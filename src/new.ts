import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { MdsiteError } from './errors.js';
import { quoteFrontMatterString } from './frontmatter.js';
import { slugify } from './slug.js';

function localDate(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Create content/posts/<slug>.md with front matter. Never overwrites an existing file. */
export function createPost(root: string, title: string, now: Date = new Date()): string {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (cleanTitle === '') throw new MdsiteError('a post title is required');
  const slug = slugify(cleanTitle);
  if (slug === '') {
    throw new MdsiteError(`cannot derive a file name from the title ${JSON.stringify(cleanTitle)} (use letters or digits)`);
  }
  const config = loadConfig(root);
  const dir = join(config.contentDir, 'posts');
  const file = resolve(dir, `${slug}.md`);
  if (existsSync(file)) throw new MdsiteError(`${relative(config.root, file)} already exists`);
  mkdirSync(dir, { recursive: true });
  const text = [
    '---',
    `title: ${quoteFrontMatterString(cleanTitle)}`,
    `date: ${localDate(now)}`,
    'tags: []',
    'draft: true',
    '---',
    '',
    'Write your post here. Remove `draft: true` when it is ready to publish.',
    '',
  ].join('\n');
  writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
  return file;
}
