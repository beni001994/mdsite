import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contentType, resolveRequestPath, startServer, type RunningServer } from '../src/serve.js';
import { main } from '../src/cli.js';
import { makeSite, post } from './helpers.js';

describe('contentType', () => {
  it.each([
    ['a.html', 'text/html; charset=utf-8'],
    ['A.HTML', 'text/html; charset=utf-8'],
    ['a.css', 'text/css; charset=utf-8'],
    ['feed.xml', 'application/xml; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['a.png', 'image/png'],
    ['a.unknown', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s -> %s', (file, type) => {
    expect(contentType(file)).toBe(type);
  });
});

describe('resolveRequestPath', () => {
  const out = () =>
    makeSite({
      'out/index.html': 'home',
      'out/a.html': 'a',
      'out/sub/index.html': 'sub',
      'out/sub/page.html': 'page',
      'out/empty/.keep': '',
      'out/.mdsite-output': 'marker',
      'secret.txt': 'outside',
    });

  it('maps / and directories to index.html', async () => {
    const root = out();
    const o = join(root, 'out');
    expect(await resolveRequestPath(o, '/')).toEqual({ ok: true, file: join(o, 'index.html') });
    expect(await resolveRequestPath(o, '/sub/')).toEqual({ ok: true, file: join(o, 'sub', 'index.html') });
    expect(await resolveRequestPath(o, '/sub')).toEqual({ ok: true, file: join(o, 'sub', 'index.html') });
  });

  it('maps files and ignores the query string and fragment', async () => {
    const o = join(out(), 'out');
    expect(await resolveRequestPath(o, '/a.html?x=1#y')).toEqual({ ok: true, file: join(o, 'a.html') });
    expect(await resolveRequestPath(o, '/sub/page.html')).toEqual({ ok: true, file: join(o, 'sub', 'page.html') });
  });

  it('returns 404 for missing files and directories without an index', async () => {
    const o = join(out(), 'out');
    expect(await resolveRequestPath(o, '/missing.html')).toEqual({ ok: false, status: 404 });
    expect(await resolveRequestPath(o, '/empty/')).toEqual({ ok: false, status: 404 });
  });

  it('hides the marker file and other dot files', async () => {
    const o = join(out(), 'out');
    expect(await resolveRequestPath(o, '/.mdsite-output')).toEqual({ ok: false, status: 404 });
    expect(await resolveRequestPath(o, '/empty/.keep')).toMatchObject({ ok: true });
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/secret.txt',
    '/sub/../../secret.txt',
    '/sub/%2e%2e/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..\\secret.txt',
    '/..%5csecret.txt',
    '//../secret.txt',
  ])('never serves files outside the output directory: %s', async (url) => {
    const o = join(out(), 'out');
    const r = await resolveRequestPath(o, url);
    if (r.ok) expect(r.file.startsWith(o)).toBe(true);
    else expect([400, 403, 404]).toContain(r.status);
    expect(r.ok && r.file.endsWith('secret.txt')).toBe(false);
  });

  it('rejects malformed percent-encoding and NUL bytes', async () => {
    const o = join(out(), 'out');
    expect(await resolveRequestPath(o, '/%E0%A4%A')).toEqual({ ok: false, status: 400 });
    expect(await resolveRequestPath(o, '/a.html%00.png')).toEqual({ ok: false, status: 400 });
  });
});

describe('startServer', () => {
  const running: RunningServer[] = [];
  afterEach(async () => {
    for (const s of running.splice(0)) await s.close();
  });

  const start = async (files: Record<string, string>, extra: { watch?: boolean; log?: (m: string) => void } = {}) => {
    const root = makeSite(files);
    const s = await startServer({ root, port: 0, watch: false, ...extra });
    running.push(s);
    return { root, s };
  };

  const files = {
    'mdsite.json': '{"title":"Served"}',
    'content/posts/a.md': post('Hello served', '2025-01-01'),
    'static/robots.txt': 'User-agent: *',
  };

  it('builds and serves the site over HTTP', async () => {
    const { s } = await start(files);
    expect(s.initialBuild.posts).toBe(1);
    const index = await fetch(s.url);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await index.text()).toContain('Hello served');

    const robots = await fetch(`${s.url}robots.txt`);
    expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await robots.text()).toBe('User-agent: *');

    expect((await fetch(`${s.url}posts/a.html`)).status).toBe(200);
  });

  it('binds to loopback by default', async () => {
    const { s } = await start(files);
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('returns 404 for unknown paths and hides the marker file', async () => {
    const { s } = await start(files);
    expect((await fetch(`${s.url}nope.html`)).status).toBe(404);
    expect((await fetch(`${s.url}.mdsite-output`)).status).toBe(404);
  });

  it('supports HEAD without a body and rejects other methods', async () => {
    const { s } = await start(files);
    const head = await fetch(`${s.url}index.html`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await fetch(s.url, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('does not serve files outside the output directory', async () => {
    const { s, root } = await start(files);
    writeFileSync(join(root, 'secret.txt'), 'TOP SECRET');
    // fetch normalizes dot segments, so use a raw socket-level request via http
    const { request } = await import('node:http');
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const url = new URL(s.url);
      const req = request({ host: url.hostname, port: url.port, path: '/%2e%2e/secret.txt', method: 'GET' }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(body.status).not.toBe(200);
    expect(body.text).not.toContain('TOP SECRET');
  });

  it('fails to start when the site cannot be built', async () => {
    const root = makeSite({ 'content/bad.md': '---\ndate: nope\n---\n' });
    await expect(startServer({ root, port: 0, watch: false })).rejects.toThrow(/date/);
  });

  it('rebuilds when a source file changes and keeps serving after a failed rebuild', async () => {
    const logs: string[] = [];
    const root = makeSite(files);
    const s = await startServer({ root, port: 0, log: (m) => logs.push(m) });
    running.push(s);

    const waitFor = async (predicate: () => Promise<boolean>, label: string) => {
      for (let i = 0; i < 60; i++) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${label}; log: ${logs.join(' | ')}`);
    };

    mkdirSync(join(root, 'content', 'posts'), { recursive: true });
    writeFileSync(join(root, 'content', 'posts', 'b.md'), post('Second served', '2025-02-01'));
    await waitFor(async () => (await (await fetch(s.url)).text()).includes('Second served'), 'rebuild');

    writeFileSync(join(root, 'content', 'posts', 'broken.md'), '---\ndate: nope\n---\n');
    await waitFor(async () => logs.some((l) => l.includes('build failed')), 'failure log');
    expect((await fetch(s.url)).status).toBe(200);
  }, 15000);
});

describe('cli: serve', () => {
  it('serves until the abort signal fires', async () => {
    const root = makeSite({ 'content/a.md': 'hello' });
    const controller = new AbortController();
    let out = '';
    const done = main(
      ['serve', '--port', '0', '-C', root],
      { stdout: (s) => (out += s), stderr: () => {}, cwd: root },
      controller.signal,
    );
    for (let i = 0; i < 50 && !out.includes('Serving'); i++) await new Promise((r) => setTimeout(r, 50));
    expect(out).toMatch(/Serving .* at http:\/\/127\.0\.0\.1:\d+\//);
    controller.abort();
    expect(await done).toBe(0);
  });
});
