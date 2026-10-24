import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeXml, htmlToText, sanitizeUrl, unescapeHtml } from '../src/escape.js';

const ch = (...codes: number[]): string => String.fromCharCode(...codes);

describe('escapeHtml', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
    ['plain', 'plain'],
    ['', ''],
    ['a & b < c > d', 'a &amp; b &lt; c &gt; d'],
    ['&amp;', '&amp;amp;'],
    ['<script>alert("x")</script>', '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'],
  ])('escapes %j', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('leaves non-ASCII text alone', () => {
    const s = ch(0xe9, 0x20, 0x65e5, 0x672c);
    expect(escapeHtml(s)).toBe(s);
  });

  it('round-trips through unescapeHtml', () => {
    const s = `<a href="x">'&amp;'</a>`;
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
  });

  it('never leaves a raw angle bracket or quote', () => {
    const nasty = `<>"'&`.repeat(50);
    expect(escapeHtml(nasty)).not.toMatch(/[<>"']/);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });

  it('drops characters that are illegal in XML 1.0', () => {
    expect(escapeXml(`a${ch(0)}b${ch(8)}c${ch(11)}d${ch(0xffff)}e`)).toBe('abcde');
  });

  it('keeps tab, newline and carriage return', () => {
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes the entities escapeHtml produces', () => {
    expect(htmlToText('<em>a</em> &amp; &lt;b&gt;')).toBe('a & <b>');
  });

  it('decodes only once', () => {
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });
});

describe('sanitizeUrl', () => {
  it('treats entity-obfuscated schemes as inert relative URLs (the & gets escaped later)', () => {
    // A URL starting with "&" has no scheme, and escapeHtml turns "&#106;" into "&amp;#106;"
    // so the browser never decodes it into a "j".
    expect(sanitizeUrl('&#106;avascript:alert(1)')).toBe('&#106;avascript:alert(1)');
    expect(escapeHtml(sanitizeUrl('&#106;avascript:alert(1)') as string)).toBe('&amp;#106;avascript:alert(1)');
  });

  it.each([
    'http://example.com',
    'https://example.com/a?b=c#d',
    'HTTPS://EXAMPLE.COM',
    'mailto:me@example.com',
    'tel:+123456',
    '/absolute/path',
    'relative/path.html',
    '../up.html',
    './here',
    '#fragment',
    '?query=1',
    '//cdn.example.com/x.js',
    '',
    'file.html/with:colon-after-slash',
    'a/b:c',
  ])('allows %j', (url) => {
    expect(sanitizeUrl(url)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    ch(1) + 'javascript:alert(1)',
    ch(0) + 'javascript:alert(1)',
    ch(0x200b) + 'javascript:alert(1)',
    ch(0xfeff) + 'javascript:alert(1)',
    'jav' + ch(0xad) + 'ascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,AAAA',
    'file:///etc/passwd',
    'ftp://example.com',
    'blob:https://example.com/x',
    'about:blank',
    'x-custom:thing',
  ])('rejects %j', (url) => {
    expect(sanitizeUrl(url)).toBeNull();
  });
});
