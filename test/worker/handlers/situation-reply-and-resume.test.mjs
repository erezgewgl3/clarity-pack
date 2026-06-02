// test/worker/handlers/situation-reply-and-resume.test.mjs
//
// Phase 14 Plan 14-01 Task 2 (RED) — situation.replyAndResume: the Do-It-Here
// reply+resume mutation. Mirrors the situation-assign-owner.test.mjs harness
// (fake ctx + spies + isUuid matcher) but here the LOAD-BEARING facts are:
//   - DEDUP happens BEFORE any mutation (a replay with the same messageUuid
//     posts exactly ONE comment + applies at most ONE flip).
//   - The Shape-B {status:'in_progress'} flip fires ONLY when the caller
//     passes needsDurabilityFlip === true — a REAL boolean, NOT a terminal.kind
//     proxy. Shape A (false / absent) = comment-only, ZERO update.
//   - createComment uses leafIssueUuid (the mutation id); the human leafIssueId
//     is echoed/logged only, NEVER the createComment/update first arg.
//   - The fire-and-forget requestWakeup carries idempotencyKey === messageUuid.
//   - createComment failure → { error: 'REPLY_FAILED' }, no update, no dedup row.
//   - A flip failure is NON-FATAL: still { ok: true, durable: false } + a dedup
//     row with durable=false (so a replay never re-attempts the flip).
//   - Opted-out caller → { error: 'OPT_IN_REQUIRED' } before any host call.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationReplyAndResume } from '../../../src/worker/handlers/situation-reply-and-resume.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// Canonical UUID matcher — mirrors the host's id-shape rejection.
function isUuid(id) {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

const LEAF_UUID = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
const HUMAN_KEY = 'BEAAA-43';

// ---- Harness ---------------------------------------------------------------

function makeCtx({
  optedIn = true,
  createCommentThrows = false,
  updateThrows = false,
  // When true, createComment/update THROW on a non-UUID first arg (the live
  // host rejection) so a handler that leaked the human key trips the failure.
  uuidStrict = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const createCommentCalls = [];
  const issueUpdateCalls = [];
  const wakeupCalls = [];
  // The in-memory dedup store the fake repo reads/writes (keyed by messageUuid).
  const dedupStore = new Map();

  let commentSeq = 0;

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
    issues: {
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        if (createCommentThrows) throw new Error('host createComment 503');
        if (uuidStrict && !isUuid(issueId)) {
          throw new Error(`host createComment: invalid id ${issueId}`);
        }
        commentSeq += 1;
        return { id: `comment-${commentSeq}` };
      },
      async update(issueId, patch, companyId, actor) {
        issueUpdateCalls.push({ issueId, patch, companyId, actor });
        if (updateThrows) throw new Error('host issues.update 503');
        if (uuidStrict && !isUuid(issueId)) {
          throw new Error(`host issues.update: invalid id ${issueId}`);
        }
        return { id: issueId, ...patch };
      },
      async requestWakeup(issueId, companyId, options) {
        wakeupCalls.push({ issueId, companyId, options });
        return { ok: true };
      },
    },
    db: {
      async query(sql) {
        calls.push({ kind: 'query', sql });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute(sql) {
        calls.push({ kind: 'execute', sql });
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _warnLogs: warnLogs,
    _createCommentCalls: createCommentCalls,
    _issueUpdateCalls: issueUpdateCalls,
    _wakeupCalls: wakeupCalls,
    _dedupStore: dedupStore,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);

  // Fake reply-resume repo injected so the handler dedups against an in-memory
  // map (no DB round-trip). The handler imports getReplyResumeByUuid /
  // insertReplyResume from the repo module; we override ctx-level behavior by
  // shadowing those via the repo's ctx.db is not enough, so the handler is
  // designed to call the repo functions with ctx — we instead make the repo
  // calls observable through ctx._dedupStore by stubbing the repo at module
  // level is overkill; the handler uses ctx.db which our fake serves. To keep
  // the dedup deterministic we model the dedup store in the db fake below.
  return ctx;
}

// Rebuild the db fake so it backs the dedup table with the in-memory store,
// making getReplyResumeByUuid / insertReplyResume behave like the real repo.
function withDedupBackedDb(ctx) {
  const store = ctx._dedupStore;
  const inner = {
    async query(sql, params) {
      ctx._calls.push({ kind: 'query', sql, params });
      if (/clarity_user_prefs/i.test(sql)) {
        // opt-in read — preserved from the original fake via a marker.
        return ctx.__optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
      }
      if (/reply_resume_dedup/i.test(sql)) {
        const [companyId, messageUuid] = params;
        const row = store.get(`${companyId}::${messageUuid}`);
        return row ? [{ comment_id: row.comment_id, durable: row.durable }] : [];
      }
      return [];
    },
    async execute(sql, params) {
      ctx._calls.push({ kind: 'execute', sql, params });
      if (/reply_resume_dedup/i.test(sql)) {
        const [company_id, message_uuid, leaf_issue_id, comment_id, durable] = params;
        const k = `${company_id}::${message_uuid}`;
        if (!store.has(k)) {
          store.set(k, { company_id, message_uuid, leaf_issue_id, comment_id, durable });
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }
      return { rowCount: 1 };
    },
  };
  ctx.db = wrapHostFaithfulDb(inner);
  return ctx;
}

function makeReplyCtx(opts = {}) {
  const ctx = makeCtx(opts);
  ctx.__optedIn = opts.optedIn !== false;
  return withDedupBackedDb(ctx);
}

function replyParams(overrides = {}) {
  return {
    companyId: 'co-1',
    leafIssueUuid: LEAF_UUID,
    leafIssueId: HUMAN_KEY,
    body: 'Yes, ship it. Approved.',
    userId: 'user-eric',
    messageUuid: 'msg-uuid-1',
    needsDurabilityFlip: false,
    ...overrides,
  };
}

function getHandler(ctx) {
  registerSituationReplyAndResume(ctx);
  const fn = ctx._handlers.get('situation.replyAndResume');
  assert.ok(fn, 'situation.replyAndResume handler was not registered');
  return fn;
}

// allow the fire-and-forget requestWakeup microtask to settle.
const flush = () => new Promise((r) => setTimeout(r, 5));

// ---- Test 1 — param validation throws --------------------------------------

test('Test 1: missing required string params THROW canonical message', async () => {
  for (const missing of ['companyId', 'leafIssueUuid', 'leafIssueId', 'body', 'messageUuid']) {
    const ctx = makeReplyCtx();
    const fn = getHandler(ctx);
    const params = replyParams();
    delete params[missing];
    await assert.rejects(
      () => fn(params),
      (err) => {
        assert.match(
          err.message,
          new RegExp(`^situation\\.replyAndResume: ${missing} required$`),
        );
        return true;
      },
    );
    assert.equal(ctx._createCommentCalls.length, 0, `no comment on missing ${missing}`);
  }

  // Missing userId is intercepted by opt-in-guard (extractUserId → null →
  // OPT_IN_REQUIRED) BEFORE the body's reqStr runs.
  {
    const ctx = makeReplyCtx();
    const fn = getHandler(ctx);
    const params = replyParams();
    delete params.userId;
    const result = await fn(params);
    assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
    assert.equal(ctx._createCommentCalls.length, 0);
  }
});

// ---- Test 2 — opt-in gate --------------------------------------------------

test('Test 2: opted-out caller → OPT_IN_REQUIRED, zero host calls', async () => {
  const ctx = makeReplyCtx({ optedIn: false });
  const fn = getHandler(ctx);
  const result = await fn(replyParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._createCommentCalls.length, 0);
  assert.equal(ctx._issueUpdateCalls.length, 0);
  assert.equal(ctx._wakeupCalls.length, 0);
});

// ---- Test 3 — Shape A happy path (comment-only, no flip) --------------------

test('Test 3: Shape A (needsDurabilityFlip=false) → one createComment, ZERO update, durable=false', async () => {
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: false }));
  await flush();

  assert.equal(ctx._createCommentCalls.length, 1, 'exactly one createComment');
  assert.equal(ctx._issueUpdateCalls.length, 0, 'NO update on Shape A');
  // createComment mutated via the UUID, with the operator body + company.
  assert.ok(isUuid(ctx._createCommentCalls[0].issueId), 'createComment first arg is the UUID');
  assert.equal(ctx._createCommentCalls[0].issueId, LEAF_UUID);
  assert.equal(ctx._createCommentCalls[0].body, 'Yes, ship it. Approved.');
  assert.equal(ctx._createCommentCalls[0].companyId, 'co-1');
  assert.deepEqual(result, {
    ok: true,
    commentId: 'comment-1',
    leafIssueId: HUMAN_KEY,
    durable: false,
  });
});

// ---- Test 4 — Shape B happy path (comment THEN flip) -----------------------

test('Test 4: Shape B (needsDurabilityFlip=true) → createComment then ONE update {status:in_progress}, durable=true', async () => {
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.equal(ctx._createCommentCalls.length, 1, 'one createComment');
  assert.equal(ctx._issueUpdateCalls.length, 1, 'exactly one update (the flip)');
  const upd = ctx._issueUpdateCalls[0];
  assert.ok(isUuid(upd.issueId), 'update first arg is the UUID');
  assert.equal(upd.issueId, LEAF_UUID);
  assert.deepEqual(upd.patch, { status: 'in_progress' }, 'durable flip patch');
  assert.equal(upd.companyId, 'co-1');
  assert.deepEqual(upd.actor, { actorUserId: 'user-eric' }, 'operator-attributed actor (CTT-07)');
  assert.equal(result.ok, true);
  assert.equal(result.durable, true);
});

// ---- Test 5 — flip selection is driven by the boolean, not terminal.kind ---

test('Test 5: a terminal.kind in params does NOT drive the flip (only needsDurabilityFlip does)', async () => {
  // needsDurabilityFlip=false but a "blocked" terminal kind present → still NO flip.
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  await fn(replyParams({ needsDurabilityFlip: false, terminal: { kind: 'blocked' } }));
  await flush();
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no flip from terminal.kind=blocked');
});

// ---- Test 6 — idempotent replay --------------------------------------------

test('Test 6: a second call with the SAME messageUuid → exactly ONE comment + ONE flip, original commentId returned', async () => {
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  const first = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();
  const second = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.equal(ctx._createCommentCalls.length, 1, 'only one createComment across two calls');
  assert.equal(ctx._issueUpdateCalls.length, 1, 'at most one update across two calls');
  assert.equal(second.commentId, first.commentId, 'replay returns the original commentId');
  assert.equal(second.durable, true, 'replay echoes the stored durable flag');
  assert.equal(second.ok, true);
});

// ---- Test 7 — createComment failure: no orphan -----------------------------

test('Test 7: createComment throws → { error: REPLY_FAILED }, no update, no dedup row', async () => {
  const ctx = makeReplyCtx({ createCommentThrows: true });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.deepEqual(result, { error: 'REPLY_FAILED' });
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no flip after a failed comment');
  assert.equal(ctx._dedupStore.size, 0, 'no orphan dedup row');
  // a replay still re-attempts (nothing was committed).
  const result2 = await fn(replyParams({ needsDurabilityFlip: true }));
  assert.deepEqual(result2, { error: 'REPLY_FAILED' });
});

// ---- Test 8 — flip failure is non-fatal ------------------------------------

test('Test 8: Shape-B flip throws → still { ok: true, durable: false } + dedup row durable=false', async () => {
  const ctx = makeReplyCtx({ updateThrows: true });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.equal(ctx._createCommentCalls.length, 1, 'the comment still landed');
  assert.equal(result.ok, true, 'a flip failure does NOT fail the action');
  assert.equal(result.durable, false, 'durable=false because the flip failed');
  // dedup row stored with durable=false so a replay never re-attempts the flip.
  const stored = ctx._dedupStore.get('co-1::msg-uuid-1');
  assert.ok(stored, 'dedup row inserted (comment landed)');
  assert.equal(stored.durable, false, 'durable=false persisted');
  // The human key (not the UUID) is logged.
  assert.ok(
    ctx._warnLogs.some((l) => l.fields && l.fields.leafIssueId === HUMAN_KEY),
    'flip failure logs the human key',
  );
});

// ---- Test 9 — fire-and-forget wake carries idempotencyKey:messageUuid ------

test('Test 9: requestWakeup is fire-and-forget with idempotencyKey === messageUuid', async () => {
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  await fn(replyParams({ messageUuid: 'msg-wake-42' }));
  await flush();

  assert.equal(ctx._wakeupCalls.length, 1, 'requestWakeup invoked once');
  const w = ctx._wakeupCalls[0];
  assert.ok(isUuid(w.issueId), 'wake targets the UUID');
  assert.equal(w.issueId, LEAF_UUID);
  assert.equal(w.companyId, 'co-1');
  assert.equal(w.options.idempotencyKey, 'msg-wake-42', 'idempotencyKey IS the messageUuid');
});

// ---- Test 10 — NO_UUID_LEAK: human key never reaches createComment/update --

test('Test 10: the human leafIssueId NEVER reaches createComment or update (NO_UUID_LEAK / dispatch)', async () => {
  const ctx = makeReplyCtx({ uuidStrict: true });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  // uuidStrict throws on a non-UUID first arg; success proves the UUID was used.
  assert.equal(result.ok, true, 'handler used the UUID for both mutations');
  assert.equal(ctx._createCommentCalls[0].issueId, LEAF_UUID);
  assert.equal(ctx._issueUpdateCalls[0].issueId, LEAF_UUID);
  for (const c of ctx._createCommentCalls) assert.notEqual(c.issueId, HUMAN_KEY);
  for (const u of ctx._issueUpdateCalls) assert.notEqual(u.issueId, HUMAN_KEY);
});
