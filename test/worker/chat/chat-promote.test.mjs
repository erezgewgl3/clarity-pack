// test/worker/chat/chat-promote.test.mjs
//
// Plan 04-04 Task B / 04-05 host-contract audit — chat.promote (CHAT-09 / D-13).
//
// GAP 12 audit fix. chat.promote turns a chat message into a real Paperclip
// task issue. The promote button sits on AGENT messages, and PITFALL #4 says
// the chat_messages side table is operator-write-only — an agent comment has
// NO chat_messages row. The reworked handler therefore takes `commentId` +
// `topicIssueId` and resolves the comment STRAIGHT from the topic thread via
// ctx.issues.listComments — there is NO getChatMessageByUuid dependency. These
// tests model an agent comment host-faithfully: it appears in listComments but
// has no chat_messages row, and promote must still succeed.
//
// Ownership scoping (T-04-16): ctx.issues.listComments is company-scoped by the
// host. A comment id not present in the named topic thread → { error: NOT_FOUND }.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatPromote } from '../../../src/worker/handlers/chat-promote.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  comments = [],
  createIssueThrows = false,
  listCommentsThrows = false,
} = {}) {
  const handlers = new Map();
  const createdIssues = [];

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
        if (listCommentsThrows) throw new Error('host listComments 503');
        return comments;
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
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

function promoteParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    commentId: 'c-agent-1',
    topicIssueId: 'issue-topic-1',
    ...overrides,
  };
}

test('chat.promote: handler registers under key chat.promote', () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  assert.ok(ctx._handlers.has('chat.promote'));
});

// GAP 12 — the message being promoted is an AGENT comment: it is present in
// the topic thread but has NO chat_messages row. The old getChatMessageByUuid
// path could never resolve it; resolving by commentId straight from the thread
// must succeed.
test('chat.promote: promotes an AGENT comment (no chat_messages row) — GAP 12', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-agent-1', body: 'Ship the pricing page by Friday' },
      { id: 'c-other', body: 'unrelated' },
    ],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());

  assert.equal(ctx._createdIssues.length, 1);
  const issue = ctx._createdIssues[0];
  // pre-filled from the agent comment body
  assert.match(issue.title + (issue.description ?? ''), /pricing page/i);
  // linked back to the topic issue (D-13)
  assert.equal(issue.parentId, 'issue-topic-1');
  assert.equal(result.ok, true);
  assert.equal(result.issueId, issue.id);
  assert.equal(result.topicIssueId, 'issue-topic-1');
});

test('chat.promote: comment id not in the topic thread → { error: NOT_FOUND }', async () => {
  const ctx = makeCtx({ comments: [{ id: 'c-different', body: 'a different comment' }] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: listComments failure → { error: NOT_FOUND }, no issue created', async () => {
  const ctx = makeCtx({ listCommentsThrows: true });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: missing commentId → throws (action-handler convention)', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const params = promoteParams();
  delete params.commentId;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(params),
    /commentId/i,
  );
});

test('chat.promote: missing topicIssueId → throws', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const params = promoteParams();
  delete params.topicIssueId;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(params),
    /topicIssueId/i,
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
  const ctx = makeCtx({ optedIn: false, comments: [{ id: 'c-agent-1', body: 'x' }] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.promote: issues.create failure → { error: PROMOTE_FAILED }', async () => {
  const ctx = makeCtx({
    comments: [{ id: 'c-agent-1', body: 'something' }],
    createIssueThrows: true,
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'PROMOTE_FAILED');
});
