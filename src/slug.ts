const MAX_SLUG_LENGTH = 80;

/**
 * Turn arbitrary text into a URL-safe ASCII slug: lowercase, accents removed,
 * runs of other characters collapsed to a single "-". Characters outside
 * Latin letters and digits (e.g. CJK) are dropped, so the result can be empty.
 */
export function slugify(input: string): string {
  let slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  }
  return slug;
}

/** Return `base`, or `base-2`, `base-3`, ... whichever is not in `used`; records the result. */
export function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  used.add(candidate);
  return candidate;
}
