import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseFrontMatter } from '../src/frontmatter.js';
import { buildMeta } from '../src/meta.js';
import { createPost } from '../src/new.js';
import { makeSite, post } from './helpers.js';

async function run(cwd: string, ...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd });
  return { code, stdout, stderr };
}

describe('cli: help and errors', () => {
  it('prints help with no arguments', async () => {
    const r = await run(makeSite({}));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('mdsite build');
  });

  it.each([['--help'], ['-h'], ['build', '--help']])('prints help for %j', async (...args) => {
    const r = await run(makeSite({}), ...args);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('prints the version', async () => {
    const r = await run(makeSite({}), '--version');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 2 on an unknown command', async () => {
    const r = await run(makeSite({}), 'frobnicate');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown command "frobnicate"');
  });

  it('exits 2 on an unknown option', async () => {
    const r = await run(makeSite({}), 'build', '--nope');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error:');
  });

  it('exits 2 on stray positional arguments', async () => {
    const r = await run(makeSite({}), 'build', 'extra');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unexpected argument "extra"');
  });

  it('exits 2 when serve gets an invalid port', async () => {
    for (const port of ['abc', '-1', '70000', '1.5']) {
      const r = await run(makeSite({ 'content/a.md': 'x' }), 'serve', '--port', port);
      expect(r.code, port).toBe(2);
    }
  });

  it('exits 1 with a readable message for build errors', async () => {
    const root = makeSite({ 'content/bad.md': '---\ndate: nope\n---\n' });
    const r = await run(root, 'build');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^error: bad\.md: "date" must look like/);
    expect(r.stderr).not.toContain('at ');
  });
});

describe('cli: build', () => {
  it('builds the site in the current directory', async () => {
    const root = makeSite({ 'content/posts/a.md': post('A', '2025-01-01') });
    const r = await run(root, 'build');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Built 1 post\(s\), 0 page\(s\), 0 tag\(s\)/);
    expect(existsSync(join(root, 'dist', 'posts', 'a.html'))).toBe(true);
  });

  it('mentions that no feed was written without a baseUrl', async () => {
    const root = makeSite({ 'content/posts/a.md': post('A', '2025-01-01') });
    expect((await run(root, 'build')).stdout).toContain('No RSS feed written');
  });

  it('does not mention the feed when one was written', async () => {
    const root = makeSite({
      'mdsite.json': '{"baseUrl":"https://example.com"}',
      'content/posts/a.md': post('A', '2025-01-01'),
    });
    expect((await run(root, 'build')).stdout).not.toContain('No RSS feed');
  });

  it('accepts --root and --out', async () => {
    const root = makeSite({ 'content/a.md': 'x' });
    const other = makeSite({});
    const r = await run(other, 'build', '--root', root, '--out', join(other, 'site-out'));
    expect(r.code).toBe(0);
    expect(existsSync(join(other, 'site-out', 'a.html'))).toBe(true);
  });

  it('accepts the short options -C and -o', async () => {
    const root = makeSite({ 'content/a.md': 'x' });
    const r = await run(root, 'build', '-C', '.', '-o', 'out');
    expect(r.code).toBe(0);
    expect(existsSync(join(root, 'out', 'a.html'))).toBe(true);
  });

  it('reports skipped drafts and includes them with --drafts', async () => {
    const root = makeSite({ 'content/a.md': post('A', '2025-01-01', 'draft: true\n') });
    const r1 = await run(root, 'build');
    expect(r1.stdout).toContain('1 draft(s) skipped');
    const r2 = await run(root, 'build', '--drafts');
    expect(r2.stdout).not.toContain('skipped');
    expect(existsSync(join(root, 'dist', 'a.html'))).toBe(true);
  });

  it('prints warnings to stderr', async () => {
    const root = makeSite({ 'content/p.md': '---\ntags: [x]\n---\n' });
    const r = await run(root, 'build');
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('warning: p.md: tags are ignored');
  });
});

describe('cli: new', () => {
  const NOW = new Date(2025, 2, 9, 12, 0, 0); // local time, 9 March 2025

  it('creates a draft post with a dated slug-named file', async () => {
    const root = makeSite({ 'content/a.md': 'x' });
    const r = await run(root, 'new', 'My First Post');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Created');
    const file = join(root, 'content', 'posts', 'my-first-post.md');
    expect(existsSync(file)).toBe(true);
    const { data } = parseFrontMatter(readFileSync(file, 'utf8'));
    expect(data.title).toBe('My First Post');
    expect(data.draft).toBe(true);
    expect(data.tags).toEqual([]);
    expect(String(data.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('joins several words into one title', async () => {
    const root = makeSite({});
    await run(root, 'new', 'Hello', 'there', 'world');
    expect(existsSync(join(root, 'content', 'posts', 'hello-there-world.md'))).toBe(true);
  });

  it('refuses to overwrite an existing post', async () => {
    const root = makeSite({});
    await run(root, 'new', 'Same');
    const file = join(root, 'content', 'posts', 'same.md');
    writeFileSync(file, 'precious');
    const r = await run(root, 'new', 'Same');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('already exists');
    expect(readFileSync(file, 'utf8')).toBe('precious');
  });

  it('requires a title', async () => {
    const r = await run(makeSite({}), 'new');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('needs a title');
  });

  it('rejects titles that cannot make a file name', async () => {
    const r = await run(makeSite({}), 'new', '???');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot derive a file name');
  });

  it('rejects blank titles', async () => {
    const r = await run(makeSite({}), 'new', '   ');
    expect(r.code).toBe(1);
  });

  it('uses the local date from the supplied clock', () => {
    const root = makeSite({});
    const file = createPost(root, 'Dated', NOW);
    expect(readFileSync(file, 'utf8')).toContain('date: 2025-03-09\n');
  });

  it.each([
    'Quotes "inside" a title',
    'Colon: and # hash',
    'Back\\slash',
    "It's [bracketed] {braced}",
    'true',
    '<script>alert(1)</script>',
    'Multi\nline   title',
  ])('writes front matter that round-trips for title %j', (title) => {
    const root = makeSite({});
    const file = createPost(root, title, NOW);
    const { data } = parseFrontMatter(readFileSync(file, 'utf8'));
    expect(data.title).toBe(title.replace(/\s+/g, ' ').trim());
    expect(() => buildMeta(data, 'x')).not.toThrow();
  });

  it('creates a post that builds only with --drafts', async () => {
    const root = makeSite({});
    await run(root, 'new', 'Fresh idea');
    expect((await run(root, 'build')).stdout).toContain('0 post(s)');
    const r = await run(root, 'build', '--drafts');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Built 1 post(s)');
    expect(existsSync(join(root, 'dist', 'posts', 'fresh-idea.html'))).toBe(true);
  });
});
