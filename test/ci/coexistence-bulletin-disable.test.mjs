// test/ci/coexistence-bulletin-disable.test.mjs
//
// Plan 03-04 Task 1 RED — COEXIST-07: plugin disable preserves Bulletin
// issues and bulletin metadata.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CHECK_PATH = path.join(REPO_ROOT, 'scripts', 'coexistence-checks', '07-bulletin-disable.mjs');

test('Coexistence #7: script exists', () => {
  assert.ok(existsSync(CHECK_PATH));
});

test('Coexistence #7: checklist includes 07-bulletin-disable.mjs', () => {
  const src = readFileSync(path.join(REPO_ROOT, 'test', 'ci', 'coexistence-checklist.test.mjs'), 'utf8');
  assert.match(src, /07-bulletin-disable\.mjs/);
});

test('Coexistence #7: run-all includes 07-bulletin-disable.mjs', () => {
  const src = readFileSync(path.join(REPO_ROOT, 'scripts', 'coexistence-checks', 'run-all.mjs'), 'utf8');
  assert.match(src, /07-bulletin-disable\.mjs/);
});

test('Coexistence #7: clean tree exits 0', () => {
  const r = spawnSync(process.execPath, [CHECK_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
});

test('Coexistence #7: rejects destructive bulletin migration in a fixture tree', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-07-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_drop_bulletins.sql'),
      'DROP TABLE plugin_clarity_pack_cdd6bda4bd.bulletins;\n',
    );
    writeFileSync(path.join(tmp, 'src', 'manifest.ts'), 'export default {};\n');
    const r = spawnSync(process.execPath, [CHECK_PATH], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, 'destructive bulletin migration should fail');
    assert.match(r.stderr + r.stdout, /bulletin|DROP TABLE/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

