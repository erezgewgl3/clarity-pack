// test/worker/db/reply-resume-repo.test.mjs
//
// Phase 14 Plan 14-01 Task 1 -- reply-resume-repo behavior.
//
// Mirrors the chat-topics-repo / action-cards-repo contract:
//   - insertReplyResume issues ONE execute INSERT into the plugin-namespace
//     reply_resume_dedup table with ON CONFLICT (company_id, message_uuid)
//     DO NOTHING (client-messageUuid idempotency). A duplicate insert is a
//     server-side no-op.
//   - getReplyResumeByUuid issues a company-scoped SELECT ... LIMIT 1 and
//     returns { comment_id, durable } or null.
//   - No array columns, so NO ::text[] casts (unlike action-cards-repo).
//
// All SQL strings are captured (sql + params) so we can regex-assert the exact
// shape the live host receives. wrapHostFaithfulDb enforces the host's
// PluginDatabaseClient contract (query SELECT-only; execute DML-only into the
// plugin namespace, returns only { rowCount }) so a write-via-query or a
// DDL-via-execute throws exactly as the live host would.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  getReplyResumeByUuid,
  insertReplyResume,
} from '../../../src/worker/db/reply-resume-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// A stateful in-memory fake keyed by (company_id, message_uuid) so we can
// exercise the ON CONFLICT DO NOTHING no-op end-to-end (a second insert with
// the same key must NOT overwrite the original row).
function makeStatefulDbCtx() {
  const store = new Map(); // key -> row
  const calls = [];
  const key = (companyId, messageUuid) => `${companyId}::${messageUuid}`;
  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      // params = [company_id, message_uuid, leaf_issue_id, comment_id, durable]
      const [company_id, message_uuid, leaf_issue_id, comment_id, durable] = params;
      const k = key(company_id, message_uuid);
      if (store.has(k)) return { rowCount: 0 }; // ON CONFLICT DO NOTHING
      store.set(k, { company_id, message_uuid, leaf_issue_id, comment_id, durable });
      return { rowCount: 1 };
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      const [company_id, message_uuid] = params;
      const row = store.get(key(company_id, message_uuid));
      return row ? [{ comment_id: row.comment_id, durable: row.durable }] : [];
    },
  };
  return { db: wrapHostFaithfulDb(fake), _calls: calls, _store: store };
}

function sampleRow(overrides = {}) {
  return {
    company_id: 'co-1',
    message_uuid: 'msg-uuid-1',
    leaf_issue_id: 'BEAAA-43',
    comment_id: 'comment-1',
    durable: false,
    ...overrides,
  };
}

// ---- R1 -- insertReplyResume INSERTs into the namespaced dedup table --------
test('R1: insertReplyResume issues one execute INSERT into plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow());
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1, 'exactly one execute call');
  assert.match(
    writes[0].sql,
    /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.reply_resume_dedup/i,
    'INSERTs into the plugin-namespace reply_resume_dedup table',
  );
});

// ---- R2 -- ON CONFLICT (company_id, message_uuid) DO NOTHING ----------------
test('R2: insertReplyResume SQL contains ON CONFLICT (company_id, message_uuid) DO NOTHING', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow());
  const w = ctx._calls.find((c) => c.kind === 'execute');
  assert.match(
    w.sql,
    /ON\s+CONFLICT\s*\(\s*company_id\s*,\s*message_uuid\s*\)\s*DO\s+NOTHING/i,
    'company-scoped messageUuid idempotency clause present',
  );
});

// ---- R3 -- no ::text[] casts (no array columns) ----------------------------
test('R3: insertReplyResume binds the five scalar params with NO ::text[] cast', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow({ durable: true }));
  const w = ctx._calls.find((c) => c.kind === 'execute');
  assert.equal((w.sql.match(/::text\[\]/g) ?? []).length, 0, 'no array-column casts');
  assert.deepEqual(
    w.params,
    ['co-1', 'msg-uuid-1', 'BEAAA-43', 'comment-1', true],
    'binds [company_id, message_uuid, leaf_issue_id, comment_id, durable]',
  );
});

// ---- R4 -- getReplyResumeByUuid: company-scoped read -------------------------
test('R4: getReplyResumeByUuid SELECTs comment_id + durable scoped by company + message_uuid LIMIT 1', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow({ durable: true }));
  const result = await getReplyResumeByUuid(ctx, 'co-1', 'msg-uuid-1');
  const q = ctx._calls.find((c) => c.kind === 'query');
  assert.ok(q, 'one query call');
  assert.match(
    q.sql,
    /FROM\s+plugin_clarity_pack_cdd6bda4bd\.reply_resume_dedup/i,
    'reads the plugin-namespace dedup table',
  );
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+message_uuid\s*=\s*\$2/i,
    'company + message_uuid scoped WHERE',
  );
  assert.match(q.sql, /SELECT\s+comment_id\s*,\s*durable/i, 'selects comment_id + durable');
  assert.match(q.sql, /LIMIT\s+1/i, 'single-row read');
  assert.deepEqual(result, { comment_id: 'comment-1', durable: true }, 'returns the stored row');
});

// ---- R5 -- getReplyResumeByUuid returns null on empty result ---------------
test('R5: getReplyResumeByUuid returns null when no row exists', async () => {
  const ctx = makeStatefulDbCtx();
  const result = await getReplyResumeByUuid(ctx, 'co-1', 'never-stored');
  assert.equal(result, null, 'null when the fake db returns []');
});

// ---- R6 -- ON CONFLICT DO NOTHING is a true no-op (idempotent insert) -------
test('R6: a second insert with the same (company, message_uuid) is a no-op and preserves the original row', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow({ comment_id: 'comment-ORIGINAL', durable: false }));
  // Replay with a DIFFERENT comment_id / durable — must NOT overwrite.
  await insertReplyResume(ctx, sampleRow({ comment_id: 'comment-REPLAY', durable: true }));
  const result = await getReplyResumeByUuid(ctx, 'co-1', 'msg-uuid-1');
  assert.deepEqual(
    result,
    { comment_id: 'comment-ORIGINAL', durable: false },
    'the original row survives the duplicate insert',
  );
  assert.equal(ctx._store.size, 1, 'only one row stored');
});

// ---- R7 -- company-scoping isolates identical messageUuids across companies -
test('R7: the same message_uuid in two companies are distinct rows', async () => {
  const ctx = makeStatefulDbCtx();
  await insertReplyResume(ctx, sampleRow({ company_id: 'co-1', comment_id: 'c1' }));
  await insertReplyResume(ctx, sampleRow({ company_id: 'co-2', comment_id: 'c2' }));
  const r1 = await getReplyResumeByUuid(ctx, 'co-1', 'msg-uuid-1');
  const r2 = await getReplyResumeByUuid(ctx, 'co-2', 'msg-uuid-1');
  assert.equal(r1.comment_id, 'c1');
  assert.equal(r2.comment_id, 'c2');
});
