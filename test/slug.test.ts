import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../src/slug.js';

const ch = (...codes: number[]): string => String.fromCharCode(...codes);

describe('slugify', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  padded  ', 'padded'],
    ['already-a-slug', 'already-a-slug'],
    ['Multiple   spaces', 'multiple-spaces'],
    ['under_score', 'under-score'],
    ['Dots.and.Dashes--here', 'dots-and-dashes-here'],
    ['C++ & C#', 'c-c'],
    ['100% sure!', '100-sure'],
    ['What is 2 + 2?', 'what-is-2-2'],
    ['UPPER lower MiXeD', 'upper-lower-mixed'],
    ['a/b\\c', 'a-b-c'],
    ['../../etc/passwd', 'etc-passwd'],
    ['<script>', 'script'],
    ['"quoted"', 'quoted'],
    ['2024-01-01 review', '2024-01-01-review'],
    ['---', ''],
    ['', ''],
    ['   ', ''],
    ['tab\tand\nnewline', 'tab-and-newline'],
    // accents are removed, other scripts are dropped
    [`caf${ch(0xe9)} cr${ch(0xe8)}me br${ch(0xfb)}l${ch(0xe9)}e`, 'cafe-creme-brulee'],
    [`na${ch(0xef)}ve fa${ch(0xe7)}ade`, 'naive-facade'],
    [`${ch(0xdc)}ber`, 'uber'],
    [`${ch(0xfb01)}nal`, 'final'],
    [ch(0xff21, 0xff22, 0xff23), 'abc'],
    [ch(0x65e5, 0x672c, 0x8a9e), ''],
    [`${ch(0xd83d, 0xde00)} smile`, 'smile'],
  ])('slugify(%j) = %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('only ever produces [a-z0-9-] without leading, trailing or double dashes', () => {
    const inputs = ['a b', '--x--', 'x  y  z', ch(0xe9, 0xe8, 0xea), '!!a!!b!!', 'A_B-C d'];
    for (const s of inputs) {
      expect(slugify(s)).toMatch(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
    }
  });

  it('truncates long input without leaving a trailing dash', () => {
    const slug = slugify('word '.repeat(60));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('is idempotent', () => {
    for (const s of ['Hello, World!', `caf${ch(0xe9)}`, 'a--b', '  x ']) {
      expect(slugify(slugify(s))).toBe(slugify(s));
    }
  });
});

describe('uniqueSlug', () => {
  it('returns the base when unused and records it', () => {
    const used = new Set<string>();
    expect(uniqueSlug('a', used)).toBe('a');
    expect(used.has('a')).toBe(true);
  });

  it('appends increasing numbers on collisions', () => {
    const used = new Set<string>();
    expect([uniqueSlug('a', used), uniqueSlug('a', used), uniqueSlug('a', used)]).toEqual(['a', 'a-2', 'a-3']);
  });

  it('avoids collisions with a pre-existing numbered slug', () => {
    const used = new Set(['a', 'a-2']);
    expect(uniqueSlug('a', used)).toBe('a-3');
  });
});
