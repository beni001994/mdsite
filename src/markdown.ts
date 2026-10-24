/**
 * A small hand-written Markdown to HTML converter.
 *
 * It implements a pragmatic subset of CommonMark/GFM (see README for the exact
 * list and the known deviations). All text is HTML-escaped, raw HTML in the
 * source is never passed through, and link/image URLs are checked against a
 * scheme allow-list.
 */
import { escapeHtml, htmlToText, sanitizeUrl } from './escape.js';
import { slugify, uniqueSlug } from './slug.js';

export interface MarkdownOptions {
  /** Add slug `id` attributes to headings. Default true. */
  headingIds?: boolean;
}

/** Nesting limit for blockquotes/lists; deeper input is rendered as plain text. */
const MAX_BLOCK_DEPTH = 24;
/** Nesting limit for links/images inside link text. */
const MAX_INLINE_DEPTH = 12;

interface BlockCtx {
  used: Set<string>;
  headingIds: boolean;
}

interface InlineCtx {
  /** Shared work budget so pathological input cannot cause quadratic blowups. */
  budget: { n: number };
  depth: number;
  noLinks: boolean;
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const text = source.replace(/^\ufeff/, '').replace(/\u0000/g, '\ufffd').replace(/\r\n?/g, '\n');
  const ctx: BlockCtx = { used: new Set(), headingIds: options.headingIds ?? true };
  const html = parseBlocks(text.split('\n'), ctx, 0, false);
  return html === '' ? '' : html + '\n';
}

/** Render a single line of inline Markdown (no block structure). */
export function renderInlineMarkdown(source: string): string {
  return renderInline(source, newInlineCtx(source));
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/** Visual indentation width, counting a tab as advancing to the next multiple of 4. */
function indentOf(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}

function stripIndent(line: string, n: number): string {
  let w = 0;
  let i = 0;
  while (i < line.length && w < n) {
    if (line[i] === ' ') {
      w++;
      i++;
    } else if (line[i] === '\t') {
      const next = w + 4 - (w % 4);
      if (next > n) return ' '.repeat(next - n) + line.slice(i + 1);
      w = next;
      i++;
    } else break;
  }
  return line.slice(i);
}

function isFenceOpen(line: string): RegExpExecArray | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return m;
}

/** Does this line start a block that may interrupt a paragraph? */
function interruptsParagraph(line: string): boolean {
  if (indentOf(line) >= 4) return false;
  if (isFenceOpen(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const m = LIST.exec(line);
  if (m && (m[4] ?? '').trim() !== '') {
    const marker = m[2];
    return !/\d/.test(marker) || parseInt(marker, 10) === 1;
  }
  return false;
}

function listKind(marker: string): { ordered: boolean; delim: string } {
  return /\d/.test(marker)
    ? { ordered: true, delim: marker.slice(-1) }
    : { ordered: false, delim: marker };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let cur = '';
  let endsWithPipe = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
      endsWithPipe = i === trimmed.length - 1;
    } else {
      cur += ch;
      endsWithPipe = false;
    }
  }
  if (!endsWithPipe) cells.push(cur);
  if (trimmed.startsWith('|')) cells.shift();
  return cells.map((c) => c.trim());
}

function tableAlignments(line: string): ('left' | 'center' | 'right' | null)[] | null {
  if (!line.includes('|')) return null;
  const cells = splitTableRow(line);
  if (cells.length === 0) return null;
  const aligns: ('left' | 'center' | 'right' | null)[] = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return aligns;
}

function newInlineCtx(text: string): InlineCtx {
  return { budget: { n: 40 * text.length + 2000 }, depth: 0, noLinks: false };
}

function parseBlocks(lines: string[], ctx: BlockCtx, depth: number, tight: boolean): string {
  if (depth > MAX_BLOCK_DEPTH) {
    const text = lines.join('\n').trim();
    return text === '' ? '' : `<p>${escapeHtml(text)}</p>`;
  }
  const out: string[] = [];
  const n = lines.length;
  let i = 0;

  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    if (indentOf(line) < 4) {
      // Fenced code block
      const fence = isFenceOpen(line);
      if (fence) {
        const fenceIndent = line.length - line.trimStart().length;
        const ch = fence[1][0];
        const len = fence[1].length;
        const closer = new RegExp(`^ {0,3}${ch === '`' ? '`' : '~'}{${len},}[ \\t]*$`);
        const word = fence[2].trim().split(/\s+/)[0] ?? '';
        const body: string[] = [];
        i++;
        while (i < n) {
          if (closer.test(lines[i])) {
            i++;
            break;
          }
          body.push(lines[i].replace(new RegExp(`^ {0,${fenceIndent}}`), ''));
          i++;
        }
        const cls = /^[\w+#.-]+$/.test(word) ? ` class="language-${escapeHtml(word)}"` : '';
        out.push(
          `<pre><code${cls}>${escapeHtml(body.join('\n'))}${body.length ? '\n' : ''}</code></pre>`,
        );
        continue;
      }

      // ATX heading
      const h = HEADING.exec(line);
      if (h) {
        const level = h[1].length;
        const raw = (h[2] ?? '').trim().replace(/(?:^|[ \t]+)#+$/, '').trim();
        const inner = renderInline(raw, newInlineCtx(raw));
        let idAttr = '';
        if (ctx.headingIds) {
          const base = slugify(htmlToText(inner)) || 'section';
          idAttr = ` id="${uniqueSlug(base, ctx.used)}"`;
        }
        out.push(`<h${level}${idAttr}>${inner}</h${level}>`);
        i++;
        continue;
      }

      // Thematic break
      if (HR.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // Blockquote
      if (QUOTE.test(line)) {
        const q: string[] = [];
        while (i < n) {
          const l = lines[i];
          if (QUOTE.test(l)) {
            q.push(l.replace(/^ {0,3}> ?/, ''));
            i++;
            continue;
          }
          if (isBlank(l)) break;
          const prev = q[q.length - 1];
          const lazyOk =
            prev !== undefined &&
            !isBlank(prev) &&
            !HEADING.test(prev) &&
            !HR.test(prev) &&
            !isFenceOpen(prev) &&
            !interruptsParagraph(l);
          if (!lazyOk) break;
          q.push(l);
          i++;
        }
        const inner = parseBlocks(q, ctx, depth + 1, false);
        out.push(inner === '' ? '<blockquote>\n</blockquote>' : `<blockquote>\n${inner}\n</blockquote>`);
        continue;
      }

      // List
      const lm = LIST.exec(line);
      if (lm) {
        const [html, next] = parseList(lines, i, ctx, depth);
        out.push(html);
        i = next;
        continue;
      }

      // Table
      if (line.includes('|') && i + 1 < n) {
        const aligns = tableAlignments(lines[i + 1]);
        const head = splitTableRow(line);
        if (aligns && head.length === aligns.length) {
          const cell = (tag: 'th' | 'td', text: string, k: number): string => {
            const a = aligns[k];
            const style = a ? ` style="text-align:${a}"` : '';
            return `<${tag}${style}>${renderInline(text, newInlineCtx(text))}</${tag}>`;
          };
          const rows: string[] = [];
          i += 2;
          while (i < n && !isBlank(lines[i]) && !interruptsParagraph(lines[i])) {
            const cells = splitTableRow(lines[i]);
            const tds: string[] = [];
            for (let k = 0; k < aligns.length; k++) tds.push(cell('td', cells[k] ?? '', k));
            rows.push(`<tr>${tds.join('')}</tr>`);
            i++;
          }
          const thead = `<thead>\n<tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr>\n</thead>`;
          const tbody = rows.length ? `\n<tbody>\n${rows.join('\n')}\n</tbody>` : '';
          out.push(`<table>\n${thead}${tbody}\n</table>`);
          continue;
        }
      }
    }

    // Paragraph
    const para: string[] = [line.replace(/^[ \t]+/, '')];
    i++;
    while (i < n && !isBlank(lines[i]) && !interruptsParagraph(lines[i])) {
      para.push(lines[i].replace(/^[ \t]+/, ''));
      i++;
    }
    const text = para.join('\n').replace(/[ \t]+$/, '');
    const inner = renderInline(text, newInlineCtx(text));
    out.push(tight ? inner : `<p>${inner}</p>`);
  }

  return out.join('\n');
}

function parseList(lines: string[], start: number, ctx: BlockCtx, depth: number): [string, number] {
  const n = lines.length;
  const first = LIST.exec(lines[start])!;
  const kind = listKind(first[2]);
  const startNumber = kind.ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let loose = false;
  let i = start;

  outer: while (i < n) {
    const line = lines[i];
    const m = LIST.exec(line);
    if (!m || indentOf(line) >= 4 || HR.test(line)) break;
    const k = listKind(m[2]);
    if (k.ordered !== kind.ordered || k.delim !== kind.delim) break;

    const markerEnd = m[1].length + m[2].length;
    const spaces = m[3]?.length ?? 0;
    let contentIndent: number;
    let firstLine: string;
    if ((m[4] ?? '') === '') {
      contentIndent = markerEnd + 1;
      firstLine = '';
    } else if (spaces > 4) {
      contentIndent = markerEnd + 1;
      firstLine = ' '.repeat(spaces - 1) + m[4];
    } else {
      contentIndent = markerEnd + spaces;
      firstLine = m[4]!;
    }

    const itemLines: string[] = [firstLine];
    i++;
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i;
        while (j < n && isBlank(lines[j])) j++;
        if (j < n && indentOf(lines[j]) >= contentIndent) {
          for (let b = i; b < j; b++) itemLines.push('');
          i = j;
          continue;
        }
        break;
      }
      if (indentOf(l) >= contentIndent) {
        itemLines.push(stripIndent(l, contentIndent));
        i++;
        continue;
      }
      const prev = itemLines[itemLines.length - 1];
      if (prev !== '' && !interruptsParagraph(l) && !LIST.test(l)) {
        itemLines.push(l.replace(/^[ \t]+/, ''));
        i++;
        continue;
      }
      break;
    }
    items.push(itemLines);
    if (itemHasLooseGap(itemLines)) loose = true;

    // Blank line(s) between items make the list loose.
    if (i < n && isBlank(lines[i])) {
      let j = i;
      while (j < n && isBlank(lines[j])) j++;
      if (j < n) {
        const nm = LIST.exec(lines[j]);
        if (nm && indentOf(lines[j]) < 4 && !HR.test(lines[j])) {
          const nk = listKind(nm[2]);
          if (nk.ordered === kind.ordered && nk.delim === kind.delim) {
            loose = true;
            i = j;
            continue outer;
          }
        }
      }
      break;
    }
  }

  const rendered = items.map((itemLines) => {
    const inner = parseBlocks(itemLines, ctx, depth + 1, !loose);
    return loose && inner !== '' ? `<li>\n${inner}\n</li>` : `<li>${inner}</li>`;
  });
  const tag = kind.ordered ? 'ol' : 'ul';
  const startAttr = kind.ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
  return [`<${tag}${startAttr}>\n${rendered.join('\n')}\n</${tag}>`, i];
}

/** A blank line inside an item followed by more top-level content makes the list loose. */
function itemHasLooseGap(itemLines: string[]): boolean {
  let inFence = false;
  for (let k = 0; k < itemLines.length - 1; k++) {
    const l = itemLines[k];
    if (isFenceOpen(l) || /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(l)) inFence = !inFence;
    if (inFence) continue;
    if (l === '' && itemLines[k + 1] !== '' && !/^\s/.test(itemLines[k + 1]) && !LIST.test(itemLines[k + 1])) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

type InlineNode =
  | { t: 'html'; v: string }
  | { t: 'delim'; ch: string; count: number; orig: number; canOpen: boolean; canClose: boolean };

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;

function isWs(ch: string): boolean {
  return /\s/.test(ch);
}
function isPunct(ch: string): boolean {
  return UNICODE_PUNCT.test(ch);
}

function unescapeMd(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

function findCodeClose(src: string, from: number, len: number, st: InlineCtx): number {
  let j = from;
  while (j < src.length) {
    if (--st.budget.n < 0) return -1;
    if (src[j] === '`') {
      let k = j;
      while (src[k] === '`') k++;
      if (k - j === len) return j;
      j = k;
    } else j++;
  }
  return -1;
}

function findClosingBracket(src: string, open: number, st: InlineCtx): number {
  let depth = 0;
  let j = open;
  while (j < src.length) {
    if (--st.budget.n < 0) return -1;
    const ch = src[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '`') {
      let k = j;
      while (src[k] === '`') k++;
      const close = findCodeClose(src, k, k - j, st);
      j = close >= 0 ? close + (k - j) : k;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

function parseLinkTail(
  src: string,
  paren: number,
): { url: string; title: string | null; end: number } | null {
  const n = src.length;
  let i = paren + 1;
  const skipWs = (): void => {
    while (i < n && /[ \t\n]/.test(src[i])) i++;
  };
  skipWs();
  let dest = '';
  if (src[i] === '<') {
    let j = i + 1;
    while (j < n && src[j] !== '>' && src[j] !== '<' && src[j] !== '\n') {
      if (src[j] === '\\') j++;
      j++;
    }
    if (src[j] !== '>') return null;
    dest = unescapeMd(src.slice(i + 1, j));
    i = j + 1;
  } else {
    const s = i;
    let depth = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\' && i + 1 < n && ASCII_PUNCT.test(src[i + 1])) {
        i += 2;
        continue;
      }
      if (ch <= ' ') break;
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    if (depth !== 0) return null;
    dest = unescapeMd(src.slice(s, i));
  }
  skipWs();
  let title: string | null = null;
  const q = src[i];
  if (q === '"' || q === "'" || q === '(') {
    const closeCh = q === '(' ? ')' : q;
    let j = i + 1;
    while (j < n && src[j] !== closeCh) {
      if (src[j] === '\\') j++;
      j++;
    }
    if (j >= n) return null;
    title = unescapeMd(src.slice(i + 1, j));
    i = j + 1;
    skipWs();
  }
  if (src[i] !== ')') return null;
  return { url: dest, title, end: i + 1 };
}

const SPECIAL = /[\\`!<[*_\n]/g;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const EMAIL_AUTOLINK = /<([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>/y;

function renderInline(src: string, st: InlineCtx): string {
  const nodes: InlineNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') {
      nodes.push({ t: 'html', v: buf });
      buf = '';
    }
  };
  const pushHtml = (html: string): void => {
    flush();
    nodes.push({ t: 'html', v: html });
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    SPECIAL.lastIndex = i;
    const m = SPECIAL.exec(src);
    const next = m ? m.index : n;
    if (next > i) {
      buf += escapeHtml(src.slice(i, next));
      i = next;
      if (i >= n) break;
    }
    const c = src[i];

    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === '\n') {
        pushHtml('<br>\n');
        i += 2;
      } else if (nx !== undefined && ASCII_PUNCT.test(nx)) {
        buf += escapeHtml(nx);
        i += 2;
      } else {
        buf += '\\';
        i++;
      }
      continue;
    }

    if (c === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const len = k - i;
      const close = findCodeClose(src, k, len, st);
      if (close >= 0) {
        let code = src.slice(k, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
          code = code.slice(1, -1);
        }
        pushHtml(`<code>${escapeHtml(code)}</code>`);
        i = close + len;
      } else {
        buf += src.slice(i, k);
        i = k;
      }
      continue;
    }

    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const isImg = c === '!';
      const open = isImg ? i + 1 : i;
      if (!isImg && st.noLinks) {
        buf += '[';
        i++;
        continue;
      }
      if (st.depth < MAX_INLINE_DEPTH) {
        const close = findClosingBracket(src, open, st);
        if (close >= 0 && src[close + 1] === '(') {
          const tail = parseLinkTail(src, close + 1);
          if (tail) {
            const label = src.slice(open + 1, close);
            const inner = renderInline(label, { ...st, depth: st.depth + 1, noLinks: true });
            const url = sanitizeUrl(tail.url);
            const titleAttr = tail.title !== null ? ` title="${escapeHtml(tail.title)}"` : '';
            if (isImg) {
              const alt = escapeHtml(htmlToText(inner));
              pushHtml(url === null ? alt : `<img src="${escapeHtml(url)}" alt="${alt}"${titleAttr}>`);
            } else {
              pushHtml(url === null ? inner : `<a href="${escapeHtml(url)}"${titleAttr}>${inner}</a>`);
            }
            i = tail.end;
            continue;
          }
        }
      }
      buf += isImg ? '![' : '[';
      i = open + 1;
      continue;
    }

    if (c === '!') {
      buf += '!';
      i++;
      continue;
    }

    if (c === '<') {
      AUTOLINK.lastIndex = i;
      const a = AUTOLINK.exec(src);
      if (a && !st.noLinks) {
        const url = sanitizeUrl(a[1]);
        if (url !== null) {
          pushHtml(`<a href="${escapeHtml(url)}">${escapeHtml(a[1])}</a>`);
          i += a[0].length;
          continue;
        }
      }
      EMAIL_AUTOLINK.lastIndex = i;
      const e = EMAIL_AUTOLINK.exec(src);
      if (e && !st.noLinks) {
        pushHtml(`<a href="mailto:${escapeHtml(e[1])}">${escapeHtml(e[1])}</a>`);
        i += e[0].length;
        continue;
      }
      buf += '&lt;';
      i++;
      continue;
    }

    if (c === '*' || c === '_') {
      let k = i;
      while (src[k] === c) k++;
      const prev = i === 0 ? '\n' : src[i - 1];
      const after = k >= n ? '\n' : src[k];
      const left = !isWs(after) && (!isPunct(after) || isWs(prev) || isPunct(prev));
      const right = !isWs(prev) && (!isPunct(prev) || isWs(after) || isPunct(after));
      const canOpen = c === '*' ? left : left && (!right || isPunct(prev));
      const canClose = c === '*' ? right : right && (!left || isPunct(after));
      flush();
      nodes.push({ t: 'delim', ch: c, count: k - i, orig: k - i, canOpen, canClose });
      i = k;
      continue;
    }

    if (c === '\n') {
      const trailing = /( {2,})$/.exec(buf);
      if (trailing) {
        buf = buf.slice(0, -trailing[1].length);
        pushHtml('<br>\n');
      } else {
        buf = buf.replace(/ +$/, '') + '\n';
      }
      i++;
      continue;
    }

    // Unreachable in practice; keeps the loop total.
    buf += escapeHtml(c);
    i++;
  }
  flush();

  applyEmphasis(nodes, st);

  let html = '';
  for (const node of nodes) {
    html += node.t === 'html' ? node.v : node.ch.repeat(node.count);
  }
  return html;
}

function applyEmphasis(nodes: InlineNode[], st: InlineCtx): void {
  for (let c = 0; c < nodes.length; c++) {
    const closer = nodes[c];
    if (closer.t !== 'delim' || !closer.canClose) continue;
    while (closer.count > 0) {
      let found = -1;
      for (let k = c - 1; k >= 0; k--) {
        if (--st.budget.n < 0) return;
        const op = nodes[k];
        if (op.t !== 'delim' || op.ch !== closer.ch || !op.canOpen || op.count === 0) continue;
        // "Rule of 3" from CommonMark.
        if (
          (op.canClose || closer.canOpen) &&
          (op.orig + closer.orig) % 3 === 0 &&
          !(op.orig % 3 === 0 && closer.orig % 3 === 0)
        ) {
          continue;
        }
        found = k;
        break;
      }
      if (found < 0) break;
      const opener = nodes[found] as Extract<InlineNode, { t: 'delim' }>;
      const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= use;
      closer.count -= use;
      for (let k = found + 1; k < c; k++) {
        const mid = nodes[k];
        if (mid.t === 'delim') {
          mid.canOpen = false;
          mid.canClose = false;
        }
      }
      const tag = use === 2 ? 'strong' : 'em';
      nodes.splice(c, 0, { t: 'html', v: `</${tag}>` });
      nodes.splice(found + 1, 0, { t: 'html', v: `<${tag}>` });
      c += 2;
    }
  }
}
