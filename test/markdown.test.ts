import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown, renderMarkdown } from '../src/markdown.js';

const md = (src: string): string => renderMarkdown(src).replace(/\n$/, '');
const noIds = (src: string): string => renderMarkdown(src, { headingIds: false }).replace(/\n$/, '');

describe('paragraphs and whitespace', () => {
  it('returns an empty string for empty or blank input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n\t\n')).toBe('');
  });

  it('wraps text in a paragraph and ends output with a newline', () => {
    expect(renderMarkdown('hello')).toBe('<p>hello</p>\n');
  });

  it('splits paragraphs on blank lines', () => {
    expect(md('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
    expect(md('one\n\n\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  it('keeps soft line breaks as newlines inside one paragraph', () => {
    expect(md('one\ntwo')).toBe('<p>one\ntwo</p>');
  });

  it('turns two trailing spaces into a hard break', () => {
    expect(md('one  \ntwo')).toBe('<p>one<br>\ntwo</p>');
  });

  it('turns a trailing backslash into a hard break', () => {
    expect(md('one\\\ntwo')).toBe('<p>one<br>\ntwo</p>');
  });

  it('does not add a break for a single trailing space', () => {
    expect(md('one \ntwo')).toBe('<p>one\ntwo</p>');
  });

  it('normalizes CRLF and lone CR line endings', () => {
    expect(md('a\r\n\r\nb')).toBe('<p>a</p>\n<p>b</p>');
    expect(md('a\r\rb')).toBe('<p>a</p>\n<p>b</p>');
  });

  it('strips a leading byte order mark', () => {
    expect(md('\ufeff# Hi')).toBe('<h1 id="hi">Hi</h1>');
  });

  it('replaces NUL characters instead of passing them through', () => {
    expect(md('a\u0000b')).toBe('<p>a\ufffdb</p>');
  });

  it('strips leading indentation of paragraph lines', () => {
    expect(md('   indented')).toBe('<p>indented</p>');
  });

  it('treats 4-space indentation as paragraph text (indented code is unsupported)', () => {
    expect(md('    code?')).toBe('<p>code?</p>');
  });
});

describe('headings', () => {
  it.each([1, 2, 3, 4, 5, 6])('renders level %i', (level) => {
    expect(md(`${'#'.repeat(level)} Title`)).toBe(`<h${level} id="title">Title</h${level}>`);
  });

  it('does not treat 7 hashes as a heading', () => {
    expect(md('####### Nope')).toBe('<p>####### Nope</p>');
  });

  it('requires a space after the hashes', () => {
    expect(md('#hashtag')).toBe('<p>#hashtag</p>');
  });

  it('allows up to three spaces of indentation', () => {
    expect(md('   # Hi')).toBe('<h1 id="hi">Hi</h1>');
    expect(md('    # Hi')).toBe('<p># Hi</p>');
  });

  it('removes closing hashes', () => {
    expect(md('## Title ##')).toBe('<h2 id="title">Title</h2>');
    expect(md('## Title ######')).toBe('<h2 id="title">Title</h2>');
  });

  it('keeps hashes that are not separated by a space from the text', () => {
    expect(md('# C#')).toBe('<h1 id="c">C#</h1>');
  });

  it('renders an empty heading', () => {
    expect(md('#')).toBe('<h1 id="section"></h1>');
    expect(md('## ##')).toBe('<h2 id="section"></h2>');
  });

  it('renders inline markup inside headings but builds the id from plain text', () => {
    expect(md('# Hello *World* `x`')).toBe('<h1 id="hello-world-x">Hello <em>World</em> <code>x</code></h1>');
  });

  it('makes heading ids unique', () => {
    expect(md('# Same\n\n# Same\n\n# Same')).toBe(
      '<h1 id="same">Same</h1>\n<h1 id="same-2">Same</h1>\n<h1 id="same-3">Same</h1>',
    );
  });

  it('can omit heading ids', () => {
    expect(noIds('# Hi')).toBe('<h1>Hi</h1>');
  });

  it('escapes HTML in headings and ids', () => {
    expect(md('# <script>alert(1)</script>')).toBe(
      '<h1 id="script-alert-1-script">&lt;script&gt;alert(1)&lt;/script&gt;</h1>',
    );
  });

  it('interrupts a paragraph', () => {
    expect(md('text\n# Head')).toBe('<p>text</p>\n<h1 id="head">Head</h1>');
  });

  it('does not support setext headings: the underline becomes a rule or text', () => {
    expect(md('Title\n---')).toBe('<p>Title</p>\n<hr>');
    expect(md('Title\n===')).toBe('<p>Title\n===</p>');
  });
});

describe('thematic breaks', () => {
  it.each(['---', '***', '___', '- - -', '* * *', '_ _ _', '-----', '  ---', '--- '])('renders %j', (src) => {
    expect(md(src)).toBe('<hr>');
  });

  it.each(['--', '**', '-*-', '    ---'])('does not render %j as a rule', (src) => {
    expect(md(src)).not.toContain('<hr>');
  });

  it('separates surrounding paragraphs', () => {
    expect(md('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr>\n<p>b</p>');
  });
});

describe('emphasis', () => {
  it.each([
    ['*a*', '<p><em>a</em></p>'],
    ['_a_', '<p><em>a</em></p>'],
    ['**a**', '<p><strong>a</strong></p>'],
    ['__a__', '<p><strong>a</strong></p>'],
    ['***a***', '<p><em><strong>a</strong></em></p>'],
    ['___a___', '<p><em><strong>a</strong></em></p>'],
    ['*a* and *b*', '<p><em>a</em> and <em>b</em></p>'],
    ['**a** and **b**', '<p><strong>a</strong> and <strong>b</strong></p>'],
    ['*a **b** c*', '<p><em>a <strong>b</strong> c</em></p>'],
    ['**a *b* c**', '<p><strong>a <em>b</em> c</strong></p>'],
    ['**bold *em***', '<p><strong>bold <em>em</em></strong></p>'],
    ['*em **bold***', '<p><em>em <strong>bold</strong></em></p>'],
    ['foo*bar*baz', '<p>foo<em>bar</em>baz</p>'],
    ['foo**bar**baz', '<p>foo<strong>bar</strong>baz</p>'],
  ])('renders %j', (src, expected) => {
    expect(md(src)).toBe(expected);
  });

  it.each([
    ['2 * 3 * 4', '<p>2 * 3 * 4</p>'],
    ['a * b', '<p>a * b</p>'],
    ['* alone*', '<ul>\n<li>alone*</li>\n</ul>'],
    ['*unclosed', '<p>*unclosed</p>'],
    ['**unclosed', '<p>**unclosed</p>'],
    ['unopened*', '<p>unopened*</p>'],
    ['a ** b ** c', '<p>a ** b ** c</p>'],
    ['snake_case_name', '<p>snake_case_name</p>'],
    ['foo_bar_', '<p>foo_bar_</p>'],
    ['_foo_bar', '<p>_foo_bar</p>'],
    ['5*6', '<p>5*6</p>'],
    ['**', '<p>**</p>'],
  ])('leaves %j mostly literal', (src, expected) => {
    expect(md(src)).toBe(expected);
  });

  it('allows intraword emphasis with asterisks but not underscores', () => {
    expect(md('a*b*c')).toBe('<p>a<em>b</em>c</p>');
    expect(md('a_b_c')).toBe('<p>a_b_c</p>');
  });

  it('does not let emphasis cross paragraph boundaries', () => {
    expect(md('*a\n\nb*')).toBe('<p>*a</p>\n<p>b*</p>');
  });

  it('can span a soft line break', () => {
    expect(md('*a\nb*')).toBe('<p><em>a\nb</em></p>');
  });

  it('honors backslash-escaped delimiters', () => {
    expect(md('\\*not em\\*')).toBe('<p>*not em*</p>');
    expect(md('\\_x\\_')).toBe('<p>_x_</p>');
  });

  it('does not apply emphasis inside code spans', () => {
    expect(md('`*a*`')).toBe('<p><code>*a*</code></p>');
  });

  it('handles very long runs of delimiters without hanging', () => {
    const out = md('*'.repeat(5000) + 'a' + '*'.repeat(5000));
    expect(out.startsWith('<p>')).toBe(true);
  });
});

describe('code spans', () => {
  it('renders and escapes a code span', () => {
    expect(md('`a < b`')).toBe('<p><code>a &lt; b</code></p>');
  });

  it('supports double-backtick spans containing a backtick', () => {
    expect(md('`` a`b ``')).toBe('<p><code>a`b</code></p>');
  });

  it('strips one leading and trailing space only', () => {
    expect(md('`  a  `')).toBe('<p><code> a </code></p>');
  });

  it('keeps all-space content', () => {
    expect(md('` `')).toBe('<p><code> </code></p>');
  });

  it('turns newlines inside a span into spaces', () => {
    expect(md('`a\nb`')).toBe('<p><code>a b</code></p>');
  });

  it('leaves an unmatched backtick literal', () => {
    expect(md('a ` b')).toBe('<p>a ` b</p>');
  });

  it('requires matching run lengths', () => {
    expect(md('``a`')).toBe('<p>``a`</p>');
    expect(md('`a``')).toBe('<p>`a``</p>');
  });

  it('does not process backslash escapes inside a span', () => {
    expect(md('`\\*`')).toBe('<p><code>\\*</code></p>');
  });

  it('escapes HTML inside a span', () => {
    expect(md('`<img src=x onerror=alert(1)>`')).toBe(
      '<p><code>&lt;img src=x onerror=alert(1)&gt;</code></p>',
    );
  });
});

describe('links', () => {
  it('renders a simple link', () => {
    expect(md('[a](https://example.com)')).toBe('<p><a href="https://example.com">a</a></p>');
  });

  it('renders a link title', () => {
    expect(md('[a](/x "The title")')).toBe('<p><a href="/x" title="The title">a</a></p>');
    expect(md("[a](/x 'The title')")).toBe('<p><a href="/x" title="The title">a</a></p>');
    expect(md('[a](/x (The title))')).toBe('<p><a href="/x" title="The title">a</a></p>');
  });

  it('escapes quotes in titles and urls', () => {
    expect(md('[a](/x "say \\"hi\\"")')).toBe('<p><a href="/x" title="say &quot;hi&quot;">a</a></p>');
    expect(md('[a](/x?a=1&b=2)')).toBe('<p><a href="/x?a=1&amp;b=2">a</a></p>');
  });

  it('supports angle-bracket destinations with spaces', () => {
    expect(md('[a](<my file.html>)')).toBe('<p><a href="my file.html">a</a></p>');
  });

  it('supports balanced parentheses in the destination', () => {
    expect(md('[a](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe(
      '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">a</a></p>',
    );
  });

  it('supports relative, fragment and mailto links', () => {
    expect(md('[a](../b.html)')).toBe('<p><a href="../b.html">a</a></p>');
    expect(md('[a](#top)')).toBe('<p><a href="#top">a</a></p>');
    expect(md('[a](mailto:me@example.com)')).toBe('<p><a href="mailto:me@example.com">a</a></p>');
  });

  it('allows an empty destination', () => {
    expect(md('[a]()')).toBe('<p><a href="">a</a></p>');
  });

  it('renders inline markup in link text', () => {
    expect(md('[*a* `b`](/x)')).toBe('<p><a href="/x"><em>a</em> <code>b</code></a></p>');
  });

  it('supports brackets inside link text', () => {
    expect(md('[a [b] c](/x)')).toBe('<p><a href="/x">a [b] c</a></p>');
  });

  it('supports escaped brackets in link text', () => {
    expect(md('[a \\] b](/x)')).toBe('<p><a href="/x">a ] b</a></p>');
  });

  it('does not nest links', () => {
    expect(md('[a [b](/y) c](/x)')).toBe('<p><a href="/x">a [b](/y) c</a></p>');
  });

  it('leaves non-links literal', () => {
    expect(md('[a]')).toBe('<p>[a]</p>');
    expect(md('[a] (/x)')).toBe('<p>[a] (/x)</p>');
    expect(md('[a](/x')).toBe('<p>[a](/x</p>');
    expect(md('[a][ref]')).toBe('<p>[a][ref]</p>');
  });

  it('does not support reference-style definitions', () => {
    expect(md('[a][1]\n\n[1]: /x')).toBe('<p>[a][1]</p>\n<p>[1]: /x</p>');
  });

  it('autolinks <http://...> and email addresses', () => {
    expect(md('<https://example.com/a?b=1&c=2>')).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a></p>',
    );
    expect(md('<me@example.com>')).toBe('<p><a href="mailto:me@example.com">me@example.com</a></p>');
  });

  it('does not autolink bare URLs', () => {
    expect(md('see https://example.com')).toBe('<p>see https://example.com</p>');
  });

  it('does not autolink dangerous schemes', () => {
    expect(md('<javascript:alert(1)>')).toBe('<p>&lt;javascript:alert(1)&gt;</p>');
  });

  it('renders the label of an unsafe link without an anchor', () => {
    expect(md('[click](javascript:alert(1))')).toBe('<p>click</p>');
  });
});

describe('images', () => {
  it('renders an image', () => {
    expect(md('![alt text](/img/a.png)')).toBe('<p><img src="/img/a.png" alt="alt text"></p>');
  });

  it('renders an image title', () => {
    expect(md('![a](/a.png "T")')).toBe('<p><img src="/a.png" alt="a" title="T"></p>');
  });

  it('uses plain text for alt, stripping markup', () => {
    expect(md('![a *b* `c`](/a.png)')).toBe('<p><img src="/a.png" alt="a b c"></p>');
  });

  it('escapes attribute-breaking characters in alt and src', () => {
    expect(md('![a"><script>](/a.png)')).toBe('<p><img src="/a.png" alt="a&quot;&gt;&lt;script&gt;"></p>');
    expect(md('![a](/a.png?x="y")')).toBe('<p><img src="/a.png?x=&quot;y&quot;" alt="a"></p>');
  });

  it('works inside a link', () => {
    expect(md('[![logo](/l.png)](/home)')).toBe('<p><a href="/home"><img src="/l.png" alt="logo"></a></p>');
  });

  it('drops images with unsafe sources and keeps the alt text', () => {
    expect(md('![x](javascript:alert(1))')).toBe('<p>x</p>');
    expect(md('![x](data:image/svg+xml;base64,AAAA)')).toBe('<p>x</p>');
  });

  it('keeps a lone exclamation mark', () => {
    expect(md('wow! really')).toBe('<p>wow! really</p>');
    expect(md('![not an image]')).toBe('<p>![not an image]</p>');
  });
});

describe('fenced code blocks', () => {
  it('renders a backtick fence', () => {
    expect(md('```\na\nb\n```')).toBe('<pre><code>a\nb\n</code></pre>');
  });

  it('renders a tilde fence', () => {
    expect(md('~~~\na\n~~~')).toBe('<pre><code>a\n</code></pre>');
  });

  it('adds a language class from the info string', () => {
    expect(md('```ts\nlet x = 1;\n```')).toBe('<pre><code class="language-ts">let x = 1;\n</code></pre>');
    expect(md('```c++ extra words\nx\n```')).toBe('<pre><code class="language-c++">x\n</code></pre>');
  });

  it('ignores info strings that are not a safe class name', () => {
    expect(md('```"><script>\nx\n```')).toBe('<pre><code>x\n</code></pre>');
  });

  it('does not process markdown or HTML inside code', () => {
    expect(md('```\n# not a heading\n<b>x</b> & *y*\n```')).toBe(
      '<pre><code># not a heading\n&lt;b&gt;x&lt;/b&gt; &amp; *y*\n</code></pre>',
    );
  });

  it('preserves blank lines and indentation inside code', () => {
    expect(md('```\na\n\n    b\n```')).toBe('<pre><code>a\n\n    b\n</code></pre>');
  });

  it('runs an unclosed fence to the end of the document', () => {
    expect(md('```\na\nb')).toBe('<pre><code>a\nb\n</code></pre>');
  });

  it('needs a closing fence at least as long as the opener', () => {
    expect(md('````\n```\nx\n````')).toBe('<pre><code>```\nx\n</code></pre>');
  });

  it('does not close a backtick fence with tildes', () => {
    expect(md('```\na\n~~~\nb\n```')).toBe('<pre><code>a\n~~~\nb\n</code></pre>');
  });

  it('renders an empty fence', () => {
    expect(md('```\n```')).toBe('<pre><code></code></pre>');
  });

  it('removes the fence indentation from content lines', () => {
    expect(md('  ```\n  a\n   b\n  ```')).toBe('<pre><code>a\n b\n</code></pre>');
  });

  it('does not treat a backtick info string containing a backtick as a fence', () => {
    expect(md('``` a`b\nx')).not.toContain('<pre>');
  });

  it('interrupts a paragraph', () => {
    expect(md('text\n```\ncode\n```')).toBe('<p>text</p>\n<pre><code>code\n</code></pre>');
  });
});

describe('blockquotes', () => {
  it('renders a blockquote with a paragraph', () => {
    expect(md('> quote')).toBe('<blockquote>\n<p>quote</p>\n</blockquote>');
  });

  it('joins consecutive quote lines', () => {
    expect(md('> a\n> b')).toBe('<blockquote>\n<p>a\nb</p>\n</blockquote>');
  });

  it('supports lazy continuation lines', () => {
    expect(md('> a\nb')).toBe('<blockquote>\n<p>a\nb</p>\n</blockquote>');
  });

  it('ends at a blank line', () => {
    expect(md('> a\n\nb')).toBe('<blockquote>\n<p>a</p>\n</blockquote>\n<p>b</p>');
  });

  it('supports nested blockquotes', () => {
    expect(md('> a\n>> b')).toBe(
      '<blockquote>\n<p>a</p>\n<blockquote>\n<p>b</p>\n</blockquote>\n</blockquote>',
    );
  });

  it('supports block content inside quotes', () => {
    expect(md('> # Title\n> - x\n> - y')).toBe(
      '<blockquote>\n<h1 id="title">Title</h1>\n<ul>\n<li>x</li>\n<li>y</li>\n</ul>\n</blockquote>',
    );
  });

  it('supports code fences inside quotes', () => {
    expect(md('> ```\n> x < y\n> ```')).toBe('<blockquote>\n<pre><code>x &lt; y\n</code></pre>\n</blockquote>');
  });

  it('does not require a space after >', () => {
    expect(md('>tight')).toBe('<blockquote>\n<p>tight</p>\n</blockquote>');
  });

  it('renders an empty quote', () => {
    expect(md('>')).toBe('<blockquote>\n</blockquote>');
  });

  it('does not lazily continue after a heading', () => {
    expect(md('> # H\nplain')).toBe('<blockquote>\n<h1 id="h">H</h1>\n</blockquote>\n<p>plain</p>');
  });

  it('survives absurd nesting depth by falling back to text', () => {
    const src = '>'.repeat(5000) + ' deep';
    const out = renderMarkdown(src);
    expect(out).toContain('deep');
    expect(out.match(/<blockquote>/g)!.length).toBeLessThan(100);
  });
});

describe('lists', () => {
  it('renders a bullet list with each marker', () => {
    expect(md('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(md('* a\n* b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(md('+ a\n+ b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  });

  it('renders an ordered list', () => {
    expect(md('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(md('1) a\n2) b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('honors a start number', () => {
    expect(md('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(md('0. a')).toBe('<ol start="0">\n<li>a</li>\n</ol>');
  });

  it('ignores the numbers after the first', () => {
    expect(md('1. a\n1. b\n1. c')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ol>');
  });

  it('starts a new list when the marker changes', () => {
    expect(md('- a\n* b')).toBe('<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>');
    expect(md('1. a\n1) b')).toBe('<ol>\n<li>a</li>\n</ol>\n<ol>\n<li>b</li>\n</ol>');
  });

  it('requires a space after the marker', () => {
    expect(md('-a')).toBe('<p>-a</p>');
    expect(md('1.a')).toBe('<p>1.a</p>');
  });

  it('does not accept ten-digit numbers', () => {
    expect(md('1234567890. a')).toBe('<p>1234567890. a</p>');
  });

  it('renders nested lists', () => {
    expect(md('- a\n  - b\n  - c\n- d')).toBe(
      '<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>',
    );
  });

  it('renders ordered lists nested in bullet lists', () => {
    expect(md('- a\n  1. b\n  2. c')).toBe(
      '<ul>\n<li>a\n<ol>\n<li>b</li>\n<li>c</li>\n</ol></li>\n</ul>',
    );
  });

  it('renders inline markup in items', () => {
    expect(md('- **a** [b](/b) `c`')).toBe(
      '<ul>\n<li><strong>a</strong> <a href="/b">b</a> <code>c</code></li>\n</ul>',
    );
  });

  it('makes a list loose when items are separated by blank lines', () => {
    expect(md('- a\n\n- b')).toBe('<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>');
  });

  it('keeps a trailing blank line outside the list', () => {
    expect(md('- a\n- b\n\npara')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p>para</p>');
  });

  it('supports multiple paragraphs in an item', () => {
    expect(md('- a\n\n  b\n- c')).toBe(
      '<ul>\n<li>\n<p>a</p>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>',
    );
  });

  it('supports lazy continuation lines', () => {
    expect(md('- a\nb')).toBe('<ul>\n<li>a\nb</li>\n</ul>');
  });

  it('supports code blocks in items', () => {
    expect(md('- a\n  ```\n  x\n  ```')).toBe('<ul>\n<li>a\n<pre><code>x\n</code></pre></li>\n</ul>');
  });

  it('supports a blockquote in an item', () => {
    expect(md('- > q')).toBe('<ul>\n<li><blockquote>\n<p>q</p>\n</blockquote></li>\n</ul>');
  });

  it('allows an empty item', () => {
    expect(md('-\n- b')).toBe('<ul>\n<li></li>\n<li>b</li>\n</ul>');
  });

  it('prefers a thematic break over a list', () => {
    expect(md('- - -')).toBe('<hr>');
    expect(md('* a\n* * *\n* b')).toContain('<hr>');
  });

  it('lets a bullet list interrupt a paragraph', () => {
    expect(md('text\n- a')).toBe('<p>text</p>\n<ul>\n<li>a</li>\n</ul>');
  });

  it('only lets an ordered list starting at 1 interrupt a paragraph', () => {
    expect(md('text\n1. a')).toBe('<p>text</p>\n<ol>\n<li>a</li>\n</ol>');
    expect(md('text\n2. a')).toBe('<p>text\n2. a</p>');
  });

  it('allows up to three spaces before the marker', () => {
    expect(md('   - a')).toBe('<ul>\n<li>a</li>\n</ul>');
    expect(md('    - a')).toBe('<p>- a</p>');
  });

  it('escapes HTML in items', () => {
    expect(md('- <b>x</b>')).toBe('<ul>\n<li>&lt;b&gt;x&lt;/b&gt;</li>\n</ul>');
  });

  it('does not render task list checkboxes', () => {
    expect(md('- [ ] todo')).toBe('<ul>\n<li>[ ] todo</li>\n</ul>');
  });

  it('survives absurd nesting depth', () => {
    let src = '';
    for (let i = 0; i < 200; i++) src += `${'  '.repeat(i)}- x\n`;
    const out = renderMarkdown(src);
    expect(out).toContain('<ul>');
    expect(out.match(/<ul>/g)!.length).toBeLessThan(100);
  });
});

describe('tables', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';

  it('renders a table', () => {
    expect(md(table)).toBe(
      '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n<tbody>\n' +
        '<tr><td>1</td><td>2</td></tr>\n<tr><td>3</td><td>4</td></tr>\n</tbody>\n</table>',
    );
  });

  it('works without leading and trailing pipes', () => {
    expect(md('a | b\n--|--\n1 | 2')).toBe(
      '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>',
    );
  });

  it('supports column alignment', () => {
    const out = md('| l | c | r | n |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |');
    expect(out).toContain('<th style="text-align:left">l</th>');
    expect(out).toContain('<th style="text-align:center">c</th>');
    expect(out).toContain('<th style="text-align:right">r</th>');
    expect(out).toContain('<th>n</th>');
    expect(out).toContain('<td style="text-align:right">3</td>');
  });

  it('renders a header-only table without a body', () => {
    expect(md('| a |\n|---|')).toBe('<table>\n<thead>\n<tr><th>a</th></tr>\n</thead>\n</table>');
  });

  it('pads short rows and drops extra cells', () => {
    const out = md('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    expect(out).toContain('<tr><td>1</td><td></td></tr>');
    expect(out).toContain('<tr><td>1</td><td>2</td></tr>');
    expect(out).not.toContain('3');
  });

  it('supports escaped pipes in cells', () => {
    expect(md('| a |\n|---|\n| x \\| y |')).toContain('<td>x | y</td>');
  });

  it('renders inline markup in cells', () => {
    const out = md('| a |\n|---|\n| **b** `c` [d](/d) |');
    expect(out).toContain('<td><strong>b</strong> <code>c</code> <a href="/d">d</a></td>');
  });

  it('escapes HTML in cells', () => {
    const out = md('| <script> |\n|---|\n| <img onerror=x> |');
    expect(out).toContain('<th>&lt;script&gt;</th>');
    expect(out).toContain('<td>&lt;img onerror=x&gt;</td>');
  });

  it('requires the delimiter row column count to match the header', () => {
    expect(md('| a | b |\n|---|\n| 1 | 2 |')).not.toContain('<table>');
  });

  it('requires a valid delimiter row', () => {
    expect(md('| a | b |\n| x | y |')).not.toContain('<table>');
    expect(md('| a | b |\n|--|-x-|')).not.toContain('<table>');
  });

  it('does not mistake a rule below a piped line for a table', () => {
    expect(md('a | b\n---')).not.toContain('<table>');
  });

  it('ends at a blank line', () => {
    expect(md(`${table}\n\nafter`)).toMatch(/<\/table>\n<p>after<\/p>$/);
  });

  it('ends when another block starts', () => {
    expect(md(`${table}\n# H`)).toMatch(/<\/table>\n<h1 id="h">H<\/h1>$/);
  });
});

describe('raw HTML and entities', () => {
  it('escapes raw HTML tags', () => {
    expect(md('<div>hi</div>')).toBe('<p>&lt;div&gt;hi&lt;/div&gt;</p>');
  });

  it('escapes HTML comments', () => {
    expect(md('<!-- c -->')).toBe('<p>&lt;!-- c --&gt;</p>');
  });

  it('shows entities literally instead of decoding them', () => {
    expect(md('&copy; &amp; &#60;')).toBe('<p>&amp;copy; &amp;amp; &amp;#60;</p>');
  });

  it('escapes quotes in text', () => {
    expect(md(`"double" and 'single'`)).toBe('<p>&quot;double&quot; and &#39;single&#39;</p>');
  });

  it('keeps a stray < literal', () => {
    expect(md('a < b > c')).toBe('<p>a &lt; b &gt; c</p>');
  });
});

describe('backslash escapes', () => {
  it.each(['*', '_', '`', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '{', '}', '~', '>', '\\'])(
    'escapes %s',
    (ch) => {
      expect(md(`a\\${ch}b`)).toBe(`<p>a${ch === '>' ? '&gt;' : ch}b</p>`);
    },
  );

  it('escapes HTML-significant characters after a backslash', () => {
    expect(md('\\<b\\>')).toBe('<p>&lt;b&gt;</p>');
    expect(md('\\&amp;')).toBe('<p>&amp;amp;</p>');
    expect(md('\\"')).toBe('<p>&quot;</p>');
  });

  it('keeps a backslash before a non-punctuation character', () => {
    expect(md('a\\b')).toBe('<p>a\\b</p>');
  });

  it('keeps a trailing backslash at the end of the document', () => {
    expect(md('a\\')).toBe('<p>a\\</p>');
  });
});

describe('inline helper', () => {
  it('renders inline markup without a paragraph wrapper', () => {
    expect(renderInlineMarkdown('a *b* <i>')).toBe('a <em>b</em> &lt;i&gt;');
  });
});

describe('robustness', () => {
  const big = (s: string, n: number): string => s.repeat(n);

  it.each([
    ['unmatched open brackets', big('[', 20000)],
    ['unmatched backticks', big('`a ', 10000)],
    ['alternating backtick runs', big('` `` ``` ', 3000)],
    ['unmatched emphasis openers', big('*a ', 10000)],
    ['unmatched emphasis closers', big('a* ', 10000)],
    ['mixed delimiters', big('*_ ', 10000)],
    ['nested link text', big('[a', 5000) + big('](x)', 5000)],
    ['link-like text', big('[a](', 10000)],
    ['many table pipes', '|' + big(' a |', 5000) + '\n|' + big('---|', 5000)],
    ['long single line', big('x', 200000)],
  ])('stays fast on %s', (_name, src) => {
    const start = Date.now();
    const out = renderMarkdown(src);
    expect(typeof out).toBe('string');
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
