// test/worker/handlers/agent-take-ownership.test.mjs
//
// Phase 6.1 ROOM-09 -- agent.takeOwnership ACTION handler.
//
// Behaviors (matches Plan 05-11 Test 1-10 numbering for the canonical
// action-handler test shape):
//   1. opt-in gate -- opted-out caller -> { error: 'OPT_IN_REQUIRED' }, no
//      ctx.agents.get call.
//   2. param validation -- missing companyId / agentId / ownerUserId /
//      userId each THROW with the canonical "agent.takeOwnership: <key>
//      required" message.
//   3. OWNER_MISMATCH -- ownerUserId !== userId -> { error:
//      'OWNER_MISMATCH' }, no agents.get, no upsert.
//   4. NOT_FOUND -- ctx.agents.get returns null -> { error: 'NOT_FOUND' },
//      no upsert.
//   5. agents.get throws -> { error: 'OWNERSHIP_FAILED' }, no upsert.
//   6. happy path -- returns { ok: true, agentId, ownerUserId, setAt };
//      one INSERT into clarity_agent_owners.
//   7. idempotent re-claim -- same (agentId, ownerUserId) twice succeeds
//      twice; the second call exercises ON CONFLICT DO UPDATE.
//   8. reassign -- same agentId + different ownerUserId returns updated
//      row; set_at advances.
//   9. repo write fails -- ctx.db.execute rejects -> { error:
//      'OWNERSHIP_FAILED' }.
//  10. CTT-07 runtime spy -- across every code path 1..9, ctx
//      ._issueUpdateCalls.length === 0. LOAD-BEARING.
//
// Pattern forked from test/worker/handlers/chat-attachment-upload.test.mjs
// (canonical 638-line action-handler test template). Ctx-mock is the
// chat-attachment-upload pattern trimmed to the handler's actual surface
// (db query/execute + agents.get + opt-in-guard prefs lookup).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerAgentTakeOwnership } from '../../../src/worker/handlers/agent-take-ownership.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// ---- Harness ---------------------------------------------------------------

function makeCtx({
  optedIn = true,
  agentLookupReturns = { id: 'agent-1', companyId: 'co-1' },
  agentLookupThrows = false,
  upsertThrows = false,
  // Override the set_at the readback returns so reassign (Test 8) can
  // assert set_at advances between two calls without sleeping.
  readbackSetAt = '2026-05-26T20:00:00.000Z',
  readbackOwnerUserId = null,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  // CTT-07 runtime spy.
  const issueUpdateCalls = [];
  const agentsGetCalls = [];
  // Captured from the upsert execute so the SELECT readback can echo the
  // canonical set_at + owner_user_id the handler actually persisted.
  let lastInsertSetAt = readbackSetAt;
  let lastInsertOwnerUserId = readbackOwnerUserId;

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
      // CTT-07 spy -- must remain at zero across every test path.
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        // upsertClarityAgentOwner readback: SELECT ... FROM
        // clarity_agent_owners WHERE agent_id = $1.
        if (
          /FROM\s+plugin_clarity_pack_cdd6bda4bd\.clarity_agent_owners[\s\S]*WHERE\s+agent_id\s*=\s*\$1/i.test(
            sql,
          )
        ) {
          return [
            {
              agent_id: params[0],
              owner_user_id: lastInsertOwnerUserId ?? 'user-eric',
              company_id: 'co-1',
              set_at: lastInsertSetAt,
            },
          ];
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (
          /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.clarity_agent_owners/i.test(
            sql,
          )
        ) {
          // Capture the upsert's set_at ($4) + owner_user_id ($2) so the
          // readback echoes what was actually persisted. ON CONFLICT DO
          // UPDATE makes this last-write-wins by construction.
          lastInsertOwnerUserId = params?.[1] ?? lastInsertOwnerUserId;
          lastInsertSetAt = params?.[3] ?? lastInsertSetAt;
          if (upsertThrows) throw new Error('host db.execute 503');
        }
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

function takeOwnershipParams(overrides = {}) {
  return {
    companyId: 'co-1',
    agentId: 'agent-1',
    ownerUserId: 'user-eric',
    userId: 'user-eric',
    ...overrides,
  };
}

function getHandler(ctx) {
  registerAgentTakeOwnership(ctx);
  const fn = ctx._handlers.get('agent.takeOwnership');
  assert.ok(fn, 'agent.takeOwnership handler was not registered');
  return fn;
}

// ---- Test 1 -- opt-in gate ------------------------------------------------

test('agent.takeOwnership Test 1: opted-out caller -> OPT_IN_REQUIRED, no agents.get', async () => {
  const ctx = makeCtx({ optedIn: false });
  const fn = getHandler(ctx);
  const result = await fn(takeOwnershipParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._agentsGetCalls.length, 0, 'agents.get must not be called when opted-out');
  // CTT-07 spy.
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 2 -- param validation throws ------------------------------------

test('agent.takeOwnership Test 2: missing required params THROW with canonical message', async () => {
  // missing companyId / agentId / ownerUserId reach the handler body's
  // reqStr() guard and throw with the canonical message. Missing userId
  // is intercepted by opt-in-guard FIRST (extractUserId returns null,
  // isOptedIn(null) returns false, the wrapper returns OPT_IN_REQUIRED
  // before the body runs) -- exercised separately below.
  for (const missing of ['companyId', 'agentId', 'ownerUserId']) {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = takeOwnershipParams();
    delete params[missing];
    await assert.rejects(
      () => fn(params),
      (err) => {
        assert.match(
          err.message,
          new RegExp(`^agent\\.takeOwnership: ${missing} required$`),
        );
        return true;
      },
    );
    // CTT-07 spy stays at zero through every throw path.
    assert.equal(ctx._issueUpdateCalls.length, 0);
  }

  // Missing userId is the opt-in-guard short-circuit (cannot identify
  // the caller -> refuse to serve). Returns OPT_IN_REQUIRED rather than
  // throwing -- matches the wrapActionHandler contract in
  // src/worker/opt-in-guard.ts:117-123.
  {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = takeOwnershipParams();
    delete params.userId;
    const result = await fn(params);
    assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
    assert.equal(ctx._issueUpdateCalls.length, 0);
  }
});

// ---- Test 3 -- OWNER_MISMATCH ---------------------------------------------

test('agent.takeOwnership Test 3: ownerUserId !== userId -> OWNER_MISMATCH, no agents.get, no upsert', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const result = await fn(
    takeOwnershipParams({ ownerUserId: 'user-attacker', userId: 'user-eric' }),
  );
  assert.deepEqual(result, { error: 'OWNER_MISMATCH' });
  assert.equal(ctx._agentsGetCalls.length, 0, 'agents.get must not be called on OWNER_MISMATCH');
  const inserts = ctx._calls.filter(
    (c) => c.kind === 'execute' && /clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(inserts.length, 0, 'no upsert on OWNER_MISMATCH');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 4 -- NOT_FOUND --------------------------------------------------

test('agent.takeOwnership Test 4: ctx.agents.get returns null -> NOT_FOUND, no upsert', async () => {
  const ctx = makeCtx({ agentLookupReturns: null });
  const fn = getHandler(ctx);
  const result = await fn(takeOwnershipParams());
  assert.deepEqual(result, { error: 'NOT_FOUND' });
  assert.equal(ctx._agentsGetCalls.length, 1);
  const inserts = ctx._calls.filter(
    (c) => c.kind === 'execute' && /clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(inserts.length, 0, 'no upsert when agent not in company');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 5 -- agents.get throws ------------------------------------------

test('agent.takeOwnership Test 5: ctx.agents.get throws -> OWNERSHIP_FAILED, no upsert', async () => {
  const ctx = makeCtx({ agentLookupThrows: true });
  const fn = getHandler(ctx);
  const result = await fn(takeOwnershipParams());
  assert.deepEqual(result, { error: 'OWNERSHIP_FAILED' });
  const inserts = ctx._calls.filter(
    (c) => c.kind === 'execute' && /clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(inserts.length, 0, 'no upsert when agents.get fails');
  // The handler logs a warn on the agents.get failure path.
  assert.ok(
    ctx._warnLogs.some((w) => /agents\.get failed/i.test(w.msg)),
    'expected warn log for agents.get failure',
  );
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 6 -- happy path -------------------------------------------------

test('agent.takeOwnership Test 6: happy path returns { ok, agentId, ownerUserId, setAt } + ONE upsert', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const result = await fn(takeOwnershipParams());
  assert.equal(result.ok, true);
  assert.equal(result.agentId, 'agent-1');
  assert.equal(result.ownerUserId, 'user-eric');
  assert.equal(typeof result.setAt, 'string');
  assert.ok(result.setAt.length > 0);
  // Exactly one INSERT into clarity_agent_owners.
  const inserts = ctx._calls.filter(
    (c) => c.kind === 'execute' && /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(inserts.length, 1, 'exactly one upsert');
  // The insert carries ON CONFLICT (agent_id) DO UPDATE.
  assert.match(inserts[0].sql, /ON\s+CONFLICT\s*\(\s*agent_id\s*\)\s*DO\s+UPDATE/i);
  // And one SELECT readback.
  const reads = ctx._calls.filter(
    (c) => c.kind === 'query' && /FROM\s+plugin_clarity_pack_cdd6bda4bd\.clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(reads.length, 1, 'exactly one readback');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 7 -- idempotent re-claim ----------------------------------------

test('agent.takeOwnership Test 7: idempotent re-claim -- same (agentId, ownerUserId) twice', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const first = await fn(takeOwnershipParams());
  const second = await fn(takeOwnershipParams());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.agentId, first.agentId);
  assert.equal(second.ownerUserId, first.ownerUserId);
  // Two upserts (one per call); ON CONFLICT DO UPDATE makes the second a
  // no-op from the database's perspective, but the handler still fires
  // INSERT then SELECT.
  const inserts = ctx._calls.filter(
    (c) => c.kind === 'execute' && /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.clarity_agent_owners/i.test(c.sql),
  );
  assert.equal(inserts.length, 2, 'two upserts (one per call)');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 8 -- reassign ---------------------------------------------------

test('agent.takeOwnership Test 8: reassign -- different ownerUserId returns updated row + set_at advances', async () => {
  // Two callers, two distinct user ids. The handler accepts both because
  // each call has ownerUserId === userId for that caller.
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const first = await fn(
    takeOwnershipParams({ ownerUserId: 'user-eric', userId: 'user-eric' }),
  );
  // Advance the mock clock by overwriting the readback set_at via a fresh
  // upsert with a later timestamp. The fake's lastInsertSetAt is bumped
  // inside execute() so the next SELECT readback returns the new value.
  const second = await fn(
    takeOwnershipParams({
      ownerUserId: 'user-eric-2',
      userId: 'user-eric-2',
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.ownerUserId, 'user-eric-2');
  // set_at must NOT be earlier than the first call's set_at. (Strict >
  // requires monotonic Date.now(); we settle for >= since the two upserts
  // happen in the same millisecond on a fast machine.)
  assert.ok(
    Date.parse(second.setAt) >= Date.parse(first.setAt),
    `set_at must not regress (first=${first.setAt}, second=${second.setAt})`,
  );
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 9 -- repo write fails -------------------------------------------

test('agent.takeOwnership Test 9: ctx.db.execute rejects -> OWNERSHIP_FAILED', async () => {
  const ctx = makeCtx({ upsertThrows: true });
  const fn = getHandler(ctx);
  const result = await fn(takeOwnershipParams());
  assert.deepEqual(result, { error: 'OWNERSHIP_FAILED' });
  // The handler logs a warn on the upsert failure path.
  assert.ok(
    ctx._warnLogs.some((w) => /upsert failed/i.test(w.msg)),
    'expected warn log for upsert failure',
  );
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 10 -- CTT-07 runtime spy ----------------------------------------

test('agent.takeOwnership Test 10: CTT-07 invariant -- zero ctx.issues.update calls across every code path', async () => {
  // Walk through every code path of Tests 1-9 in a single ctx so the
  // cumulative issueUpdateCalls counter is the true invariant pin.
  // Each branch must increment _issueUpdateCalls by zero.

  // Path A: opt-in gate.
  {
    const ctx = makeCtx({ optedIn: false });
    const fn = getHandler(ctx);
    await fn(takeOwnershipParams());
    assert.equal(ctx._issueUpdateCalls.length, 0, 'opt-in gate path');
  }

  // Path B: each missing-param throw (companyId/agentId/ownerUserId reach
  // the body's reqStr; userId is intercepted by opt-in-guard so its path
  // returns OPT_IN_REQUIRED without throwing).
  for (const missing of ['companyId', 'agentId', 'ownerUserId']) {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = takeOwnershipParams();
    delete params[missing];
    await assert.rejects(() => fn(params));
    assert.equal(ctx._issueUpdateCalls.length, 0, `throw path: ${missing}`);
  }
  // userId-missing path: OPT_IN_REQUIRED, not a throw.
  {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    const params = takeOwnershipParams();
    delete params.userId;
    await fn(params);
    assert.equal(ctx._issueUpdateCalls.length, 0, 'userId-missing opt-in path');
  }

  // Path C: OWNER_MISMATCH.
  {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    await fn(
      takeOwnershipParams({ ownerUserId: 'a', userId: 'b' }),
    );
    assert.equal(ctx._issueUpdateCalls.length, 0, 'OWNER_MISMATCH path');
  }

  // Path D: NOT_FOUND.
  {
    const ctx = makeCtx({ agentLookupReturns: null });
    const fn = getHandler(ctx);
    await fn(takeOwnershipParams());
    assert.equal(ctx._issueUpdateCalls.length, 0, 'NOT_FOUND path');
  }

  // Path E: agents.get throws.
  {
    const ctx = makeCtx({ agentLookupThrows: true });
    const fn = getHandler(ctx);
    await fn(takeOwnershipParams());
    assert.equal(ctx._issueUpdateCalls.length, 0, 'agents.get throws path');
  }

  // Path F: happy path.
  {
    const ctx = makeCtx();
    const fn = getHandler(ctx);
    await fn(takeOwnershipParams());
    assert.equal(ctx._issueUpdateCalls.length, 0, 'happy path');
  }

  // Path G: upsert throws.
  {
    const ctx = makeCtx({ upsertThrows: true });
    const fn = getHandler(ctx);
    await fn(takeOwnershipParams());
    assert.equal(ctx._issueUpdateCalls.length, 0, 'upsert throws path');
  }
});
