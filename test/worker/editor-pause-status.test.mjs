// test/worker/editor-pause-status.test.mjs
//
// Quick task 260528-mn0 (2026-05-28) — STALE-READ FIX. `editor.pause-status`
// now derives `paused` from the agent's REAL status (resolved via
// ctx.agents.managed.reconcile → ctx.agents.get(uuid)), NOT from the stale
// editor_agent_failures heuristic. recordSuccess writes no failure row, so the
// old `consecutive >= MAX` heuristic latched "paused" forever after a genuine
// resume — the operator saw a red banner on an active agent.
//
// New contract:
//   - active agent (status:'idle', pausedAt:null) → paused:false EVEN with a
//     stale consecutive>=MAX failure row (the regression this fix closes).
//   - paused agent (status:'paused' OR pausedAt!=null) → paused:true; agentName
//     resolved via the RESOLVED UUID (never the 'editor-agent' key, never the
//     UUID leaked to the UI as a name).
//   - reconcile/get unavailable or throwing → FALL BACK to the legacy
//     failure-table heuristic (consecutive>=MAX), agentName null. Never worse
//     than before.
//   - companyId absent / no agents client → legacy heuristic (preserves the
//     issue-reader-integration.test.mjs companyId-less contract).
//
// Still a DISCRIMINATED UNION:
//   { paused:false, lastFailureAt:null, reason:null }
//   { paused:true, cause:'operator'|'budget'|'adapter', agentName, [detail],
//     lastFailureAt, reason }   ← legacy fields kept for editor-only pause-banner.tsx

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerEditorPauseStatus,
} from '../../src/worker/handlers/editor-pause-status.ts';
import { MAX_CONSECUTIVE_FAILURES } from '../../src/worker/agents/circuit-breaker.ts';

const EDITOR_AGENT_UUID = 'b2a22e50-00ed-itor-aaaa-aaaaaaaaaaaa';

function makeFakeCtx({
  rows = [],
  throwOnQuery = false,
  agentName = 'Editorial Desk',
  agentStatus = 'idle',
  agentPausedAt = null,
  agentsGetThrows = false,
  reconcileThrows = false,
  agentId = EDITOR_AGENT_UUID,
  omitAgents = false,
} = {}) {
  const registered = new Map();
  const agentsGetCalls = [];
  const reconcileCalls = [];
  const ctx = {
    data: {
      register(key, handler) {
        registered.set(key, handler);
      },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          // opt-in-guard probe — return opted-in.
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        if (/editor_agent_failures/.test(sql)) {
          if (throwOnQuery) throw new Error('boom');
          return rows;
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    logger: { warn() {}, info() {}, error() {} },
  };
  if (!omitAgents) {
    ctx.agents = {
      managed: {
        async reconcile(key, companyId) {
          reconcileCalls.push({ key, companyId });
          if (reconcileThrows) throw new Error('reconcile failure');
          return { agentId, agent: agentId ? { id: agentId } : null, status: agentStatus };
        },
      },
      async get(agentUuid, companyId) {
        agentsGetCalls.push({ agentUuid, companyId });
        if (agentsGetThrows) throw new Error('agents.get failure');
        return { id: agentUuid, name: agentName, status: agentStatus, pausedAt: agentPausedAt };
      },
    };
  }
  return { ctx, registered, agentsGetCalls, reconcileCalls };
}

function getHandler(ctx, registered) {
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  assert.ok(handler, 'editor.pause-status was registered');
  return handler;
}

test('editor.pause-status — no failure rows + active agent → paused:false', async () => {
  const { ctx, registered } = makeFakeCtx({ rows: [], agentStatus: 'idle' });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false);
});

test('STALE-READ FIX — active agent (status:idle) + stale consecutive>=MAX failure row → paused:FALSE', async () => {
  // This is the exact production symptom: a real resume left a stale
  // consecutive>=3 row; the old heuristic showed a false "paused" banner on an
  // active agent. Authoritative status now wins.
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-20T10:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES + 5 }],
    agentStatus: 'idle',
    agentPausedAt: null,
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false, 'active agent → banner gone despite stale failure row');
});

test('editor.pause-status — genuinely paused agent (status:paused) → paused:true + agentName resolved', async () => {
  const { ctx, registered, agentsGetCalls, reconcileCalls } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: 1 }],
    agentStatus: 'paused',
    agentName: 'Editorial Desk',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true, 'paused agent → paused:true even with consecutive < MAX');
  assert.equal(result.agentName, 'Editorial Desk');
  assert.ok(reconcileCalls.length >= 1, 'reconcile resolves the Editor-Agent UUID first');
  assert.ok(agentsGetCalls.length >= 1, 'ctx.agents.get called');
});

test('FIX (b) — ctx.agents.get is called with the RESOLVED UUID, not the editor-agent KEY', async () => {
  const { ctx, registered, agentsGetCalls } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: 1 }],
    agentStatus: 'paused',
  });
  const handler = getHandler(ctx, registered);
  await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(agentsGetCalls[0].agentUuid, EDITOR_AGENT_UUID, 'get receives the reconciled UUID');
  assert.notEqual(agentsGetCalls[0].agentUuid, 'editor-agent', 'get must NOT receive the key (uuid-cast throw)');
});

test('editor.pause-status — paused via pausedAt != null (status not "paused") → paused:true', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [],
    agentStatus: 'idle',
    agentPausedAt: '2026-05-28T09:00:00Z',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true, 'pausedAt set → paused:true');
});

test('editor.pause-status — paused agent with NO failure row → paused:true, cause operator, legacy fields null', async () => {
  const { ctx, registered } = makeFakeCtx({ rows: [], agentStatus: 'paused' });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'operator', 'no reason row → operator (default)');
  assert.equal(result.lastFailureAt, null);
  assert.equal(result.reason, null);
});

test('D-07 cause derivation — reason contains "budget" → cause:"budget" (agent paused)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T10:30:00Z', reason: 'agent budget exhausted (caps hit)', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentStatus: 'paused',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'budget');
  assert.equal(result.lastFailureAt, '2026-05-25T10:30:00Z', 'legacy field preserved when paused');
});

test('D-07 cause derivation — reason contains "codex"/"adapter" → cause:"adapter" + detail HH:MM (agent paused)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T14:07:00Z', reason: 'codex adapter timeout', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentStatus: 'paused',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'adapter');
  assert.match(result.detail, /^\d{2}:\d{2}$/, 'detail is HH:MM');
});

test('D-07 cause derivation — generic reason → cause:"operator" (agent paused)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentStatus: 'paused',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'operator');
});

test('FALLBACK — reconcile throws → legacy heuristic (consecutive>=MAX → paused:true), agentName null', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES }],
    reconcileThrows: true,
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true, 'reconcile failure → fall back to heuristic');
  assert.equal(result.agentName, null, 'agentName degrades to null on resolution failure');
});

test('FALLBACK — ctx.agents.get throws → legacy heuristic, agentName null, NO UUID leak', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentsGetThrows: true,
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true, 'get failure → fall back to heuristic');
  assert.equal(result.agentName, null);
  assert.doesNotMatch(JSON.stringify(result), /b2a22e50/, 'no UUID fragment leaked as name');
});

test('FALLBACK — reconcile throws + below-threshold row → paused:false (heuristic honors threshold)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES - 1 }],
    reconcileThrows: true,
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false);
});

test('FALLBACK — no companyId → legacy heuristic (no reconcile/get attempted)', async () => {
  const { ctx, registered, reconcileCalls, agentsGetCalls } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES }],
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric' });
  assert.equal(result.paused, true, 'companyId-less → heuristic');
  assert.equal(result.agentName, null);
  assert.equal(reconcileCalls.length, 0, 'no companyId → no reconcile');
  assert.equal(agentsGetCalls.length, 0, 'no companyId → no get');
});

test('FALLBACK — no agents client on ctx → legacy heuristic', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES }],
    omitAgents: true,
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.agentName, null);
});

test('editor.pause-status — failures query throws → paused:false (catch path preserved)', async () => {
  const { ctx, registered } = makeFakeCtx({ throwOnQuery: true });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false, 'DB query throw → paused:false');
});

test('back-compat — legacy lastFailureAt + reason present when paused (editor-only banner consumes them)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:23:00Z', reason: 'compile failed', consecutive: 1 }],
    agentStatus: 'paused',
  });
  const handler = getHandler(ctx, registered);
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.lastFailureAt, '2026-05-25T11:23:00Z', 'legacy lastFailureAt preserved');
  assert.equal(result.reason, 'compile failed', 'legacy reason preserved');
});
