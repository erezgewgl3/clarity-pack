// test/migrations/ddl-prefix-validator.test.mjs
//
// Paperclip's plugin SQL validator (server/src/services/plugin-database.ts)
// classifies every migration statement and rejects any that does not begin
// with create / alter / comment:
//
//     API error 400: Plugin migrations may contain DDL statements only
//
// Discovered during the Plan 03-03 Countermoves drill, 2026-05-15.
// 0004_bulletin.sql contained an apostrophe inside a `--` comment
// (`Paperclip's`). The host's `stripSqlForKeywordScan` strips SQL string
// literals with a GREEDY regex /'([^']|'')*'/g BEFORE stripping comments,
// so that lone apostrophe paired with the opening quote of the first real
// string literal (`'pending'` in a CHECK constraint) and swallowed the
// leading CREATE keyword -- the validator then saw a non-DDL statement and
// rejected the install.
//
// This test ports the host's tokenizer + classifier VERBATIM and runs it on
// every migrations/*.sql, so any future migration that trips the same
// greedy-strip hazard fails `pnpm test` BEFORE an install attempt.
//
// It also ports `extractQualifiedRefs` and the "must use fully qualified
// schema names" gate. That gate has a second teeth: the host's ref patterns
// cover only the create/alter/drop-table + from/join/references/into/update
// keyword families -- there is NO pattern for `CREATE INDEX ... ON
// schema.table`, so a standalone CREATE INDEX is rejected at install with
// `Plugin migration objects must use fully qualified schema names`.
// Surfaced by the Plan 03-03 Countermoves drill, 2026-05-15 (0004 originally
// shipped 4 CREATE INDEX statements; they were removed -- PK/UNIQUE
// constraints inside CREATE TABLE cover the access paths that matter).
//
// If the host validator is ever fixed upstream, this test stays correct --
// it only asserts what the host asserts today.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

// --- Verbatim ports from server/src/services/plugin-database.ts -----------

// splitSqlStatements: quote- and comment-aware `;` splitter.
function splitSqlStatements(input) {
  const statements = [];
  let start = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ';') {
      const statement = input.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const trailing = input.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

// stripSqlForKeywordScan: the GREEDY string-literal stripper that caused the
// 2026-05-15 install failure. Ported exactly so the test reproduces the bug.
function stripSqlForKeywordScan(input) {
  return input
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function normaliseSql(input) {
  return stripSqlForKeywordScan(input).replace(/\s+/g, ' ').trim().toLowerCase();
}

// extractQualifiedRefs: finds `schema.table` refs the host recognizes.
// Verbatim port -- note the absence of any `create index` / `on` pattern.
function extractQualifiedRefs(statement) {
  const refs = [];
  const patterns = [
    /\b(from|join|references|into|update)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\."?([A-Za-z_][A-Za-z0-9_]*)"?/gi,
    /\b(alter\s+table|create\s+table|create\s+view|drop\s+table|truncate\s+table)\s+(?:if\s+(?:not\s+)?exists\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?\."?([A-Za-z_][A-Za-z0-9_]*)"?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of statement.matchAll(pattern)) {
      refs.push({ keyword: match[1].toLowerCase(), schema: match[2], table: match[3] });
    }
  }
  return refs;
}

// The host's DDL gate: validatePluginMigrationStatement line ~185.
const DDL_PREFIX = /^(create|alter|comment)\b/;

// --------------------------------------------------------------------------

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const f of files) {
  test(`Migration ${f} — every statement classifies as DDL under the host validator`, () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const statements = splitSqlStatements(sql);
    assert.ok(statements.length > 0, `migration ${f} produced no statements`);

    for (const statement of statements) {
      const normalized = normaliseSql(statement);
      assert.ok(
        DDL_PREFIX.test(normalized),
        `migration ${f} has a statement the host rejects with ` +
          `"Plugin migrations may contain DDL statements only".\n` +
          `After the host's greedy string-strip the statement normalizes to:\n` +
          `  ${normalized.slice(0, 160)}\n` +
          `Most common cause: an apostrophe inside a -- comment. ` +
          `Keep migration comments apostrophe-free.`,
      );

      // Qualified-refs gate: every non-COMMENT statement must yield at least
      // one schema.table ref the host can see. A standalone CREATE INDEX
      // yields none and is rejected with
      // "Plugin migration objects must use fully qualified schema names".
      if (!normalized.startsWith('comment ')) {
        assert.ok(
          extractQualifiedRefs(statement).length > 0,
          `migration ${f} has a statement the host rejects with ` +
            `"Plugin migration objects must use fully qualified schema names".\n` +
            `Statement normalizes to:\n  ${normalized.slice(0, 160)}\n` +
            `The host's extractQualifiedRefs only recognizes refs for ` +
            `create/alter/drop-table + from/join/references/into/update. ` +
            `CREATE INDEX is not supported in plugin migrations -- rely on ` +
            `PRIMARY KEY / UNIQUE constraints inside CREATE TABLE instead.`,
        );
      }
    }
  });
}
