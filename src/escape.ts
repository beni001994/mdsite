const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for use in HTML text nodes and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Escape text for XML (RSS). Characters that are illegal in XML 1.0 are dropped. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, (c) => (c === "'" ? '&apos;' : HTML_ESCAPES[c]));
}

/** Reverse of escapeHtml, for exactly the five entities it produces. */
export function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_m, name: string) => {
    switch (name) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      default:
        return "'";
    }
  });
}

/** Remove tags from HTML that this library produced and decode its entities. */
export function htmlToText(html: string): string {
  return unescapeHtml(html.replace(/<[^>]*>/g, ''));
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Allow-list URL check for links and images. Relative URLs, fragments and
 * http/https/mailto/tel are allowed. Anything else (javascript:, data:,
 * vbscript:, file:, obfuscated variants) returns null.
 *
 * Browsers ignore ASCII whitespace/control characters inside the scheme, so
 * those are removed before the scheme is inspected.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  const compact = url.replace(/[\x00-\x20\x7f-\x9f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  const m = /^([^:/?#]*):/.exec(compact);
  if (m && !SAFE_SCHEMES.has(m[1].toLowerCase())) return null;
  return url;
}
