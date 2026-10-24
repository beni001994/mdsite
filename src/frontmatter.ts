import { FrontMatterError } from './errors.js';

export type FrontMatterValue = string | boolean | string[];

export interface FrontMatterResult {
  data: Record<string, FrontMatterValue>;
  body: string;
  hasFrontMatter: boolean;
}

/**
 * Parse a deliberately small YAML subset:
 *
 *   key: value            plain, 'single quoted' or "double quoted" strings
 *   key: true | false     booleans (unquoted)
 *   key: [a, b, "c d"]    inline lists
 *   key:                  block list on following lines:
 *     - a
 *     - b
 *   # comment lines and trailing " # comments" on plain values
 *
 * Nested maps, multi-line strings, anchors, numbers-as-numbers etc. are not
 * supported; unsupported lines are reported as errors rather than ignored.
 */
export function parseFrontMatter(source: string): FrontMatterResult {
  const text = source.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!/^---[ \t]*$/.test(lines[0])) {
    return { data: {}, body: text, hasFrontMatter: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new FrontMatterError('front matter starts with "---" but is never closed', 1);
  }

  const data: Record<string, FrontMatterValue> = {};
  let i = 1;
  while (i < end) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (!m) {
      throw new FrontMatterError(`expected "key: value", got ${JSON.stringify(line.trim())}`, lineNo);
    }
    const key = m[1];
    if (key === '__proto__') {
      throw new FrontMatterError('"__proto__" is not allowed as a key', lineNo);
    }
    if (Object.hasOwn(data, key)) {
      throw new FrontMatterError(`duplicate key "${key}"`, lineNo);
    }
    const raw = (m[2] ?? '').trim();
    i++;
    if (raw === '' || raw.startsWith('#')) {
      // Possibly a block list.
      const items: string[] = [];
      while (i < end) {
        const l = lines[i];
        if (/^\s*$/.test(l) || /^\s*#/.test(l)) {
          i++;
          continue;
        }
        const im = /^[ \t]*-(?:[ \t]+(.*))?$/.exec(l);
        if (!im) break;
        const value = parseScalar((im[1] ?? '').trim(), i + 1);
        if (typeof value !== 'string') {
          throw new FrontMatterError('list items must be strings', i + 1);
        }
        items.push(value);
        i++;
      }
      data[key] = items.length > 0 ? items : '';
      continue;
    }
    data[key] = parseValue(raw, lineNo);
  }

  return { data, body: lines.slice(end + 1).join('\n'), hasFrontMatter: true };
}

function parseValue(raw: string, line: number): FrontMatterValue {
  if (raw.startsWith('[')) return parseFlowList(raw, line);
  return parseScalar(raw, line);
}

function parseScalar(raw: string, line: number): string | boolean {
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const [value, rest] = parseQuoted(raw, line);
    const tail = rest.trim();
    if (tail !== '' && !tail.startsWith('#')) {
      throw new FrontMatterError(`unexpected text after quoted string: ${JSON.stringify(tail)}`, line);
    }
    return value;
  }
  const plain = raw.replace(/[ \t]+#.*$/, '').trim();
  if (plain === 'true') return true;
  if (plain === 'false') return false;
  return plain;
}

/** Parse a quoted string at the start of `raw`; returns the value and the remaining text. */
function parseQuoted(raw: string, line: number): [string, string] {
  const quote = raw[0];
  let out = '';
  let i = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (quote === '"' && ch === '\\') {
      const nx = raw[i + 1];
      if (nx === undefined) break;
      const map: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/' };
      if (!(nx in map)) {
        throw new FrontMatterError(`unsupported escape "\\${nx}" in double-quoted string`, line);
      }
      out += map[nx];
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (quote === "'" && raw[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return [out, raw.slice(i + 1)];
    }
    out += ch;
    i++;
  }
  throw new FrontMatterError('unterminated quoted string', line);
}

function parseFlowList(raw: string, line: number): string[] {
  let i = 1;
  const items: string[] = [];
  const skipWs = (): void => {
    while (i < raw.length && /[ \t]/.test(raw[i])) i++;
  };
  skipWs();
  if (raw[i] === ']') {
    return finishList(raw, i + 1, items, line);
  }
  for (;;) {
    skipWs();
    if (i >= raw.length) throw new FrontMatterError('unterminated list (missing "]")', line);
    if (raw[i] === '"' || raw[i] === "'") {
      const [value, rest] = parseQuoted(raw.slice(i), line);
      items.push(value);
      i = raw.length - rest.length;
    } else {
      let j = i;
      while (j < raw.length && raw[j] !== ',' && raw[j] !== ']') j++;
      const item = raw.slice(i, j).trim();
      if (item === '') throw new FrontMatterError('empty list item', line);
      items.push(item);
      i = j;
    }
    skipWs();
    if (raw[i] === ',') {
      i++;
      continue;
    }
    if (raw[i] === ']') return finishList(raw, i + 1, items, line);
    throw new FrontMatterError('unterminated list (missing "]")', line);
  }
}

function finishList(raw: string, from: number, items: string[], line: number): string[] {
  const tail = raw.slice(from).trim();
  if (tail !== '' && !tail.startsWith('#')) {
    throw new FrontMatterError(`unexpected text after list: ${JSON.stringify(tail)}`, line);
  }
  return items;
}

/** Quote a string so that parseFrontMatter reads it back unchanged. */
export function quoteFrontMatterString(value: string): string {
  const cleaned = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return `"${cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
