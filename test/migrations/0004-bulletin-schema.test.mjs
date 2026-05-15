// test/migrations/0004-bulletin-schema.test.mjs
//
// Plan 03-01 Task 1 RED — DDL contract for the Phase 3 bulletin migration.
// The Paperclip host plugin-SQL validator (Plan 02-01 Finding #4 + Plan
// 02-04 procedural-block finding) requires:
//   - every CREATE TABLE fully-qualified with the deterministic plugin
//     namespace `plugin_clarity_pack_cdd6bda4bd` (no template substitution)
//   - no anonymous procedural blocks (`DO $$ ... $$`)
//   - additive-only: no DROP TABLE, no ALTER TABLE ... DROP COLUMN
//
// These asserts run on every `pnpm test` so a non-conforming migration fails
// CI BEFORE an install attempt rather than mid-install.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATION = path.join(REPO_ROOT, 'migrations', '0004_bulletin.sql');
const NS = 'plugin_clarity_pack_cdd6bda4bd';

// Strip `--` line comments and `/* */` block comments before scanning, so
// prose in the migration header (which legitimately discusses DDL patterns
// and the validator's `DO $$` rejection) does not produce false positives.
// Matches test/migrations/no-procedural-blocks.test.mjs.
function stripSqlComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const rawSql = existsSync(MIGRATION) ? readFileSync(MIGRATION, 'utf8') : '';
// Full text — used by string-presence asserts (CREATE TABLE etc. live in DDL,
// not comments, so the raw text is fine and keeps assert messages readable).
const sql = rawSql;
// Comment-stripped text — used by the "must NOT match" negative asserts.
const code = stripSqlComments(rawSql);

test('0004_bulletin.sql exists', () => {
  assert.ok(existsSync(MIGRATION), 'migrations/0004_bulletin.sql must exist');
});

test('0004 creates the bulletins table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.bulletins`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletins"',
  );
});

test('0004 creates the bulletin_errata table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.bulletin_errata`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_errata"',
  );
});

test('0004 creates the clarity_department_membership table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.clarity_department_membership`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_department_membership"',
  );
});

test('0004 creates the bulletin_compile_failures table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.bulletin_compile_failures`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures"',
  );
});

test('0004 declares UNIQUE (next_due_at, content_hash) on bulletins (D-13 idempotency key)', () => {
  assert.match(
    sql,
    /UNIQUE\s*\(\s*next_due_at\s*,\s*content_hash\s*\)/i,
    'bulletins must carry the D-13 idempotency UNIQUE constraint',
  );
});

test('0004 bulletins table carries a draft_json jsonb column (W3/W4 structured-data contract)', () => {
  assert.match(
    sql,
    /draft_json\s+jsonb\s+NOT\s+NULL/i,
    'bulletins must carry a draft_json jsonb NOT NULL column',
  );
});

test('0004 — every CREATE TABLE is namespace-qualified (no bare CREATE TABLE)', () => {
  const bare = code.match(/CREATE TABLE IF NOT EXISTS (?!plugin_clarity_pack_cdd6bda4bd\.)/i);
  assert.equal(bare, null, `found an unqualified CREATE TABLE: ${bare?.[0] ?? ''}`);
});

test('0004 contains zero DROP TABLE statements (additive-only invariant)', () => {
  assert.equal(/drop\s+table/i.test(code), false, 'migration must be additive-only');
});

test('0004 contains zero ALTER TABLE ... DROP COLUMN statements (additive-only invariant)', () => {
  assert.equal(
    /alter\s+table[\s\S]*?drop\s+column/i.test(code),
    false,
    'migration must not drop columns',
  );
});

test('0004 contains zero procedural blocks (Paperclip plugin-SQL validator rejects DO $$)', () => {
  assert.equal(/\bdo\s+\$\$/i.test(code), false, 'no anonymous procedural blocks allowed');
});
