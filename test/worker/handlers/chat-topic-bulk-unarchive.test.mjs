// test/worker/handlers/chat-topic-bulk-unarchive.test.mjs
//
// Plan 05-08 Task 2 -- chat.topic.bulkUnarchive ACTION handler (D-16).
//
// Archive full-view's bulk-select Unarchive button. Flips chat_topics.archived
// for an array of topic-issue ids in a single DB round-trip. Empty array short-
// circuits without a DB call.
//
// CTT-07 invariant: bulk-unarchive flips a plugin-side column only. Test 12
// spies on ctx.issues.update and asserts zero invocations.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopicBulkUnarchive } from '../../../src/worker/handlers/chat-topic-bulk-unarchive.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true, repoThrows = false } = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
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
        // Match the bulk UPDATE; report rowCount = length of input array.
        if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
          const ids = params[2];
          return { rowCount: Array.isArray(ids) ? ids.length : 0 };
        }
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function bulkParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueIds: ['issue-1', 'issue-2', 'issue-3'],
    ...overrides,
  };
}

// ---- Test 1 — registers under exactly chat.topic.bulkUnarchive ----------

test('chat.topic.bulkUnarchive: handler registers under exactly chat.topic.bulkUnarchive', () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  assert.ok(ctx._handlers.has('chat.topic.bulkUnarchive'));
  assert.equal(ctx._handlers.size, 1);
});

// ---- Test 8 — happy path -----------------------------------------------

test('chat.topic.bulkUnarchive: happy path -> { ok: true, updated: N } via single execute', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  const result = await ctx._handlers.get('chat.topic.bulkUnarchive')(bulkParams());
  assert.deepEqual(result, { ok: true, updated: 3 });
  const writes = ctx._calls.filter(
    (c) => c.kind === 'execute' && /chat_topics/i.test(c.sql),
  );
  assert.equal(writes.length, 1, 'one DB round-trip');
  // SQL passes archived=false (un-archive direction) and an array param.
  assert.equal(writes[0].params[0], false);
  assert.equal(writes[0].params[1], 'co-1');
  assert.deepEqual(writes[0].params[2], ['issue-1', 'issue-2', 'issue-3']);
});

// ---- Test 9 — empty array short-circuit; zero DB calls ------------------

test('chat.topic.bulkUnarchive: empty topicIssueIds -> { ok: true, updated: 0 } with NO DB call', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  const result = await ctx._handlers.get('chat.topic.bulkUnarchive')(
    bulkParams({ topicIssueIds: [] }),
  );
  assert.deepEqual(result, { ok: true, updated: 0 });
  const writes = ctx._calls.filter(
    (c) => c.kind === 'execute' && /chat_topics/i.test(c.sql),
  );
  assert.equal(writes.length, 0, 'no UPDATE for empty input');
});

// ---- Test 10 — wrong-typed topicIssueIds -------------------------------

test('chat.topic.bulkUnarchive: non-array topicIssueIds -> throws with /string\\[\\]/', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  await assert.rejects(
    () =>
      ctx._handlers.get('chat.topic.bulkUnarchive')(
        bulkParams({ topicIssueIds: 'issue-1' }),
      ),
    /string\[\]/,
  );
});

test('chat.topic.bulkUnarchive: array with non-string element -> throws', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  await assert.rejects(
    () =>
      ctx._handlers.get('chat.topic.bulkUnarchive')(
        bulkParams({ topicIssueIds: ['issue-1', 42] }),
      ),
    /string\[\]/,
  );
});

// ---- Test 11 — opted-out caller -> OPT_IN_REQUIRED ---------------------

test('chat.topic.bulkUnarchive: opted-out caller -> OPT_IN_REQUIRED, no UPDATE issued', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTopicBulkUnarchive(ctx);
  const result = await ctx._handlers.get('chat.topic.bulkUnarchive')(bulkParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  const writes = ctx._calls.filter(
    (c) => c.kind === 'execute' && /chat_topics/i.test(c.sql),
  );
  assert.equal(writes.length, 0);
});

// ---- Test 12 — CTT-07 BULK-LOAD-BEARING --------------------------------

test('chat.topic.bulkUnarchive: NEVER calls ctx.issues.update (CTT-07 invariant)', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  await ctx._handlers.get('chat.topic.bulkUnarchive')(bulkParams());
  await ctx._handlers
    .get('chat.topic.bulkUnarchive')(bulkParams({ topicIssueIds: [] }));
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'ctx.issues.update MUST remain zero-times called across all paths',
  );
});

// ---- repo failure -> BULK_UNARCHIVE_FAILED -----------------------------

test('chat.topic.bulkUnarchive: repo failure -> { error: BULK_UNARCHIVE_FAILED } + warn log', async () => {
  const ctx = makeCtx({ repoThrows: true });
  registerChatTopicBulkUnarchive(ctx);
  const result = await ctx._handlers.get('chat.topic.bulkUnarchive')(bulkParams());
  assert.equal(result.error, 'BULK_UNARCHIVE_FAILED');
  assert.ok(ctx._warnLogs.length >= 1);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- missing companyId -------------------------------------------------

test('chat.topic.bulkUnarchive: missing companyId -> throws', async () => {
  const ctx = makeCtx();
  registerChatTopicBulkUnarchive(ctx);
  const p = bulkParams();
  delete p.companyId;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.bulkUnarchive')(p),
    /companyId/i,
  );
});

test('registerChatTopicBulkUnarchive is exported', async () => {
  const mod = await import('../../../src/worker/handlers/chat-topic-bulk-unarchive.ts');
  assert.equal(typeof mod.registerChatTopicBulkUnarchive, 'function');
});
