// test/worker/chat-topics-repo.test.mjs
//
// Plan 04-02 Task B RED — typed CRUD for the three 0006_chat.sql tables.
//
// Mirrors test/worker/tldr-cache.test.mjs: every function takes a
// ChatTopicsRepoCtx ({ db }) and every SQL string is fully-qualified against
// the deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd (02-01
// Finding #4 — no template substitution). ctx.db.query is SELECT-only;
// ctx.db.execute returns only { rowCount } (no RETURNING) — wrapHostFaithfulDb
// enforces that contract, so a write-via-query throws exactly as the live host
// would.
//
// CHAT-06 dedup: insertChatMessage is INSERT ... ON CONFLICT (message_uuid)
// DO NOTHING then a read-back SELECT, so a half-succeeded optimistic-send
// retry returns the original row.
// BLOCKER-3: insertEmployeeParent is ON CONFLICT (company_id, employee_agent_id)
// DO NOTHING then a read-back, so two concurrent first-ever-topic creates
// resolve to the same parent issue.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  insertChatTopic,
  getChatTopicByIssueId,
  listChatTopicsForEmployee,
  allocateChtNumber,
  insertChatMessage,
  getChatMessageByUuid,
  updateChatMessagePinned,
  getEmployeeParentIssueId,
  insertEmployeeParent,
} from '../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

// An in-memory fake of the three 0006 tables. wrapHostFaithfulDb decorates it
// so the host query/execute contract is enforced.
function makeFakeDbCtx(seed = {}) {
  const calls = [];
  const topics = [...(seed.topics ?? [])];
  const messages = [...(seed.messages ?? [])];
  const parents = [...(seed.parents ?? [])];

  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });

      if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        const [
          topic_id,
          company_id,
          issue_id,
          parent_issue_id,
          employee_agent_id,
          title,
          last_activity_at,
          archived,
          created_at,
        ] = params;
        const clash = topics.some(
          (t) => t.company_id === company_id && t.issue_id === issue_id,
        );
        if (!clash && !topics.some((t) => t.topic_id === topic_id)) {
          topics.push({
            topic_id,
            company_id,
            issue_id,
            parent_issue_id,
            employee_agent_id,
            title,
            last_activity_at,
            archived,
            created_at,
          });
        }
        return { rowCount: 1 };
      }

      if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
        const [
          message_uuid,
          company_id,
          topic_issue_id,
          comment_id,
          sender_kind,
          supersedes_uuid,
          pinned,
          sent_at,
        ] = params;
        // ON CONFLICT (message_uuid) DO NOTHING
        if (!messages.some((m) => m.message_uuid === message_uuid)) {
          messages.push({
            message_uuid,
            company_id,
            topic_issue_id,
            comment_id,
            sender_kind,
            supersedes_uuid,
            pinned,
            sent_at,
          });
        }
        return { rowCount: 1 };
      }

      if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
        const [pinned, messageUuid, companyId] = params;
        const row = messages.find(
          (m) => m.message_uuid === messageUuid && m.company_id === companyId,
        );
        if (row) row.pinned = pinned;
        return { rowCount: row ? 1 : 0 };
      }

      if (
        /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)
      ) {
        const [company_id, employee_agent_id, parent_issue_id, created_at] = params;
        // ON CONFLICT (company_id, employee_agent_id) DO NOTHING
        if (
          !parents.some(
            (p) =>
              p.company_id === company_id &&
              p.employee_agent_id === employee_agent_id,
          )
        ) {
          parents.push({ company_id, employee_agent_id, parent_issue_id, created_at });
        }
        return { rowCount: 1 };
      }

      return { rowCount: 0 };
    },

    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });

      // CHT-NN allocator — SELECT MAX over company-scoped topic_id suffixes.
      if (/SELECT[\s\S]*max[\s\S]*FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        const [companyId] = params;
        const nums = topics
          .filter((t) => t.company_id === companyId)
          .map((t) => Number(String(t.topic_id).replace(/^CHT-/, '')))
          .filter((n) => Number.isFinite(n));
        const max = nums.length ? Math.max(...nums) : null;
        return [{ max_n: max }];
      }

      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        // listChatTopicsForEmployee: WHERE company_id = $1 AND employee_agent_id = $2
        if (/employee_agent_id\s*=\s*\$2/i.test(sql)) {
          const [companyId, employeeAgentId] = params;
          return topics.filter(
            (t) =>
              t.company_id === companyId && t.employee_agent_id === employeeAgentId,
          );
        }
        // getChatTopicByIssueId: WHERE company_id = $1 AND issue_id = $2
        const [companyId, issueId] = params;
        return topics.filter(
          (t) => t.company_id === companyId && t.issue_id === issueId,
        );
      }

      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
        const [messageUuid, companyId] = params;
        return messages.filter(
          (m) => m.message_uuid === messageUuid && m.company_id === companyId,
        );
      }

      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)) {
        const [companyId, employeeAgentId] = params;
        return parents.filter(
          (p) =>
            p.company_id === companyId && p.employee_agent_id === employeeAgentId,
        );
      }

      return [];
    },
  };

  return { ctx: { db: wrapHostFaithfulDb(fake) }, calls, topics, messages, parents };
}

const TOPIC = {
  topic_id: 'CHT-1',
  company_id: 'COU',
  issue_id: 'issue-101',
  parent_issue_id: 'parent-1',
  employee_agent_id: 'agent-cfo',
  title: 'Q3 pricing',
  last_activity_at: '2026-05-18T10:00:00Z',
  archived: false,
  created_at: '2026-05-18T10:00:00Z',
};

// ---------------------------------------------------------------------------
// chat_topics
// ---------------------------------------------------------------------------

test('insertChatTopic targets the baked namespace and reads the row back', async () => {
  const { ctx, calls } = makeFakeDbCtx();
  const row = await insertChatTopic(ctx, TOPIC);
  assert.equal(row.topic_id, 'CHT-1');
  assert.equal(row.issue_id, 'issue-101');
  assert.ok(
    calls.some((c) => /plugin_clarity_pack_cdd6bda4bd\.chat_topics/.test(c.sql)),
    'SQL targets plugin_clarity_pack_cdd6bda4bd.chat_topics',
  );
  // host contract: the INSERT goes through execute, the read-back through query
  assert.ok(calls.some((c) => c.kind === 'execute'), 'INSERT via execute');
  assert.ok(calls.some((c) => c.kind === 'query'), 'read-back via query');
});

test('getChatTopicByIssueId returns the topic for a known issue and null otherwise', async () => {
  const { ctx } = makeFakeDbCtx({ topics: [TOPIC] });
  const hit = await getChatTopicByIssueId(ctx, 'COU', 'issue-101');
  assert.ok(hit, 'returns a row for a known (company_id, issue_id)');
  assert.equal(hit.topic_id, 'CHT-1');
  const miss = await getChatTopicByIssueId(ctx, 'COU', 'issue-999');
  assert.equal(miss, null, 'returns null for an unknown issue');
});

test('listChatTopicsForEmployee returns only that employee topics, company-scoped', async () => {
  const { ctx } = makeFakeDbCtx({
    topics: [
      TOPIC,
      { ...TOPIC, topic_id: 'CHT-2', issue_id: 'issue-102', employee_agent_id: 'agent-cto' },
      { ...TOPIC, topic_id: 'CHT-3', issue_id: 'issue-103', company_id: 'OTHER' },
    ],
  });
  const list = await listChatTopicsForEmployee(ctx, 'COU', 'agent-cfo');
  assert.equal(list.length, 1);
  assert.equal(list[0].topic_id, 'CHT-1');
});

// ---------------------------------------------------------------------------
// CHT-NN allocator
// ---------------------------------------------------------------------------

test('allocateChtNumber returns CHT-1 for an empty company', async () => {
  const { ctx } = makeFakeDbCtx();
  const id = await allocateChtNumber(ctx, 'COU');
  assert.equal(id, 'CHT-1');
});

test('allocateChtNumber returns CHT-<max+1> when topics exist', async () => {
  const { ctx } = makeFakeDbCtx({
    topics: [
      { ...TOPIC, topic_id: 'CHT-1', issue_id: 'i1' },
      { ...TOPIC, topic_id: 'CHT-7', issue_id: 'i7' },
      { ...TOPIC, topic_id: 'CHT-4', issue_id: 'i4' },
    ],
  });
  const id = await allocateChtNumber(ctx, 'COU');
  assert.equal(id, 'CHT-8', 'max suffix is 7 -> next is CHT-8');
});

test('allocateChtNumber is company-scoped (another company does not bump the counter)', async () => {
  const { ctx } = makeFakeDbCtx({
    topics: [{ ...TOPIC, topic_id: 'CHT-9', issue_id: 'i9', company_id: 'OTHER' }],
  });
  const id = await allocateChtNumber(ctx, 'COU');
  assert.equal(id, 'CHT-1', 'COU has no topics of its own');
});

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------

const MSG = {
  message_uuid: 'uuid-aaa',
  company_id: 'COU',
  topic_issue_id: 'issue-101',
  comment_id: 'comment-1',
  sender_kind: 'user',
  supersedes_uuid: null,
  pinned: false,
  sent_at: '2026-05-18T10:05:00Z',
};

test('insertChatMessage stores the id-map columns and reads the row back', async () => {
  const { ctx, calls } = makeFakeDbCtx();
  const row = await insertChatMessage(ctx, MSG);
  assert.equal(row.message_uuid, 'uuid-aaa');
  assert.equal(row.comment_id, 'comment-1');
  assert.equal(row.topic_issue_id, 'issue-101');
  assert.equal(row.sender_kind, 'user');
  assert.equal(row.supersedes_uuid, null);
  assert.equal(row.pinned, false);
  assert.equal(row.sent_at, '2026-05-18T10:05:00Z');
  const insert = calls.find((c) => c.kind === 'execute');
  assert.match(insert.sql, /ON CONFLICT\s*\(\s*message_uuid\s*\)\s*DO NOTHING/i);
});

test('insertChatMessage on a duplicate message_uuid is a no-op; read-back is the original', async () => {
  const { ctx, messages } = makeFakeDbCtx();
  await insertChatMessage(ctx, MSG);
  const second = await insertChatMessage(ctx, {
    ...MSG,
    comment_id: 'comment-OVERWRITE',
    sender_kind: 'agent',
  });
  assert.equal(messages.length, 1, 'the duplicate insert was a no-op');
  assert.equal(second.comment_id, 'comment-1', 'read-back returns the ORIGINAL row');
  assert.equal(second.sender_kind, 'user');
});

test('getChatMessageByUuid returns the row for a known uuid and null for an unknown one', async () => {
  const { ctx } = makeFakeDbCtx({ messages: [MSG] });
  const hit = await getChatMessageByUuid(ctx, 'COU', 'uuid-aaa');
  assert.ok(hit, 'returns a row for a known message_uuid (dedup-on-send path)');
  assert.equal(hit.comment_id, 'comment-1');
  const miss = await getChatMessageByUuid(ctx, 'COU', 'uuid-unknown');
  assert.equal(miss, null);
});

test('getChatMessageByUuid is company-scoped', async () => {
  const { ctx } = makeFakeDbCtx({ messages: [MSG] });
  const wrongCompany = await getChatMessageByUuid(ctx, 'OTHER', 'uuid-aaa');
  assert.equal(wrongCompany, null, 'a message does not leak across companies');
});

test('updateChatMessagePinned flips the pin flag and is company-scoped', async () => {
  const { ctx, messages } = makeFakeDbCtx({ messages: [MSG] });
  await updateChatMessagePinned(ctx, 'COU', 'uuid-aaa', true);
  assert.equal(messages[0].pinned, true);
  await updateChatMessagePinned(ctx, 'COU', 'uuid-aaa', false);
  assert.equal(messages[0].pinned, false);
});

// ---------------------------------------------------------------------------
// chat_employee_parents — BLOCKER-3 parent-issue resolution
// ---------------------------------------------------------------------------

test('getEmployeeParentIssueId returns the parent id for a known employee and null otherwise', async () => {
  const { ctx } = makeFakeDbCtx({
    parents: [
      {
        company_id: 'COU',
        employee_agent_id: 'agent-cfo',
        parent_issue_id: 'parent-cfo',
        created_at: '2026-05-18T09:00:00Z',
      },
    ],
  });
  const hit = await getEmployeeParentIssueId(ctx, 'COU', 'agent-cfo');
  assert.equal(hit, 'parent-cfo');
  const miss = await getEmployeeParentIssueId(ctx, 'COU', 'agent-unknown');
  assert.equal(miss, null);
});

test('insertEmployeeParent inserts then reads back the parent_issue_id', async () => {
  const { ctx, parents } = makeFakeDbCtx();
  const id = await insertEmployeeParent(ctx, 'COU', 'agent-cfo', 'parent-cfo');
  assert.equal(id, 'parent-cfo');
  assert.equal(parents.length, 1);
});

test('insertEmployeeParent on a duplicate (company_id, employee_agent_id) is a no-op; read-back is the original parent', async () => {
  const { ctx, parents, calls } = makeFakeDbCtx();
  await insertEmployeeParent(ctx, 'COU', 'agent-cfo', 'parent-FIRST');
  const second = await insertEmployeeParent(ctx, 'COU', 'agent-cfo', 'parent-RACE');
  assert.equal(parents.length, 1, 'the duplicate insert was a no-op');
  assert.equal(
    second,
    'parent-FIRST',
    'a racing first-ever-topic create resolves to the SAME parent issue',
  );
  const insert = calls.find((c) => c.kind === 'execute');
  assert.match(
    insert.sql,
    /ON CONFLICT\s*\(\s*company_id\s*,\s*employee_agent_id\s*\)\s*DO NOTHING/i,
  );
});
