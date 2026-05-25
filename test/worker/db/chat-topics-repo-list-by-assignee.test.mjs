// test/worker/db/chat-topics-repo-list-by-assignee.test.mjs
//
// Plan 04.2-07 Task 1 RED -> GREEN -- listTopicsForIssueAndAssignee repo
// helper (D-04 + D-05).
//
// The helper supports `chat.openForIssue`'s step-2 reverse-lookup added by
// Plan 04.2-07 (D-7 routing rewrite). It lists every chat topic that was
// started from one source Paperclip issue AND is owned by one specific
// employee-agent, company-scoped.
//
// Locked semantics (D-04 + D-05):
//   - INCLUDES archived rows (D-04 — no archived_at IS NULL filter; the
//     auto-unarchive path needs to see them).
//   - ORDER BY GREATEST(chat_topics.last_activity_at, MAX(chat_messages.sent_at))
//     DESC (D-05 tiebreaker — note column is `sent_at` per CHAT_MESSAGE_COLS,
//     NOT `created_at`).
//
// SQL-shape pin idiom mirrors `chat-topics-repo.test.mjs` R1 + R2 (lines
// 561-594): spy on `ctx.db.query` calls and assert the SQL string + params.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { listTopicsForIssueAndAssignee } from '../../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeSpyDbCtx({ rows = [] } = {}) {
  const calls = [];
  const fake = {
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      return rows;
    },
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      return { rowCount: 0 };
    },
  };
  return { ctx: { db: wrapHostFaithfulDb(fake) }, calls };
}

// ---- RED 1 — SQL shape pin (WHERE + ORDER BY GREATEST) -------------------

test('R1: listTopicsForIssueAndAssignee issues ONE query with locked WHERE + GREATEST ORDER BY', async () => {
  const { ctx, calls } = makeSpyDbCtx();
  await listTopicsForIssueAndAssignee(ctx, 'COU', 'issue-x', 'agent-cmo');
  const queries = calls.filter((c) => c.kind === 'query');
  assert.equal(queries.length, 1, 'exactly one db.query call');
  const q = queries[0];
  // WHERE clause shape — company + origin + assignee, in this positional order.
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+origin_issue_id\s*=\s*\$2\s+AND\s+employee_agent_id\s*=\s*\$3/i,
    'WHERE company_id = $1 AND origin_issue_id = $2 AND employee_agent_id = $3',
  );
  // ORDER BY clause includes both chat_topics.last_activity_at AND chat_messages.sent_at
  // (D-05 tiebreaker via GREATEST + correlated subquery against chat_messages).
  assert.match(q.sql, /ORDER\s+BY/i, 'has an ORDER BY clause');
  assert.match(q.sql, /GREATEST/i, 'ORDER BY uses GREATEST (D-05 tiebreaker)');
  assert.match(q.sql, /chat_topics\.last_activity_at/i, 'references chat_topics.last_activity_at');
  assert.match(q.sql, /chat_messages/i, 'correlated subquery against chat_messages');
  assert.match(q.sql, /sent_at/i, 'uses CHAT_MESSAGE_COLS column sent_at (NOT created_at)');
});

// ---- RED 2 — Param positional order ---------------------------------------

test('R2: listTopicsForIssueAndAssignee binds [companyId, originIssueId, employeeAgentId] in order', async () => {
  const { ctx, calls } = makeSpyDbCtx();
  await listTopicsForIssueAndAssignee(ctx, 'co-1', 'issue-101', 'agent-cfo');
  const q = calls.find((c) => c.kind === 'query');
  assert.deepEqual(
    q.params,
    ['co-1', 'issue-101', 'agent-cfo'],
    'params bound in exact order [companyId, originIssueId, employeeAgentId]',
  );
});

// ---- RED 3 — Archived rows are INCLUDED (D-04) ----------------------------

test('R3: archived rows are NOT filtered — both archived and non-archived returned', async () => {
  const seedRows = [
    {
      topic_id: 'CHT-1',
      company_id: 'COU',
      issue_id: 'topic-1',
      parent_issue_id: 'p-1',
      employee_agent_id: 'agent-cmo',
      title: 'Pricing',
      last_activity_at: '2026-05-20T10:00:00.000Z',
      archived: false,
      created_at: '2026-05-19T09:00:00.000Z',
      origin_issue_id: 'issue-x',
    },
    {
      topic_id: 'CHT-2',
      company_id: 'COU',
      issue_id: 'topic-2',
      parent_issue_id: 'p-1',
      employee_agent_id: 'agent-cmo',
      title: 'Pricing follow-up',
      last_activity_at: '2026-05-22T11:00:00.000Z',
      archived: true,
      created_at: '2026-05-21T08:00:00.000Z',
      origin_issue_id: 'issue-x',
    },
  ];
  const { ctx } = makeSpyDbCtx({ rows: seedRows });
  const entries = await listTopicsForIssueAndAssignee(ctx, 'COU', 'issue-x', 'agent-cmo');
  assert.equal(entries.length, 2, 'both rows returned (archived included per D-04)');
  // archived flag preserved on each entry.
  const byTopic = Object.fromEntries(entries.map((e) => [e.topicId, e]));
  assert.equal(byTopic['CHT-1'].archived, false, 'non-archived row carries archived: false');
  assert.equal(byTopic['CHT-2'].archived, true, 'archived row carries archived: true');
});

// ---- RED 4 — camelCase return shape ---------------------------------------

test('R4: returned entries use camelCase shape — topicIssueId, topicId, title, lastActivityAt, archived', async () => {
  const seedRows = [
    {
      topic_id: 'CHT-7',
      company_id: 'COU',
      issue_id: 'topic-uuid-7',
      parent_issue_id: 'p-1',
      employee_agent_id: 'agent-cmo',
      title: 'Pricing',
      last_activity_at: '2026-05-22T11:00:00.000Z',
      archived: false,
      created_at: '2026-05-21T08:00:00.000Z',
      origin_issue_id: 'issue-x',
    },
  ];
  const { ctx } = makeSpyDbCtx({ rows: seedRows });
  const entries = await listTopicsForIssueAndAssignee(ctx, 'COU', 'issue-x', 'agent-cmo');
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.topicIssueId, 'topic-uuid-7', 'topicIssueId from row.issue_id');
  assert.equal(e.topicId, 'CHT-7', 'topicId carries the CHT-NN sequence');
  assert.equal(e.title, 'Pricing');
  assert.equal(e.lastActivityAt, '2026-05-22T11:00:00.000Z');
  assert.equal(typeof e.archived, 'boolean', 'archived is a boolean');
  // No snake_case leaks (other than nothing — the entries should be pure camel).
  assert.equal(e.issue_id, undefined, 'no snake_case issue_id leak');
  assert.equal(e.topic_id, undefined, 'no snake_case topic_id leak');
  assert.equal(e.last_activity_at, undefined, 'no snake_case last_activity_at leak');
});

// ---- RED 5 — Empty result is [] (not null, no throw) ----------------------

test('R5: empty result returns [] (not null, no throw)', async () => {
  const { ctx } = makeSpyDbCtx({ rows: [] });
  const entries = await listTopicsForIssueAndAssignee(ctx, 'COU', 'issue-cold', 'agent-cmo');
  assert.ok(Array.isArray(entries), 'returns an array');
  assert.equal(entries.length, 0, 'empty array on no rows');
});
