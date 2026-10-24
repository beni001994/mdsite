import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { loadConfig, isInside, type SiteConfig } from './config.js';
import { MdsiteError } from './errors.js';
import { escapeHtml } from './escape.js';
import { parseFrontMatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { buildMeta, type PostMeta } from './meta.js';
import { buildFeed } from './rss.js';
import { slugify } from './slug.js';
import { DEFAULT_CSS, DEFAULT_LAYOUT, renderTemplate } from './template.js';

export const OUTPUT_MARKER = '.mdsite-output';
export const STYLE_PATH = 'assets/style.css';
export const FEED_PATH = 'feed.xml';

export interface Entry {
  /** Source path relative to the content directory, with forward slashes. */
  source: string;
  /** Output path relative to the output directory, with forward slashes. */
  outPath: string;
  meta: PostMeta;
  html: string;
  /** Posts are entries with a date; the rest are standalone pages. */
  isPost: boolean;
}

export interface TagInfo {
  name: string;
  slug: string;
  posts: Entry[];
}

export interface Site {
  config: SiteConfig;
  posts: Entry[];
  pages: Entry[];
  tags: TagInfo[];
  warnings: string[];
  skippedDrafts: number;
}

export interface BuildOptions {
  drafts?: boolean;
  outDir?: string;
}

export interface BuildResult {
  outDir: string;
  posts: number;
  pages: number;
  tags: number;
  files: string[];
  warnings: string[];
  skippedDrafts: number;
  feed: boolean;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function walkMarkdown(dir: string, rel: string, found: string[], warnings: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const childRel = rel === '' ? ent.name : `${rel}/${ent.name}`;
    if (ent.isSymbolicLink()) {
      warnings.push(`skipped symbolic link ${childRel}`);
    } else if (ent.isDirectory()) {
      walkMarkdown(join(dir, ent.name), childRel, found, warnings);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      found.push(childRel);
    }
  }
}

function outPathFor(source: string): string {
  const withoutExt = source.replace(/\.md$/i, '');
  const segments = withoutExt.split('/').map((s) => slugify(s));
  if (segments.some((s) => s === '')) {
    throw new MdsiteError(`${source}: cannot derive a URL from this file name (use letters or digits)`);
  }
  return segments.join('/') + '.html';
}

function compareEntries(a: Entry, b: Entry): number {
  const da = a.meta.date?.getTime() ?? 0;
  const db = b.meta.date?.getTime() ?? 0;
  if (da !== db) return db - da;
  if (a.meta.title !== b.meta.title) return a.meta.title < b.meta.title ? -1 : 1;
  return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
}

export function loadSite(root: string, options: BuildOptions = {}): Site {
  const config = loadConfig(root, options.outDir);
  if (!existsSync(config.contentDir) || !statSync(config.contentDir).isDirectory()) {
    throw new MdsiteError(`content directory not found: ${config.contentDir}`);
  }
  const warnings: string[] = [];
  const files: string[] = [];
  walkMarkdown(config.contentDir, '', files, warnings);

  const posts: Entry[] = [];
  const pages: Entry[] = [];
  const claimed = new Map<string, string>();
  let skippedDrafts = 0;

  for (const source of files) {
    const outPath = outPathFor(source);
    const text = readFileSync(join(config.contentDir, ...source.split('/')), 'utf8');
    let entry: Entry;
    try {
      const { data, body } = parseFrontMatter(text);
      const baseName = posix.basename(source).replace(/\.md$/i, '');
      const meta = buildMeta(data, baseName);
      if (meta.draft && !options.drafts) {
        skippedDrafts++;
        continue;
      }
      entry = { source, outPath, meta, html: renderMarkdown(body), isPost: meta.date !== undefined };
    } catch (e) {
      if (e instanceof MdsiteError) throw new MdsiteError(`${source}: ${e.message}`);
      throw e;
    }
    const other = claimed.get(outPath);
    if (other) {
      throw new MdsiteError(`${source} and ${other} would both be written to ${outPath}`);
    }
    claimed.set(outPath, source);
    if (entry.isPost) posts.push(entry);
    else {
      if (entry.meta.tags.length > 0) {
        warnings.push(`${source}: tags are ignored on pages without a date`);
      }
      pages.push(entry);
    }
  }

  posts.sort(compareEntries);
  pages.sort((a, b) => {
    const oa = a.meta.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.meta.order ?? Number.MAX_SAFE_INTEGER;
    return oa !== ob ? oa - ob : compareEntries(a, b);
  });

  const tags = collectTags(posts);
  for (const tag of tags) {
    for (const reserved of [`tags/${tag.slug}.html`]) {
      const other = claimed.get(reserved);
      if (other) throw new MdsiteError(`${other} collides with the generated page ${reserved} for tag "${tag.name}"`);
    }
  }
  for (const reserved of ['index.html', 'tags/index.html', FEED_PATH]) {
    const other = claimed.get(reserved);
    if (other) throw new MdsiteError(`${other} collides with the generated file ${reserved}`);
  }

  return { config, posts, pages, tags, warnings, skippedDrafts };
}

function collectTags(posts: Entry[]): TagInfo[] {
  const bySlug = new Map<string, TagInfo>();
  for (const post of posts) {
    for (const name of post.meta.tags) {
      const slug = slugify(name);
      if (slug === '') {
        throw new MdsiteError(`${post.source}: tag "${name}" has no letters or digits to build a URL from`);
      }
      let info = bySlug.get(slug);
      if (!info) {
        info = { name, slug, posts: [] };
        bySlug.set(slug, info);
      } else if (info.name.toLowerCase() !== name.toLowerCase()) {
        throw new MdsiteError(`tags "${info.name}" and "${name}" both map to the URL slug "${slug}"; rename one`);
      }
      info.posts.push(post);
    }
  }
  return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Rendering (pure: no file system access)
// ---------------------------------------------------------------------------

/** Relative path prefix from a page back to the site root, e.g. "../" for "tags/x.html". */
export function baseFor(outPath: string): string {
  const depth = outPath.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

function navHtml(site: Site, current: string): string {
  const base = baseFor(current);
  const link = (path: string, label: string, active: boolean): string =>
    `<a href="${base}${path}"${active ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
  const items = [link('index.html', 'Home', current === 'index.html')];
  if (site.tags.length > 0) {
    items.push(link('tags/index.html', 'Tags', current === 'tags/index.html' || current.startsWith('tags/')));
  }
  for (const page of site.pages) {
    items.push(link(page.outPath, page.meta.title, page.outPath === current));
  }
  return items.join('\n');
}

function tagLinks(entry: Entry, site: Site, base: string): string {
  if (entry.meta.tags.length === 0) return '';
  const links = entry.meta.tags.map((name) => {
    const slug = slugify(name);
    const info = site.tags.find((t) => t.slug === slug);
    return `<a href="${base}tags/${info?.slug ?? slug}.html">${escapeHtml(info?.name ?? name)}</a>`;
  });
  return `<span class="tags">${links.join(' ')}</span>`;
}

function postList(posts: Entry[], site: Site, base: string): string {
  if (posts.length === 0) return '<p>No posts yet.</p>';
  const items = posts.map((p) => {
    const tags = tagLinks(p, site, base);
    return (
      `<li><a href="${base}${p.outPath}">${escapeHtml(p.meta.title)}</a> ` +
      `<time datetime="${escapeHtml(p.meta.dateText ?? '')}">${escapeHtml(p.meta.dateText ?? '')}</time>` +
      (tags ? ` ${tags}` : '') +
      '</li>'
    );
  });
  return `<ul class="post-list">\n${items.join('\n')}\n</ul>`;
}

export function renderSite(site: Site, layout: string = DEFAULT_LAYOUT): Map<string, string> {
  const { config } = site;
  const out = new Map<string, string>();
  const hasFeed = config.baseUrl !== undefined && site.posts.length > 0;

  const wrap = (outPath: string, title: string | null, description: string, content: string): string => {
    const base = baseFor(outPath);
    const head = hasFeed
      ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(config.title)}" href="${base}${FEED_PATH}">`
      : '';
    return renderTemplate(layout, {
      lang: config.language,
      siteTitle: config.title,
      pageTitle: title === null ? config.title : `${title} - ${config.title}`,
      title: title ?? config.title,
      description,
      base,
      head,
      nav: navHtml(site, outPath),
      content,
    });
  };

  // Entries
  for (const entry of [...site.posts, ...site.pages]) {
    const base = baseFor(entry.outPath);
    let article: string;
    if (entry.isPost) {
      const tags = tagLinks(entry, site, base);
      const d = escapeHtml(entry.meta.dateText ?? '');
      article =
        `<article>\n<h1>${escapeHtml(entry.meta.title)}</h1>\n` +
        `<p class="meta"><time datetime="${d}">${d}</time>${tags ? ` ${tags}` : ''}</p>\n` +
        `${entry.html}</article>`;
    } else {
      article = `<article>\n<h1>${escapeHtml(entry.meta.title)}</h1>\n${entry.html}</article>`;
    }
    out.set(entry.outPath, wrap(entry.outPath, entry.meta.title, entry.meta.description ?? config.description, article));
  }

  // Index
  const intro = config.description ? `<p class="lead">${escapeHtml(config.description)}</p>\n` : '';
  out.set(
    'index.html',
    wrap('index.html', null, config.description, `<h1>Posts</h1>\n${intro}${postList(site.posts, site, './')}\n`),
  );

  // Tags
  if (site.tags.length > 0) {
    const list = site.tags
      .map((t) => `<li><a href="${t.slug}.html">${escapeHtml(t.name)}</a> (${t.posts.length})</li>`)
      .join('\n');
    out.set(
      'tags/index.html',
      wrap('tags/index.html', 'Tags', config.description, `<h1>Tags</h1>\n<ul class="tag-list">\n${list}\n</ul>\n`),
    );
    for (const tag of site.tags) {
      const outPath = `tags/${tag.slug}.html`;
      out.set(
        outPath,
        wrap(
          outPath,
          `Tagged: ${tag.name}`,
          config.description,
          `<h1>Tagged: ${escapeHtml(tag.name)}</h1>\n${postList(tag.posts, site, '../')}\n`,
        ),
      );
    }
  }

  if (hasFeed) out.set(FEED_PATH, buildFeed(config, site.posts));
  out.set(STYLE_PATH, DEFAULT_CSS);
  return out;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function collectStatic(dir: string, warnings: string[]): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string, rel: string): void => {
    for (const ent of readdirSync(current, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const childRel = rel === '' ? ent.name : `${rel}/${ent.name}`;
      if (ent.isSymbolicLink()) warnings.push(`skipped symbolic link static/${childRel}`);
      else if (ent.isDirectory()) walk(join(current, ent.name), childRel);
      else if (ent.isFile()) found.push(childRel);
    }
  };
  walk(dir, '');
  return found.sort();
}

function prepareOutDir(outDir: string): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  } else {
    if (!statSync(outDir).isDirectory()) throw new MdsiteError(`${outDir} exists and is not a directory`);
    const children = readdirSync(outDir);
    if (children.length > 0) {
      if (!children.includes(OUTPUT_MARKER)) {
        throw new MdsiteError(
          `refusing to write into ${outDir}: it is not empty and was not created by mdsite ` +
            `(no ${OUTPUT_MARKER} file). Choose another --out directory or empty this one.`,
        );
      }
      for (const child of children) rmSync(join(outDir, child), { recursive: true, force: true });
    }
  }
  writeFileSync(join(outDir, OUTPUT_MARKER), 'This directory is managed by mdsite and is emptied on every build.\n');
}

function safeJoin(outDir: string, rel: string): string {
  const target = resolve(outDir, ...rel.split('/'));
  if (!isInside(outDir, target) || target === resolve(outDir)) {
    throw new MdsiteError(`refusing to write outside the output directory: ${rel}`);
  }
  return target;
}

export function loadLayout(root: string): string {
  const file = join(resolve(root), 'layout.html');
  return existsSync(file) ? readFileSync(file, 'utf8') : DEFAULT_LAYOUT;
}

export function buildSite(root: string, options: BuildOptions = {}): BuildResult {
  const site = loadSite(root, options);
  const outputs = renderSite(site, loadLayout(root));
  const staticFiles = collectStatic(site.config.staticDir, site.warnings);

  for (const rel of staticFiles) {
    if (outputs.has(rel) && rel !== STYLE_PATH) {
      throw new MdsiteError(`static/${rel} collides with a generated file of the same name`);
    }
  }
  const overrideStyle = staticFiles.includes(STYLE_PATH);
  if (overrideStyle) outputs.delete(STYLE_PATH);

  const { outDir } = site.config;
  prepareOutDir(outDir);

  const written: string[] = [];
  for (const [rel, content] of outputs) {
    const target = safeJoin(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    written.push(rel);
  }
  for (const rel of staticFiles) {
    const target = safeJoin(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(site.config.staticDir, ...rel.split('/')), target);
    written.push(rel);
  }

  return {
    outDir,
    posts: site.posts.length,
    pages: site.pages.length,
    tags: site.tags.length,
    files: written.sort(),
    warnings: site.warnings,
    skippedDrafts: site.skippedDrafts,
    feed: outputs.has(FEED_PATH),
  };
}
