import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { MdsiteError } from './errors.js';

export interface SiteConfig {
  title: string;
  description: string;
  /** Absolute site URL without trailing slash. Required for the RSS feed. */
  baseUrl?: string;
  language: string;
  author?: string;
  feedLimit: number;
  /** Absolute paths. */
  root: string;
  contentDir: string;
  staticDir: string;
  outDir: string;
}

const KNOWN_KEYS = new Set([
  'title',
  'description',
  'baseUrl',
  'language',
  'author',
  'feedLimit',
  'contentDir',
  'staticDir',
  'outDir',
]);

function str(raw: Record<string, unknown>, key: string, fallback: string): string {
  const v = raw[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new MdsiteError(`mdsite.json: "${key}" must be a non-empty string`);
  }
  return v.trim();
}

export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export function loadConfig(root: string, outDirOverride?: string): SiteConfig {
  const absRoot = resolve(root);
  const file = join(absRoot, 'mdsite.json');
  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new MdsiteError(`mdsite.json: invalid JSON (${(e as Error).message})`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MdsiteError('mdsite.json: expected a JSON object');
    }
    raw = parsed as Record<string, unknown>;
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new MdsiteError(`mdsite.json: unknown key "${key}" (known: ${[...KNOWN_KEYS].join(', ')})`);
    }
  }

  let baseUrl: string | undefined;
  if (raw.baseUrl !== undefined) {
    const value = str(raw, 'baseUrl', '');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new MdsiteError(`mdsite.json: "baseUrl" must be an absolute http(s) URL, got "${value}"`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new MdsiteError(`mdsite.json: "baseUrl" must use http or https, got "${value}"`);
    }
    baseUrl = value.replace(/\/+$/, '');
  }

  const language = str(raw, 'language', 'en');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(language)) {
    throw new MdsiteError(`mdsite.json: "language" must be a language tag like "en" or "pt-BR", got "${language}"`);
  }

  let feedLimit = 20;
  if (raw.feedLimit !== undefined) {
    const v = raw.feedLimit;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 500) {
      throw new MdsiteError('mdsite.json: "feedLimit" must be an integer between 1 and 500');
    }
    feedLimit = v;
  }

  const config: SiteConfig = {
    title: str(raw, 'title', 'My Site'),
    description: raw.description === undefined ? '' : str(raw, 'description', ''),
    baseUrl,
    language,
    author: raw.author === undefined ? undefined : str(raw, 'author', ''),
    feedLimit,
    root: absRoot,
    contentDir: resolve(absRoot, str(raw, 'contentDir', 'content')),
    staticDir: resolve(absRoot, str(raw, 'staticDir', 'static')),
    outDir: outDirOverride ? resolve(outDirOverride) : resolve(absRoot, str(raw, 'outDir', 'dist')),
  };

  const { outDir, contentDir, staticDir } = config;
  if (isInside(outDir, absRoot)) {
    throw new MdsiteError(`output directory ${outDir} must not be the site root or contain it`);
  }
  for (const [name, dir] of [
    ['content', contentDir],
    ['static', staticDir],
  ] as const) {
    if (isInside(outDir, dir) || isInside(dir, outDir)) {
      throw new MdsiteError(`output directory ${outDir} must not overlap the ${name} directory ${dir}`);
    }
  }
  return config;
}
