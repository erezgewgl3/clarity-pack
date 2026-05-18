// test/migrations/0006-chat-schema.test.mjs
//
// Plan 04-02 Task A RED — DDL contract for the Phase 4 chat migration.
// Mirrors test/migrations/0004-bulletin-schema.test.mjs. The Paperclip host
// plugin-SQL validator (Plan 02-01 Finding #4 + Plan 02-04 procedural-block
// finding) requires:
//   - every CREATE TABLE fully-qualified with the deterministic plugin
//     namespace `plugin_clarity_pack_cdd6bda4bd` (no template substitution)
//   - no anonymous procedural blocks (`DO $$ ... $$`)
//   - no standalone CREATE INDEX (host extractQualifiedRefs has no pattern)
//   - apostrophe-free comments (greedy string-literal strip hazard)
//   - the file ends on a `;`-terminated statement (no trailing comment block)
//   - additive-only: no DROP TABLE, no ALTER TABLE ... DROP COLUMN
//
// CHAT-02 invariant: chat_messages has NO `body` column — the side table maps
// IDs only, message content lives only in public.issue_comments.
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
const MIGRATION = path.join(REPO_ROOT, 'migrations', '0006_chat.sql');
const NS = 'plugin_clarity_pack_cdd6bda4bd';

// Strip `--` line comments and `/* */` block comments before scanning, so
// prose in the migration header (which legitimately discusses DDL patterns
// and the validator's `DO $$` rejection) does not produce false positives.
function stripSqlComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const rawSql = existsSync(MIGRATION) ? readFileSync(MIGRATION, 'utf8') : '';
const sql = rawSql;
const code = stripSqlComments(rawSql);

// Extract the body of a `CREATE TABLE IF NOT EXISTS NS.<table> ( ... )` block
// from the comment-stripped SQL — for column-set assertions.
function tableBody(tableName) {
  const re = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${NS}\\.${tableName}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    'i',
  );
  const m = code.match(re);
  return m ? m[1] : null;
}

test('0006_chat.sql exists', () => {
  assert.ok(existsSync(MIGRATION), 'migrations/0006_chat.sql must exist');
});

test('0006 creates the chat_topics table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.chat_topics`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_topics"',
  );
});

test('0006 creates the chat_messages table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.chat_messages`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_messages"',
  );
});

test('0006 creates the chat_employee_parents table fully-qualified', () => {
  assert.ok(
    sql.includes(`CREATE TABLE IF NOT EXISTS ${NS}.chat_employee_parents`),
    'must contain "CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_employee_parents"',
  );
});

test('0006 chat_topics declares UNIQUE (company_id, issue_id) (CHT-NN -> one issue)', () => {
  assert.match(
    sql,
    /UNIQUE\s*\(\s*company_id\s*,\s*issue_id\s*\)/i,
    'chat_topics must carry UNIQUE (company_id, issue_id)',
  );
});

test('0006 chat_messages keys idempotency on message_uuid PRIMARY KEY', () => {
  const body = tableBody('chat_messages');
  assert.ok(body, 'chat_messages CREATE TABLE block must be found');
  assert.match(
    body,
    /message_uuid\s+text\s+PRIMARY\s+KEY/i,
    'message_uuid must be the PRIMARY KEY (CHAT-06 idempotency key)',
  );
});

test('0006 chat_messages carries the dedup/supersedes/pin columns', () => {
  const body = tableBody('chat_messages');
  assert.ok(body, 'chat_messages CREATE TABLE block must be found');
  for (const col of [
    'company_id',
    'topic_issue_id',
    'comment_id',
    'sender_kind',
    'supersedes_uuid',
    'pinned',
    'sent_at',
  ]) {
    assert.match(
      body,
      new RegExp(`\\b${col}\\b`, 'i'),
      `chat_messages must declare a ${col} column`,
    );
  }
});

test('0006 chat_messages constrains sender_kind to user|agent', () => {
  const body = tableBody('chat_messages');
  assert.ok(body, 'chat_messages CREATE TABLE block must be found');
  assert.match(
    body,
    /sender_kind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*sender_kind\s+IN\s*\(\s*'user'\s*,\s*'agent'\s*\)\s*\)/i,
    'sender_kind must be CHECK (sender_kind IN (user, agent))',
  );
});

test('0006 chat_messages has NO body column (CHAT-02 invariant)', () => {
  const body = tableBody('chat_messages');
  assert.ok(body, 'chat_messages CREATE TABLE block must be found');
  // A standalone `body` column declaration — `body  text ...`. message_uuid /
  // any other column with `body` as a substring would not match `\bbody\s`.
  assert.equal(
    /(^|,)\s*body\s+/i.test(body),
    false,
    'chat_messages must NOT declare a body column — message content lives only in public.issue_comments (CHAT-02)',
  );
});

test('0006 chat_employee_parents declares the per-employee parent-issue map columns', () => {
  const body = tableBody('chat_employee_parents');
  assert.ok(body, 'chat_employee_parents CREATE TABLE block must be found');
  for (const col of ['company_id', 'employee_agent_id', 'parent_issue_id']) {
    assert.match(
      body,
      new RegExp(`\\b${col}\\b`, 'i'),
      `chat_employee_parents must declare a ${col} column`,
    );
  }
});

test('0006 chat_employee_parents has a composite PK on (company_id, employee_agent_id)', () => {
  const body = tableBody('chat_employee_parents');
  assert.ok(body, 'chat_employee_parents CREATE TABLE block must be found');
  assert.match(
    body,
    /PRIMARY\s+KEY\s*\(\s*company_id\s*,\s*employee_agent_id\s*\)/i,
    'each employee maps to exactly one parent issue per company (BLOCKER-3 race safety)',
  );
});

test('0006 — every CREATE TABLE is namespace-qualified (no bare CREATE TABLE)', () => {
  const bare = code.match(
    /CREATE TABLE IF NOT EXISTS (?!plugin_clarity_pack_cdd6bda4bd\.)/i,
  );
  assert.equal(bare, null, `found an unqualified CREATE TABLE: ${bare?.[0] ?? ''}`);
});

test('0006 contains zero standalone CREATE INDEX statements', () => {
  assert.equal(
    /create\s+index/i.test(code),
    false,
    'no standalone CREATE INDEX — access paths come from inline PK / UNIQUE only',
  );
});

test('0006 contains zero procedural blocks (host validator rejects DO $$)', () => {
  assert.equal(/\bdo\s+\$\$/i.test(code), false, 'no anonymous procedural blocks allowed');
});

test('0006 contains zero DROP TABLE statements (additive-only invariant)', () => {
  assert.equal(/drop\s+table/i.test(code), false, 'migration must be additive-only');
});

test('0006 contains zero ALTER TABLE ... DROP COLUMN statements (additive-only invariant)', () => {
  assert.equal(
    /alter\s+table[\s\S]*?drop\s+column/i.test(code),
    false,
    'migration must not drop columns',
  );
});

test('0006 has no apostrophe inside any -- line comment (greedy-strip hazard)', () => {
  const lines = rawSql.split('\n');
  for (const line of lines) {
    const idx = line.indexOf('--');
    if (idx === -1) continue;
    const comment = line.slice(idx);
    assert.equal(
      comment.includes("'"),
      false,
      `migration comment contains an apostrophe (greedy string-strip hazard): ${comment.trim()}`,
    );
  }
});

test('0006 ends on a ;-terminated statement (no trailing comment block)', () => {
  assert.ok(rawSql.trim().endsWith(';'), 'the file must end on a ;-terminated statement');
});
