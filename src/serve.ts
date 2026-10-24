import { createServer, type Server } from 'node:http';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildSite, type BuildResult } from './site.js';
import { loadConfig, isInside } from './config.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export type ResolveResult =
  | { ok: true; file: string }
  | { ok: false; status: 400 | 403 | 404 };

/**
 * Map a request URL to a file inside `outDir`, rejecting anything that
 * would escape it (encoded dots, backslashes, NUL bytes, ...).
 */
export async function resolveRequestPath(outDir: string, requestUrl: string): Promise<ResolveResult> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return { ok: false, status: 400 };
  }
  if (pathname.includes('\0')) return { ok: false, status: 400 };
  if (pathname.includes('\\')) return { ok: false, status: 403 };
  const root = resolve(outDir);
  let target = resolve(root, '.' + pathname);
  if (!isInside(root, target)) return { ok: false, status: 403 };
  try {
    let s = await stat(target);
    if (s.isDirectory()) {
      target = join(target, 'index.html');
      s = await stat(target);
    }
    if (!s.isFile()) return { ok: false, status: 404 };
  } catch {
    return { ok: false, status: 404 };
  }
  // Never serve the marker file.
  if (relative(root, target).split(sep)[0].startsWith('.')) return { ok: false, status: 404 };
  return { ok: true, file: target };
}

export interface ServeOptions {
  root: string;
  port?: number;
  host?: string;
  drafts?: boolean;
  outDir?: string;
  /** Rebuild when source files change. Default true. */
  watch?: boolean;
  log?: (message: string) => void;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  initialBuild: BuildResult;
  close(): Promise<void>;
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const log = options.log ?? (() => {});
  const buildOptions = { drafts: options.drafts, outDir: options.outDir };
  const initialBuild = buildSite(options.root, buildOptions);
  const config = loadConfig(options.root, options.outDir);
  const outDir = config.outDir;

  const server = createServer((req, res) => {
    void (async () => {
      const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
        return;
      }
      const r = await resolveRequestPath(outDir, req.url ?? '/');
      if (!r.ok) {
        res.writeHead(r.status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : `${r.status}\n`);
        return;
      }
      try {
        const body = await readFile(r.file);
        res.writeHead(200, { ...headers, 'Content-Type': contentType(r.file), 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('404\n');
      }
    })();
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4000, options.host ?? '127.0.0.1', () => resolveListen());
  });
  const port = (server.address() as AddressInfo).port;
  const host = options.host ?? '127.0.0.1';

  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  if (options.watch !== false) {
    const rebuild = (): void => {
      try {
        const r = buildSite(options.root, buildOptions);
        log(`rebuilt: ${r.posts} posts, ${r.pages} pages`);
      } catch (e) {
        log(`build failed (still serving previous output): ${(e as Error).message}`);
      }
    };
    try {
      watcher = watch(config.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const abs = resolve(config.root, filename.toString());
        if (isInside(outDir, abs)) return;
        const top = relative(config.root, abs).split(sep)[0];
        if (top === 'node_modules' || top.startsWith('.')) return;
        clearTimeout(timer);
        timer = setTimeout(rebuild, 150);
      });
      watcher.on('error', (e) => log(`watcher error: ${e.message}`));
    } catch (e) {
      log(`file watching unavailable: ${(e as Error).message}`);
    }
  }

  return {
    server,
    port,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}/`,
    initialBuild,
    close: () =>
      new Promise<void>((done) => {
        clearTimeout(timer);
        watcher?.close();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
