import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSite } from '../src/site.js';

const example = resolve(import.meta.dirname, '..', 'example');
const out = mkdtempSync(join(tmpdir(), 'mdsite-example-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const result = buildSite(example, { outDir: join(out, 'site') });
const read = (rel: string): string => readFileSync(join(out, 'site', rel), 'utf8');

describe('example site', () => {
  it('builds without warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('contains the expected pages', () => {
    expect(result.posts).toBe(3);
    expect(result.pages).toBe(1);
    expect(result.skippedDrafts).toBe(1);
    for (const f of [
      'index.html',
      'about.html',
      'posts/welcome.html',
      'posts/markdown-tour.html',
      'posts/getting-started.html',
      'tags/index.html',
      'tags/meta.html',
      'tags/markdown.html',
      'tags/tutorial.html',
      'tags/reference.html',
      'feed.xml',
      'images/logo.svg',
      'robots.txt',
    ]) {
      expect(existsSync(join(out, 'site', f)), f).toBe(true);
    }
  });

  it('does not publish the draft', () => {
    expect(existsSync(join(out, 'site', 'posts', 'unfinished.html'))).toBe(false);
    expect(read('index.html')).not.toContain('Unfinished');
    expect(read('feed.xml')).not.toContain('Unfinished');
  });

  it('lists posts newest first', () => {
    const index = read('index.html');
    const order = ['Welcome to Field Notes', 'A tour of the supported Markdown', 'Getting started with mdsite'].map((t) =>
      index.indexOf(t),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders the Markdown tour features', () => {
    const html = read('posts/markdown-tour.html');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:center">Supported</th>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<br>');
  });

  it('neutralizes the script and javascript: link in the tour', () => {
    const html = read('posts/markdown-tour.html');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;alert(&quot;not executed&quot;)&lt;/script&gt;');
  });

  it('links internal pages with working relative URLs', () => {
    const welcome = read('posts/welcome.html');
    expect(welcome).toContain('href="../about.html"');
    expect(welcome).toContain('src="../images/logo.svg"');
    expect(existsSync(join(out, 'site', 'about.html'))).toBe(true);
    expect(existsSync(join(out, 'site', 'images', 'logo.svg'))).toBe(true);
  });

  it('writes a feed with absolute URLs from baseUrl', () => {
    const xml = read('feed.xml');
    expect(xml.match(/<item>/g)).toHaveLength(3);
    expect(xml).toContain('<link>https://example.com/notes/posts/welcome.html</link>');
  });

  it('shows the about page in the navigation', () => {
    expect(read('index.html')).toContain('<a href="./about.html">About</a>');
  });
});
