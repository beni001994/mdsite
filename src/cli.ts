import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MdsiteError } from './errors.js';
import { createPost } from './new.js';
import { startServer } from './serve.js';
import { buildSite } from './site.js';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
}

const HELP = `mdsite - a small static site generator

Usage:
  mdsite build [options]          Build the site into the output directory
  mdsite new <title> [options]    Create content/posts/<slug>.md (as a draft)
  mdsite serve [options]          Build, serve over HTTP and rebuild on change

Options:
  -C, --root <dir>    Site directory (default: current directory)
  -o, --out <dir>     Output directory (build/serve; default: "dist" or mdsite.json)
      --drafts        Include posts marked "draft: true" (build/serve)
  -p, --port <n>      Port for serve (default: 4000; 0 picks a free port)
      --host <host>   Host for serve (default: 127.0.0.1)
  -h, --help          Show this help
  -v, --version       Show the version
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

class UsageError extends Error {}

/** Run the CLI. Resolves to the process exit code. `serve` resolves when the server is stopped. */
export async function main(argv: string[], io: CliIO, signal?: AbortSignal): Promise<number> {
  try {
    return await run(argv, io, signal);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`error: ${e.message}\n\n${HELP}`);
      return 2;
    }
    if (e instanceof MdsiteError) {
      io.stderr(`error: ${e.message}\n`);
      return 1;
    }
    io.stderr(`unexpected error: ${(e as Error).stack ?? String(e)}\n`);
    return 1;
  }
}

async function run(argv: string[], io: CliIO, signal?: AbortSignal): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: 'string', short: 'C' },
        out: { type: 'string', short: 'o' },
        drafts: { type: 'boolean' },
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${version()}\n`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (command === undefined) {
    io.stdout(HELP);
    return 0;
  }
  const root = resolve(io.cwd, values.root ?? '.');
  const out = values.out === undefined ? undefined : resolve(io.cwd, values.out);

  switch (command) {
    case 'build': {
      if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}" (use --root to choose a directory)`);
      const r = buildSite(root, { drafts: values.drafts, outDir: out });
      for (const w of r.warnings) io.stderr(`warning: ${w}\n`);
      const draftNote = r.skippedDrafts > 0 ? `, ${r.skippedDrafts} draft(s) skipped` : '';
      io.stdout(
        `Built ${r.posts} post(s), ${r.pages} page(s), ${r.tags} tag(s)${draftNote} -> ${r.outDir}\n`,
      );
      if (!r.feed) {
        io.stdout('No RSS feed written (set "baseUrl" in mdsite.json and add at least one post to enable it).\n');
      }
      return 0;
    }
    case 'new': {
      if (rest.length === 0) throw new UsageError('"new" needs a title, e.g. mdsite new "My first post"');
      const file = createPost(root, rest.join(' '));
      io.stdout(`Created ${relative(io.cwd, file) || file}\n`);
      return 0;
    }
    case 'serve': {
      if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}" (use --root to choose a directory)`);
      let port = 4000;
      if (values.port !== undefined) {
        if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) {
          throw new UsageError(`invalid port "${values.port}"`);
        }
        port = Number(values.port);
      }
      const running = await startServer({
        root,
        port,
        host: values.host,
        drafts: values.drafts,
        outDir: out,
        log: (m) => io.stdout(`${m}\n`),
      });
      io.stdout(`Serving ${running.initialBuild.outDir} at ${running.url} (Ctrl+C to stop)\n`);
      await new Promise<void>((done) => {
        if (signal?.aborted) return done();
        signal?.addEventListener('abort', () => done(), { once: true });
      });
      await running.close();
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}
