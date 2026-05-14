// test/worker/handlers-wrapped.test.mjs
//
// Plan 02-04 Task 1 RED — every non-exempt handler from 02-02/02-03 registers
// via wrapDataHandler / wrapActionHandler instead of directly calling
// ctx.data.register / ctx.actions.register. SOURCE-GREP test (deterministic
// structural assertion).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDLERS_DIR = path.resolve(HERE, '..', '..', 'src', 'worker', 'handlers');

function readHandler(file) {
  return readFileSync(path.join(HANDLERS_DIR, file), 'utf8');
}

const WRAPPED_DATA_HANDLERS = [
  // file → expected handler-key declared inside (informational)
  { file: 'issue-reader.ts', key: 'issue.reader' },
  { file: 'resolve-refs.ts', key: 'resolve-refs' },
  { file: 'flatten-blocker-chain.ts', key: 'flatten-blocker-chain' },
  { file: 'editor-pause-status.ts', key: 'editor.pause-status' },
];

const WRAPPED_ACTION_HANDLERS = [
  { file: 'ac-checklist.ts', key: 'ac-toggle' },
];

for (const { file, key } of WRAPPED_DATA_HANDLERS) {
  test(`Wrap: ${file} registers '${key}' via wrapDataHandler (OPTIN-04 server-side gate)`, () => {
    const src = readHandler(file);
    assert.match(
      src,
      /wrapDataHandler\s*\(/,
      `${file} should call wrapDataHandler(ctx, '${key}', fn) instead of ctx.data.register directly`,
    );
    // It should NOT call ctx.data.register directly any more — only the wrap.
    assert.doesNotMatch(
      src,
      /\bctx\.data\.register\s*\(/,
      `${file} should not call ctx.data.register directly; route through wrapDataHandler`,
    );
  });
}

for (const { file, key } of WRAPPED_ACTION_HANDLERS) {
  test(`Wrap: ${file} registers '${key}' via wrapActionHandler (OPTIN-04 server-side gate)`, () => {
    const src = readHandler(file);
    assert.match(
      src,
      /wrapActionHandler\s*\(/,
      `${file} should call wrapActionHandler(ctx, '${key}', fn) instead of ctx.actions.register directly`,
    );
    assert.doesNotMatch(
      src,
      /\bctx\.actions\.register\s*\(/,
      `${file} should not call ctx.actions.register directly; route through wrapActionHandler`,
    );
  });
}

// Exempt handlers MAY still call ctx.data.register / ctx.actions.register
// directly (the wrapper short-circuits to the same call for exempt keys, but
// these files can use either form). We just verify their file structure.
const EXEMPT_DATA_FILES = ['get-opt-in.ts', 'get-instance-config.ts'];
const EXEMPT_ACTION_FILES = ['set-opt-in.ts'];

for (const file of EXEMPT_DATA_FILES) {
  test(`Exempt: ${file} exists`, () => {
    assert.doesNotThrow(() => readHandler(file));
  });
}

for (const file of EXEMPT_ACTION_FILES) {
  test(`Exempt: ${file} exists`, () => {
    assert.doesNotThrow(() => readHandler(file));
  });
}

// ---------------------------------------------------------------------------
// Migration 0003 — DDL grep tests
// ---------------------------------------------------------------------------

const MIGRATION_PATH = path.resolve(HERE, '..', '..', 'migrations', '0003_situation_and_optin.sql');

test('Migration 0003: file exists at migrations/0003_situation_and_optin.sql', () => {
  assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf8'));
});

test('Migration 0003: creates situation_snapshots in fully qualified namespace (Finding #4)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd\.situation_snapshots/,
  );
});

test('Migration 0003: creates active_viewers in fully qualified namespace (Finding #4)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd\.active_viewers/,
  );
});

test('Migration 0003: zero unqualified DDL — no bare CREATE TABLE without the namespace prefix', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  // Match CREATE TABLE that does NOT have the plugin namespace prefix in the same statement.
  const unqualified = sql.match(/CREATE TABLE(?: IF NOT EXISTS)? (?!plugin_clarity_pack_cdd6bda4bd\.)/g);
  assert.equal(unqualified, null, 'all CREATE TABLE statements must use the fully qualified namespace');
});

test('Migration 0003: no DDL targets public.* tables (COEXIST-02)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.doesNotMatch(sql, /\bpublic\.\w+/, 'no public.* references allowed');
});

test('Migration 0003: contains no DROP TABLE statements (COEXIST-03 additive-only)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
});
