// test/worker/chat/chat-send.test.mjs
//
// Plan 04-03 Task A RED — chat.send action handler.
//
// chat.send is the canonical-write path for an outgoing chat message:
//   1. Dedup on message_uuid — a resend returns the original comment_id
//      WITHOUT re-posting (CHAT-06 / D-10 idempotent replay).
//   2. createComment writes the message to public.issue_comments (CHAT-02 —
//      message content lives ONLY in the host comment table).
//   3. insertChatMessage records the message_uuid -> comment_id map.
//   4. Auto-reopen (D-06): a 'done' topic is flipped to 'in_progress' so the
//      assigned agent wakes. Per 04-01-SPIKE-FINDINGS OQ-3
//      (STATUS-FLIP-NOT-NEEDED) the status flip is for UX/status correctness
//      only — requestWakeup is NOT called; a comment alone wakes the agent.
//   5. A createComment host failure returns { error: 'SEND_FAILED' } and does
//      NOT insert a chat_messages row (no orphan map entry).
//
// Wrapped via opt-in-guard's wrapActionHandler — an opted-out caller gets
// { error: 'OPT_IN_REQUIRED' } before the inner handler runs (T-04-08).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatSend } from '../../../src/worker/handlers/chat-send.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// makeCtx wires an in-memory ctx. `chatMessages` seeds the chat_messages side
// table (keyed by message_uuid). `issueStatus` is the status of the topic
// issue that ctx.issues.get returns. `createCommentFails` makes createComment
// throw (host failure path).
function makeCtx({
  optedIn = true,
  chatMessages = [],
  issueStatus = 'in_progress',
  createCommentFails = false,
} = {}) {
  const handlers = new Map();
  const createCommentCalls = [];
  const updateCalls = [];
  const wakeupCalls = [];
  const insertedMessages = [];
  // chat_messages rows, keyed by message_uuid.
  const messageStore = new Map(chatMessages.map((r) => [r.message_uuid, r]));

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get(issueId, companyId) {
        return { id: issueId, companyId, status: issueStatus };
      },
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        if (createCommentFails) throw new Error('host createComment 503');
        return { id: `comment-${createCommentCalls.length}`, issueId, body, companyId };
      },
      async update(issueId, patch, companyId) {
        updateCalls.push({ issueId, patch, companyId });
        return { id: issueId };
      },
      async requestWakeup(issueId, companyId) {
        wakeupCalls.push({ issueId, companyId });
        return { ok: true };
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/chat_messages/i.test(sql)) {
          // getChatMessageByUuid: WHERE message_uuid = $1 AND company_id = $2
          const uuid = params?.[0];
          const row = messageStore.get(uuid);
          return row ? [row] : [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT INTO .*chat_messages/i.test(sql)) {
          const row = {
            message_uuid: params[0],
            company_id: params[1],
            topic_issue_id: params[2],
            comment_id: params[3],
            sender_kind: params[4],
            supersedes_uuid: params[5],
            pinned: params[6],
            sent_at: params[7],
          };
          insertedMessages.push(row);
          if (!messageStore.has(row.message_uuid)) messageStore.set(row.message_uuid, row);
        }
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _createCommentCalls: createCommentCalls,
    _updateCalls: updateCalls,
    _wakeupCalls: wakeupCalls,
    _insertedMessages: insertedMessages,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function sendParams(overrides = {}) {
  return {
    topicIssueId: 'issue-topic-1',
    body: 'Hello from Eric',
    messageUuid: 'uuid-fresh-1',
    companyId: 'co-1',
    userId: 'user-eric',
    ...overrides,
  };
}

test('chat.send: handler registers under key chat.send', () => {
  const ctx = makeCtx();
  registerChatSend(ctx);
  assert.ok(ctx._handlers.has('chat.send'));
});

test('chat.send: fresh message_uuid → createComment + chat_messages insert, returns commentId', async () => {
  const ctx = makeCtx();
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());

  assert.equal(ctx._createCommentCalls.length, 1);
  assert.equal(ctx._createCommentCalls[0].issueId, 'issue-topic-1');
  assert.equal(ctx._createCommentCalls[0].body, 'Hello from Eric');
  assert.equal(ctx._insertedMessages.length, 1);
  assert.equal(ctx._insertedMessages[0].message_uuid, 'uuid-fresh-1');
  assert.equal(ctx._insertedMessages[0].comment_id, 'comment-1');
  assert.equal(ctx._insertedMessages[0].sender_kind, 'user');
  assert.equal(ctx._insertedMessages[0].supersedes_uuid, null);
  assert.equal(result.ok, true);
  assert.equal(result.commentId, 'comment-1');
});

test('chat.send: resend with stored message_uuid is idempotent — no second createComment (CHAT-06)', async () => {
  const ctx = makeCtx({
    chatMessages: [
      {
        message_uuid: 'uuid-fresh-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'comment-existing',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());

  assert.equal(ctx._createCommentCalls.length, 0, 'createComment must not be called on a replay');
  assert.equal(ctx._insertedMessages.length, 0, 'no new chat_messages insert on a replay');
  assert.equal(result.ok, true);
  assert.equal(result.commentId, 'comment-existing');
});

test('chat.send: sending to a done topic auto-reopens it to in_progress (D-06)', async () => {
  const ctx = makeCtx({ issueStatus: 'done' });
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());

  assert.equal(ctx._updateCalls.length, 1);
  assert.equal(ctx._updateCalls[0].issueId, 'issue-topic-1');
  assert.equal(ctx._updateCalls[0].patch.status, 'in_progress');
});

test('chat.send: OQ-3 STATUS-FLIP-NOT-NEEDED — requestWakeup is NOT called on auto-reopen', async () => {
  const ctx = makeCtx({ issueStatus: 'done' });
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());

  assert.equal(
    ctx._wakeupCalls.length,
    0,
    '04-01-SPIKE-FINDINGS OQ-3: a comment alone wakes the agent — no requestWakeup',
  );
});

test('chat.send: in_progress topic is NOT updated (no needless flip)', async () => {
  const ctx = makeCtx({ issueStatus: 'in_progress' });
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());
  assert.equal(ctx._updateCalls.length, 0);
});

test('chat.send: createComment host failure → { error: SEND_FAILED }, no orphan chat_messages row', async () => {
  const ctx = makeCtx({ createCommentFails: true });
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());

  assert.equal(result.error, 'SEND_FAILED');
  assert.equal(ctx._insertedMessages.length, 0, 'no side-table insert when the comment never landed');
});

test('chat.send: opted-out caller → OPT_IN_REQUIRED, no createComment (T-04-08)', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createCommentCalls.length, 0);
});

// topicIssueId / body / messageUuid / companyId reach the inner handler and
// THROW per the action-handler convention. userId is consumed by the
// opt-in-guard wrapper FIRST — a missing userId is treated as opted-out and
// short-circuits with { error: 'OPT_IN_REQUIRED' } before the inner handler
// runs (opt-in-guard.ts extractUserId), so it never reaches the throw path.
for (const missing of ['topicIssueId', 'body', 'messageUuid', 'companyId']) {
  test(`chat.send: missing ${missing} → throws (action-handler convention)`, async () => {
    const ctx = makeCtx();
    registerChatSend(ctx);
    const params = sendParams();
    delete params[missing];
    await assert.rejects(() => ctx._handlers.get('chat.send')(params), new RegExp(missing, 'i'));
  });
}

test('chat.send: missing userId → OPT_IN_REQUIRED (opt-in-guard short-circuit)', async () => {
  const ctx = makeCtx();
  registerChatSend(ctx);
  const params = sendParams();
  delete params.userId;
  const result = await ctx._handlers.get('chat.send')(params);
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createCommentCalls.length, 0);
});
