// test/worker/handlers/chat-topic-pin.test.mjs
//
// Plan 05-08 Task 2 -- chat.topic.pin ACTION handler (D-20).
//
// Mirrors test/worker/chat/chat-topic-archive.test.mjs harness byte-for-byte
// with key substitutions. Pin/unpin a chat topic flips the migration-0010
// pinned_at column. A pinned topic becomes EXEMPT from archive (the reverse
// read of this invariant lives in chat-topic-archive.ts's PIN_EXEMPT guard,
// added in Plan 05-08 Task 3).
//
// CTT-07 invariant: pinning NEVER touches the host issue. Test 6 spies on
// ctx.issues.update across both pin=true and pin=false paths and asserts
// zero invocations.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopicPin } from '../../../src/worker/handlers/chat-topic-pin.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  topics = [
    {
      topic_id: 'CHT-1',
      company_id: 'co-1',
      issue_id: 'issue-topic-1',
      parent_issue_id: 'parent-1',
      employee_agent_id: 'agent-cfo',
      title: 'Pricing',
      last_activity_at: '2026-01-01T00:00:00.000Z',
      archived: false,
      created_at: '2026-01-01T00:00:00.000Z',
      pinned_at: null,
    },
  ],
  repoThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  // CTT-07 regression guard — spy on ctx.issues.update.
  const issueUpdateCalls = [];
  const issueClient = {
    async update(issueId, patch, companyId) {
      issueUpdateCalls.push({ issueId, patch, companyId });
      return { id: issueId, ...patch };
    },
  };

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: issueClient,
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (repoThrows) throw new Error('host db.execute 503');
        if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
          const [pinned, issueId, companyId] = params;
          const row = topics.find(
            (t) => t.issue_id === issueId && t.company_id === companyId,
          );
          if (row) {
            row.pinned_at = pinned ? new Date().toISOString() : null;
          }
          return { rowCount: row ? 1 : 0 };
        }
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _topics: topics,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function pinParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    pinned: true,
    ...overrides,
  };
}

// ---- Test 1 — handler registers under exactly chat.topic.pin ------------

test('chat.topic.pin: handler registers under key chat.topic.pin', () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  assert.ok(ctx._handlers.has('chat.topic.pin'));
  assert.equal(ctx._handlers.size, 1);
});

// ---- Test 2 — opted-out caller -> OPT_IN_REQUIRED -----------------------

test('chat.topic.pin: opted-out caller -> OPT_IN_REQUIRED, no UPDATE issued', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTopicPin(ctx);
  const result = await ctx._handlers.get('chat.topic.pin')(pinParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  const writes = ctx._calls.filter(
    (c) => c.kind === 'execute' && /chat_topics/i.test(c.sql),
  );
  assert.equal(writes.length, 0);
});

// ---- Test 3 — missing companyId -> throws -------------------------------

test('chat.topic.pin: missing companyId -> throws', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  const p = pinParams();
  delete p.companyId;
  await assert.rejects(() => ctx._handlers.get('chat.topic.pin')(p), /companyId/i);
});

// ---- Test 4 — missing topicIssueId -> throws ----------------------------

test('chat.topic.pin: missing topicIssueId -> throws', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  const p = pinParams();
  delete p.topicIssueId;
  await assert.rejects(() => ctx._handlers.get('chat.topic.pin')(p), /topicIssueId/i);
});

// ---- Test 5 — wrong-typed pinned -> throws with /boolean/ --------------

test('chat.topic.pin: missing pinned flag -> throws with /boolean/', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  const p = pinParams();
  delete p.pinned;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.pin')(p),
    /pinned.*boolean|boolean.*pinned/i,
  );
});

test('chat.topic.pin: non-boolean pinned value -> throws with /boolean/', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.pin')(pinParams({ pinned: 'yes' })),
    /boolean/i,
  );
});

// ---- Test 6 — CTT-07 PIN-LOAD-BEARING -----------------------------------
//
// The load-bearing CTT-07 invariant: chat.topic.pin NEVER touches the host
// issue. Across both pinned=true and pinned=false paths, ctx.issues.update
// remains zero-times called. If a future refactor accidentally re-introduces
// host status mutation on pin, this test fails by construction.

test('chat.topic.pin: NEVER calls ctx.issues.update (CTT-07 invariant)', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  await ctx._handlers.get('chat.topic.pin')(pinParams({ pinned: true }));
  await ctx._handlers.get('chat.topic.pin')(pinParams({ pinned: false }));
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'ctx.issues.update MUST remain zero-times called across both pin paths',
  );
});

// ---- Test 7 — REPO-FAILURE -> { error: PIN_FAILED } + warn log ----------

test('chat.topic.pin: repo failure -> { error: PIN_FAILED } + warn log', async () => {
  const ctx = makeCtx({ repoThrows: true });
  registerChatTopicPin(ctx);
  const result = await ctx._handlers.get('chat.topic.pin')(pinParams());
  assert.equal(result.error, 'PIN_FAILED');
  assert.ok(ctx._warnLogs.length >= 1);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 8 — happy path ------------------------------------------------

test('chat.topic.pin: happy path { pinned: true } -> { ok, topicIssueId, pinned: true }', async () => {
  const ctx = makeCtx();
  registerChatTopicPin(ctx);
  const result = await ctx._handlers.get('chat.topic.pin')(
    pinParams({ pinned: true }),
  );
  assert.deepEqual(result, {
    ok: true,
    topicIssueId: 'issue-topic-1',
    pinned: true,
  });
  assert.ok(ctx._topics[0].pinned_at != null, 'pinned_at persisted non-null');
});

test('chat.topic.pin: registerChatTopicPin is exported', async () => {
  const mod = await import('../../../src/worker/handlers/chat-topic-pin.ts');
  assert.equal(typeof mod.registerChatTopicPin, 'function');
});
