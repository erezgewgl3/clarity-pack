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
//   7. self-assign (takeItMyself) success → ctx.issues.update(leafIssueId,
//      {assigneeUserId: userId}, companyId, actor); the ONLY assigneeUserId path (D-02)
//   8. ctx.issues.update throws → { error: 'ASSIGN_FAILED' }

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationAssignOwner } from '../../../src/worker/handlers/situation-assign-owner.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// ---- Harness ---------------------------------------------------------------

function makeCtx({
  optedIn = true,
  agentLookupReturns = { id: 'agent-1', companyId: 'co-1' },
  agentLookupThrows = false,
  updateThrows = false,
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
    leafIssueId: 'issue-leaf-1',
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

test('situation.assignOwner Test 6: agent-assign success → ONE update({assigneeAgentId}) + actor carries operator userId', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const result = await fn(assignParams());
  assert.equal(result.ok, true);
  assert.equal(result.leafIssueId, 'issue-leaf-1');
  assert.equal(result.assignedTo, 'agent-1');
  // Exactly one ctx.issues.update on the leaf issue.
  assert.equal(ctx._issueUpdateCalls.length, 1, 'exactly one issues.update');
  const call = ctx._issueUpdateCalls[0];
  assert.equal(call.issueId, 'issue-leaf-1');
  assert.deepEqual(call.patch, { assigneeAgentId: 'agent-1' });
  assert.equal(call.companyId, 'co-1');
  // T-09-02 — the 4th arg (actor) MUST carry the operator userId so the
  // Paperclip audit trail attributes the change to the human, not the worker.
  assert.ok(call.actor, 'actor (4th arg) present');
  assert.equal(call.actor.actorUserId, 'user-eric', 'actor.actorUserId is the operator');
});

// ---- Test 7 — self-assign (Take it myself), the ONLY assigneeUserId path ----

test('situation.assignOwner Test 7: self-assign success → update({assigneeUserId: userId}) (D-02), NOT assigneeAgentId', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const params = assignParams({ takeItMyself: true });
  delete params.assigneeAgentId;
  const result = await fn(params);
  assert.equal(result.ok, true);
  assert.equal(result.leafIssueId, 'issue-leaf-1');
  assert.equal(ctx._issueUpdateCalls.length, 1);
  const call = ctx._issueUpdateCalls[0];
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
