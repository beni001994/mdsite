import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFeed } from '../src/rss.js';
import { loadConfig } from '../src/config.js';
import { buildSite } from '../src/site.js';
import type { Entry } from '../src/site.js';
import { makeSite, post } from './helpers.js';

function entry(title: string, date: string, extra: Partial<Entry> = {}): Entry {
  return {
    source: 'x.md',
    outPath: 'posts/x.html',
    html: '<p>body</p>\n',
    isPost: true,
    meta: { title, date: new Date(date), dateText: date.slice(0, 10), tags: [], draft: false },
    ...extra,
  };
}

const config = (extra: Record<string, unknown> = {}) =>
  loadConfig(makeSite({ 'mdsite.json': JSON.stringify({ title: 'Feed & Co', baseUrl: 'https://example.com/blog', ...extra }) }));

describe('buildFeed', () => {
  it('produces an RSS 2.0 document with channel metadata', () => {
    const xml = buildFeed(config({ description: 'About <things>', language: 'fr' }), [entry('A', '2025-01-02')]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
    expect(xml).toContain('<title>Feed &amp; Co</title>');
    expect(xml).toContain('<link>https://example.com/blog/</link>');
    expect(xml).toContain('<description>About &lt;things&gt;</description>');
    expect(xml).toContain('<language>fr</language>');
    expect(xml).toContain('<atom:link href="https://example.com/blog/feed.xml" rel="self" type="application/rss+xml"/>');
    expect(xml.trimEnd().endsWith('</rss>')).toBe(true);
  });

  it('falls back to the title when there is no description', () => {
    expect(buildFeed(config(), [entry('A', '2025-01-02')])).toContain('<description>Feed &amp; Co</description>');
  });

  it('builds absolute item links and permalink guids', () => {
    const xml = buildFeed(config(), [entry('A', '2025-01-02')]);
    expect(xml).toContain('<link>https://example.com/blog/posts/x.html</link>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/blog/posts/x.html</guid>');
  });

  it('formats dates as RFC 822 and sets lastBuildDate to the newest post', () => {
    const xml = buildFeed(config(), [entry('New', '2025-03-04'), entry('Old', '2024-01-01')]);
    expect(xml).toContain('<pubDate>Tue, 04 Mar 2025 00:00:00 GMT</pubDate>');
    expect(xml).toContain('<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>');
    expect(xml).toContain('<lastBuildDate>Tue, 04 Mar 2025 00:00:00 GMT</lastBuildDate>');
  });

  it('escapes titles, categories and the HTML body', () => {
    const e = entry('Tom & <Jerry>', '2025-01-02');
    e.meta.tags = ['a&b', '<x>'];
    e.html = '<p>1 < 2 & "q"</p>';
    const xml = buildFeed(config(), [e]);
    expect(xml).toContain('<title>Tom &amp; &lt;Jerry&gt;</title>');
    expect(xml).toContain('<category>a&amp;b</category>');
    expect(xml).toContain('<category>&lt;x&gt;</category>');
    expect(xml).toContain('<description>&lt;p&gt;1 &lt; 2 &amp; &quot;q&quot;&lt;/p&gt;</description>');
    expect(xml).not.toContain('<Jerry>');
  });

  it('strips characters that are illegal in XML', () => {
    const xml = buildFeed(config(), [entry('a' + String.fromCharCode(0, 8) + 'b', '2025-01-02')]);
    expect(xml).toContain('<title>ab</title>');
  });

  it('respects feedLimit', () => {
    const posts = [1, 2, 3, 4].map((n) => entry(`P${n}`, `2025-01-0${n}`));
    const xml = buildFeed(config({ feedLimit: 2 }), posts);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain('P1');
    expect(xml).not.toContain('P3');
  });

  it('is deterministic (no wall-clock values)', () => {
    const c = config();
    const posts = [entry('A', '2025-01-02')];
    expect(buildFeed(c, posts)).toBe(buildFeed(c, posts));
  });

  it('produces well-formed element nesting', () => {
    const xml = buildFeed(config(), [entry('A', '2025-01-02'), entry('B', '2025-01-01')]);
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z:]+)[^>]*?(\/?)>/g)) {
      if (m[3] === '/') continue;
      if (m[1] === '') stack.push(m[2]);
      else expect(stack.pop()).toBe(m[2]);
    }
    expect(stack).toEqual([]);
  });
});

describe('feed in a built site', () => {
  it('contains only published posts, newest first', () => {
    const root = makeSite({
      'mdsite.json': '{"title":"T","baseUrl":"https://example.com"}',
      'content/posts/a.md': post('First', '2025-01-01'),
      'content/posts/b.md': post('Second', '2025-02-01'),
      'content/posts/c.md': post('Hidden', '2025-03-01', 'draft: true\n'),
      'content/about.md': '---\ntitle: About\n---\nx',
    });
    buildSite(root);
    const xml = readFileSync(join(root, 'dist', 'feed.xml'), 'utf8');
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml.indexOf('Second')).toBeLessThan(xml.indexOf('First'));
    expect(xml).not.toContain('Hidden');
    expect(xml).not.toContain('About');
    expect(xml).toContain('https://example.com/posts/b.html');
  });
});
