import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MdsiteError } from '../src/errors.js';
import { baseFor, buildSite, loadSite, OUTPUT_MARKER, renderSite } from '../src/site.js';
import { makeSite, post } from './helpers.js';

const read = (root: string, rel: string): string => readFileSync(join(root, 'dist', ...rel.split('/')), 'utf8');
const exists = (root: string, rel: string): boolean => existsSync(join(root, 'dist', ...rel.split('/')));

describe('baseFor', () => {
  it.each([
    ['index.html', './'],
    ['about.html', './'],
    ['posts/a.html', '../'],
    ['tags/x.html', '../'],
    ['a/b/c.html', '../../'],
  ])('%s -> %s', (path, expected) => {
    expect(baseFor(path)).toBe(expected);
  });
});

describe('building a basic site', () => {
  const files = {
    'mdsite.json': JSON.stringify({ title: 'My Blog', description: 'Notes', baseUrl: 'https://example.com/' }),
    'content/posts/older.md': post('Older post', '2024-01-05', 'tags: [Go, web]\n', '# Heading\n\nText'),
    'content/posts/newer.md': post('Newer post', '2025-06-01', 'tags: [go]\n'),
    'content/about.md': '---\ntitle: About\n---\nAbout me.\n',
  };

  it('writes pages, index, tags, feed and assets', () => {
    const root = makeSite(files);
    const r = buildSite(root);
    expect(r.posts).toBe(2);
    expect(r.pages).toBe(1);
    expect(r.tags).toBe(2);
    expect(r.feed).toBe(true);
    for (const f of [
      'index.html',
      'about.html',
      'posts/older.html',
      'posts/newer.html',
      'tags/index.html',
      'tags/go.html',
      'tags/web.html',
      'feed.xml',
      'assets/style.css',
      OUTPUT_MARKER,
    ]) {
      expect(exists(root, f), f).toBe(true);
    }
    expect(r.files).toContain('posts/older.html');
  });

  it('lists posts newest first on the index', () => {
    const root = makeSite(files);
    buildSite(root);
    const index = read(root, 'index.html');
    expect(index.indexOf('Newer post')).toBeGreaterThan(0);
    expect(index.indexOf('Newer post')).toBeLessThan(index.indexOf('Older post'));
    expect(index).toContain('<time datetime="2025-06-01">2025-06-01</time>');
    expect(index).toContain('<a href="./posts/newer.html">');
  });

  it('renders the post body inside the layout with the title and date', () => {
    const root = makeSite(files);
    buildSite(root);
    const html = read(root, 'posts/older.html');
    expect(html).toContain('<title>Older post - My Blog</title>');
    expect(html).toContain('<h1>Older post</h1>');
    expect(html).toContain('<h1 id="heading">Heading</h1>');
    expect(html).toContain('<time datetime="2024-01-05">2024-01-05</time>');
    expect(html).toContain('<link rel="stylesheet" href="../assets/style.css">');
  });

  it('uses relative links that work from nested pages', () => {
    const root = makeSite(files);
    buildSite(root);
    const html = read(root, 'posts/older.html');
    expect(html).toContain('<a class="site-title" href="../index.html">');
    expect(html).toContain('<a href="../tags/go.html">go</a>');
    expect(html).toContain('<a href="../about.html">About</a>');
    expect(read(root, 'index.html')).toContain('<a href="./about.html">About</a>');
  });

  it('marks the current page in the navigation', () => {
    const root = makeSite(files);
    buildSite(root);
    expect(read(root, 'about.html')).toContain('<a href="./about.html" aria-current="page">About</a>');
    expect(read(root, 'index.html')).toContain('<a href="./index.html" aria-current="page">Home</a>');
    expect(read(root, 'tags/go.html')).toContain('<a href="../tags/index.html" aria-current="page">Tags</a>');
  });

  it('uses the spelling from the newest post for a tag and merges case variants', () => {
    const root = makeSite(files);
    buildSite(root);
    const tags = read(root, 'tags/index.html');
    expect(tags).toContain('<a href="go.html">go</a> (2)');
    expect(tags).toContain('<a href="web.html">web</a> (1)');
    const go = read(root, 'tags/go.html');
    expect(go).toContain('Tagged: go');
    expect(go.indexOf('Newer post')).toBeLessThan(go.indexOf('Older post'));
    expect(go).toContain('<a href="../posts/newer.html">');
  });

  it('puts the site description on the index', () => {
    const root = makeSite(files);
    buildSite(root);
    expect(read(root, 'index.html')).toContain('<p class="lead">Notes</p>');
    expect(read(root, 'index.html')).toContain('<meta name="description" content="Notes">');
  });

  it('is deterministic', () => {
    const a = makeSite(files);
    const b = makeSite(files);
    buildSite(a);
    buildSite(b);
    for (const f of ['index.html', 'feed.xml', 'tags/go.html', 'posts/older.html']) {
      expect(read(a, f)).toBe(read(b, f));
    }
  });
});

describe('minimal and empty sites', () => {
  it('builds with no config file', () => {
    const root = makeSite({ 'content/hello.md': '# Hello\n' });
    const r = buildSite(root);
    expect(r.pages).toBe(1);
    expect(read(root, 'index.html')).toContain('<title>My Site</title>');
    expect(read(root, 'index.html')).toContain('No posts yet.');
  });

  it('builds with an empty content directory', () => {
    const root = makeSite({ 'content/.keep': '' });
    expect(buildSite(root).posts).toBe(0);
    expect(exists(root, 'tags/index.html')).toBe(false);
  });

  it('omits the feed when there is no baseUrl', () => {
    const root = makeSite({ 'content/posts/a.md': post('A', '2025-01-01') });
    const r = buildSite(root);
    expect(r.feed).toBe(false);
    expect(exists(root, 'feed.xml')).toBe(false);
    expect(read(root, 'index.html')).not.toContain('application/rss+xml');
  });

  it('omits the feed when there are no posts', () => {
    const root = makeSite({ 'mdsite.json': '{"baseUrl":"https://e.com"}', 'content/a.md': 'x' });
    expect(buildSite(root).feed).toBe(false);
  });

  it('advertises the feed in the head when present', () => {
    const root = makeSite({
      'mdsite.json': '{"title":"T","baseUrl":"https://e.com"}',
      'content/posts/a.md': post('A', '2025-01-01'),
    });
    buildSite(root);
    expect(read(root, 'posts/a.html')).toContain('<link rel="alternate" type="application/rss+xml" title="T" href="../feed.xml">');
  });

  it('fails clearly when the content directory is missing', () => {
    const root = makeSite({ 'mdsite.json': '{}' });
    expect(() => buildSite(root)).toThrow(/content directory not found/);
  });

  it('ignores non-markdown files and dot files in content', () => {
    const root = makeSite({
      'content/a.md': 'x',
      'content/notes.txt': 'y',
      'content/.hidden.md': 'z',
      'content/.git/config.md': 'z',
    });
    const r = buildSite(root);
    expect(r.pages).toBe(1);
  });

  it('treats a dated entry as a post wherever it lives', () => {
    const root = makeSite({ 'content/top.md': post('Top', '2025-01-01'), 'content/sub/deep/x.md': 'no date' });
    const r = buildSite(root);
    expect(r.posts).toBe(1);
    expect(exists(root, 'sub/deep/x.html')).toBe(true);
    expect(read(root, 'sub/deep/x.html')).toContain('href="../../assets/style.css"');
  });
});

describe('drafts', () => {
  const files = {
    'content/posts/live.md': post('Live', '2025-01-01'),
    'content/posts/wip.md': post('WIP', '2025-02-01', 'draft: true\n'),
    'content/secret-page.md': '---\ntitle: Secret\ndraft: true\n---\nx',
  };

  it('skips drafts by default and reports the count', () => {
    const root = makeSite(files);
    const r = buildSite(root);
    expect(r.skippedDrafts).toBe(2);
    expect(r.posts).toBe(1);
    expect(exists(root, 'posts/wip.html')).toBe(false);
    expect(exists(root, 'secret-page.html')).toBe(false);
    expect(read(root, 'index.html')).not.toContain('WIP');
  });

  it('includes drafts with the drafts option', () => {
    const root = makeSite(files);
    const r = buildSite(root, { drafts: true });
    expect(r.skippedDrafts).toBe(0);
    expect(r.posts).toBe(2);
    expect(exists(root, 'posts/wip.html')).toBe(true);
    expect(exists(root, 'secret-page.html')).toBe(true);
  });

  it('does not create tag pages for tags that only drafts use', () => {
    const root = makeSite({
      'content/a.md': post('A', '2025-01-01'),
      'content/b.md': post('B', '2025-01-02', 'tags: [only-draft]\ndraft: true\n'),
    });
    buildSite(root);
    expect(exists(root, 'tags/only-draft.html')).toBe(false);
  });

  it('does not validate drafts beyond their front matter', () => {
    const root = makeSite({ 'content/a.md': post('A', '2025-01-01', 'draft: true\n') });
    expect(() => buildSite(root)).not.toThrow();
  });
});

describe('static files', () => {
  it('copies static files preserving structure', () => {
    const root = makeSite({
      'content/a.md': 'x',
      'static/robots.txt': 'User-agent: *',
      'static/img/deep/logo.svg': '<svg/>',
    });
    buildSite(root);
    expect(read(root, 'robots.txt')).toBe('User-agent: *');
    expect(read(root, 'img/deep/logo.svg')).toBe('<svg/>');
  });

  it('lets static/assets/style.css replace the default stylesheet', () => {
    const root = makeSite({ 'content/a.md': 'x', 'static/assets/style.css': 'body{color:red}' });
    buildSite(root);
    expect(read(root, 'assets/style.css')).toBe('body{color:red}');
  });

  it('rejects static files that collide with generated pages', () => {
    const root = makeSite({ 'content/a.md': 'x', 'static/index.html': 'mine' });
    expect(() => buildSite(root)).toThrow(/static\/index\.html collides/);
  });

  it('works without a static directory', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    expect(() => buildSite(root)).not.toThrow();
  });
});

describe('output directory safety', () => {
  it('replaces stale files from a previous build', () => {
    const root = makeSite({ 'content/a.md': 'x', 'content/b.md': 'y' });
    buildSite(root);
    expect(exists(root, 'b.html')).toBe(true);
    writeFileSync(join(root, 'content', 'b.md'), '---\ntitle: B\ndraft: true\n---\n');
    buildSite(root);
    expect(exists(root, 'b.html')).toBe(false);
    expect(exists(root, 'a.html')).toBe(true);
  });

  it('refuses to clean a non-empty directory it did not create', () => {
    const root = makeSite({ 'content/a.md': 'x', 'dist/precious.txt': 'keep me' });
    expect(() => buildSite(root)).toThrow(/refusing to write into .*not empty/);
    expect(readFileSync(join(root, 'dist', 'precious.txt'), 'utf8')).toBe('keep me');
  });

  it('writes into an existing empty directory', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    mkdirSync(join(root, 'dist'));
    expect(() => buildSite(root)).not.toThrow();
  });

  it('does not touch the output directory when the content has an error', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    buildSite(root);
    writeFileSync(join(root, 'content', 'bad.md'), '---\ndate: nope\n---\n');
    expect(() => buildSite(root)).toThrow(MdsiteError);
    expect(exists(root, 'a.html')).toBe(true);
  });

  it('supports an output directory override', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    const out = join(root, 'elsewhere');
    const r = buildSite(root, { outDir: out });
    expect(r.outDir).toBe(out);
    expect(existsSync(join(out, 'a.html'))).toBe(true);
  });

  it('refuses an output directory that contains the site', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    expect(() => buildSite(root, { outDir: root })).toThrow(/must not be the site root or contain it/);
    expect(() => buildSite(root, { outDir: join(root, '..') })).toThrow(/must not be the site root or contain it/);
  });

  it('refuses an output directory inside the content directory', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    expect(() => buildSite(root, { outDir: join(root, 'content', 'out') })).toThrow(/overlap the content directory/);
  });
});

describe('content errors', () => {
  it('names the file and line for front matter problems', () => {
    const root = makeSite({ 'content/posts/bad.md': '---\ntitle: A\noops\n---\nx' });
    expect(() => buildSite(root)).toThrow(/posts\/bad\.md: front matter line 3/);
  });

  it('names the file for invalid dates', () => {
    const root = makeSite({ 'content/bad.md': '---\ndate: 2025-02-30\n---\nx' });
    expect(() => buildSite(root)).toThrow(/bad\.md: "date" must look like/);
  });

  it('rejects two sources that map to the same output file', () => {
    const root = makeSite({ 'content/My Post.md': 'a', 'content/my-post.md': 'b' });
    expect(() => buildSite(root)).toThrow(/would both be written to my-post\.html/);
  });

  it('rejects a source file named index (it would replace the generated index)', () => {
    const root = makeSite({ 'content/index.md': 'x' });
    expect(() => buildSite(root)).toThrow(/collides with the generated file index\.html/);
  });

  it('rejects a source that collides with a tag page', () => {
    const root = makeSite({
      'content/tags/go.md': 'x',
      'content/posts/a.md': post('A', '2025-01-01', 'tags: [go]\n'),
    });
    expect(() => buildSite(root)).toThrow(/collides with the generated page tags\/go\.html/);
  });

  it('rejects file names that cannot become a URL', () => {
    const root = makeSite({ 'content/!!!.md': 'x' });
    expect(() => buildSite(root)).toThrow(/cannot derive a URL/);
  });

  it('rejects different tags that share a slug', () => {
    const root = makeSite({
      'content/a.md': post('A', '2025-01-01', 'tags: ["C++"]\n'),
      'content/b.md': post('B', '2025-01-02', 'tags: ["C#"]\n'),
    });
    expect(() => buildSite(root)).toThrow(/both map to the URL slug "c"/);
  });

  it('rejects tags with no usable characters', () => {
    const root = makeSite({ 'content/a.md': post('A', '2025-01-01', 'tags: ["???"]\n') });
    expect(() => buildSite(root)).toThrow(/tag "\?\?\?" has no letters or digits/);
  });

  it('warns that tags are ignored on undated pages', () => {
    const root = makeSite({ 'content/p.md': '---\ntitle: P\ntags: [x]\n---\nbody' });
    const r = buildSite(root);
    expect(r.warnings.join('\n')).toMatch(/p\.md: tags are ignored/);
    expect(exists(root, 'tags/x.html')).toBe(false);
  });
});

describe('escaping in generated pages', () => {
  it('escapes titles, tags and the site title everywhere they appear', () => {
    const evil = '<script>alert(1)</script>';
    const root = makeSite({
      'mdsite.json': JSON.stringify({ title: evil, description: evil }),
      'content/posts/a.md': `---\ntitle: ${JSON.stringify(evil)}\ndate: 2025-01-01\ntags: [${JSON.stringify(evil + 'x')}]\n---\nbody`,
      'content/page.md': `---\ntitle: ${JSON.stringify(evil)}\n---\nbody`,
    });
    // tag slug becomes "script-alert-1-script-x"
    buildSite(root);
    for (const f of ['index.html', 'posts/a.html', 'page.html', 'tags/index.html', 'tags/script-alert-1-script-x.html']) {
      const html = read(root, f);
      expect(html, f).not.toContain(evil);
      expect(html, f).not.toMatch(/<script/i);
    }
  });

  it('escapes markdown content too', () => {
    const root = makeSite({ 'content/a.md': '<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))' });
    buildSite(root);
    const html = read(root, 'a.html');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
  });
});

describe('custom layout', () => {
  it('uses layout.html from the site root', () => {
    const root = makeSite({
      'content/a.md': '---\ntitle: A\n---\nhello',
      'layout.html': '<html><title>{{title}}</title>{{{content}}}<p>{{base}}</p></html>',
    });
    buildSite(root);
    const html = read(root, 'a.html');
    expect(html).toContain('<title>A</title>');
    expect(html).toContain('<p>hello</p>');
    expect(html).toContain('<p>./</p>');
  });

  it('reports unknown layout variables', () => {
    const root = makeSite({ 'content/a.md': 'x', 'layout.html': '{{nope}}' });
    expect(() => buildSite(root)).toThrow(/unknown variable "nope"/);
  });

  it('renderSite accepts a layout string directly', () => {
    const root = makeSite({ 'content/a.md': 'x' });
    const site = loadSite(root);
    const out = renderSite(site, '[{{siteTitle}}]{{{content}}}');
    expect(out.get('index.html')).toMatch(/^\[My Site\]/);
  });
});

describe('page ordering', () => {
  it('orders pages by the order key, then title', () => {
    const root = makeSite({
      'content/z.md': '---\ntitle: Zeta\norder: 1\n---\n',
      'content/b.md': '---\ntitle: Beta\n---\n',
      'content/a.md': '---\ntitle: Alpha\n---\n',
      'content/c.md': '---\ntitle: Gamma\norder: 0\n---\n',
    });
    buildSite(root);
    const nav = read(root, 'index.html');
    const idx = ['Gamma', 'Zeta', 'Alpha', 'Beta'].map((t) => nav.indexOf(`>${t}</a>`));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it('breaks date ties by title', () => {
    const root = makeSite({
      'content/b.md': post('Bravo', '2025-01-01'),
      'content/a.md': post('Alpha', '2025-01-01'),
    });
    buildSite(root);
    const index = read(root, 'index.html');
    expect(index.indexOf('Alpha')).toBeLessThan(index.indexOf('Bravo'));
  });
});
