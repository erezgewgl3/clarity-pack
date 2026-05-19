// test/ci/coexistence-chat-disable.test.mjs
//
// Plan 04-06 Task 1 RED -> GREEN -- COEXIST-08 / CHAT-11: plugin disable
// preserves every chat message as an ordinary threaded comment in classic
// Paperclip, and the plugin-namespace chat tables survive the disable.
//
// Chat message CONTENT lives only in public.issue_comments (CHAT-02 / D-02);
// the plugin-namespace chat_topics / chat_messages / chat_employee_parents
// tables hold IDs + metadata only and must NOT be dropped on disable
// (additive-only / COEXIST-03). This test runs 08-chat-disable.mjs against the
// clean tree and against destructive fixtures, and pins the checklist + run-all
// wiring so a regression fails the CI build.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CHECK_PATH = path.join(REPO_ROOT, 'scripts', 'coexistence-checks', '08-chat-disable.mjs');

test('Coexistence #8: script exists', () => {
  assert.ok(existsSync(CHECK_PATH), 'expected scripts/coexistence-checks/08-chat-disable.mjs');
});

test('Coexistence #8: script references issue_comments', () => {
  const src = readFileSync(CHECK_PATH, 'utf8');
  assert.match(src, /issue_comments/, 'the check must assert against public.issue_comments');
});

test('Coexistence #8: checklist includes 08-chat-disable.mjs', () => {
  const src = readFileSync(
    path.join(REPO_ROOT, 'test', 'ci', 'coexistence-checklist.test.mjs'),
    'utf8',
  );
  assert.match(src, /08-chat-disable\.mjs/);
});

test('Coexistence #8: run-all includes 08-chat-disable.mjs', () => {
  const src = readFileSync(
    path.join(REPO_ROOT, 'scripts', 'coexistence-checks', 'run-all.mjs'),
    'utf8',
  );
  assert.match(src, /08-chat-disable\.mjs/);
});

test('Coexistence #8: clean tree exits 0', () => {
  const r = spawnSync(process.execPath, [CHECK_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
});

test('Coexistence #8: rejects a migration that DROPs a chat table (additive-only)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-08-drop-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_drop_chat.sql'),
      'DROP TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics;\n',
    );
    writeFileSync(path.join(tmp, 'src', 'manifest.ts'), 'export default {};\n');
    const r = spawnSync(process.execPath, [CHECK_PATH], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, 'dropping a chat table should fail the check');
    assert.match(r.stderr + r.stdout, /chat|DROP TABLE/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #8: rejects a migration that DELETEs public.issue_comments (chat content)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-08-delete-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_delete_comments.sql'),
      'DELETE FROM public.issue_comments WHERE body IS NOT NULL;\n',
    );
    writeFileSync(path.join(tmp, 'src', 'manifest.ts'), 'export default {};\n');
    const r = spawnSync(process.execPath, [CHECK_PATH], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, 'deleting issue_comments rows should fail the check');
    assert.match(r.stderr + r.stdout, /issue_comments/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #8: rejects a migration that drops the plugin namespace', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-08-schema-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_drop_schema.sql'),
      'DROP SCHEMA plugin_clarity_pack_cdd6bda4bd CASCADE;\n',
    );
    writeFileSync(path.join(tmp, 'src', 'manifest.ts'), 'export default {};\n');
    const r = spawnSync(process.execPath, [CHECK_PATH], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, 'dropping the plugin namespace should fail the check');
    assert.match(r.stderr + r.stdout, /namespace|SCHEMA/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
