import type { FrontMatterValue } from './frontmatter.js';
import { MdsiteError } from './errors.js';

export interface PostMeta {
  title: string;
  /** Present for dated entries (posts). */
  date?: Date;
  /** The YYYY-MM-DD part exactly as the author wrote it. */
  dateText?: string;
  tags: string[];
  draft: boolean;
  description?: string;
  /** Sort key for undated pages in the navigation. */
  order?: number;
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?[ ]?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parse YYYY-MM-DD, optionally followed by a time and offset. Returns null when invalid. */
export function parseDate(text: string): Date | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  let offsetMinutes = 0;
  if (m[7] && m[7] !== 'Z') {
    const sign = m[7][0] === '-' ? -1 : 1;
    const digits = m[7].slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2));
    if (oh > 23 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);
}

function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function expectString(key: string, value: FrontMatterValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new MdsiteError(`"${key}" must be a string`);
  return value;
}

/** Validate raw front matter data and turn it into typed metadata. */
export function buildMeta(data: Record<string, FrontMatterValue>, fallbackName: string): PostMeta {
  const title = expectString('title', data.title)?.trim() || humanize(fallbackName);

  let date: Date | undefined;
  let dateText: string | undefined;
  const rawDate = expectString('date', data.date)?.trim();
  if (rawDate) {
    const parsed = parseDate(rawDate);
    if (!parsed) {
      throw new MdsiteError(`"date" must look like 2025-01-31 (optionally with a time), got "${rawDate}"`);
    }
    date = parsed;
    dateText = rawDate.slice(0, 10);
  }

  const tags: string[] = [];
  const rawTags = data.tags;
  if (rawTags !== undefined) {
    let list: string[];
    if (Array.isArray(rawTags)) list = rawTags;
    else if (typeof rawTags === 'string') list = rawTags.split(',');
    else throw new MdsiteError('"tags" must be a list or a comma-separated string');
    const seen = new Set<string>();
    for (const t of list) {
      const tag = t.trim();
      if (tag === '' || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }

  let draft = false;
  if (data.draft !== undefined) {
    if (typeof data.draft !== 'boolean') {
      throw new MdsiteError('"draft" must be true or false (unquoted)');
    }
    draft = data.draft;
  }

  const description = expectString('description', data.description)?.trim() || undefined;

  let order: number | undefined;
  const rawOrder = expectString('order', data.order)?.trim();
  if (rawOrder) {
    if (!/^-?\d{1,9}$/.test(rawOrder)) throw new MdsiteError(`"order" must be an integer, got "${rawOrder}"`);
    order = Number(rawOrder);
  }

  return { title, date, dateText, tags, draft, description, order };
}
