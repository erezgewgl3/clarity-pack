// test/worker/chat/chat-send.test.mjs
//
// Plan 04-03 Task A RED — chat.send action handler.
// Plan 04.1-03 Task 2 — auto-reopen REPLACED with ensureTopicWakeable.
//
// chat.send is the canonical-write path for an outgoing chat message:
//   1. Dedup on message_uuid — a resend returns the original comment_id
//      WITHOUT re-posting (CHAT-06 / D-10 idempotent replay).
//   2. createComment writes the message to public.issue_comments (CHAT-02 —
//      message content lives ONLY in the host comment table).
//   3. insertChatMessage records the message_uuid -> comment_id map.
//   4. D-09 / D-11 — ensureTopicWakeable(ctx, topicIssueId, companyId) runs
//      fire-and-forget after the comment lands. The shared helper REPLACES the
//      prior inline auto-reopen block: it flips terminal/blocked status off
//      (towards in_progress). Per 04.1-01-SPIKE-FINDINGS PROBE-OQ3 PASS-NATIVE
//      multi-turn native re-wake works (REST surface returns 404) — the
//      helper does NOT call requestWakeup. A slow / failing watchdog never
//      delays or fails the send.
//   5. A createComment host failure returns { error: 'SEND_FAILED' } and does
//      NOT insert a chat_messages row (no orphan map entry). The watchdog is
//      NOT invoked when the comment never landed.
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
// throw (host failure path). `getDelayMs` slows down ctx.issues.get to prove
// fire-and-forget — chat.send must resolve before the slow get completes.
function makeCtx({
  optedIn = true,
  chatMessages = [],
  issueStatus = 'in_progress',
  createCommentFails = false,
  getDelayMs = 0,
  wakeupFails = false,
} = {}) {
  const handlers = new Map();
  const createCommentCalls = [];
  const getCalls = [];
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
        getCalls.push({ issueId, companyId, at: Date.now() });
        if (getDelayMs > 0) {
          await new Promise((r) => setTimeout(r, getDelayMs));
        }
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
      async requestWakeup(issueId, companyId, opts) {
        wakeupCalls.push({ issueId, companyId, opts });
        if (wakeupFails) throw new Error('host requestWakeup 503');
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
    _getCalls: getCalls,
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

test('chat.send: sending to a done topic logs hint and does NOT call issues.update (rc.8 CTT-07)', async () => {
  // rc.8 hotfix 2026-05-26: the watchdog NO LONGER calls ctx.issues.update.
  // CTT-07 invariant — plugin actions NEVER mutate public.issues.updated_at.
  // The host's disposition-recovery is the rightful owner of restoration.
  const ctx = makeCtx({ issueStatus: 'done' });
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());

  // The watchdog is fire-and-forget — wait a tick for it to run.
  await new Promise((r) => setImmediate(r));

  assert.equal(ctx._updateCalls.length, 0, 'CTT-07: zero issues.update calls');
});

test('chat.send: ACTIVE WAKE — requestWakeup IS called for the topic with messageUuid as the idempotency key (2026-05-29 usability fix)', async () => {
  // SUPERSEDES the prior "requestWakeup NEVER called" guard. The Phase 4.1
  // PROBE-OQ3 "native wake suffices" conclusion did NOT hold on
  // paperclipai@2026.525.0 — idle agents never ran, so the operator's chat
  // message got no reply (the whole point of chat). chat.send now explicitly
  // wakes the topic's assignee (requestWakeup works in this valid ACTION scope;
  // it only fails in the dead scheduled-job scope). One wake per fresh send,
  // keyed by messageUuid so a CHAT-06 resend never double-wakes.
  const ctx = makeCtx();
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx._wakeupCalls.length, 1, 'chat.send must actively wake the assignee on a fresh send');
  assert.equal(ctx._wakeupCalls[0].issueId, 'issue-topic-1');
  assert.equal(
    ctx._wakeupCalls[0].opts?.idempotencyKey,
    'uuid-fresh-1',
    'idempotencyKey must be the messageUuid so a resend never double-wakes',
  );
});

test('chat.send: a requestWakeup failure is NON-FATAL — the send still succeeds (comment already persisted)', async () => {
  const ctx = makeCtx({ wakeupFails: true });
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());
  assert.equal(result.ok, true, 'a wake failure must not fail the send');
  assert.equal(result.commentId, 'comment-1');
  assert.equal(ctx._insertedMessages.length, 1, 'the message is still persisted on a wake failure');
});

test('chat.send: a resend (replay) does NOT wake again — dedup returns before the wake (CHAT-06)', async () => {
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
  await ctx._handlers.get('chat.send')(sendParams());
  assert.equal(ctx._wakeupCalls.length, 0, 'an idempotent replay must not re-wake the agent');
});

test('chat.send: in_progress topic is NOT updated (no needless flip, but watchdog STILL fires — D-11 anti-regression)', async () => {
  const ctx = makeCtx({ issueStatus: 'in_progress' });
  registerChatSend(ctx);
  await ctx._handlers.get('chat.send')(sendParams());
  await new Promise((r) => setImmediate(r));

  // No flip on a non-terminal status.
  assert.equal(ctx._updateCalls.length, 0);
  // ... but the watchdog DID run — issues.get was called on every send (D-11
  // anti-regression of OQ-3 STATUS-FLIP-NOT-NEEDED: the conclusion was right
  // about the requestWakeup nudge being unnecessary, NOT about skipping the
  // status check on subsequent sends).
  assert.ok(
    ctx._getCalls.length >= 1,
    'ensureTopicWakeable runs on every send (issues.get always called)',
  );
});

test('chat.send: fire-and-forget — chat.send returns BEFORE a slow watchdog completes', async () => {
  // 50ms is well above the single setImmediate tick chat.send needs to land
  // the comment + the side-table insert.
  const ctx = makeCtx({ issueStatus: 'done', getDelayMs: 50 });
  registerChatSend(ctx);
  const before = Date.now();
  const result = await ctx._handlers.get('chat.send')(sendParams());
  const elapsed = Date.now() - before;

  assert.equal(result.ok, true);
  assert.equal(result.commentId, 'comment-1');
  // chat.send must NOT have awaited the 50ms-delayed get. Allow 25ms slack
  // for slow CI; 50ms would mean we awaited the watchdog (regression).
  assert.ok(
    elapsed < 40,
    `chat.send must not await the watchdog (elapsed=${elapsed}ms; threshold=40ms)`,
  );
  // Wait for the watchdog to actually finish before the next test.
  await new Promise((r) => setTimeout(r, 70));
});

test('chat.send: createComment host failure → { error: SEND_FAILED }, no orphan chat_messages row, watchdog NOT invoked', async () => {
  const ctx = makeCtx({ createCommentFails: true });
  registerChatSend(ctx);
  const result = await ctx._handlers.get('chat.send')(sendParams());
  await new Promise((r) => setImmediate(r));

  assert.equal(result.error, 'SEND_FAILED');
  assert.equal(ctx._insertedMessages.length, 0, 'no side-table insert when the comment never landed');
  // U5 — no point waking the agent for a message that never landed.
  assert.equal(
    ctx._getCalls.length,
    0,
    'watchdog NOT invoked when createComment fails (no comment to wake on)',
  );
  assert.equal(ctx._updateCalls.length, 0);
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
