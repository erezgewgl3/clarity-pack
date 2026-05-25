// test/worker/db/chat-topics-repo-pinned.test.mjs
//
// Plan 05-08 Task 1 — chat-topics-repo extensions for D-20 storage-pin +
// D-15/D-16 bulk-unarchive + archive full-view. Tests the four new helpers
// added by migration 0010_chat_topics_pinned.sql:
//
//   - setChatTopicPinned     — flip pinned_at between now() and NULL
//   - isChatTopicPinned      — read pinned state (SELECT 1)
//   - bulkSetChatTopicArchived — single-round-trip multi-row archive flip
//   - listAllArchivedChatTopics — company-scoped archived listing for the
//     /<companyPrefix>/archive full-view page
//
// All SQL strings are captured (sql + params) so we can regex-assert the
// shapes the live host receives. No docstring-derived fakes — wrapHostFaithfulDb
// enforces the host's PluginDatabaseClient contract (query SELECT-only;
// execute returns only { rowCount }) so a write-via-query throws exactly as
// the live host would.
//
// CTT-07 invariant note: none of these helpers issue any `public.issues.*`
// write. All UPDATEs target plugin_clarity_pack_cdd6bda4bd.chat_topics
// literally. Migration 0010 is additive-only per coexistence guarantee #3.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  setChatTopicPinned,
  isChatTopicPinned,
  bulkSetChatTopicArchived,
  listAllArchivedChatTopics,
} from '../../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeFakeDbCtx({ pinnedRows = new Map(), archivedRows = [] } = {}) {
  const calls = [];
  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      return { rowCount: 1 };
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      // isChatTopicPinned — SELECT pinned_at WHERE issue_id = $1 AND company_id = $2
      if (
        /SELECT\s+pinned_at\s+FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(
          sql,
        )
      ) {
        const [issueId, companyId] = params;
        const key = `${companyId}::${issueId}`;
        if (pinnedRows.has(key)) {
          return [{ pinned_at: pinnedRows.get(key) }];
        }
        return [];
      }
      // listAllArchivedChatTopics — SELECT cols WHERE company_id = $1 AND archived = true
      if (
        /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics[\s\S]*archived\s*=\s*true/i.test(
          sql,
        )
      ) {
        return archivedRows;
      }
      return [];
    },
  };
  return { db: wrapHostFaithfulDb(fake), _calls: calls };
}

// ---- R1 — setChatTopicPinned(true): UPDATE sets pinned_at = now(); -------
//        WHERE clause uses company_id + issue_id.

test('R1: setChatTopicPinned(true) issues UPDATE that sets pinned_at via CASE WHEN $1 = true THEN now()', async () => {
  const ctx = makeFakeDbCtx();
  await setChatTopicPinned(ctx, 'co-1', 'issue-topic-1', true);
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1, 'one execute call');
  const w = writes[0];
  assert.match(
    w.sql,
    /UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i,
    'UPDATEs the plugin-namespace chat_topics table',
  );
  assert.match(
    w.sql,
    /pinned_at\s*=\s*CASE\s+WHEN\s+\$1\s*=\s*true\s+THEN\s+now\(\)\s+ELSE\s+NULL\s+END/i,
    'CASE WHEN $1 = true THEN now() ELSE NULL pattern',
  );
  assert.match(
    w.sql,
    /WHERE\s+issue_id\s*=\s*\$2\s+AND\s+company_id\s*=\s*\$3/i,
    'WHERE uses company_id + issue_id',
  );
  assert.deepEqual(w.params, [true, 'issue-topic-1', 'co-1']);
});

// ---- R2 — setChatTopicPinned(false): same SQL, flips pinned_at -> NULL ---

test('R2: setChatTopicPinned(false) sets pinned_at to NULL', async () => {
  const ctx = makeFakeDbCtx();
  await setChatTopicPinned(ctx, 'co-1', 'issue-topic-1', false);
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].params, [false, 'issue-topic-1', 'co-1']);
  // SAME SQL — only the $1 binding flips.
  assert.match(
    writes[0].sql,
    /pinned_at\s*=\s*CASE\s+WHEN\s+\$1\s*=\s*true\s+THEN\s+now\(\)\s+ELSE\s+NULL\s+END/i,
  );
});

// ---- R3 — isChatTopicPinned reflects pinned_at: true/false/missing -------

test('R3a: isChatTopicPinned returns true when row pinned_at is non-null', async () => {
  const ctx = makeFakeDbCtx({
    pinnedRows: new Map([['co-1::issue-topic-1', '2026-05-25T12:00:00Z']]),
  });
  const result = await isChatTopicPinned(ctx, 'co-1', 'issue-topic-1');
  assert.equal(result, true);
});

test('R3b: isChatTopicPinned returns false when row pinned_at is null', async () => {
  const ctx = makeFakeDbCtx({
    pinnedRows: new Map([['co-1::issue-topic-1', null]]),
  });
  const result = await isChatTopicPinned(ctx, 'co-1', 'issue-topic-1');
  assert.equal(result, false);
});

test('R3c: isChatTopicPinned returns false when row is absent', async () => {
  const ctx = makeFakeDbCtx();
  const result = await isChatTopicPinned(ctx, 'co-1', 'missing-topic');
  assert.equal(result, false);
});

// ---- R4 — bulkSetChatTopicArchived issues single UPDATE with ANY($) -----

test('R4: bulkSetChatTopicArchived issues a single UPDATE with = ANY($) array binding', async () => {
  const ctx = makeFakeDbCtx();
  // wrapHostFaithfulDb's default execute returns { rowCount: 1 }; we expect
  // the helper to surface that as `updated`.
  const result = await bulkSetChatTopicArchived(
    ctx,
    'co-1',
    ['issue-1', 'issue-2', 'issue-3'],
    false,
  );
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1, 'one DB round-trip');
  const w = writes[0];
  assert.match(w.sql, /UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i);
  assert.match(w.sql, /=\s*ANY\(\$3::text\[\]\)/i, 'ARRAY binding on $3');
  assert.deepEqual(w.params, [false, 'co-1', ['issue-1', 'issue-2', 'issue-3']]);
  assert.equal(result.updated, 1, 'rowCount surfaces as updated');
});

// ---- R5 — bulkSetChatTopicArchived SQL contains the PIN_EXEMPT guard ----

test('R5: bulkSetChatTopicArchived SQL contains pinned_at IS NULL OR $1 = false guard', async () => {
  const ctx = makeFakeDbCtx();
  await bulkSetChatTopicArchived(ctx, 'co-1', ['issue-1'], true);
  const w = ctx._calls.find((c) => c.kind === 'execute');
  assert.match(
    w.sql,
    /\(\s*pinned_at\s+IS\s+NULL\s+OR\s+\$1\s*=\s*false\s*\)/i,
    'pinned_at IS NULL OR $1 = false guard present',
  );
});

// ---- R6 — bulkSetChatTopicArchived with empty array short-circuits ------

test('R6: bulkSetChatTopicArchived with empty topicIssueIds returns { updated: 0 } and skips DB', async () => {
  const ctx = makeFakeDbCtx();
  const result = await bulkSetChatTopicArchived(ctx, 'co-1', [], false);
  assert.deepEqual(result, { updated: 0 });
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 0, 'no execute calls for empty input');
});

// ---- R7 — listAllArchivedChatTopics is company-scoped, no employee filter

test('R7: listAllArchivedChatTopics is company-scoped (no employee_agent_id parameter), ORDER BY archived_at DESC NULLS LAST', async () => {
  const ctx = makeFakeDbCtx({
    archivedRows: [
      {
        topic_id: 'CHT-9',
        company_id: 'co-1',
        issue_id: 'issue-9',
        parent_issue_id: 'parent-1',
        employee_agent_id: 'agent-a',
        title: 'Older topic',
        last_activity_at: '2026-05-20T00:00:00.000Z',
        archived: true,
        created_at: '2026-05-20T00:00:00.000Z',
        archived_at: '2026-05-21T00:00:00.000Z',
        pinned_at: null,
      },
    ],
  });
  const rows = await listAllArchivedChatTopics(ctx, 'co-1');
  const q = ctx._calls.find((c) => c.kind === 'query');
  assert.ok(q, 'one query');
  assert.deepEqual(q.params, ['co-1'], 'exactly one param: companyId');
  // Company-scoped means no employee_agent_id appears in the WHERE clause
  // (it still appears in the SELECT column list — CHAT_TOPIC_COLS — so we
  // narrow the regex to the WHERE clause only).
  const whereClause = q.sql.match(/WHERE[\s\S]*?ORDER\s+BY/i)?.[0] ?? '';
  assert.doesNotMatch(whereClause, /employee_agent_id/i, 'no employee filter in WHERE');
  assert.match(
    q.sql,
    /ORDER\s+BY\s+archived_at\s+DESC\s+NULLS\s+LAST,\s+last_activity_at\s+DESC/i,
    'archived_at DESC NULLS LAST sort',
  );
  assert.match(q.sql, /archived\s*=\s*true/i, 'filters archived = true');
  assert.match(q.sql, /pinned_at/i, 'SELECT includes pinned_at column');
  assert.equal(rows.length, 1);
});
