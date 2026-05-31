// test/worker/handlers/situation-assign-owner.test.mjs
//
// Plan 09-01 Task 2 (RED) — situation.assignOwner: the FIRST plugin core-issue
// mutation. Mirrors the agent-take-ownership.test.mjs harness (fake ctx + a
// _issueUpdateCalls spy) — but here the spy is LOAD-BEARING in the opposite
// direction: success paths MUST record exactly one ctx.issues.update call whose
// 4th arg (actor) carries the operator userId (audit attribution, T-09-02).
//
// Behaviors (09-01-PLAN.md Task 2 <behavior>):
//   1. missing companyId/leafIssueId/userId → THROW "situation.assignOwner: <key> required"
//   2. opted-out caller → { error: 'OPT_IN_REQUIRED' } (via wrapActionHandler)
//   3. neither assigneeAgentId nor takeItMyself → { error: 'BAD_REQUEST' }
//   4. BOTH assigneeAgentId and takeItMyself → { error: 'BAD_REQUEST' }
//   5. agent-assign + agents.get null → { error: 'NOT_FOUND' }, no issues.update
//   6. agent-assign success → ctx.issues.update(leafIssueId, {assigneeAgentId}, companyId, actor)
//      with actor.actorUserId === operator userId; returns { ok, leafIssueId, assignedTo }
//   7. self-assign (takeItMyself) success → ctx.issues.update(leafIssueUuid,
//      {assigneeUserId: userId}, companyId, actor); the ONLY assigneeUserId path (D-02)
//   8. ctx.issues.update throws → { error: 'ASSIGN_FAILED' }
//
// Plan 09-04 Task 1 (RED) — the live ASSIGN_FAILED reproduction. v1.3.0 passed
// the HUMAN issue key (BEAAA-43) as the ctx.issues.update first arg; the host
// rejects a non-UUID id. The fix carries a separate `leafIssueUuid` and mutates
// via THAT, keeping the human `leafIssueId` for logging + the echoed result.
// These tests add a `uuidStrictUpdate` fake (issues.update THROWS on a non-UUID
// first arg — mirroring the host) and assert BOTH assign branches now call
// ctx.issues.update with the UUID, the human key is still echoed, and a payload
// missing leafIssueUuid is rejected (reqStr) — codifying the handler's
// dependence on the popover dispatch (Task 2).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationAssignOwner } from '../../../src/worker/handlers/situation-assign-owner.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// Canonical UUID matcher — mirrors the host's id-shape rejection.
function isUuid(id) {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

// A real UUID for the leaf issue (the mutation id) + the human display key.
const LEAF_UUID = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
const HUMAN_KEY = 'BEAAA-43';

// ---- Harness ---------------------------------------------------------------

function makeCtx({
  optedIn = true,
  agentLookupReturns = { id: 'agent-1', companyId: 'co-1' },
  agentLookupThrows = false,
  updateThrows = false,
  // Plan 09-04 — when true, issues.update THROWS on a non-UUID first arg,
  // reproducing the live host rejection (the v1.3.0 ASSIGN_FAILED root cause).
  uuidStrictUpdate = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const issueUpdateCalls = [];
  const agentsGetCalls = [];

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
    agents: {
      async get(agentId, companyId) {
        agentsGetCalls.push({ agentId, companyId });
        if (agentLookupThrows) throw new Error('host agents.get 503');
        return agentLookupReturns;
      },
    },
    issues: {
      async update(issueId, patch, companyId, actor) {
        issueUpdateCalls.push({ issueId, patch, companyId, actor });
        if (updateThrows) throw new Error('host issues.update 503');
        // Plan 09-04 — the live host rejects a non-UUID id. The strict fake
        // throws so a handler that still passes the human key trips ASSIGN_FAILED.
        if (uuidStrictUpdate && !isUuid(issueId)) {
          throw new Error(`host issues.update: invalid id ${issueId}`);
        }
        return { id: issueId, ...patch };
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
    _issueUpdateCalls: issueUpdateCalls,
    _agentsGetCalls: agentsGetCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function assignParams(overrides = {}) {
  return {
    companyId: 'co-1',
    // Human display key (BEAAA-43) — echoed + logged, NEVER the mutation id.
    leafIssueId: HUMAN_KEY,
    // Plan 09-04 — the issue UUID the handler MUST pass to ctx.issues.update.
    leafIssueUuid: LEAF_UUID,
    userId: 'user-eric',
    assigneeAgentId: 'agent-1',
    ...overrides,
  };
}

function getHandler(ctx) {
  registerSituationAssignOwner(ctx);
  const fn = ctx._handlers.get('situation.assignOwner');
  assert.ok(fn, 'situation.assignOwner handler was not registered');
  return fn;
}

// ---- Test 1 — param validation throws --------------------------------------

test('situation.assignOwner Test 1: missing companyId / leafIssueId THROW canonical message', async () => {
  for (const missing of ['companyId', 'leafIssueId']) {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = assignParams();
    delete params[missing];
    await assert.rejects(
      () => fn(params),
      (err) => {
        assert.match(
          err.message,
          new RegExp(`^situation\\.assignOwner: ${missing} required$`),
        );
        return true;
      },
    );
    assert.equal(ctx._issueUpdateCalls.length, 0, `no update on missing ${missing}`);
  }

  // Missing userId is intercepted by opt-in-guard (extractUserId → null →
  // OPT_IN_REQUIRED) BEFORE the body's reqStr runs — same as agent.takeOwnership.
  {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = assignParams();
    delete params.userId;
    const result = await fn(params);
    assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
    assert.equal(ctx._issueUpdateCalls.length, 0);
  }
});

// ---- Test 2 — opt-in gate --------------------------------------------------

test('situation.assignOwner Test 2: opted-out caller → OPT_IN_REQUIRED, no agents.get, no update', async () => {
  const ctx = makeCtx({ optedIn: false });
  const fn = getHandler(ctx);
  const result = await fn(assignParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._agentsGetCalls.length, 0);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 3 — neither branch selected → BAD_REQUEST ------------------------

test('situation.assignOwner Test 3: neither assigneeAgentId nor takeItMyself → BAD_REQUEST', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const params = assignParams();
  delete params.assigneeAgentId;
  const result = await fn(params);
  assert.deepEqual(result, { error: 'BAD_REQUEST' });
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 4 — both branches selected → BAD_REQUEST -------------------------

test('situation.assignOwner Test 4: BOTH assigneeAgentId and takeItMyself → BAD_REQUEST', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const result = await fn(assignParams({ takeItMyself: true }));
  assert.deepEqual(result, { error: 'BAD_REQUEST' });
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 5 — agent-assign NOT_FOUND ---------------------------------------

test('situation.assignOwner Test 5: agent-assign + agents.get null → NOT_FOUND, no update', async () => {
  const ctx = makeCtx({ agentLookupReturns: null });
  const fn = getHandler(ctx);
  const result = await fn(assignParams());
  assert.deepEqual(result, { error: 'NOT_FOUND' });
  assert.equal(ctx._agentsGetCalls.length, 1);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 6 — agent-assign success (the hero path) -------------------------
// Plan 09-04 — runs against the UUID-strict fake. The handler MUST pass the
// UUID (leafIssueUuid) as the update first arg, NOT the human key (BEAAA-43) —
// otherwise the strict fake throws (the live ASSIGN_FAILED). RED against
// unmodified source (it passes leafIssueId = BEAAA-43 → throws).

test('situation.assignOwner Test 6: agent-assign success → ONE update(UUID, {assigneeAgentId}) + actor carries operator userId; human key echoed', async () => {
  const ctx = makeCtx({ uuidStrictUpdate: true });
  const fn = getHandler(ctx);
  const result = await fn(assignParams());
  assert.equal(result.ok, true);
  // The human key is still echoed (for the UI toast), never the mutation id.
  assert.equal(result.leafIssueId, HUMAN_KEY);
  assert.equal(result.assignedTo, 'agent-1');
  // Exactly one ctx.issues.update on the leaf issue.
  assert.equal(ctx._issueUpdateCalls.length, 1, 'exactly one issues.update');
  const call = ctx._issueUpdateCalls[0];
  // The mutation id is the UUID, NOT the human key.
  assert.equal(call.issueId, LEAF_UUID, 'update first arg is the UUID, not BEAAA-43');
  assert.ok(isUuid(call.issueId), 'update first arg is UUID-shaped');
  assert.notEqual(call.issueId, HUMAN_KEY, 'update first arg is NOT the human key');
  assert.deepEqual(call.patch, { assigneeAgentId: 'agent-1' });
  assert.equal(call.companyId, 'co-1');
  // T-09-02 — the 4th arg (actor) MUST carry the operator userId so the
  // Paperclip audit trail attributes the change to the human, not the worker.
  assert.ok(call.actor, 'actor (4th arg) present');
  assert.equal(call.actor.actorUserId, 'user-eric', 'actor.actorUserId is the operator');
});

// ---- Test 7 — self-assign (Take it myself), the ONLY assigneeUserId path ----
// Plan 09-04 — same UUID-strict fake; the "Take it myself" branch ALSO mutates
// via the UUID (one update call hits both branches → both fixed by one change).

test('situation.assignOwner Test 7: self-assign success → update(UUID, {assigneeUserId: userId}) (D-02), NOT assigneeAgentId; human key echoed', async () => {
  const ctx = makeCtx({ uuidStrictUpdate: true });
  const fn = getHandler(ctx);
  const params = assignParams({ takeItMyself: true });
  delete params.assigneeAgentId;
  const result = await fn(params);
  assert.equal(result.ok, true);
  assert.equal(result.leafIssueId, HUMAN_KEY, 'human key still echoed for the self-assign branch');
  assert.equal(ctx._issueUpdateCalls.length, 1);
  const call = ctx._issueUpdateCalls[0];
  // The mutation id is the UUID for the self-assign branch too.
  assert.equal(call.issueId, LEAF_UUID, 'self-assign update first arg is the UUID');
  assert.ok(isUuid(call.issueId), 'self-assign update first arg is UUID-shaped');
  // D-02 — the single assigneeUserId use. Patch is { assigneeUserId } NOT { assigneeAgentId }.
  assert.deepEqual(call.patch, { assigneeUserId: 'user-eric' });
  assert.ok(!('assigneeAgentId' in call.patch), 'self-assign must NOT set assigneeAgentId');
  assert.equal(call.actor.actorUserId, 'user-eric');
  // Self-assign does NOT consult agents.get (no agent to verify).
  assert.equal(ctx._agentsGetCalls.length, 0, 'self-assign skips agents.get');
});

// ---- Test 8 — update throws → ASSIGN_FAILED --------------------------------

test('situation.assignOwner Test 8: ctx.issues.update throws → ASSIGN_FAILED (logged)', async () => {
  const ctx = makeCtx({ updateThrows: true });
  const fn = getHandler(ctx);
  const result = await fn(assignParams());
  assert.deepEqual(result, { error: 'ASSIGN_FAILED' });
  assert.equal(ctx._issueUpdateCalls.length, 1, 'update was attempted once before failing');
  assert.ok(
    ctx._warnLogs.some((w) => /issues\.update|assign/i.test(w.msg)),
    'expected a warn log on the update-failure path',
  );
});

// ---- Test 9 (Plan 09-04) — the live ASSIGN_FAILED reproduction --------------
// The v1.3.0 failure exactly: a payload carrying ONLY the human key (no UUID)
// against the UUID-strict host. The fix REQUIRES leafIssueUuid; without it the
// handler must reject (reqStr throws → wrapActionHandler catches), and it must
// NOT smuggle the human key into ctx.issues.update.

test('situation.assignOwner Test 9 (09-04): payload WITHOUT leafIssueUuid is rejected (reqStr) — handler requires the UUID key the popover dispatches', async () => {
  const ctx = makeCtx({ uuidStrictUpdate: true });
  const fn = getHandler(ctx);
  const params = assignParams();
  delete params.leafIssueUuid;
  await assert.rejects(
    () => fn(params),
    (err) => {
      assert.match(
        err.message,
        /^situation\.assignOwner: leafIssueUuid required$/,
        `expected leafIssueUuid required, got: ${err.message}`,
      );
      return true;
    },
  );
  // The handler must NOT have attempted the mutation with the human key.
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no update when leafIssueUuid is missing');
});

// ---- Test 10 (Plan 09-04) — the human key NEVER reaches ctx.issues.update ----
// Direct proof that even with a permissive (non-strict) fake, the mutation id is
// the UUID and the human key is confined to the echo/log envelope.

test('situation.assignOwner Test 10 (09-04): human leafIssueId never appears as the ctx.issues.update first arg', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  await fn(assignParams());
  assert.equal(ctx._issueUpdateCalls.length, 1);
  const call = ctx._issueUpdateCalls[0];
  assert.equal(call.issueId, LEAF_UUID);
  assert.notEqual(call.issueId, HUMAN_KEY, 'the human key is never the update id');
});
