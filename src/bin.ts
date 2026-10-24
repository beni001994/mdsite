#!/usr/bin/env node
import { main } from './cli.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

const code = await main(
  process.argv.slice(2),
  {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.cwd(),
  },
  controller.signal,
);
process.exitCode = code;
