// test/worker/chat/chat-promote.test.mjs
//
// Plan 04-04 Task B RED — chat.promote action handler (CHAT-09 / D-13).
//
// chat.promote turns a chat message into a real Paperclip task issue:
//   - The source message is looked up via getChatMessageByUuid → its
//     comment_id, then the comment body via ctx.issues.listComments on the
//     topic issue.
//   - ctx.issues.create makes a real issue pre-filled from the message body,
//     linked back to the topic issue via parentId (D-13).
//   - Returns the new issue id.
//
// Ownership re-check (T-04-16): a message the caller cannot see — an unknown
// message_uuid, or one in another company — returns { error: 'NOT_FOUND' } /
// { error: 'NOT_OWNED' }. getChatMessageByUuid is company-scoped, so a
// cross-company uuid simply does not resolve.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatPromote } from '../../../src/worker/handlers/chat-promote.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  chatMessages = [],
  comments = [],
  createIssueThrows = false,
} = {}) {
  const handlers = new Map();
  const createdIssues = [];
  const messageStore = new Map(chatMessages.map((r) => [r.message_uuid, r]));

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async create(input) {
        if (createIssueThrows) throw new Error('host issues.create 503');
        const id = `issue-new-${createdIssues.length + 1}`;
        const row = { id, ...input };
        createdIssues.push(row);
        return row;
      },
      async listComments(issueId, companyId) {
        void issueId;
        void companyId;
        return comments;
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
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _createdIssues: createdIssues,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

const SEEDED_MESSAGE = {
  message_uuid: 'uuid-msg-1',
  company_id: 'co-1',
  topic_issue_id: 'issue-topic-1',
  comment_id: 'c-1',
  sender_kind: 'user',
  supersedes_uuid: null,
  pinned: false,
  sent_at: '2026-01-01T00:00:00.000Z',
};

function promoteParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    messageUuid: 'uuid-msg-1',
    ...overrides,
  };
}

test('chat.promote: handler registers under key chat.promote', () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  assert.ok(ctx._handlers.has('chat.promote'));
});

test('chat.promote: creates a real issue pre-filled from the message body, linked to the topic', async () => {
  const ctx = makeCtx({
    chatMessages: [SEEDED_MESSAGE],
    comments: [{ id: 'c-1', body: 'Ship the pricing page by Friday' }],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());

  assert.equal(ctx._createdIssues.length, 1);
  const issue = ctx._createdIssues[0];
  // pre-filled from the message body
  assert.match(issue.title + (issue.description ?? ''), /pricing page/i);
  // linked back to the topic issue (D-13)
  assert.equal(issue.parentId, 'issue-topic-1');
  assert.equal(result.ok, true);
  assert.equal(result.issueId, issue.id);
});

test('chat.promote: unknown messageUuid → { error: NOT_FOUND }, no issue created', async () => {
  const ctx = makeCtx({ chatMessages: [] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: a message from another company does not resolve → NOT_FOUND', async () => {
  // The seeded message is company co-1; the caller queries as co-OTHER.
  const ctx = makeCtx({
    chatMessages: [SEEDED_MESSAGE],
    comments: [{ id: 'c-1', body: 'cross-company' }],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(
    promoteParams({ companyId: 'co-OTHER' }),
  );
  // getChatMessageByUuid is WHERE message_uuid=$1 AND company_id=$2 — a
  // mismatched company yields no row.
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: source comment not found in the thread → { error: NOT_FOUND }', async () => {
  const ctx = makeCtx({
    chatMessages: [SEEDED_MESSAGE],
    comments: [{ id: 'c-OTHER', body: 'a different comment' }],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
});

test('chat.promote: missing messageUuid → throws (action-handler convention)', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const params = promoteParams();
  delete params.messageUuid;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(params),
    /messageUuid/i,
  );
});

test('chat.promote: missing companyId → throws', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const params = promoteParams();
  delete params.companyId;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(params),
    /companyId/i,
  );
});

test('chat.promote: opted-out caller → OPT_IN_REQUIRED, no issue created', async () => {
  const ctx = makeCtx({ optedIn: false, chatMessages: [SEEDED_MESSAGE] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: issues.create failure → { error: PROMOTE_FAILED }', async () => {
  const ctx = makeCtx({
    chatMessages: [SEEDED_MESSAGE],
    comments: [{ id: 'c-1', body: 'something' }],
    createIssueThrows: true,
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'PROMOTE_FAILED');
});
