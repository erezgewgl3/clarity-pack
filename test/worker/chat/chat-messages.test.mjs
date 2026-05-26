// test/worker/chat/chat-messages.test.mjs
//
// Plan 04-04 Task A RED — chat.messages data handler.
// EXTENDED 2026-05-20 by Plan 04.1-04:
//   - U1..U5 — runtime-noise filter (D-14/D-15). System-authored / system_notice
//     / body-pattern-match comments are silently filtered from the message
//     thread by default. `includeDiagnostics: true` returns them anyway
//     (D-16 diagnostics opt-in).
//   - U5 cross-pin — the Plan 04.1-02 marker comment IS surfaced (Pitfall 4).
//   - U6..U7 — D-11 watchdog cadence. Every poll fires `ensureTopicWakeable`
//     fire-and-forget at the head of the handler; a slow watchdog never
//     delays the messages response.
//   - U8..U10 — D-13 host-stuck signal. The response shape grows
//     `topicStuck: boolean` + `recoveryOwner: string | null` from the topic
//     issue's `activeRecoveryAction` / `successfulRunHandoff.exhausted`.
//   - U11 — the opt-in gate runs BEFORE the watchdog hook (never wake an
//     agent for an opted-out user).
//   - U12 — full response-shape contract.
//
// Original Plan 04-04 invariants preserved:
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
  // Plan 05-11 (CHAT-07) -- chat_message_attachments rows the handler enriches
  // per-message via a single bulk lookup.
  attachmentRows = [],
  listCommentsThrows = false,
  // Plan 04.1-04 — watchdog + topic-stuck simulation.
  // `topicIssue` is the object ctx.issues.get returns; defaults to an in_progress
  // issue with no recovery action (the steady-state). Pass overrides to simulate
  // D-11 flip targets (status: done/cancelled/blocked) or D-13 stuck signals.
  topicIssue = { status: 'in_progress' },
  topicIssueNull = false,
  getThrows = false,
  getDelayMs = 0,
} = {}) {
  const handlers = new Map();
  const getCalls = [];
  const updateCalls = [];

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
      async get(issueId, companyId) {
        getCalls.push({ issueId, companyId });
        if (getDelayMs > 0) {
          await new Promise((r) => setTimeout(r, getDelayMs));
        }
        if (getThrows) throw new Error('host issues.get 503');
        if (topicIssueNull) return null;
        // The watchdog reads status from this; the stuck-signal read also
        // reads activeRecoveryAction + successfulRunHandoff from this.
        return { id: issueId, companyId, ...topicIssue };
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
        // Plan 05-11 (CHAT-07) -- match the more specific table name BEFORE
        // the generic /chat_messages/ regex (which would otherwise match the
        // chat_message_attachments path too).
        if (/chat_message_attachments/i.test(sql)) {
          // listChatMessageAttachmentsForTopic: WHERE company_id = $1 AND
          // topic_issue_id = $2 ORDER BY created_at DESC LIMIT $3.
          const [companyId, topicIssueId, limit] = params ?? [];
          const matched = attachmentRows.filter(
            (r) => r.company_id === companyId && r.topic_issue_id === topicIssueId,
          );
          // Match the SQL ORDER BY created_at DESC.
          matched.sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          return matched.slice(0, typeof limit === 'number' ? limit : matched.length);
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
    _getCalls: getCalls,
    _updateCalls: updateCalls,
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

// ---------------------------------------------------------------------------
// ORIGINAL Plan 04-04 contract — preserved verbatim
// ---------------------------------------------------------------------------

test('chat.messages: handler registers under key chat.messages', () => {
  const ctx = makeCtx();
  registerChatMessages(ctx);
  assert.ok(ctx._handlers.has('chat.messages'));
});

test('chat.messages: returns the comment thread ordered by server created_at', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-2', body: 'second', createdAt: new Date('2026-01-02T00:00:00Z'), authorType: 'user', authorUserId: 'user-eric' },
      { id: 'c-1', body: 'first', createdAt: new Date('2026-01-01T00:00:00Z'), authorType: 'user', authorUserId: 'user-eric' },
      { id: 'c-3', body: 'third', createdAt: new Date('2026-01-03T00:00:00Z'), authorType: 'user', authorUserId: 'user-eric' },
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
      { id: 'c-1', body: 'typo', createdAt: new Date('2026-01-01T00:00:00Z'), authorType: 'user', authorUserId: 'user-eric' },
      { id: 'c-2', body: 'fixed', createdAt: new Date('2026-01-02T00:00:00Z'), authorType: 'user', authorUserId: 'user-eric' },
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
      { id: 'c-1', body: 'pinned note', createdAt: new Date('2026-01-01T00:00:00Z'), authorType: 'user' },
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
      { id: 'c-op', body: 'hello from Eric', createdAt: new Date('2026-01-01T00:00:00Z'), authorType: 'agent', authorUserId: null },
      // agent reply — no chat_messages row at all
      { id: 'c-agent', body: 'reply from the agent', createdAt: new Date('2026-01-02T00:00:00Z'), authorType: 'agent', authorUserId: null },
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

// ===========================================================================
// Plan 04.1-04 — runtime-noise filter (D-14/D-15), watchdog hook (D-11),
//                host-stuck signal (D-13), opt-in-first ordering.
// ===========================================================================

// Fixture: a thread with one user, one agent reply, and one system disposition
// notice (the exact shape captured live on Countermoves COU-1757 per
// 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM).
function mixedThread() {
  return [
    {
      id: 'c-op',
      body: 'Lock the rate at 12%',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      authorType: 'user',
      authorUserId: 'user-eric',
    },
    {
      id: 'c-agent',
      body: 'OK, will lock at 12%.',
      createdAt: new Date('2026-01-01T00:00:30Z'),
      authorType: 'agent',
      authorAgentId: 'agent-ceo',
    },
    {
      // The captured live notice shape from 04.1-01-SPIKE-FINDINGS.
      id: 'c-sys',
      body: 'Paperclip needs a disposition before this issue can continue.',
      createdAt: new Date('2026-01-01T00:01:00Z'),
      authorType: 'system',
      authorUserId: null,
      authorAgentId: null,
      presentation: { kind: 'system_notice', tone: 'warning' },
    },
  ];
}

test('U1 RUNTIME-NOISE-FILTERED-BY-DEFAULT: a system disposition notice is silently filtered (CTT-04)', async () => {
  const ctx = makeCtx({ comments: mixedThread() });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.kind, 'messages');
  const ids = result.messages.map((m) => m.commentId);
  assert.deepEqual(ids, ['c-op', 'c-agent'], 'system_notice row c-sys filtered; conversational rows preserved in order');
});

test('U2 INCLUDE-DIAGNOSTICS-OFF-IS-DEFAULT: omitting includeDiagnostics filters the system comment', async () => {
  const ctx = makeCtx({ comments: mixedThread() });
  registerChatMessages(ctx);
  // No includeDiagnostics in the params shape.
  const resultOmit = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(resultOmit.messages.length, 2, 'default: 2 conversational, 0 noise');

  // Explicit false — same behaviour as omit.
  const resultFalse = await ctx._handlers.get('chat.messages')(msgParams({ includeDiagnostics: false }));
  assert.equal(resultFalse.messages.length, 2);
});

test('U3 INCLUDE-DIAGNOSTICS-ON-INCLUDES-NOISE: D-16 toggle returns all 3 comments', async () => {
  const ctx = makeCtx({ comments: mixedThread() });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams({ includeDiagnostics: true }));

  assert.equal(result.messages.length, 3);
  const ids = result.messages.map((m) => m.commentId);
  assert.deepEqual(ids, ['c-op', 'c-agent', 'c-sys'], 'D-16 diagnostics view sees the system row in chronological order');
});

test('U4 BODY-PATTERN-FALLBACK: an agent-authored comment whose body matches a RUNTIME_PHRASE is filtered', async () => {
  // The host-field discriminator misses (authorType is 'agent'), but the
  // body-pattern fallback catches it. This is the defense-in-depth path for
  // any host build that ever ships a runtime notice without the system stamp.
  const ctx = makeCtx({
    comments: [
      { id: 'c-1', body: 'Hi there.', createdAt: new Date('2026-01-01T00:00:00Z'), authorType: 'agent' },
      { id: 'c-2', body: 'This run exhausted the bounded corrective handoff.', createdAt: new Date('2026-01-01T00:00:30Z'), authorType: 'agent' },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  const ids = result.messages.map((m) => m.commentId);
  assert.deepEqual(ids, ['c-1'], 'c-2 caught by body-pattern fallback');
});

test('U5 MARKER-COMMENT-NEVER-FILTERED (Pitfall 4 integration): Plan 04.1-02 marker wording is surfaced', async () => {
  // The exact wording from src/worker/chat/true-task.ts line 78 (the Plan
  // 04.1-02 D-07 marker). This test cross-checks the integration between
  // the marker-writer (Plan 04.1-02) and the filter (Plan 04.1-04) — a
  // future RUNTIME_PHRASES addition that accidentally matches the marker
  // fails this test AND the comment-classify unit test.
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-marker',
        body: 'Task created — abc12345, assigned to CEO.',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        authorType: 'agent',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.messages.length, 1, 'marker comment is surfaced, not stripped');
  assert.equal(result.messages[0].commentId, 'c-marker');
});

test('U6 WATCHDOG-HOOK-FIRED: every chat.messages call invokes ctx.issues.get for the topic', async () => {
  // D-11 watchdog cadence — every poll re-checks the topic is wakeable.
  // The watchdog reads via ctx.issues.get; the stuck-signal read may also
  // hit ctx.issues.get. We assert ≥1 call hitting the topic id.
  const ctx = makeCtx({ comments: mixedThread() });
  registerChatMessages(ctx);
  await ctx._handlers.get('chat.messages')(msgParams());

  // Allow a tick for the fire-and-forget watchdog to start.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.ok(ctx._getCalls.length >= 1, 'watchdog (or stuck-read) called ctx.issues.get at least once');
  assert.ok(
    ctx._getCalls.every((c) => c.issueId === 'issue-topic-1' && c.companyId === 'co-1'),
    'all gets are scoped to the topic id + companyId',
  );
});

test('U6b WATCHDOG-LOGS-OFF-DONE: when the topic is parked at done, the watchdog logs info-hint and does NOT call issues.update (rc.8 CTT-07)', async () => {
  // rc.8 hotfix 2026-05-26: the watchdog NO LONGER mutates host issue
  // status. Per CTT-07 the manifest doesn't declare issues.update;
  // calling it always failed on the live host (~4 log lines/minute of
  // "missing capability" spam). The host's disposition-recovery is the
  // rightful owner of restoration; the plugin only logs a hint.
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: { status: 'done' },
  });
  registerChatMessages(ctx);
  await ctx._handlers.get('chat.messages')(msgParams());

  // Watchdog is fire-and-forget — give it a tick to land.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(ctx._updateCalls.length, 0, 'CTT-07: zero issues.update calls');
});

test('U7 WATCHDOG-FIRE-AND-FORGET: a slow watchdog does NOT delay the chat.messages response', async () => {
  // 50ms ctx.issues.get delay simulates a slow host. The fire-and-forget
  // watchdog must NOT be awaited; the response must return as fast as the
  // listComments + side-table-query path.
  //
  // The handler DOES await the topicIssue read for the topicStuck/recoveryOwner
  // shape — that's a SECOND ctx.issues.get. The fire-and-forget call is the
  // FIRST one (the watchdog). With both reads served by the same fake, we
  // can't measure them separately by wall-clock; instead we assert the
  // response returns AT MOST one round-trip slow (≤ ~80ms), not two (≥ ~100ms).
  // Specifically: the fire-and-forget watchdog's get IS not awaited, so the
  // total elapsed is bounded by the single stuck-read get.
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: { status: 'in_progress' },
    getDelayMs: 50,
  });
  registerChatMessages(ctx);

  const before = Date.now();
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  const elapsed = Date.now() - before;

  assert.equal(result.kind, 'messages');
  // If both gets were awaited sequentially we'd see >=100ms. The watchdog
  // get must not be awaited — total elapsed is bounded by ONE 50ms get
  // (the stuck-read) plus listComments overhead. Threshold 85ms allows CI
  // slack; 100ms would be a regression.
  assert.ok(
    elapsed < 85,
    `chat.messages must not await the watchdog get (elapsed=${elapsed}ms; threshold=85ms)`,
  );

  // Let the fire-and-forget watchdog complete so node --test doesn't see
  // a dangling promise.
  await new Promise((r) => setTimeout(r, 70));
});

test('U8 TOPIC-STUCK-FIELD-FALSE: a clean topic returns topicStuck=false, recoveryOwner=null', async () => {
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: { status: 'in_progress' },
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.topicStuck, false, 'no activeRecoveryAction → topicStuck false');
  assert.equal(result.recoveryOwner, null, 'no recovery owner');
});

test('U9 TOPIC-STUCK-FIELD-TRUE-RECOVERY: activeRecoveryAction surfaces recoveryOwner name', async () => {
  // The UI-SPEC Pattern G banner reads recoveryOwner to render the named
  // human action. Plan 04.1-06's HostStuckBanner depends on this shape.
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: {
      status: 'in_progress',
      activeRecoveryAction: { kind: 'recovery_owner', recoveryOwnerName: 'Eric' },
    },
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.topicStuck, true);
  assert.equal(result.recoveryOwner, 'Eric');
});

test('U10 TOPIC-STUCK-FIELD-TRUE-EXHAUSTED: successfulRunHandoff.exhausted=true → topicStuck true', async () => {
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: {
      status: 'in_progress',
      successfulRunHandoff: { exhausted: true },
    },
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.topicStuck, true);
  // recoveryOwner may be null when no name is attached — the banner falls
  // back to a generic 'Owner' label per UI-SPEC.
  assert.equal(result.recoveryOwner, null);
});

test('U11 OPT-IN-GATE-STILL-FIRST: opted-out caller → no watchdog get, no listComments call', async () => {
  // The opt-in gate (wrapDataHandler) returns OPT_IN_REQUIRED BEFORE the
  // handler body runs — so NO ctx.issues call should fire for an opted-out
  // user. This pins the contract: never wake an agent for someone who
  // hasn't opted in.
  let listCommentsCalled = false;
  const ctx = makeCtx({
    optedIn: false,
    comments: mixedThread(),
  });
  // Wrap listComments to assert it's never called.
  const realListComments = ctx.issues.listComments;
  ctx.issues.listComments = async (...args) => {
    listCommentsCalled = true;
    return realListComments(...args);
  };
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(listCommentsCalled, false, 'no listComments call for an opted-out user');
  assert.equal(ctx._getCalls.length, 0, 'no watchdog get for an opted-out user');
});

test('U12 RESPONSE-SHAPE-EXTENDED: response carries kind, topicIssueId, messages, topicStuck, recoveryOwner', async () => {
  const ctx = makeCtx({
    comments: mixedThread(),
    topicIssue: {
      status: 'in_progress',
      activeRecoveryAction: { kind: 'recovery_owner', recoveryOwnerName: 'CFO' },
    },
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  // Existing fields preserved — Plan 04-05's UI continues to work.
  assert.equal(result.kind, 'messages');
  assert.equal(result.topicIssueId, 'issue-topic-1');
  assert.ok(Array.isArray(result.messages));

  // New fields — Plan 04.1-06's HostStuckBanner reads these.
  assert.equal(result.topicStuck, true);
  assert.equal(result.recoveryOwner, 'CFO');

  // Defensive — no extra surprise fields beyond the documented shape.
  const expectedKeys = new Set(['kind', 'topicIssueId', 'messages', 'topicStuck', 'recoveryOwner']);
  for (const k of Object.keys(result)) {
    assert.ok(expectedKeys.has(k), `unexpected response key: ${k}`);
  }
});

test('U13 STUCK-READ-FAILURE-DEGRADES-GRACEFULLY: a thrown ctx.issues.get does NOT fail the messages response', async () => {
  // Best-effort durability: if the topic-stuck read fails, the messages
  // array is still returned. topicStuck defaults to false; recoveryOwner null.
  const ctx = makeCtx({
    comments: mixedThread(),
    getThrows: true,
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());

  // The messages array is still returned (filtered).
  assert.equal(result.kind, 'messages');
  assert.equal(result.messages.length, 2, 'filtered conversational rows still returned');
  // Stuck fields fall back to safe defaults.
  assert.equal(result.topicStuck, false);
  assert.equal(result.recoveryOwner, null);
});

// ---------------------------------------------------------------------------
// Plan 05-11 (CHAT-07) -- chat-uploaded attachments are inlined per message
// via a SINGLE bulk topic-wide query (PRIM-01 spirit -- never N+1).
// ---------------------------------------------------------------------------

test('U14 ATTACHMENTS-DEFAULT-EMPTY: a message with no attachments returns attachments: []', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-1',
        body: 'hello',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        authorType: 'user',
        authorUserId: 'user-eric',
      },
    ],
    chatMessages: [
      {
        message_uuid: 'uuid-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    attachmentRows: [],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0].attachments, []);
});

test('U15 ATTACHMENTS-INLINED: a message with 2 attachments returns them in upload order (ASC)', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-1',
        body: 'with attachments',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        authorType: 'user',
        authorUserId: 'user-eric',
      },
    ],
    chatMessages: [
      {
        message_uuid: 'uuid-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    attachmentRows: [
      {
        id: 'att-2',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        chat_message_id: 'uuid-1',
        comment_id: 'c-1',
        document_key: 'chat-attach-uuid-1-b',
        mime_type: 'application/pdf',
        original_filename: 'second.pdf',
        byte_size: 2048,
        created_at: '2026-01-01T00:05:00.000Z',
      },
      {
        id: 'att-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        chat_message_id: 'uuid-1',
        comment_id: 'c-1',
        document_key: 'chat-attach-uuid-1-a',
        mime_type: 'image/png',
        original_filename: 'first.png',
        byte_size: 512,
        created_at: '2026-01-01T00:01:00.000Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.messages.length, 1);
  // The two attachments render in upload order (ASC by created_at).
  assert.equal(result.messages[0].attachments.length, 2);
  assert.equal(result.messages[0].attachments[0].id, 'att-1');
  assert.equal(result.messages[0].attachments[1].id, 'att-2');
  // camelCase fields are present.
  const a = result.messages[0].attachments[0];
  assert.equal(a.documentKey, 'chat-attach-uuid-1-a');
  assert.equal(a.mimeType, 'image/png');
  assert.equal(a.originalFilename, 'first.png');
  assert.equal(a.byteSize, 512);
  assert.equal(a.createdAt, '2026-01-01T00:01:00.000Z');
});

test('U16 ATTACHMENTS-ALWAYS-PRESENT: every message in the response carries an attachments field', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-1',
        body: 'first',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        authorType: 'user',
        authorUserId: 'user-eric',
      },
      {
        id: 'c-2',
        body: 'second (agent)',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        authorType: 'agent',
        authorAgentId: 'agent-cfo',
      },
    ],
    chatMessages: [
      {
        message_uuid: 'uuid-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    attachmentRows: [
      {
        id: 'att-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        chat_message_id: 'uuid-1',
        comment_id: 'c-1',
        document_key: 'chat-attach-uuid-1-x',
        mime_type: 'application/pdf',
        original_filename: 'x.pdf',
        byte_size: 1024,
        created_at: '2026-01-01T00:01:00.000Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  // Both messages render; both carry an attachments field (agent message: []).
  assert.equal(result.messages.length, 2);
  for (const m of result.messages) {
    assert.ok(
      Array.isArray(m.attachments),
      `attachments must be present on every message (got ${typeof m.attachments})`,
    );
  }
  // Operator message has 1 attachment; agent message has 0.
  const operator = result.messages.find((m) => m.commentId === 'c-1');
  const agent = result.messages.find((m) => m.commentId === 'c-2');
  assert.equal(operator.attachments.length, 1);
  assert.equal(agent.attachments.length, 0);
});

test('U17 ATTACHMENTS-LOOKUP-FAILURE-DEGRADES: a thrown attachments SELECT returns empty arrays, not an error', async () => {
  // The attachments lookup is best-effort -- a failed read degrades to
  // empty attachments on every message instead of failing the whole
  // chat.messages response.
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-1',
        body: 'hello',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        authorType: 'user',
        authorUserId: 'user-eric',
      },
    ],
    chatMessages: [
      {
        message_uuid: 'uuid-1',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-1',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  // Override db.query to throw on the attachments table specifically.
  const originalQuery = ctx.db.query.bind(ctx.db);
  ctx.db.query = async (sql, params) => {
    if (/chat_message_attachments/i.test(sql)) {
      throw new Error('host db.query 503');
    }
    return originalQuery(sql, params);
  };
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  // Messages still surface; attachments degrade to [].
  assert.equal(result.kind, 'messages');
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0].attachments, []);
});

// ---------------------------------------------------------------------------
// rc.8 Phase B follow-up (2026-05-26) — operator-sent user messages MUST
// render in the thread even though the Paperclip host stamps every
// plugin-worker `ctx.issues.createComment` call with `authorType: 'system'`.
//
// Live evidence (Playwright probe 2026-05-26T18:23):
//   chat.send POST → host returns { ok:true, commentId:"1896d334-..." }
//   /api/issues/<id>/comments REST → comment exists with body="PHASE-B-VERIFY-..."
//     and authorType:"system", authorUserId:null
//   But chat.messages response → comment is MISSING (classifier filtered it)
//
// The bug: the Plan 04.1-04 D-14 classifier treats authorType:'system' as
// runtime-noise. The Plan 04.1-11 marker allowlist exists only for
// `Task created — ...` strings, not for general operator chat sends. So
// EVERY operator chat message gets filtered out of its own thread.
//
// The fix: in the chat-messages filter, allowlist any comment whose
// chat_messages side-table row carries `sender_kind:'user'`. The side
// table is the authoritative record of operator-initiated sends, and the
// host-stamped authorType is irrelevant to that fact.
// ---------------------------------------------------------------------------

test('chat.messages: operator-sent comment with authorType:system + chat_messages.sender_kind:user RENDERS (rc.8 phase-B classifier bypass)', async () => {
  const ctx = makeCtx({
    comments: [
      // The exact production shape from Playwright probe 2026-05-26: a
      // user-typed message that the host bridge stamped as authorType:'system'.
      {
        id: 'c-operator',
        body: 'PHASE-B-VERIFY operator message',
        createdAt: new Date('2026-05-26T18:23:13.864Z'),
        authorType: 'system',
        authorUserId: null,
        authorAgentId: null,
      },
    ],
    chatMessages: [
      // chat_messages side-table row that PROVES this comment is operator-
      // initiated. The plugin wrote this when chat.send fired.
      {
        message_uuid: 'm-operator',
        company_id: 'co-1',
        topic_issue_id: 'issue-topic-1',
        comment_id: 'c-operator',
        sender_kind: 'user',
        supersedes_uuid: null,
        pinned: false,
        sent_at: '2026-05-26T18:23:13.864Z',
      },
    ],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.kind, 'messages');
  assert.equal(
    result.messages.length,
    1,
    'operator-sent comment with chat_messages sender_kind:user MUST pass the filter',
  );
  assert.equal(result.messages[0].commentId, 'c-operator');
  assert.equal(result.messages[0].senderKind, 'user');
});

test('chat.messages: agent-stamped runtime notice WITHOUT a chat_messages side-table row is still filtered (anti-regression)', async () => {
  // Defense in depth — the bypass MUST apply only to comments with a
  // chat_messages row. A bare authorType:'system' notice from the host's
  // recovery service (no chat_messages link) must STILL be filtered out.
  const ctx = makeCtx({
    comments: [
      {
        id: 'c-recovery',
        body: 'finish_successful_run_handoff: paused awaiting disposition',
        createdAt: new Date('2026-05-26T18:00:00Z'),
        authorType: 'system',
        authorUserId: null,
        authorAgentId: null,
      },
    ],
    // No chat_messages side-table rows — the bypass cannot fire.
    chatMessages: [],
  });
  registerChatMessages(ctx);
  const result = await ctx._handlers.get('chat.messages')(msgParams());
  assert.equal(result.messages.length, 0, 'recovery notice still filtered');
});
