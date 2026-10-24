import { describe, expect, it } from 'vitest';
import { MdsiteError } from '../src/errors.js';
import { buildMeta, parseDate } from '../src/meta.js';
import type { FrontMatterValue } from '../src/frontmatter.js';

const meta = (data: Record<string, FrontMatterValue>, name = 'my-file') => buildMeta(data, name);

describe('parseDate', () => {
  it.each([
    ['2025-01-31', '2025-01-31T00:00:00.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
    ['2025-12-31T23:59:59Z', '2025-12-31T23:59:59.000Z'],
    ['2025-01-31 10:30', '2025-01-31T10:30:00.000Z'],
    ['2025-01-31T10:30', '2025-01-31T10:30:00.000Z'],
    ['2025-01-31T10:30:15', '2025-01-31T10:30:15.000Z'],
    ['2025-01-31T10:30:15.123Z', '2025-01-31T10:30:15.000Z'],
    ['2025-01-31T10:30:00+02:00', '2025-01-31T08:30:00.000Z'],
    ['2025-01-31T10:30:00-0530', '2025-01-31T16:00:00.000Z'],
    ['2025-01-31T00:30:00+01:00', '2025-01-30T23:30:00.000Z'],
    ['  2025-01-31  ', '2025-01-31T00:00:00.000Z'],
  ])('parses %j', (input, iso) => {
    expect(parseDate(input)?.toISOString()).toBe(iso);
  });

  it.each([
    '',
    'tomorrow',
    '2025',
    '2025-1-5',
    '25-01-01',
    '2025/01/31',
    '2025-13-01',
    '2025-00-10',
    '2025-01-00',
    '2025-01-32',
    '2025-02-29',
    '2023-02-29',
    '2025-04-31',
    '2025-01-31T24:00',
    '2025-01-31T10:60',
    '2025-01-31T10:30:60',
    '2025-01-31T10:30:00+24:00',
    '2025-01-31T10:30:00+01:60',
    '2025-01-31T',
    '2025-01-31x',
    'Jan 31, 2025',
  ])('rejects %j', (input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe('buildMeta', () => {
  it('uses the title when given', () => {
    expect(meta({ title: '  Hello  ' }).title).toBe('Hello');
  });

  it('falls back to a humanized file name', () => {
    expect(meta({}, 'my-first_post').title).toBe('My first post');
    expect(meta({ title: '' }, 'about').title).toBe('About');
    expect(meta({ title: '   ' }, 'x').title).toBe('X');
  });

  it('rejects a non-string title', () => {
    expect(() => meta({ title: ['a'] })).toThrow(/"title" must be a string/);
    expect(() => meta({ title: true })).toThrow(/"title" must be a string/);
  });

  it('leaves date undefined for pages', () => {
    const m = meta({ title: 'T' });
    expect(m.date).toBeUndefined();
    expect(m.dateText).toBeUndefined();
  });

  it('keeps the author-written date part', () => {
    const m = meta({ date: '2025-01-31T23:30:00-05:00' });
    expect(m.dateText).toBe('2025-01-31');
    expect(m.date?.toISOString()).toBe('2025-02-01T04:30:00.000Z');
  });

  it('rejects invalid dates with a helpful message', () => {
    expect(() => meta({ date: '2025-02-30' })).toThrow(/"date" must look like 2025-01-31.*2025-02-30/);
    expect(() => meta({ date: ['2025-01-01'] })).toThrow(/"date" must be a string/);
  });

  it('throws MdsiteError', () => {
    expect(() => meta({ date: 'nope' })).toThrow(MdsiteError);
  });

  describe('tags', () => {
    it('defaults to none', () => {
      expect(meta({}).tags).toEqual([]);
    });

    it('accepts a list', () => {
      expect(meta({ tags: ['a', 'b'] }).tags).toEqual(['a', 'b']);
    });

    it('accepts a comma-separated string', () => {
      expect(meta({ tags: 'a, b ,c' }).tags).toEqual(['a', 'b', 'c']);
    });

    it('trims, drops empties and removes case-insensitive duplicates keeping the first', () => {
      expect(meta({ tags: [' Go ', '', 'go', 'GO', 'Rust'] }).tags).toEqual(['Go', 'Rust']);
    });

    it('treats an empty string as no tags', () => {
      expect(meta({ tags: '' }).tags).toEqual([]);
    });

    it('rejects a boolean', () => {
      expect(() => meta({ tags: true })).toThrow(/"tags"/);
    });
  });

  describe('draft', () => {
    it('defaults to false', () => {
      expect(meta({}).draft).toBe(false);
    });

    it.each([true, false])('accepts %s', (v) => {
      expect(meta({ draft: v }).draft).toBe(v);
    });

    it.each(['yes', 'true', 'False', ''])('rejects the string %j', (v) => {
      expect(() => meta({ draft: v })).toThrow(/"draft" must be true or false/);
    });
  });

  it('reads description and order', () => {
    const m = meta({ description: ' About me ', order: '3' });
    expect(m.description).toBe('About me');
    expect(m.order).toBe(3);
    expect(meta({ order: '-2' }).order).toBe(-2);
  });

  it('rejects a non-integer order', () => {
    expect(() => meta({ order: '1.5' })).toThrow(/"order" must be an integer/);
    expect(() => meta({ order: 'first' })).toThrow(/"order" must be an integer/);
  });

  it('ignores unknown keys', () => {
    expect(meta({ title: 'T', whatever: 'x' }).title).toBe('T');
  });
});
