// test/worker/chat/chat-messages.test.mjs
//
// Plan 04-04 Task A RED — chat.messages data handler.
//
// chat.messages returns the message thread for one topic issue:
//   - ctx.issues.listComments(topicIssueId, companyId) is the canonical body
//     source (CHAT-02 — content lives only in public.issue_comments).
//   - chat_messages rows (the side table) are JOINed in for supersedes / pin
//     metadata.
//   - The thread is ORDERED by the SERVER-side comment created_at — never a
//     client-supplied time (PITFALLS 11.4).
//   - A comment that has been superseded (D-11 / CHAT-05 edit chain) is marked
//     so the UI can collapse the edit chain.
//   - Missing companyId returns { error: 'COMPANY_ID_REQUIRED' }; missing
//     topicIssueId returns { error: 'TOPIC_ISSUE_ID_REQUIRED' }.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatMessages } from '../../../src/worker/handlers/chat-messages.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  comments = [],
  chatMessages = [],
  listCommentsThrows = false,
} = {}) {
  const handlers = new Map();

  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async listComments(issueId, companyId) {
        void issueId;
        void companyId;
        if (listCommentsThrows) throw new Error('host listComments 503');
        return comments;
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/chat_messages/i.test(sql)) {
          // listChatMessagesForTopic: WHERE topic_issue_id = $1 AND company_id = $2
          const topicIssueId = params?.[0];
          return chatMessages.filter((r) => r.topic_issue_id === topicIssueId);
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function msgParams(overrides = {}) {
  return {
    topicIssueId: 'issue-topic-1',
    companyId: 'co-1',
    userId: 'user-eric',
    ...overrides,
  };
}

test('chat.messages: handler registers under key chat.messages', () => {
  const ctx = makeCtx();
  registerChatMessages(ctx);
  assert.ok(ctx._handlers.has('chat.messages'));
});

test('chat.messages: returns the comment thread ordered by server created_at', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-2', body: 'second', createdAt: new Date('2026-01-02T00:00:00Z'), authorUserId: 'user-eric' },
      { id: 'c-1', body: 'first', createdAt: new Date('2026-01-01T00:00:00Z'), authorUserId: 'user-eric' },
      { id: 'c-3', body: 'third', createdAt: new Date('2026-01-03T00:00:00Z'), authorUserId: 'user-eric' },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.kind, 'messages');
  assert.deepEqual(
    result.messages.map((m) => m.commentId),
    ['c-1', 'c-2', 'c-3'],
    'thread must be ordered by server-side created_at ascending (PITFALLS 11.4)',
  );
});

test('chat.messages: a superseded comment is marked so the UI can collapse the edit chain (CHAT-05)', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-1', body: 'typo', createdAt: new Date('2026-01-01T00:00:00Z'), authorUserId: 'user-eric' },
      { id: 'c-2', body: 'fixed', createdAt: new Date('2026-01-02T00:00:00Z'), authorUserId: 'user-eric' },
    ],
    chatMessages: [
      {
        message_uuid: 'uuid-orig',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
      {
        message_uuid: 'uuid-edit',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-2',
        sender_kind: 'user',
        supersedes_uuid: 'uuid-orig',
        pinned: false,
        sent_at: '2026-01-02T00:00:00.000Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  const orig = result.messages.find((m) => m.commentId === 'c-1');
  const edit = result.messages.find((m) => m.commentId === 'c-2');
  assert.equal(orig.superseded, true, 'the original comment is marked superseded');
  assert.equal(edit.superseded, false, 'the superseding comment is the live one');
  assert.equal(edit.supersedesUuid, 'uuid-orig');
});

test('chat.messages: pin flag from the side table surfaces on the message', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-1', body: 'pinned note', createdAt: new Date('2026-01-01T00:00:00Z') },
    ],
    chatMessages: [
      {
        message_uuid: 'u-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: true,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.messages[0].pinned, true);
});

// GAP 10 — sender identity. PITFALL #3: ctx.issues.createComment posts the
// comment as the plugin WORKER, so an operator-sent comment comes back from
// listComments with an EMPTY authorUserId. The UI must derive "is this mine"
// from the chat_messages side-table sender_kind, NOT authorUserId — so the
// handler MUST surface senderKind reliably. This test models the live host:
// the operator comment has no authorUserId, but its chat_messages row carries
// sender_kind='user'; an agent comment has neither.
test('chat.messages: surfaces senderKind from the side table — operator vs agent (GAP 10)', async () => {
  const ctx = makeCtx({
    comments: [
      // operator message — host stamped NO authorUserId (posted as the worker)
      { id: 'c-op', body: 'hello from Eric', createdAt: new Date('2026-01-01T00:00:00Z'), authorUserId: null },
      // agent reply — no chat_messages row at all
      { id: 'c-agent', body: 'reply from the agent', createdAt: new Date('2026-01-02T00:00:00Z'), authorUserId: null },
    ],
    chatMessages: [
      {
        message_uuid: 'u-op',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-op',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  const op = result.messages.find((m) => m.commentId === 'c-op');
  const agent = result.messages.find((m) => m.commentId === 'c-agent');
  // the operator message's identity comes ONLY from sender_kind — its
  // authorUserId is empty, so any authorUserId-based test would mislabel it.
  assert.equal(op.senderKind, 'user', 'an operator message reports senderKind=user');
  assert.equal(op.authorUserId, null, 'PITFALL #3 — operator comment has empty authorUserId');
  // the agent reply has no side-table row → senderKind null (stays "Agent").
  assert.equal(agent.senderKind, null, 'an agent comment has no chat_messages row → senderKind null');
});

test('chat.messages: missing companyId → { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatMessages(ctx);
  const params = msgParams();
  delete params.companyId;
  const result = await ctx._handlers.get('chat.messages')(params);
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.messages: missing topicIssueId → { error: TOPIC_ISSUE_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatMessages(ctx);
  const params = msgParams();
  delete params.topicIssueId;
  const result = await ctx._handlers.get('chat.messages')(params);
  assert.equal(result.error, 'TOPIC_ISSUE_ID_REQUIRED');
});

test('chat.messages: opted-out caller → OPT_IN_REQUIRED', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('chat.messages: listComments failure → { error: THREAD_FAILED }', async () => {
  const ctx = makeCtx({ listCommentsThrows: true });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.error, 'THREAD_FAILED');
});
