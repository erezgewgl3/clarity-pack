// test/worker/chat/chat-stream-bridge.test.mjs
//
// Plan 04-03 Task C RED — the chat stream bridge.
//
// D-08 realtime delivery: the worker subscribes ctx.events.on(
// 'issue.comment.created'), and for events on a CHAT TOPIC issue re-emits onto
// a per-company plugin SSE channel `chat:<companyId>` via ctx.streams.emit.
// The UI consumes the relayed channel via usePluginStream.
//
//   - An event on an issue that IS a chat topic (getChatTopicByIssueId returns
//     a row) emits on channel `chat:<companyId>`.
//   - An event on a non-chat issue does NOT emit (T-04-11 — the bridge relays
//     only chat-topic comments).
//   - A null entityId or companyId is guarded — no emit, no throw.
//   - 04-01-SPIKE-FINDINGS OQ-2: the comment-event payload is opaque, so the
//     bridge re-fetches via ctx.issues.listComments and emits the newest
//     comment id (RESEARCH Assumption A1).
//   - A throwing handler body never crashes the worker (T-04-12).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatStreamBridge } from '../../../src/worker/streams/chat-stream-bridge.ts';
import { invalidateOptedInCache } from '../../../src/worker/opted-in-company-set.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// makeCtx captures ctx.events.on subscriptions and ctx.streams.emit calls.
// `chatTopicIssueIds` is the set of issue ids that getChatTopicByIssueId
// treats as chat topics. `comments` is what ctx.issues.listComments returns.
// `listCommentsThrows` makes the re-fetch fail.
//
// Phase 16.1 Plan 16.1-03: the bridge now scope-gates on the opted-in-company
// set (L-5 disposition #2). The bridge's seed runs two pure plugin-namespace
// SELECTs (clarity_user_prefs -> opted-in user_ids, clarity_agent_owners ->
// company_ids). To exercise the EMIT path the test must opt the event company
// in; `optedInCompanyIds` drives those two seed queries. Each test invalidates
// the module-level set first so the seed re-reads against THIS ctx's db.
function makeCtx({
  chatTopicIssueIds = [],
  comments = [],
  listCommentsThrows = false,
  optedInCompanyIds = ['co-1'],
} = {}) {
  const subscriptions = new Map();
  const emitCalls = [];
  const topicSet = new Set(chatTopicIssueIds);
  const optedInSet = new Set(optedInCompanyIds);

  const ctx = {
    logger: { warn() {}, info() {} },
    events: {
      on(name, fn) {
        subscriptions.set(name, fn);
        return () => subscriptions.delete(name);
      },
    },
    streams: {
      open() {},
      emit(channel, event) {
        emitCalls.push({ channel, event });
      },
      close() {},
    },
    issues: {
      async listComments() {
        if (listCommentsThrows) throw new Error('host listComments 503');
        return comments;
      },
    },
    db: {
      async query(sql, params) {
        if (/chat_topics/i.test(sql)) {
          // getChatTopicByIssueId: WHERE company_id = $1 AND issue_id = $2
          const issueId = params?.[1];
          return topicSet.has(issueId)
            ? [{ topic_id: 'CHT-1', company_id: params[0], issue_id: issueId }]
            : [];
        }
        // opted-in-company-set lazy seed (Plan 16.1-03).
        if (/clarity_user_prefs/i.test(sql)) {
          // One synthetic opted-in user per opted-in company.
          return Array.from(optedInSet).map((_, i) => ({ user_id: `u-${i}` }));
        }
        if (/clarity_agent_owners/i.test(sql)) {
          return Array.from(optedInSet).map((company_id) => ({ company_id }));
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _subscriptions: subscriptions,
    _emitCalls: emitCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

// The opted-in-company set is module-level state; reset it before each test so
// each test's ctx.db drives a fresh lazy seed.
test.beforeEach(() => invalidateOptedInCache());

function commentEvent(overrides = {}) {
  return {
    eventId: 'evt-1',
    eventType: 'issue.comment.created',
    occurredAt: '2026-05-18T21:00:00.000Z',
    entityId: 'issue-topic-1',
    entityType: 'issue',
    companyId: 'co-1',
    ...overrides,
  };
}

test('chat-stream-bridge: subscribes to issue.comment.created', () => {
  const ctx = makeCtx();
  registerChatStreamBridge(ctx);
  assert.ok(ctx._subscriptions.has('issue.comment.created'));
});

test('chat-stream-bridge: a comment on a chat topic emits on chat:<companyId>', async () => {
  const ctx = makeCtx({
    chatTopicIssueIds: ['issue-topic-1'],
    comments: [
      { id: 'c-1', issueId: 'issue-topic-1', createdAt: '2026-05-18T20:00:00.000Z' },
      { id: 'c-2', issueId: 'issue-topic-1', createdAt: '2026-05-18T21:00:00.000Z' },
    ],
  });
  registerChatStreamBridge(ctx);
  await ctx._subscriptions.get('issue.comment.created')(commentEvent());

  assert.equal(ctx._emitCalls.length, 1);
  assert.equal(ctx._emitCalls[0].channel, 'chat:co-1');
  assert.equal(ctx._emitCalls[0].event.type, 'comment.created');
  assert.equal(ctx._emitCalls[0].event.issueId, 'issue-topic-1');
});

test('chat-stream-bridge: OQ-2 opaque payload — emits the newest comment id via listComments re-fetch', async () => {
  const ctx = makeCtx({
    chatTopicIssueIds: ['issue-topic-1'],
    comments: [
      { id: 'c-old', issueId: 'issue-topic-1', createdAt: '2026-05-18T20:00:00.000Z' },
      { id: 'c-new', issueId: 'issue-topic-1', createdAt: '2026-05-18T21:00:00.000Z' },
    ],
  });
  registerChatStreamBridge(ctx);
  await ctx._subscriptions.get('issue.comment.created')(commentEvent());
  assert.equal(ctx._emitCalls[0].event.commentId, 'c-new');
});

test('chat-stream-bridge: a comment on a NON-chat issue does NOT emit (T-04-11)', async () => {
  const ctx = makeCtx({ chatTopicIssueIds: [] });
  registerChatStreamBridge(ctx);
  await ctx._subscriptions.get('issue.comment.created')(commentEvent());
  assert.equal(ctx._emitCalls.length, 0);
});

test('chat-stream-bridge: null entityId is guarded — no emit, no throw', async () => {
  const ctx = makeCtx({ chatTopicIssueIds: ['issue-topic-1'] });
  registerChatStreamBridge(ctx);
  await ctx._subscriptions.get('issue.comment.created')(commentEvent({ entityId: undefined }));
  assert.equal(ctx._emitCalls.length, 0);
});

test('chat-stream-bridge: null companyId is guarded — no emit, no throw', async () => {
  const ctx = makeCtx({ chatTopicIssueIds: ['issue-topic-1'] });
  registerChatStreamBridge(ctx);
  await ctx._subscriptions.get('issue.comment.created')(commentEvent({ companyId: undefined }));
  assert.equal(ctx._emitCalls.length, 0);
});

test('chat-stream-bridge: a throwing listComments never crashes the worker (T-04-12)', async () => {
  const ctx = makeCtx({ chatTopicIssueIds: ['issue-topic-1'], listCommentsThrows: true });
  registerChatStreamBridge(ctx);
  // The handler must swallow the error — await must not reject.
  await ctx._subscriptions.get('issue.comment.created')(commentEvent());
  assert.equal(ctx._emitCalls.length, 0);
});
