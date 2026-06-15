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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { registerSituationReplyAndResume } from '../../../src/worker/handlers/situation-reply-and-resume.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// Plan 21-04 Task 2 — source-grep helpers (no jsdom; mirrors the UI suites'
// stripComments convention) so the kind-agnostic + no-auto-resume contracts are
// pinned against the SOURCE, not a behavioral mock.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const HANDLER_SRC = stripComments(
  readFileSync(path.join(REPO_ROOT, 'src/worker/handlers/situation-reply-and-resume.ts'), 'utf8'),
);
const PRIMITIVE_SRC = stripComments(
  readFileSync(path.join(REPO_ROOT, 'src/ui/surfaces/_shared/reply-in-place.tsx'), 'utf8'),
);

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
  // CR-01 (14-REVIEW) — when true, ctx.issues.get resolves null (the UUID is
  // outside the caller's company); when 'throw', it rejects. Default: returns a
  // row (the UUID is in-company).
  getReturns = 'row',
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const createCommentCalls = [];
  const issueUpdateCalls = [];
  const issueGetCalls = [];
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
      // CR-01 (14-REVIEW) — the company-scope authorization gate. Returns a row
      // for an in-company UUID, null for a cross-company UUID, throws when the
      // host call itself fails.
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        if (getReturns === 'throw') throw new Error('host issues.get 503');
        if (getReturns === 'null') return null;
        return { id: issueId, companyId };
      },
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
    _issueGetCalls: issueGetCalls,
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

// ---- Test 11 — CR-01: cross-company leafIssueUuid → NOT_FOUND, zero writes --

test('Test 11: leafIssueUuid not in caller company (issues.get → null) → NOT_FOUND, no comment/update, no dedup row', async () => {
  const ctx = makeReplyCtx({ getReturns: 'null' });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.deepEqual(result, { error: 'NOT_FOUND' }, 'rejects the cross-company target');
  assert.equal(ctx._issueGetCalls.length, 1, 'the company-scope gate was consulted');
  assert.equal(ctx._issueGetCalls[0].issueId, LEAF_UUID, 'gate checked the leaf UUID');
  assert.equal(ctx._issueGetCalls[0].companyId, 'co-1', 'gate scoped to the caller company');
  assert.equal(ctx._createCommentCalls.length, 0, 'NO comment posted on a rejected target');
  assert.equal(ctx._issueUpdateCalls.length, 0, 'NO status flip on a rejected target');
  assert.equal(ctx._wakeupCalls.length, 0, 'NO wakeup on a rejected target');
  // A failed gate writes NO dedup row, so a legitimate later retry is not blocked.
  assert.equal(ctx._dedupStore.size, 0, 'no dedup row written for a rejected target');
});

// ---- Test 12 — CR-01: the gate is consulted BEFORE any mutation on the OK path

test('Test 12: in-company leafIssueUuid → issues.get called once before createComment', async () => {
  const ctx = makeReplyCtx({ getReturns: 'row' });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: false }));
  await flush();

  assert.equal(result.ok, true, 'in-company target proceeds');
  assert.equal(ctx._issueGetCalls.length, 1, 'gate consulted exactly once');
  assert.equal(ctx._createCommentCalls.length, 1, 'comment posted after the gate passed');
});

// ---- Test 13 — CR-01: a host failure in the gate → NOT_FOUND, no writes -----

test('Test 13: issues.get throws → NOT_FOUND, no comment/update, no dedup row (retry-safe)', async () => {
  const ctx = makeReplyCtx({ getReturns: 'throw' });
  const fn = getHandler(ctx);
  const result = await fn(replyParams({ needsDurabilityFlip: true }));
  await flush();

  assert.deepEqual(result, { error: 'NOT_FOUND' });
  assert.equal(ctx._createCommentCalls.length, 0, 'no comment on a gate error');
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no flip on a gate error');
  assert.equal(ctx._dedupStore.size, 0, 'no dedup row on a gate error (legit retry allowed)');
});

// ---- Plan 21-04 Task 2 — the handler is TERMINAL-KIND-AGNOSTIC (needs NO change)
//
// 21-CONTEXT D-8 + the SEED CORRECTION: the seed asserted the worker would need
// to "loosen any terminal-kind gate" for the stuck path. Live-code grounding
// proves the opposite — the handler NEVER inspects terminal.kind; it acts on the
// caller-supplied needsDurabilityFlip boolean alone. A stuck (Shape-B
// status='blocked') row resumes correctly through this UNCHANGED handler. These
// source-grep tests pin that contract so a future edit that re-introduces a
// terminal-kind branch is caught.

test('Test 14: the handler source reads needsDurabilityFlip and NEVER inspects terminal.kind (kind-agnostic — needs NO change)', () => {
  // It DOES key off the caller-supplied durable-flip boolean.
  assert.match(HANDLER_SRC, /needsDurabilityFlip/, 'handler keys off needsDurabilityFlip');
  // It NEVER inspects terminal.kind / terminalKind — no terminal-kind proxy. This
  // is the seed-divergence pin (D-8): the stuck path required no handler edit.
  assert.doesNotMatch(HANDLER_SRC, /terminal\.kind/, 'handler must NOT read terminal.kind');
  assert.doesNotMatch(HANDLER_SRC, /terminalKind/, 'handler must NOT read terminalKind');
});

// ---- Plan 21-04 Task 2 — the stuck Shape-B resume path (needsDurabilityFlip=true)
//
// A stuck agent is the dominant Shape-B (status='blocked') case. Exercising the
// existing behavioral handler with needsDurabilityFlip=true IS the stuck resume:
// the operator's note posts a comment (the native resume trigger) AND the durable
// {status:'in_progress'} flip applies, returning { ok:true, durable:true }. Reuses
// the file's mock-ctx; the handler treats it identically to any other Shape-B row
// (kind-agnostic). This duplicates Test 4's mechanism intentionally, framed as the
// STUCK resume per D-8 (extend, don't rewrite).

test('Test 15: STUCK Shape-B resume (needsDurabilityFlip=true) → comment posts + durable in_progress flip + { ok, durable:true }', async () => {
  const ctx = makeReplyCtx();
  const fn = getHandler(ctx);
  const result = await fn(
    replyParams({ needsDurabilityFlip: true, body: 'Try the staging credentials in the vault.' }),
  );
  await flush();

  // The operator note posted (the native resume trigger for the stuck agent).
  assert.equal(ctx._createCommentCalls.length, 1, 'the unstick reply posts one comment');
  assert.equal(ctx._createCommentCalls[0].body, 'Try the staging credentials in the vault.');
  // The durable Shape-B flip applied: exactly one update {status:'in_progress'}.
  assert.equal(ctx._issueUpdateCalls.length, 1, 'one durable status flip');
  assert.deepEqual(
    ctx._issueUpdateCalls[0].patch,
    { status: 'in_progress' },
    'stuck row durably flips to in_progress',
  );
  // The result confirms the durable stuck resume.
  assert.equal(result.ok, true);
  assert.equal(result.durable, true);
});

// ---- Plan 21-04 Task 2 — STUCK-04 no-auto-resume on view
//
// The resume mutation (situation.replyAndResume) must fire ONLY on an explicit
// operator Send / chip onClick — NEVER on mount/view. The shared <ReplyInPlace>
// primitive is the single dispatch site for all three surfaces, so pinning it
// here covers SR + Reader + backlog by construction. Source-grep over the
// primitive: the reply() dispatch lives ONLY inside dispatchReply, and
// dispatchReply is invoked ONLY from onClick / onKeyDown (Enter) — never from a
// React.useEffect (no mount-driven dispatch).

test('Test 16: the reply() dispatch lives ONLY inside dispatchReply (single dispatch site)', () => {
  // The action hook is bound once.
  assert.match(PRIMITIVE_SRC, /const reply = usePluginAction\('situation\.replyAndResume'\)/);
  // `reply(` is invoked exactly once in the source — inside dispatchReply.
  assert.equal(
    (PRIMITIVE_SRC.match(/\breply\(\{/g) || []).length,
    1,
    'exactly one reply({...}) dispatch call (inside dispatchReply)',
  );
});

test('Test 17: STUCK-04 — dispatchReply is invoked ONLY from Send/chip onClick + Enter, NEVER from a useEffect (no auto-resume on view)', () => {
  // dispatchReply fires from the Send button, the chips, and Enter — all explicit
  // operator gestures.
  assert.match(PRIMITIVE_SRC, /onClick=\{\(\)\s*=>\s*void dispatchReply\(body\)\}/, 'Send onClick');
  assert.match(
    PRIMITIVE_SRC,
    /onClick=\{\(\)\s*=>\s*void dispatchReply\(cannedSentence\(option\)\)\}/,
    'chip onClick',
  );
  assert.match(PRIMITIVE_SRC, /if\s*\(e\.key === 'Enter'\)\s*void dispatchReply\(body\)/, 'Enter key');
  // The primitive uses NO React.useEffect at all (so dispatchReply cannot be
  // mount-driven) — and certainly no effect that calls dispatchReply.
  assert.doesNotMatch(PRIMITIVE_SRC, /React\.useEffect/, 'no useEffect in the primitive');
  assert.doesNotMatch(PRIMITIVE_SRC, /useEffect\([\s\S]*?dispatchReply/, 'no effect-driven dispatch');
});

// ---- Plan 21-04 Task 2 — CONFIRMATION: the handler source is UNCHANGED.
//
// This plan adds NO edit to situation-reply-and-resume.ts (D-8: the handler is
// kind-agnostic and needs no change for the stuck path). The kind-agnostic
// source-grep (Test 14) is the assertion; the git-diff-clean check is a manual
// verification noted in the SUMMARY (no programmatic git call in a unit test).
