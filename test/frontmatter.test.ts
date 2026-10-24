import { describe, expect, it } from 'vitest';
import { FrontMatterError } from '../src/errors.js';
import { parseFrontMatter, quoteFrontMatterString } from '../src/frontmatter.js';

const fm = (lines: string[], body = 'Body'): string => ['---', ...lines, '---', body].join('\n');
const data = (lines: string[]) => parseFrontMatter(fm(lines)).data;

describe('detecting front matter', () => {
  it('returns the whole text as body when there is no front matter', () => {
    const r = parseFrontMatter('# Hi\n\ntext');
    expect(r.hasFrontMatter).toBe(false);
    expect(r.data).toEqual({});
    expect(r.body).toBe('# Hi\n\ntext');
  });

  it('does not treat a later --- as front matter', () => {
    const r = parseFrontMatter('intro\n---\ntitle: x\n---\n');
    expect(r.hasFrontMatter).toBe(false);
  });

  it('does not treat "----" as an opening fence', () => {
    expect(parseFrontMatter('----\ntitle: x\n----\n').hasFrontMatter).toBe(false);
  });

  it('parses an empty front matter block', () => {
    const r = parseFrontMatter('---\n---\nbody');
    expect(r.hasFrontMatter).toBe(true);
    expect(r.data).toEqual({});
    expect(r.body).toBe('body');
  });

  it('returns the body after the closing fence', () => {
    expect(parseFrontMatter(fm(['title: A'], 'Line 1\n\nLine 2')).body).toBe('Line 1\n\nLine 2');
  });

  it('accepts "..." as the closing fence', () => {
    const r = parseFrontMatter('---\ntitle: A\n...\nbody');
    expect(r.data.title).toBe('A');
    expect(r.body).toBe('body');
  });

  it('accepts trailing spaces after fences', () => {
    expect(parseFrontMatter('---  \ntitle: A\n---  \nb').data.title).toBe('A');
  });

  it('handles CRLF line endings', () => {
    const r = parseFrontMatter('---\r\ntitle: A\r\ntags: [x, y]\r\n---\r\nbody\r\n');
    expect(r.data).toEqual({ title: 'A', tags: ['x', 'y'] });
    expect(r.body).toBe('body\n');
  });

  it('handles a leading byte order mark', () => {
    expect(parseFrontMatter('﻿---\ntitle: A\n---\n').data.title).toBe('A');
  });

  it('keeps a horizontal rule in the body', () => {
    expect(parseFrontMatter('---\ntitle: A\n---\nx\n\n---\n\ny').body).toBe('x\n\n---\n\ny');
  });

  it('throws when the block is never closed', () => {
    expect(() => parseFrontMatter('---\ntitle: A\nbody')).toThrow(FrontMatterError);
    expect(() => parseFrontMatter('---\ntitle: A\nbody')).toThrow(/never closed/);
  });
});

describe('scalar values', () => {
  it.each([
    ['title: Hello', 'Hello'],
    ['title:   Spaced   ', 'Spaced'],
    ['title: Two words here', 'Two words here'],
    ['title: "Quoted"', 'Quoted'],
    ["title: 'Single'", 'Single'],
    ['title: "has: colon"', 'has: colon'],
    ['title: has: colon unquoted', 'has: colon unquoted'],
    ['title: "# not a comment"', '# not a comment'],
    ['title: a#b', 'a#b'],
    ['title: value # trailing comment', 'value'],
    ['title: "value" # trailing comment', 'value'],
    ['title: ""', ''],
    ["title: ''", ''],
    ['title: 2024', '2024'],
    ['title: 3.14', '3.14'],
    ['title: null', 'null'],
    ['title: yes', 'yes'],
    ['title: "true"', 'true'],
    ["title: 'false'", 'false'],
    ['title: "say \\"hi\\""', 'say "hi"'],
    ['title: "back\\\\slash"', 'back\\slash'],
    ['title: "tab\\there"', 'tab\there'],
    ['title: "line\\nbreak"', 'line\nbreak'],
    ["title: 'it''s'", "it's"],
    ["title: 'no \\n escape'", 'no \\n escape'],
    ['title: café 日本', 'café 日本'],
    ['title: <b>html</b>', '<b>html</b>'],
  ])('%s', (line, expected) => {
    expect(data([line]).title).toBe(expected);
  });

  it.each([
    ['draft: true', true],
    ['draft: false', false],
    ['draft: true # comment', true],
  ])('%s is a boolean', (line, expected) => {
    expect(data([line]).draft).toBe(expected);
  });

  it('keeps True/TRUE as strings', () => {
    expect(data(['draft: True']).draft).toBe('True');
  });

  it('parses several keys', () => {
    expect(data(['title: A', 'date: 2025-01-02', 'draft: false', 'custom-key_1: x'])).toEqual({
      title: 'A',
      date: '2025-01-02',
      draft: false,
      'custom-key_1': 'x',
    });
  });

  it('skips blank lines and comments', () => {
    expect(data(['# a comment', '', 'title: A', '   # indented comment', ''])).toEqual({ title: 'A' });
  });

  it('treats a key with no value as an empty string', () => {
    expect(data(['title:'])).toEqual({ title: '' });
    expect(data(['title:   '])).toEqual({ title: '' });
  });

  it('rejects __proto__ as a key and treats other inherited names as plain keys', () => {
    expect(() => data(['__proto__: [a]'])).toThrow(/not allowed as a key/);
    const r = data(['constructor: y']);
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(r.constructor).toBe('y');
  });
});

describe('lists', () => {
  it.each([
    ['tags: [a, b, c]', ['a', 'b', 'c']],
    ['tags: [a,b,c]', ['a', 'b', 'c']],
    ['tags: [ a , b ]', ['a', 'b']],
    ['tags: []', []],
    ['tags: [ ]', []],
    ['tags: [single]', ['single']],
    ['tags: ["a, b", c]', ['a, b', 'c']],
    ["tags: ['x', \"y\"]", ['x', 'y']],
    ['tags: [two words, "three words"]', ['two words', 'three words']],
    ['tags: [a, b] # comment', ['a', 'b']],
    ['tags: ["a]b"]', ['a]b']],
    ['tags: [true, 1]', ['true', '1']],
  ])('inline: %s', (line, expected) => {
    expect(data([line]).tags).toEqual(expected);
  });

  it('parses block lists', () => {
    expect(data(['tags:', '  - a', '  - b c', '  - "d: e"'])).toEqual({ tags: ['a', 'b c', 'd: e'] });
  });

  it('accepts block lists without indentation', () => {
    expect(data(['tags:', '- a', '- b'])).toEqual({ tags: ['a', 'b'] });
  });

  it('continues with the next key after a block list', () => {
    expect(data(['tags:', '  - a', 'title: T'])).toEqual({ tags: ['a'], title: 'T' });
  });

  it('allows comments and blank lines between block items', () => {
    expect(data(['tags:', '  - a', '', '  # c', '  - b'])).toEqual({ tags: ['a', 'b'] });
  });
});

describe('errors', () => {
  const err = (lines: string[]): FrontMatterError => {
    try {
      parseFrontMatter(fm(lines));
    } catch (e) {
      return e as FrontMatterError;
    }
    throw new Error('expected an error');
  };

  it.each([
    [['not a key value pair'], /expected "key: value"/],
    [['title'], /expected "key: value"/],
    [['title:no-space'], /expected "key: value"/],
    [['  indented: x'], /expected "key: value"/],
    [['1bad: x'], /expected "key: value"/],
    [['bad key: x'], /expected "key: value"/],
    [['title: "unterminated'], /unterminated quoted string/],
    [["title: 'unterminated"], /unterminated quoted string/],
    [['title: "a" junk'], /unexpected text after quoted string/],
    [['title: "bad \\q escape"'], /unsupported escape/],
    [['tags: [a, b'], /unterminated list/],
    [['tags: [a b] junk'], /unexpected text after list/],
    [['tags: [a,, b]'], /empty list item/],
    [['tags: [a, ]'], /unterminated list|empty list item/],
    [['tags: ["unterminated]'], /unterminated quoted string/],
    [['title: A', 'title: B'], /duplicate key "title"/],
    [['tags:', '  - true'], /list items must be strings/],
  ])('rejects %j', (lines, pattern) => {
    expect(err(lines).message).toMatch(pattern);
  });

  it('reports the 1-based line number in the file', () => {
    const e = err(['title: A', 'oops']);
    expect(e).toBeInstanceOf(FrontMatterError);
    expect(e.line).toBe(3);
    expect(e.message).toContain('line 3');
  });

  it('reports line 1 for an unterminated block', () => {
    try {
      parseFrontMatter('---\ntitle: A');
    } catch (e) {
      expect((e as FrontMatterError).line).toBe(1);
    }
  });
});

describe('quoteFrontMatterString', () => {
  it.each([
    'Plain title',
    'Has "quotes" inside',
    'Back\\slash',
    'Colon: and # hash',
    "Apostrophe's",
    '[brackets]',
    'true',
    '  padded  ',
    'café',
    '',
  ])('round-trips %j', (value) => {
    const parsed = parseFrontMatter(`---\ntitle: ${quoteFrontMatterString(value)}\n---\n`).data.title;
    expect(parsed).toBe(value.trim());
  });

  it('collapses newlines and drops control characters', () => {
    const q = quoteFrontMatterString('a\nb\tc' + String.fromCharCode(0, 7) + 'd');
    expect(q).toBe('"a b cd"');
  });
});
