import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Create a temporary site directory from a map of relative path to file content. */
export function makeSite(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mdsite-test-'));
  created.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, ...rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

export function post(title: string, date: string, extra = '', body = 'Body.'): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\n${extra}---\n${body}\n`;
}
