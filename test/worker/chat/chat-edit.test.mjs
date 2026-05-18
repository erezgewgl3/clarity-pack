// test/worker/chat/chat-edit.test.mjs
//
// Plan 04-03 Task B RED — chat.edit action handler.
//
// Paperclip exposes issue.comment.created but NO issue.comment.updated event —
// comments are append-only at the host (D-11, CHAT-05). An "edit" therefore
// writes a NEW comment carrying a supersedes link to the prior message; the
// original comment is NEVER mutated.
//
//   - An edit creates a new comment (the edited body) and inserts a
//     chat_messages row whose supersedes_uuid points at the prior message_uuid.
//   - Server-side ownership re-check (T-04-09 / ASVS V4): the prior message
//     must exist and have sender_kind === 'user'. Editing an agent message —
//     or a non-existent message — returns { error: 'NOT_OWNED' }.
//   - The original comment is never updated (no ctx.issues.update call).
//
// Wrapped via opt-in-guard's wrapActionHandler.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatEdit } from '../../../src/worker/handlers/chat-edit.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true, priorMessage = null } = {}) {
  const handlers = new Map();
  const createCommentCalls = [];
  const updateCalls = [];
  const insertedMessages = [];
  const messageStore = new Map();
  if (priorMessage) messageStore.set(priorMessage.message_uuid, priorMessage);

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        return { id: `comment-edit-${createCommentCalls.length}`, issueId, body, companyId };
      },
      async update(issueId, patch, companyId) {
        updateCalls.push({ issueId, patch, companyId });
        return { id: issueId };
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/chat_messages/i.test(sql)) {
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
    _insertedMessages: insertedMessages,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

const userPriorMessage = {
  message_uuid: 'uuid-prior',
  company_id: 'co-1',
  topic_issue_id: 'issue-topic-1',
  comment_id: 'comment-orig',
  sender_kind: 'user',
  supersedes_uuid: null,
  pinned: false,
  sent_at: '2026-01-01T00:00:00.000Z',
};

function editParams(overrides = {}) {
  return {
    topicIssueId: 'issue-topic-1',
    priorMessageUuid: 'uuid-prior',
    newMessageUuid: 'uuid-edit',
    newBody: 'Hello — corrected',
    companyId: 'co-1',
    userId: 'user-eric',
    ...overrides,
  };
}

test('chat.edit: handler registers under key chat.edit', () => {
  const ctx = makeCtx();
  registerChatEdit(ctx);
  assert.ok(ctx._handlers.has('chat.edit'));
});

test('chat.edit: edit creates a NEW comment and inserts a chat_messages row with supersedes_uuid (D-11)', async () => {
  const ctx = makeCtx({ priorMessage: userPriorMessage });
  registerChatEdit(ctx);
  const result = await ctx._handlers.get('chat.edit')(editParams());

  assert.equal(ctx._createCommentCalls.length, 1);
  assert.equal(ctx._createCommentCalls[0].body, 'Hello — corrected');
  assert.equal(ctx._insertedMessages.length, 1);
  assert.equal(ctx._insertedMessages[0].message_uuid, 'uuid-edit');
  assert.equal(ctx._insertedMessages[0].supersedes_uuid, 'uuid-prior');
  assert.equal(ctx._insertedMessages[0].sender_kind, 'user');
  assert.equal(result.ok, true);
});

test('chat.edit: the original comment is NEVER mutated (append-only, CHAT-05)', async () => {
  const ctx = makeCtx({ priorMessage: userPriorMessage });
  registerChatEdit(ctx);
  await ctx._handlers.get('chat.edit')(editParams());
  assert.equal(ctx._updateCalls.length, 0, 'no issues.update — comments are append-only');
});

test('chat.edit: editing an agent message → NOT_OWNED, no new comment (T-04-09)', async () => {
  const ctx = makeCtx({
    priorMessage: { ...userPriorMessage, sender_kind: 'agent' },
  });
  registerChatEdit(ctx);
  const result = await ctx._handlers.get('chat.edit')(editParams());
  assert.equal(result.error, 'NOT_OWNED');
  assert.equal(ctx._createCommentCalls.length, 0);
  assert.equal(ctx._insertedMessages.length, 0);
});

test('chat.edit: editing a non-existent prior message → NOT_OWNED', async () => {
  const ctx = makeCtx({ priorMessage: null });
  registerChatEdit(ctx);
  const result = await ctx._handlers.get('chat.edit')(editParams());
  assert.equal(result.error, 'NOT_OWNED');
  assert.equal(ctx._createCommentCalls.length, 0);
});

test('chat.edit: opted-out caller → OPT_IN_REQUIRED, no createComment', async () => {
  const ctx = makeCtx({ optedIn: false, priorMessage: userPriorMessage });
  registerChatEdit(ctx);
  const result = await ctx._handlers.get('chat.edit')(editParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createCommentCalls.length, 0);
});

for (const missing of ['topicIssueId', 'priorMessageUuid', 'newMessageUuid', 'newBody', 'companyId']) {
  test(`chat.edit: missing ${missing} → throws (action-handler convention)`, async () => {
    const ctx = makeCtx({ priorMessage: userPriorMessage });
    registerChatEdit(ctx);
    const params = editParams();
    delete params[missing];
    await assert.rejects(() => ctx._handlers.get('chat.edit')(params), new RegExp(missing, 'i'));
  });
}
