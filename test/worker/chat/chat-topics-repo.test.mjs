// test/worker/chat/chat-topics-repo.test.mjs
//
// Plan 04.2-01 Task 1 RED -> GREEN -- chat_topics origin_issue_id (RCB-04).
//
// Migration 0009 adds an additive plugin-namespace column `origin_issue_id`
// to chat_topics. The repo gains:
//   - listChatTopicsByOriginIssue(ctx, companyId, originIssueId) -- newest-
//     first topic rows for one source issue (the Reader reverse-topics list).
//   - insertChatTopic accepts an OPTIONAL `originIssueId` field on its row
//     argument, written into the new column; the param defaults to null so
//     every pre-04.2-01 call site compiles unchanged (RCB-07 back-compat).
//
// Mirrors test/worker/chat-topics-repo.test.mjs's makeFakeDbCtx + the
// host-faithful db wrapper. The in-memory fake here is scoped to the new
// origin_issue_id surface; the Plan 04-02 / 04.1-05 repo behaviour stays
// covered by the original test file.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  insertChatTopic,
  listChatTopicsByOriginIssue,
} from '../../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// An in-memory fake of chat_topics that understands the origin_issue_id
// column. wrapHostFaithfulDb enforces the host query/execute contract.
function makeFakeDbCtx(seed = {}) {
  const calls = [];
  const topics = [...(seed.topics ?? [])];

  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });

      if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        // The INSERT column list is read off the SQL so the test stays
        // resilient to extra columns; param positions follow the column list.
        const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
        const cols = colMatch
          ? colMatch[1].split(',').map((c) => c.trim())
          : [];
        const row = {};
        cols.forEach((col, i) => {
          row[col] = params[i];
        });
        const clash = topics.some(
          (t) => t.company_id === row.company_id && t.issue_id === row.issue_id,
        );
        if (!clash && !topics.some((t) => t.topic_id === row.topic_id)) {
          topics.push({ origin_issue_id: null, ...row });
        }
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },

    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });

      // listChatTopicsByOriginIssue:
      //   WHERE company_id = $1 AND origin_issue_id = $2 ORDER BY last_activity_at DESC
      if (
        /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql) &&
        /origin_issue_id\s*=\s*\$2/i.test(sql)
      ) {
        const [companyId, originIssueId] = params;
        return topics
          .filter(
            (t) =>
              t.company_id === companyId && t.origin_issue_id === originIssueId,
          )
          .slice()
          .sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
      }

      // getChatTopicByIssueId read-back: WHERE company_id = $1 AND issue_id = $2
      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        const [companyId, issueId] = params;
        return topics.filter(
          (t) => t.company_id === companyId && t.issue_id === issueId,
        );
      }

      return [];
    },
  };

  return { ctx: { db: wrapHostFaithfulDb(fake) }, calls, topics };
}

const TOPIC = {
  topic_id: 'CHT-1',
  company_id: 'COU',
  issue_id: 'issue-101',
  parent_issue_id: 'parent-1',
  employee_agent_id: 'agent-cfo',
  title: 'Q3 pricing',
  last_activity_at: '2026-05-21T10:00:00Z',
  archived: false,
  created_at: '2026-05-21T10:00:00Z',
};

// ---------------------------------------------------------------------------
// R1 -- LIST-BY-ORIGIN-SQL-SHAPE
// ---------------------------------------------------------------------------

test('R1: listChatTopicsByOriginIssue issues one company+origin-scoped SELECT, newest-first', async () => {
  const { ctx, calls } = makeFakeDbCtx();
  await listChatTopicsByOriginIssue(ctx, 'COU', 'COU-77');
  const queries = calls.filter((c) => c.kind === 'query');
  assert.equal(queries.length, 1, 'exactly one ctx.db.query call');
  const q = queries[0];
  assert.match(
    q.sql,
    /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i,
    'targets the namespaced chat_topics table',
  );
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+origin_issue_id\s*=\s*\$2/i,
    'WHERE company_id = $1 AND origin_issue_id = $2',
  );
  assert.match(
    q.sql,
    /ORDER\s+BY\s+last_activity_at\s+DESC/i,
    'ORDER BY last_activity_at DESC (newest-first)',
  );
  assert.deepEqual(q.params, ['COU', 'COU-77'], 'params [companyId, originIssueId]');
});

// ---------------------------------------------------------------------------
// R2 -- LIST-BY-ORIGIN-MAPS-ROWS
// ---------------------------------------------------------------------------

test('R2: listChatTopicsByOriginIssue maps rows to { topicIssueId, topicId, title, lastActivityAt }, newest-first', async () => {
  const { ctx } = makeFakeDbCtx({
    topics: [
      {
        ...TOPIC,
        topic_id: 'CHT-1',
        issue_id: 'issue-old',
        title: 'Older topic',
        last_activity_at: '2026-05-20T10:00:00Z',
        origin_issue_id: 'COU-77',
      },
      {
        ...TOPIC,
        topic_id: 'CHT-2',
        issue_id: 'issue-new',
        title: 'Newer topic',
        last_activity_at: '2026-05-21T10:00:00Z',
        origin_issue_id: 'COU-77',
      },
    ],
  });
  const list = await listChatTopicsByOriginIssue(ctx, 'COU', 'COU-77');
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    topicIssueId: 'issue-new',
    topicId: 'CHT-2',
    title: 'Newer topic',
    lastActivityAt: '2026-05-21T10:00:00Z',
  });
  assert.deepEqual(list[1], {
    topicIssueId: 'issue-old',
    topicId: 'CHT-1',
    title: 'Older topic',
    lastActivityAt: '2026-05-20T10:00:00Z',
  });
});

// ---------------------------------------------------------------------------
// R3 -- LIST-BY-ORIGIN-EMPTY
// ---------------------------------------------------------------------------

test('R3: listChatTopicsByOriginIssue returns [] when no topic has this origin issue', async () => {
  const { ctx } = makeFakeDbCtx({
    topics: [{ ...TOPIC, origin_issue_id: 'COU-OTHER' }],
  });
  const list = await listChatTopicsByOriginIssue(ctx, 'COU', 'COU-77');
  assert.deepEqual(list, []);
});

// ---------------------------------------------------------------------------
// R4 -- INSERT-WITH-ORIGIN
// ---------------------------------------------------------------------------

test('R4: insertChatTopic with originIssueId writes origin_issue_id into the INSERT', async () => {
  const { ctx, calls, topics } = makeFakeDbCtx();
  await insertChatTopic(ctx, { ...TOPIC, originIssueId: 'COU-1' });
  const insert = calls.find(
    (c) =>
      c.kind === 'execute' &&
      /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(c.sql),
  );
  assert.ok(insert, 'the INSERT was issued via execute');
  assert.match(
    insert.sql,
    /\borigin_issue_id\b/,
    'origin_issue_id appears in the INSERT column list',
  );
  assert.equal(topics.length, 1);
  assert.equal(topics[0].origin_issue_id, 'COU-1', 'origin_issue_id persisted');
});

// ---------------------------------------------------------------------------
// R5 -- INSERT-WITHOUT-ORIGIN-BACK-COMPAT (RCB-07)
// ---------------------------------------------------------------------------

test('R5: insertChatTopic without originIssueId still works -- origin_issue_id is NULL (RCB-07 back-compat)', async () => {
  const { ctx, topics } = makeFakeDbCtx();
  // The exact pre-04.2-01 call shape -- no originIssueId on the row argument.
  const row = await insertChatTopic(ctx, TOPIC);
  assert.equal(row.topic_id, 'CHT-1');
  assert.equal(topics.length, 1);
  assert.equal(
    topics[0].origin_issue_id,
    null,
    'origin_issue_id defaults to NULL when the caller omits it',
  );
});
