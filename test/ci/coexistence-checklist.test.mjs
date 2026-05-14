// test/ci/coexistence-checklist.test.mjs
//
// Plan 02-04 Task 3 RED — coexistence CI assertion suite. Six scripts each
// implement one of the COEXIST-01..06 checks. This test file verifies:
//   1. Each script exists at scripts/coexistence-checks/0N_*.mjs
//   2. Each script exits 0 against the current clean tree
//   3. Each script exits non-zero when fed its corresponding "bad" fixture
//      (and the error message mentions the violation type)
//   4. scripts/coexistence-checks/run-all.mjs exists and chains them
//   5. .github/workflows/coexistence.yml exists and references run-all

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, mkdtempSync, copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CHECKS_DIR = path.join(REPO_ROOT, 'scripts', 'coexistence-checks');
const FIXTURES_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'coexistence');

const CHECK_FILES = [
  '01-original-ui-unchanged.mjs',
  '02-no-public-ddl.mjs',
  '03-disable-preserves-data.mjs',
  '04-editor-agent-no-special-privs.mjs',
  '05-chat-comment-coexistence-stub.mjs',
  '06-css-bleed-through.mjs',
];

// ---------------------------------------------------------------------------
// File existence
// ---------------------------------------------------------------------------

for (const f of CHECK_FILES) {
  test(`Coexistence: ${f} exists`, () => {
    assert.ok(existsSync(path.join(CHECKS_DIR, f)), `expected ${f}`);
  });
}

test('Coexistence: scripts/coexistence-checks/run-all.mjs exists', () => {
  assert.ok(existsSync(path.join(CHECKS_DIR, 'run-all.mjs')));
});

test('Coexistence: .github/workflows/coexistence.yml exists and runs run-all', () => {
  const yml = path.join(REPO_ROOT, '.github', 'workflows', 'coexistence.yml');
  assert.ok(existsSync(yml), 'workflow file exists');
  const src = readFileSync(yml, 'utf8');
  assert.match(src, /coexistence-checks\/run-all/);
});

// ---------------------------------------------------------------------------
// Clean-tree positive-case: each script + run-all exits 0
// ---------------------------------------------------------------------------

function runNode(script, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  return result;
}

for (const f of CHECK_FILES) {
  test(`Coexistence: ${f} exits 0 against clean tree`, () => {
    const r = runNode(path.join(CHECKS_DIR, f));
    assert.equal(
      r.status,
      0,
      `${f} should pass clean tree; stdout=${r.stdout}; stderr=${r.stderr}`,
    );
  });
}

test('Coexistence: run-all.mjs exits 0 against clean tree', () => {
  const r = runNode(path.join(CHECKS_DIR, 'run-all.mjs'));
  assert.equal(r.status, 0, `run-all failed: ${r.stdout}\n${r.stderr}`);
});

// ---------------------------------------------------------------------------
// Negative-case fixtures: each check fails when fed its bad fixture.
// Fixtures live at test/fixtures/coexistence/*. The check scripts accept a
// FIXTURE_DIR env var; when set they read from that directory instead of the
// repo's normal paths.
// ---------------------------------------------------------------------------

test('Coexistence #2: rejects bad-public-ddl.sql in migrations/', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-02-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    copyFileSync(
      path.join(FIXTURES_DIR, 'bad-public-ddl.sql'),
      path.join(tmp, 'migrations', '0001_bad.sql'),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '02-no-public-ddl.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject public.* DDL; stdout=${r.stdout}; stderr=${r.stderr}`);
    assert.match(r.stderr + r.stdout, /public\./, 'error message mentions public.*');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #6: rejects bad-unscoped-css.css in src/ui/', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-06-'));
  try {
    mkdirSync(path.join(tmp, 'src', 'ui'), { recursive: true });
    copyFileSync(
      path.join(FIXTURES_DIR, 'bad-unscoped-css.css'),
      path.join(tmp, 'src', 'ui', 'bad.css'),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '06-css-bleed-through.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject unscoped CSS; stdout=${r.stdout}; stderr=${r.stderr}`);
    assert.match(r.stderr + r.stdout, /unscoped|must start with/, 'error message mentions scope');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #3: rejects DROP TABLE in migrations/', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-03-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_drop.sql'),
      'DROP TABLE plugin_clarity_pack_cdd6bda4bd.foo;\n',
    );
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test' }) + '\n');
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '03-disable-preserves-data.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject DROP TABLE`);
    assert.match(r.stderr + r.stdout, /DROP/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #4: rejects manifest with admin/bypass capability on Editor-Agent', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-04-'));
  try {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'src', 'manifest.ts'),
      `const m = { agents: [{ agentKey: 'editor-agent', capabilities: ['admin.bypass-governance'] }] };\n`,
    );
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '04-editor-agent-no-special-privs.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject admin capability`);
    assert.match(r.stderr + r.stdout, /admin|bypass/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #5: rejects clarity-pack chat_messages CREATE TABLE in migrations/', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-05-'));
  try {
    mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'migrations', '0001_chat.sql'),
      'CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_messages (id bigserial PRIMARY KEY);\n',
    );
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '05-chat-comment-coexistence-stub.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject chat_messages table`);
    assert.match(r.stderr + r.stdout, /chat_messages/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Coexistence #1: rejects manifest with routePath pointing at a Paperclip core route', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clarity-coexist-01-'));
  try {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'src', 'manifest.ts'),
      `const m = { ui: { slots: [{ type: 'page', routePath: 'issue' }] } };\n`,
    );
    const r = spawnSync(
      process.execPath,
      [path.join(CHECKS_DIR, '01-original-ui-unchanged.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    assert.notEqual(r.status, 0, `should reject core-route hijack`);
    assert.match(r.stderr + r.stdout, /core route|COEXIST-01/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture files exist (the test file pins them)
// ---------------------------------------------------------------------------

test('Fixtures: test/fixtures/coexistence/bad-public-ddl.sql exists with ALTER TABLE public.issues', () => {
  const src = readFileSync(path.join(FIXTURES_DIR, 'bad-public-ddl.sql'), 'utf8');
  assert.match(src, /ALTER TABLE public\.issues/i);
});

test('Fixtures: test/fixtures/coexistence/bad-unscoped-css.css exists with global selector', () => {
  const src = readFileSync(path.join(FIXTURES_DIR, 'bad-unscoped-css.css'), 'utf8');
  assert.match(src, /^body\s*\{/m);
});
