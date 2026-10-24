import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, loadConfig } from '../src/config.js';
import { makeSite } from './helpers.js';

const cfg = (json: unknown) => loadConfig(makeSite({ 'mdsite.json': typeof json === 'string' ? json : JSON.stringify(json) }));

describe('loadConfig', () => {
  it('uses defaults when mdsite.json is absent', () => {
    const root = makeSite({});
    const c = loadConfig(root);
    expect(c.title).toBe('My Site');
    expect(c.description).toBe('');
    expect(c.language).toBe('en');
    expect(c.baseUrl).toBeUndefined();
    expect(c.feedLimit).toBe(20);
    expect(c.contentDir).toBe(resolve(root, 'content'));
    expect(c.staticDir).toBe(resolve(root, 'static'));
    expect(c.outDir).toBe(resolve(root, 'dist'));
  });

  it('reads all supported keys', () => {
    const c = cfg({
      title: ' T ',
      description: 'D',
      baseUrl: 'https://example.com/blog///',
      language: 'pt-BR',
      author: 'Me',
      feedLimit: 5,
      contentDir: 'src',
      staticDir: 'public',
      outDir: 'build',
    });
    expect(c.title).toBe('T');
    expect(c.baseUrl).toBe('https://example.com/blog');
    expect(c.language).toBe('pt-BR');
    expect(c.author).toBe('Me');
    expect(c.feedLimit).toBe(5);
    expect(c.contentDir.endsWith('src')).toBe(true);
    expect(c.outDir.endsWith('build')).toBe(true);
  });

  it('applies an output directory override', () => {
    const root = makeSite({});
    expect(loadConfig(root, join(root, 'o')).outDir).toBe(join(root, 'o'));
  });

  it.each([
    ['{ not json', /invalid JSON/],
    ['[]', /expected a JSON object/],
    ['"str"', /expected a JSON object/],
    ['null', /expected a JSON object/],
    [{ titel: 'typo' }, /unknown key "titel"/],
    [{ title: 3 }, /"title" must be a non-empty string/],
    [{ title: '  ' }, /"title" must be a non-empty string/],
    [{ baseUrl: 'example.com' }, /"baseUrl" must be an absolute/],
    [{ baseUrl: 'ftp://example.com' }, /must use http or https/],
    [{ baseUrl: 'javascript:alert(1)' }, /must use http or https/],
    [{ language: 'english language' }, /"language" must be a language tag/],
    [{ feedLimit: 0 }, /"feedLimit"/],
    [{ feedLimit: 1.5 }, /"feedLimit"/],
    [{ feedLimit: '5' }, /"feedLimit"/],
    [{ feedLimit: 501 }, /"feedLimit"/],
    [{ outDir: '.' }, /must not be the site root or contain it/],
    [{ outDir: '..' }, /must not be the site root or contain it/],
    [{ outDir: 'content' }, /overlap the content directory/],
    [{ outDir: 'content/out' }, /overlap the content directory/],
    [{ outDir: 'static' }, /overlap the static directory/],
    [{ contentDir: 'dist' }, /overlap the content directory/],
  ])('rejects %j', (json, pattern) => {
    expect(() => cfg(json)).toThrow(pattern);
  });
});

describe('isInside', () => {
  it('is true for the directory itself and descendants', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b/c/d')).toBe(true);
  });

  it('is false for siblings with a common prefix and for parents', () => {
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });
});
