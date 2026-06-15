// test/migrations/0019-validator.test.mjs
//
// Phase 19 Plan 19-01 Task 1 (D-11) — a focused regression that runs the host's
// plugin SQL validator (ported verbatim from
// server/src/services/plugin-database.ts, same as ddl-prefix-validator.test.mjs)
// against migrations/0019_action_cards_flag.sql and asserts it is install-legal:
//
//   - every statement classifies as DDL (create / alter / comment) AFTER the
//     host's greedy string-literal strip (apostrophe-free comment guard);
//   - every non-COMMENT statement yields a fully-qualified schema.table ref the
//     host recognizes (no standalone CREATE INDEX);
//   - the migration targets ONLY the plugin namespace
//     plugin_clarity_pack_cdd6bda4bd (zero public.* DDL — coexistence #3);
//   - the D-01 divergence holds: NO plugin_version column / filter is present
//     (the ON state must survive a two-source version bump).
//
// The broad ddl-prefix-validator.test.mjs already sweeps every migration; this
// file pins 0019 specifically so the D-01 not-version-scoped property and the
// namespace-only property are asserted by name.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATION = path.join(REPO_ROOT, 'migrations', '0019_action_cards_flag.sql');
const NAMESPACE = 'plugin_clarity_pack_cdd6bda4bd';

// --- Verbatim ports from server/src/services/plugin-database.ts -----------

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

const DDL_PREFIX = /^(create|alter|comment)\b/;

// --------------------------------------------------------------------------

const sql = readFileSync(MIGRATION, 'utf8');
const statements = splitSqlStatements(sql);

test('0019 — produces statements and creates exactly the namespaced flag table', () => {
  assert.ok(statements.length > 0, '0019 produced no statements');
  assert.ok(
    /CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd\.action_cards_flag/.test(sql),
    'creates plugin_clarity_pack_cdd6bda4bd.action_cards_flag with IF NOT EXISTS',
  );
});

test('0019 — every statement classifies as DDL under the host validator', () => {
  for (const statement of statements) {
    const normalized = normaliseSql(statement);
    assert.ok(
      DDL_PREFIX.test(normalized),
      `0019 has a non-DDL statement after the host greedy string-strip:\n  ${normalized.slice(0, 160)}\n` +
        'Most common cause: an apostrophe inside a -- comment.',
    );
  }
});

test('0019 — every non-COMMENT statement uses a fully qualified namespace ref', () => {
  for (const statement of statements) {
    const normalized = normaliseSql(statement);
    if (normalized.startsWith('comment ')) continue;
    const refs = extractQualifiedRefs(statement);
    assert.ok(
      refs.length > 0,
      `0019 has a statement with no host-recognized schema.table ref:\n  ${normalized.slice(0, 160)}`,
    );
    for (const ref of refs) {
      assert.equal(ref.schema, NAMESPACE, `every ref must target ${NAMESPACE} (zero public.* DDL)`);
    }
  }
});

test('0019 — D-01 divergence: NO plugin_version column or filter (ON survives a version bump)', () => {
  // Scan the SQL with comments stripped — the explanatory header legitimately
  // names the divergence; what must be absent is an actual plugin_version
  // column / DDL token (the not-version-scoped property the host would persist).
  const codeOnly = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/plugin_version/i.test(codeOnly),
    '0019 must NOT introduce a plugin_version column (not version-scoped)',
  );
});
