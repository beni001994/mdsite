import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

/**
 * These tests assert that output never contains an executable construct:
 * no raw tag from the input, no dangerous URL scheme in href/src, no
 * attribute injection. They check structure, not just one exact string.
 */
const html = (src: string): string => renderMarkdown(src);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'id', 'style']);

/** Names of all attributes on all tags, parsing quoted values properly. */
function attributeNames(out: string): string[] {
  const names: string[] = [];
  for (const tag of out.matchAll(/<[a-zA-Z][a-zA-Z0-9]*((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>/g)) {
    for (const a of tag[1].matchAll(/\s+([a-zA-Z-]+)(?:="[^"]*")?/g)) names.push(a[1]);
  }
  return names;
}

const TAG_NAMES = /<\/?([a-zA-Z][a-zA-Z0-9]*)/g;
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'code', 'pre', 'a', 'img', 'ul', 'ol', 'li',
  'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br',
]);

function tagsIn(out: string): string[] {
  return [...out.matchAll(TAG_NAMES)].map((m) => m[1].toLowerCase());
}

describe('script and tag injection', () => {
  it.each([
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<style>*{x:expression(alert(1))}</style>',
    '<math><mi xlink:href="data:x,<script>alert(1)</script>">',
    '<details open ontoggle=alert(1)>',
    '<<script>alert(1)//<</script>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<!--[if IE]><script>alert(1)</script><![endif]-->',
    '<![CDATA[<script>alert(1)</script>]]>',
    '</p><script>alert(1)</script>',
  ])('escapes raw HTML: %s', (src) => {
    const out = html(src);
    expect(out).not.toMatch(/<(?!\/?p>)[^>]*>/); // only <p> and </p> remain
    expect(out).toContain('&lt;');
  });

  it('only ever emits allow-listed tags', () => {
    const src = [
      '# <h1>x</h1>',
      '<b>x</b> *y* **z** `<i>`',
      '> <q>x</q>',
      '- <li>x</li>',
      '| <th> |\n|---|\n| <td> |',
      '```html\n<script>alert(1)</script>\n```',
      '[<b>x</b>](/y "<t>")',
      '![<i>](/z)',
    ].join('\n\n');
    for (const tag of tagsIn(html(src))) expect(ALLOWED_TAGS.has(tag)).toBe(true);
  });
});

describe('dangerous link and image URLs', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:x',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
  ])('does not emit %j as a link target', (url) => {
    for (const src of [`[x](<${url}>)`, `![x](<${url}>)`]) {
      const out = html(src);
      expect(out).not.toMatch(/(?:href|src)="[^"]*(?:javascript|vbscript|data:|file:)/i);
      expect(out).not.toContain('<a ');
      expect(out).not.toContain('<img');
    }
  });

  it('does not emit a javascript: href for plain destinations', () => {
    expect(html('[x](javascript:alert(1))')).toBe('<p>x</p>\n');
  });

  it('does not autolink javascript: URLs', () => {
    expect(html('<javascript:alert(1)>')).not.toContain('<a ');
  });

  it('keeps entity-obfuscated schemes inert', () => {
    const out = html('[x](&#106;avascript:alert(1))');
    expect(out).toContain('href="&amp;#106;avascript:alert(1)"');
  });

  it('allows safe schemes', () => {
    expect(html('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(html('[x](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
  });
});

describe('attribute injection', () => {
  it('cannot break out of href', () => {
    const out = html('[x](/a"onmouseover="alert(1))');
    expect(out).toContain('href="/a&quot;onmouseover=&quot;alert(1)"');
    expect(attributeNames(out)).toEqual(['href']);
  });

  it('cannot break out of src or alt', () => {
    const out = html('![x" onerror="alert(1)](/a" onerror="alert(1))');
    expect(attributeNames(out).every((a) => ALLOWED_ATTRS.has(a))).toBe(true);
  });

  it('cannot break out of title', () => {
    const out = html('[x](/a "t\\" onclick=\\"alert(1)")');
    expect(attributeNames(out)).toEqual(['href', 'title']);
  });

  it('cannot inject through the code fence language', () => {
    const out = html('```js" onclick="alert(1)\nx\n```');
    expect(out).not.toContain('onclick');
    expect(html('```a"b\nx\n```')).toBe('<pre><code>x\n</code></pre>\n');
  });

  it('cannot inject through heading ids', () => {
    expect(html('# a" onclick="alert(1)')).toMatch(/^<h1 id="[a-z0-9-]+">/);
  });

  it('escapes ampersands in urls so entities cannot form', () => {
    expect(html('[x](/a?b=1&amp;c=2)')).toContain('href="/a?b=1&amp;amp;c=2"');
  });
});

describe('malformed constructs', () => {
  it.each([
    '[a](<b',
    '[a](b "c',
    '![a](',
    '[[[[',
    ']]]]',
    '(((',
    '<',
    '<<<<',
    '<a',
    '<https://x',
    '`',
    '``',
    '```',
    '*',
    '**',
    '***',
    '_',
    '\\',
    '|',
    '| a |\n|',
    '|---|',
    '>',
    '- ',
    '1.',
    '#',
    '&',
    '&#0;',
    '&#x110000;',
  ])('does not throw on %j', (src) => {
    expect(() => renderMarkdown(src)).not.toThrow();
  });

  it('does not let script text survive unescaped in any output position', () => {
    const payload = '<script>alert(1)</script>';
    const src = [
      `# ${payload}`,
      `> ${payload}`,
      `- ${payload}`,
      `1. ${payload}`,
      `*${payload}*`,
      `**${payload}**`,
      `[${payload}](/x)`,
      `![${payload}](/x)`,
      `| ${payload} |\n|---|\n| ${payload} |`,
      `\`${payload}\``,
      '```\n' + payload + '\n```',
    ].join('\n\n');
    expect(html(src)).not.toContain(payload);
    expect(html(src)).not.toMatch(/<script/i);
  });
});
