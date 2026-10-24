import type { SiteConfig } from './config.js';
import { escapeXml } from './escape.js';
import type { Entry } from './site.js';

/**
 * Build an RSS 2.0 feed. Requires config.baseUrl (feeds need absolute URLs).
 * `posts` must already be sorted newest first. The feed is deterministic:
 * lastBuildDate is the newest post date, not the wall clock.
 *
 * Item bodies are the rendered HTML, XML-escaped. Relative links and image
 * URLs inside post bodies are NOT rewritten to absolute URLs.
 */
export function buildFeed(config: SiteConfig, posts: Entry[]): string {
  const base = config.baseUrl as string;
  const items = posts.slice(0, config.feedLimit);
  const newest = items[0]?.meta.date;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escapeXml(config.title)}</title>`,
    `<link>${escapeXml(base + '/')}</link>`,
    `<description>${escapeXml(config.description || config.title)}</description>`,
    `<language>${escapeXml(config.language)}</language>`,
    `<atom:link href="${escapeXml(base + '/feed.xml')}" rel="self" type="application/rss+xml"/>`,
  ];
  if (newest) lines.push(`<lastBuildDate>${newest.toUTCString()}</lastBuildDate>`);
  for (const post of items) {
    const url = `${base}/${post.outPath}`;
    lines.push('<item>');
    lines.push(`<title>${escapeXml(post.meta.title)}</title>`);
    lines.push(`<link>${escapeXml(url)}</link>`);
    lines.push(`<guid isPermaLink="true">${escapeXml(url)}</guid>`);
    if (post.meta.date) lines.push(`<pubDate>${post.meta.date.toUTCString()}</pubDate>`);
    for (const tag of post.meta.tags) lines.push(`<category>${escapeXml(tag)}</category>`);
    lines.push(`<description>${escapeXml(post.html)}</description>`);
    lines.push('</item>');
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}
