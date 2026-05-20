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
  getChatMessageByCommentId,
  pinChatMessageByCommentId,
  getEmployeeParentIssueId,
  insertEmployeeParent,
  // Plan 04.1-05 — D-10 plugin-side archive + D-08 chat_topic_tasks side table
  // (Wave 1 lock: REST originId filters do not work; side table is the
  // steady-state D-08 lookup path).
  setChatTopicArchived,
  insertChatTopicTask,
  listChatTopicTasksForTopic,
} from '../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

// An in-memory fake of the three 0006 tables. wrapHostFaithfulDb decorates it
// so the host query/execute contract is enforced.
function makeFakeDbCtx(seed = {}) {
  const calls = [];
  const topics = [...(seed.topics ?? [])];
  const messages = [...(seed.messages ?? [])];
  const parents = [...(seed.parents ?? [])];
  // Plan 04.1-05 D-08 — the chat_topic_tasks side table seed slot. Each row:
  // { id, company_id, topic_issue_id, task_issue_id, created_at }.
  const chatTopicTasks = [...(seed.chatTopicTasks ?? [])];

  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });

      // Plan 04.1-05 D-10 — UPDATE chat_topics SET archived = $1 WHERE issue_id = $2 AND company_id = $3
      if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        const [archived, issueId, companyId] = params;
        const row = topics.find(
          (t) => t.issue_id === issueId && t.company_id === companyId,
        );
        if (row) row.archived = archived;
        return { rowCount: row ? 1 : 0 };
      }

      // Plan 04.1-05 D-08 — INSERT INTO chat_topic_tasks ... ON CONFLICT DO NOTHING
      if (
        /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i.test(sql)
      ) {
        const [company_id, topic_issue_id, task_issue_id] = params;
        const clash = chatTopicTasks.some(
          (r) =>
            r.company_id === company_id &&
            r.topic_issue_id === topic_issue_id &&
            r.task_issue_id === task_issue_id,
        );
        if (!clash) {
          chatTopicTasks.push({
            id: chatTopicTasks.length + 1,
            company_id,
            topic_issue_id,
            task_issue_id,
            created_at:
              params[3] && typeof params[3] === 'string'
                ? params[3]
                : new Date().toISOString(),
          });
        }
        return { rowCount: clash ? 0 : 1 };
      }

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
        const existing = messages.find((m) => m.message_uuid === message_uuid);
        if (existing) {
          // ON CONFLICT (message_uuid) DO UPDATE SET pinned = EXCLUDED.pinned
          // (pinChatMessageByCommentId) vs DO NOTHING (insertChatMessage).
          if (/ON CONFLICT[\s\S]*DO UPDATE/i.test(sql)) {
            existing.pinned = pinned;
          }
        } else {
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
        const [pinned, key, companyId] = params;
        // updateChatMessagePinned keys on message_uuid; pinChatMessageByCommentId
        // keys on comment_id — the SQL WHERE clause says which.
        const byComment = /WHERE\s+comment_id\s*=\s*\$2/i.test(sql);
        const row = messages.find(
          (m) =>
            (byComment ? m.comment_id === key : m.message_uuid === key) &&
            m.company_id === companyId,
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
      // The SELECT CASTs to `bigint`; node-postgres returns bigint columns as
      // STRINGS, never numbers. This fake returns max_n host-faithfully — as a
      // string when a row matched — so the allocator's Number(...) coercion
      // (GAP 5) is exercised exactly as it runs against the live host. A
      // permissive number-returning fake hid the "1"+1="11" concat bug.
      if (/SELECT[\s\S]*max[\s\S]*FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        const [companyId] = params;
        const nums = topics
          .filter((t) => t.company_id === companyId)
          .map((t) => Number(String(t.topic_id).replace(/^CHT-/, '')))
          .filter((n) => Number.isFinite(n));
        // Postgres MAX over an empty set is SQL NULL; over a non-empty set the
        // bigint comes back as a string (the node-postgres bigint contract).
        const max = nums.length ? String(Math.max(...nums)) : null;
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
        const [key, companyId] = params;
        // getChatMessageByUuid keys on message_uuid; getChatMessageByCommentId
        // keys on comment_id — the SQL WHERE clause says which.
        const byComment = /WHERE\s+comment_id\s*=\s*\$1/i.test(sql);
        return messages.filter(
          (m) =>
            (byComment ? m.comment_id === key : m.message_uuid === key) &&
            m.company_id === companyId,
        );
      }

      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)) {
        const [companyId, employeeAgentId] = params;
        return parents.filter(
          (p) =>
            p.company_id === companyId && p.employee_agent_id === employeeAgentId,
        );
      }

      // Plan 04.1-05 D-08 — SELECT task_issue_id FROM chat_topic_tasks
      //   WHERE company_id = $1 AND topic_issue_id = $2
      //   ORDER BY created_at DESC LIMIT 50
      if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i.test(sql)) {
        const [companyId, topicIssueId] = params;
        return chatTopicTasks
          .filter(
            (r) =>
              r.company_id === companyId && r.topic_issue_id === topicIssueId,
          )
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((r) => ({ task_issue_id: r.task_issue_id }));
      }

      return [];
    },
  };

  return {
    ctx: { db: wrapHostFaithfulDb(fake) },
    calls,
    topics,
    messages,
    parents,
    chatTopicTasks,
  };
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

// GAP 5 — the live re-drill saw CHT-1, CHT-11, CHT-111, CHT-1111 because the
// bigint MAX returns as a STRING and `"1" + 1` concatenates. Allocate four
// topics in sequence (inserting each so the next MAX sees it) and assert the
// suffix counts 1, 2, 3, 4 — string concatenation would give 1, 11, 111, 1111.
test('allocateChtNumber counts 1,2,3,4 across sequential creates (GAP 5 — no string concat)', async () => {
  const { ctx } = makeFakeDbCtx();
  const allocated = [];
  for (let i = 0; i < 4; i += 1) {
    const id = await allocateChtNumber(ctx, 'COU');
    allocated.push(id);
    await insertChatTopic(ctx, {
      ...TOPIC,
      topic_id: id,
      issue_id: `issue-seq-${i}`,
    });
  }
  assert.deepEqual(
    allocated,
    ['CHT-1', 'CHT-2', 'CHT-3', 'CHT-4'],
    'sequential allocation must increment numerically, not concatenate strings',
  );
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
// chat_messages — GAP 12 comment-id resolution + agent-comment pin UPSERT
// ---------------------------------------------------------------------------

test('getChatMessageByCommentId returns the row for a known comment_id', async () => {
  const { ctx } = makeFakeDbCtx({ messages: [MSG] });
  const hit = await getChatMessageByCommentId(ctx, 'COU', 'comment-1');
  assert.ok(hit, 'returns a row for a known (company_id, comment_id)');
  assert.equal(hit.message_uuid, 'uuid-aaa');
  // PITFALL #4 — an agent comment has no chat_messages row, so an unknown
  // comment_id resolves to null exactly as it would for an agent reply.
  const miss = await getChatMessageByCommentId(ctx, 'COU', 'comment-AGENT');
  assert.equal(miss, null);
});

test('getChatMessageByCommentId is company-scoped', async () => {
  const { ctx } = makeFakeDbCtx({ messages: [MSG] });
  const wrongCompany = await getChatMessageByCommentId(ctx, 'OTHER', 'comment-1');
  assert.equal(wrongCompany, null);
});

// GAP 12 — pinning an OPERATOR message updates its existing chat_messages row.
test('pinChatMessageByCommentId updates an existing operator-message row', async () => {
  const { ctx, messages } = makeFakeDbCtx({ messages: [{ ...MSG, pinned: false }] });
  const row = await pinChatMessageByCommentId(ctx, 'COU', 'issue-101', 'comment-1', true);
  assert.equal(row.pinned, true);
  assert.equal(messages.length, 1, 'no new row — the existing operator row was updated');
  assert.equal(messages[0].sender_kind, 'user');
  assert.equal(messages[0].pinned, true);
});

// GAP 12 — pinning an AGENT comment (PITFALL #4: no chat_messages row) must
// UPSERT a pin-only row so the pin lands.
test('pinChatMessageByCommentId UPSERTs a pin-only row for an agent comment (GAP 12)', async () => {
  const { ctx, messages } = makeFakeDbCtx({ messages: [] });
  const row = await pinChatMessageByCommentId(
    ctx,
    'COU',
    'issue-101',
    'comment-AGENT',
    true,
  );
  assert.equal(row.pinned, true);
  assert.equal(row.comment_id, 'comment-AGENT');
  assert.equal(row.sender_kind, 'agent', 'an agent-comment pin row is stamped sender_kind=agent');
  assert.equal(messages.length, 1, 'one pin-only row was inserted');
  assert.equal(messages[0].topic_issue_id, 'issue-101');
});

test('pinChatMessageByCommentId on an agent comment is idempotent (ON CONFLICT DO UPDATE)', async () => {
  const { ctx, messages } = makeFakeDbCtx({ messages: [] });
  await pinChatMessageByCommentId(ctx, 'COU', 'issue-101', 'comment-AGENT', true);
  const second = await pinChatMessageByCommentId(ctx, 'COU', 'issue-101', 'comment-AGENT', false);
  assert.equal(messages.length, 1, 'still exactly one row — the conflict updated in place');
  assert.equal(second.pinned, false, 'the re-pin call flipped the flag, not duplicated the row');
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

// ---------------------------------------------------------------------------
// Plan 04.1-05 — D-10 setChatTopicArchived
// ---------------------------------------------------------------------------
//
// Mirrors the updateChatMessagePinned analog (chat-topics-repo.ts:241-253):
// one UPDATE, company-scoped, no read-back. Per the D-10 invariant the
// archive write is plugin-side only — the helper does NOT touch the host
// issue (chat-topic-archive.test.mjs Test 6 pins the no-ctx.issues.update
// invariant at the handler tier).

test('R1: setChatTopicArchived calls execute ONCE with the locked UPDATE SQL and param order', async () => {
  const { ctx, calls } = makeFakeDbCtx({
    topics: [{ ...TOPIC, archived: false }],
  });
  await setChatTopicArchived(ctx, 'COU', 'issue-101', true);
  const writes = calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 1, 'exactly one execute() call');
  const w = writes[0];
  assert.match(
    w.sql,
    /UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i,
    'targets the namespaced chat_topics table',
  );
  assert.match(w.sql, /SET\s+archived\s*=\s*\$1/i, 'SET archived = $1');
  assert.match(
    w.sql,
    /WHERE\s+issue_id\s*=\s*\$2\s+AND\s+company_id\s*=\s*\$3/i,
    'WHERE issue_id = $2 AND company_id = $3 (company-scoped)',
  );
  // Param order: [archived, topicIssueId, companyId].
  assert.deepEqual(w.params, [true, 'issue-101', 'COU']);
});

test('R2: setChatTopicArchived passes the boolean through (true and false both land)', async () => {
  const { ctx, topics } = makeFakeDbCtx({
    topics: [{ ...TOPIC, archived: false }],
  });
  // Archive.
  await setChatTopicArchived(ctx, 'COU', 'issue-101', true);
  assert.equal(topics[0].archived, true, 'archived=true persisted');
  // Un-archive — same shape, false flips back.
  await setChatTopicArchived(ctx, 'COU', 'issue-101', false);
  assert.equal(topics[0].archived, false, 'archived=false persisted (un-archive)');
});

// ---------------------------------------------------------------------------
// Plan 04.1-05 — D-08 chat_topic_tasks side table (Wave 1 lock: REST originId
// filters do not work; this is the steady-state lookup path).
// ---------------------------------------------------------------------------

test('R3: insertChatTopicTask INSERT carries ON CONFLICT DO NOTHING and writes the row', async () => {
  const { ctx, calls, chatTopicTasks } = makeFakeDbCtx();
  await insertChatTopicTask(ctx, 'COU', 'issue-topic-1', 'task-1');
  const insert = calls.find(
    (c) =>
      c.kind === 'execute' &&
      /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i.test(c.sql),
  );
  assert.ok(insert, 'the INSERT was issued via execute');
  assert.match(
    insert.sql,
    /ON CONFLICT[\s\S]*DO NOTHING/i,
    'ON CONFLICT DO NOTHING for race-safety (cross-plan retrofit best-effort)',
  );
  assert.equal(chatTopicTasks.length, 1);
  assert.equal(chatTopicTasks[0].company_id, 'COU');
  assert.equal(chatTopicTasks[0].topic_issue_id, 'issue-topic-1');
  assert.equal(chatTopicTasks[0].task_issue_id, 'task-1');
});

test('R4: insertChatTopicTask on a duplicate (company_id, topic_issue_id, task_issue_id) is a no-op', async () => {
  const { ctx, chatTopicTasks } = makeFakeDbCtx();
  await insertChatTopicTask(ctx, 'COU', 'issue-topic-1', 'task-1');
  await insertChatTopicTask(ctx, 'COU', 'issue-topic-1', 'task-1');
  assert.equal(
    chatTopicTasks.length,
    1,
    'the second insert is a no-op (ON CONFLICT DO NOTHING)',
  );
});

test('R5: listChatTopicTasksForTopic returns task ids ordered newest-first, company+topic scoped', async () => {
  const { ctx } = makeFakeDbCtx({
    chatTopicTasks: [
      {
        id: 1,
        company_id: 'COU',
        topic_issue_id: 'issue-topic-1',
        task_issue_id: 'task-OLD',
        created_at: '2026-05-18T10:00:00Z',
      },
      {
        id: 2,
        company_id: 'COU',
        topic_issue_id: 'issue-topic-1',
        task_issue_id: 'task-NEW',
        created_at: '2026-05-19T10:00:00Z',
      },
      {
        id: 3,
        company_id: 'COU',
        topic_issue_id: 'issue-topic-OTHER',
        task_issue_id: 'task-X',
        created_at: '2026-05-20T10:00:00Z',
      },
      {
        id: 4,
        company_id: 'OTHER-CO',
        topic_issue_id: 'issue-topic-1',
        task_issue_id: 'task-CROSS-CO',
        created_at: '2026-05-20T10:00:00Z',
      },
    ],
  });
  const ids = await listChatTopicTasksForTopic(ctx, 'COU', 'issue-topic-1');
  assert.deepEqual(
    ids,
    ['task-NEW', 'task-OLD'],
    'newest-first; cross-topic and cross-company rows excluded',
  );
});
