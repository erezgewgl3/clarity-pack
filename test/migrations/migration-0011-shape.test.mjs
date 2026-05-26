// test/migrations/migration-0011-shape.test.mjs
//
// Plan 05-11 Task 1 -- migration-specific shape gate. The verbatim host-validator
// port (test/migrations/ddl-prefix-validator.test.mjs) covers the generic
// classifier + qualified-refs gate for every migrations/*.sql automatically.
// This dedicated test pins the readable shape contract for migration 0011:
//
//   - contains the literal "chat_message_attachments"
//   - ZERO standalone CREATE INDEX statements
//   - ZERO procedural DO blocks
//   - ZERO apostrophes inside -- comment lines
//   - fully-qualified plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
//   - ends on a semicolon-terminated statement
//   - FK clause does NOT carry DEFERRABLE INITIALLY DEFERRED (Option B
//     upload-on-send semantics make the standard FK sufficient)
//
// The Option B locked-decisions log lives in 05-11-PLAN.md. The no-DEFERRABLE
// assertion here is the regression guard that prevents an accidental
// re-introduction of the earlier Option A (eager upload + DEFERRABLE FK).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'migrations',
  '0011_chat_message_attachments.sql',
);

test('S1: migration 0011 file exists and is readable', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.ok(sql.length > 0, 'migration file is non-empty');
});

test('S2: migration 0011 contains the literal chat_message_attachments', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /chat_message_attachments/, 'table name literal present');
});

test('S3: migration 0011 contains a CREATE TABLE IF NOT EXISTS clause for the new table', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i,
    'fully-qualified CREATE TABLE IF NOT EXISTS',
  );
});

/**
 * Strip every -- line-comment AND every block /* ... *\/ comment from a SQL
 * file before scanning for forbidden keywords. The migration body may
 * legitimately MENTION forbidden tokens (CREATE INDEX, DEFERRABLE) in its
 * explanatory comment block ("we do NOT use a standalone CREATE INDEX
 * because ..."), so scanning the raw text would produce false positives.
 * We only care about the DDL outside comments.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('S4: migration 0011 has ZERO standalone CREATE INDEX statements (excluding comments)', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION_PATH, 'utf8'));
  // The host validator's extractQualifiedRefs has NO pattern for CREATE INDEX,
  // so standalone indexes are rejected at install time. Comments legitimately
  // discuss why we do NOT ship one; the scan ignores them.
  assert.equal(
    (sql.match(/\bCREATE\s+INDEX\b/gi) ?? []).length,
    0,
    'no standalone CREATE INDEX statements outside comments',
  );
});

test('S5: migration 0011 has ZERO procedural DO blocks', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  // The host validator rejects anonymous procedural blocks (DO ... $$).
  // Match `DO` at start-of-line or after whitespace, followed by a $-quote.
  assert.equal(
    (sql.match(/\bDO\s+\$/g) ?? []).length,
    0,
    'no anonymous procedural DO blocks',
  );
});

test('S6: migration 0011 has ZERO apostrophes inside -- comment lines', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  // The host's greedy string-literal stripper runs BEFORE comment stripping,
  // so an apostrophe inside a comment line pairs with the opening quote of
  // the next real string literal and swallows the CREATE keyword (Plan 03-03
  // Countermoves drill, 2026-05-15). The COMMENT ON ... IS 'string'; line
  // is NOT a -- comment line; we only scan -- lines.
  const lines = sql.split(/\r?\n/);
  const offenders = [];
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('--') && trimmed.includes("'")) {
      offenders.push({ line: i + 1, text: trimmed.slice(0, 80) });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `apostrophe found inside -- comment lines: ${JSON.stringify(offenders)}`,
  );
});

test('S7: migration 0011 ends on a semicolon-terminated statement', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  // The host splitSqlStatements treats any non-empty text after the final
  // semicolon as a statement; a comment-only trailing block normalizes to
  // empty and is rejected. Strip trailing whitespace and assert the last
  // non-whitespace character is `;`.
  const trimmed = sql.replace(/\s+$/, '');
  assert.equal(
    trimmed.slice(-1),
    ';',
    'file ends on a semicolon-terminated statement',
  );
});

test('S8: migration 0011 FK is STANDARD (NOT DEFERRABLE) -- Option B upload-on-send invariant', () => {
  // Strip comments before scanning -- the migration legitimately discusses
  // why we do NOT use DEFERRABLE in its explanatory header. The DDL outside
  // comments must carry no DEFERRABLE / INITIALLY DEFERRED token.
  const sql = stripSqlComments(readFileSync(MIGRATION_PATH, 'utf8'));
  // The Option B (upload-on-send) decision means the chat_messages row is
  // always committed before any chat_message_attachments insert. The FK at
  // insert time always references a real, already-committed row -- no
  // DEFERRABLE clause is needed. This is the regression guard against an
  // accidental re-introduction of the earlier Option A (eager-upload +
  // DEFERRABLE FK).
  assert.equal(
    (sql.match(/\bDEFERRABLE\b/gi) ?? []).length,
    0,
    'NO DEFERRABLE tokens in DDL (Option B upload-on-send semantics)',
  );
  assert.equal(
    (sql.match(/\bINITIALLY\s+DEFERRED\b/gi) ?? []).length,
    0,
    'NO INITIALLY DEFERRED tokens in DDL (Option B upload-on-send semantics)',
  );
});

test('S9: migration 0011 has a FK clause referencing chat_messages.message_uuid', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(
    sql,
    /REFERENCES\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages\s*\(\s*message_uuid\s*\)/i,
    'FK references chat_messages(message_uuid)',
  );
});

test('S10: migration 0011 carries ON DELETE CASCADE on the FK', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /ON\s+DELETE\s+CASCADE/i, 'ON DELETE CASCADE present');
});
