// scripts/safety/test/cli.test.mjs
//
// Covers R10 — CLI dispatcher.
//   - --help lists all 7 subcommands.
//   - unknownCmd exits 1 with "unknown subcommand".
//   - smoke / verify / gate stubs exit 2 with the deferred-plan message.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(HERE, '..', 'cli.mjs');

function runCli(args) {
  return new Promise((resolve, reject) => {
    // Use node directly — the CLI file has a shebang for POSIX and a
    // bin entry for pnpm, but `node cli.mjs <args>` is the most portable
    // way to test on Windows + macOS + Linux uniformly.
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

test('R10.a — --help exits 0 and lists all 7 subcommands', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  for (const sub of ['snapshot', 'restore', 'smoke', 'verify', 'gate', 'list', 'prune']) {
    assert.match(stdout, new RegExp(`\\b${sub}\\b`), `--help should mention ${sub}`);
  }
});

test('R10.b — no args also prints help and exits 0', async () => {
  const { code, stdout } = await runCli([]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: clarity-safety/);
});

test('R10.c — unknown subcommand exits 1 with "unknown subcommand"', async () => {
  const { code, stderr } = await runCli(['unknownsub']);
  assert.equal(code, 1);
  assert.match(stderr, /unknown subcommand: unknownsub/);
});

test('R10.d — smoke (Plan 02 implementation) without --api-url exits 1 with required-flag error', async () => {
  // Plan 01 stub returned exit 2 with "lands in plan 02"; Plan 02 replaces
  // the stub with the real implementation, so calling smoke without the
  // required --api-url flag now exits 1 with a usage error.
  const { code, stderr } = await runCli(['smoke']);
  assert.equal(code, 1);
  assert.match(stderr, /--api-url|PAPERCLIP_API_URL/);
});

test('R10.d.help — smoke --help prints usage and exits 0', async () => {
  const { code, stdout } = await runCli(['smoke', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: clarity-safety smoke/);
});

test('R10.e — verify stub exits 2 with plan-02 deferred message', async () => {
  const { code, stderr } = await runCli(['verify']);
  assert.equal(code, 2);
  assert.match(stderr, /verify subcommand lands in plan 02/);
});

test('R10.f — gate stub exits 2 with plan-03 deferred message', async () => {
  const { code, stderr } = await runCli(['gate']);
  assert.equal(code, 2);
  assert.match(stderr, /gate subcommand lands in plan 03/);
});

test('R10.g — restore with bad snapshot id exits 1 with "invalid snapshotId"', async () => {
  const { code, stderr } = await runCli(['restore', '../etc/passwd']);
  assert.equal(code, 1);
  assert.match(stderr, /invalid snapshotId/);
});

test('R10.h — cli.mjs has the executable shebang', async () => {
  const { readFile } = await import('node:fs/promises');
  const head = (await readFile(CLI_PATH, 'utf8')).split('\n', 1)[0];
  assert.equal(head, '#!/usr/bin/env node');
});
