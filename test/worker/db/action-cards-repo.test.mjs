// test/worker/db/action-cards-repo.test.mjs
//
// Phase 13 Plan 13-01 Task 2 -- action-cards-repo behavior.
//
// Mirrors the tldr-cache contract verbatim (the repo it is copied from):
//   - upsertActionCard issues ONE execute INSERT into the plugin-namespace
//     action_cards table with ON CONFLICT (company_id, source_issue_id,
//     content_hash) DO NOTHING (EDITOR-03 company-scoped idempotency, D-02).
//   - The two text[] columns (source_revisions, tags) are bound through
//     $N::text[] casts using toPgTextArrayLiteral -- the v0.6.5 Bug 2 fix
//     reused VERBATIM from tldr-cache.ts (params arrive as `{...}` array
//     literals; the SQL string carries `::text[]` twice).
//   - getActionCardBySource issues a company-scoped SELECT
//     ORDER BY generated_at DESC LIMIT 1 and returns the first row, or null
//     when the fake db returns [].
//
// All SQL strings are captured (sql + params) so we can regex-assert the exact
// shape the live host receives. wrapHostFaithfulDb enforces the host's
// PluginDatabaseClient contract (query SELECT-only; execute DML-only into the
// plugin namespace, returns only { rowCount }) so a write-via-query or a
// DDL-via-execute throws exactly as the live host would.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  upsertActionCard,
  getActionCardBySource,
} from '../../../src/worker/db/action-cards-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeFakeDbCtx({ rows = [] } = {}) {
  const calls = [];
  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      return { rowCount: 1 };
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      return rows;
    },
  };
  return { db: wrapHostFaithfulDb(fake), _calls: calls };
}

function sampleRow(overrides = {}) {
  return {
    company_id: 'co-1',
    source_issue_id: 'leaf-uuid-1',
    named_action: 'Approve the Q3 budget so Finance can proceed.',
    awaited_party: 'Founder',
    est_bucket: 'quick',
    action_kind: 'decide',
    decision_options: ['Approve', 'Reject'],
    content_hash: 'hash-abc',
    generated_at: '2026-06-02T12:00:00.000Z',
    compiled_by_agent_id: 'editor-agent-1',
    source_revisions: ['rev-1', 'rev-2'],
    tags: ['needs-you'],
    ...overrides,
  };
}

// ---- R1 -- upsertActionCard INSERTs into the namespaced action_cards table --
test('R1: upsertActionCard issues one execute INSERT into plugin_clarity_pack_cdd6bda4bd.action_cards', async () => {
  const ctx = makeFakeDbCtx();
  await upsertActionCard(ctx, sampleRow());
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1, 'exactly one execute call');
  assert.match(
    writes[0].sql,
    /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.action_cards/i,
    'INSERTs into the plugin-namespace action_cards table',
  );
});

// ---- R2 -- ON CONFLICT (company-scoped key) DO NOTHING ----------------------
test('R2: upsertActionCard SQL contains ON CONFLICT (company_id, source_issue_id, content_hash) DO NOTHING', async () => {
  const ctx = makeFakeDbCtx();
  await upsertActionCard(ctx, sampleRow());
  const w = ctx._calls.find((c) => c.kind === 'execute');
  assert.match(
    w.sql,
    /ON\s+CONFLICT\s*\(\s*company_id\s*,\s*source_issue_id\s*,\s*content_hash\s*\)\s*DO\s+NOTHING/i,
    'company-scoped EDITOR-03 idempotency clause present',
  );
});

// ---- R3 -- both text[] columns bound via $N::text[] casts -------------------
test('R3: upsertActionCard binds source_revisions + tags through $N::text[] casts (two ::text[])', async () => {
  const ctx = makeFakeDbCtx();
  await upsertActionCard(ctx, sampleRow());
  const w = ctx._calls.find((c) => c.kind === 'execute');
  const castCount = (w.sql.match(/::text\[\]/g) ?? []).length;
  assert.equal(castCount, 2, 'exactly two ::text[] casts (source_revisions + tags)');
  // The text[] params arrive as Postgres array-literal strings `{...}`.
  const arrayLiterals = w.params.filter(
    (p) => typeof p === 'string' && /^\{.*\}$/.test(p),
  );
  assert.ok(
    arrayLiterals.includes('{"rev-1","rev-2"}'),
    'source_revisions bound as a {..} array literal',
  );
  assert.ok(
    arrayLiterals.includes('{"needs-you"}'),
    'tags bound as a {..} array literal',
  );
});

// ---- R4 -- decision_options bound as JSON (jsonb column) --------------------
test('R4: upsertActionCard binds decision_options for the jsonb column and includes the core scalar params', async () => {
  const ctx = makeFakeDbCtx();
  await upsertActionCard(ctx, sampleRow());
  const w = ctx._calls.find((c) => c.kind === 'execute');
  // The display + key scalar fields must all be present in the params.
  assert.ok(w.params.includes('co-1'), 'company_id bound');
  assert.ok(w.params.includes('leaf-uuid-1'), 'source_issue_id bound');
  assert.ok(w.params.includes('hash-abc'), 'content_hash bound');
  assert.ok(
    w.params.includes('Approve the Q3 budget so Finance can proceed.'),
    'named_action bound',
  );
  assert.ok(w.params.includes('Founder'), 'awaited_party bound');
  assert.ok(w.params.includes('quick'), 'est_bucket bound');
  assert.ok(w.params.includes('decide'), 'action_kind bound');
  assert.ok(w.params.includes('editor-agent-1'), 'compiled_by_agent_id bound');
});

// ---- R5 -- decision_options NULL passes through (conservative default) ------
test('R5: upsertActionCard tolerates decision_options = null (D-08 conservative default)', async () => {
  const ctx = makeFakeDbCtx();
  await upsertActionCard(ctx, sampleRow({ decision_options: null }));
  const w = ctx._calls.find((c) => c.kind === 'execute');
  assert.ok(w.params.includes(null), 'null decision_options bound without throwing');
});

// ---- R6 -- getActionCardBySource: company-scoped most-recent read -----------
test('R6: getActionCardBySource SELECTs ORDER BY generated_at DESC LIMIT 1 scoped by company + source', async () => {
  const stored = sampleRow();
  const ctx = makeFakeDbCtx({ rows: [stored] });
  const result = await getActionCardBySource(ctx, 'co-1', 'leaf-uuid-1');
  const q = ctx._calls.find((c) => c.kind === 'query');
  assert.ok(q, 'one query call');
  assert.match(
    q.sql,
    /FROM\s+plugin_clarity_pack_cdd6bda4bd\.action_cards/i,
    'reads the plugin-namespace action_cards table',
  );
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+source_issue_id\s*=\s*\$2/i,
    'company + source scoped WHERE',
  );
  assert.match(q.sql, /ORDER\s+BY\s+generated_at\s+DESC/i, 'most-recent ordering');
  assert.match(q.sql, /LIMIT\s+1/i, 'single-row read');
  assert.deepEqual(q.params, ['co-1', 'leaf-uuid-1'], 'binds [companyId, sourceIssueId]');
  assert.deepEqual(result, stored, 'returns the first row');
});

// ---- R7 -- getActionCardBySource returns null on empty result --------------
test('R7: getActionCardBySource returns null when no row exists', async () => {
  const ctx = makeFakeDbCtx({ rows: [] });
  const result = await getActionCardBySource(ctx, 'co-1', 'missing-leaf');
  assert.equal(result, null, 'null when the fake db returns []');
});
