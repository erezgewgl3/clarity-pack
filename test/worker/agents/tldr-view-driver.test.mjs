// test/worker/agents/tldr-view-driver.test.mjs
//
// View-driven rework (2026-05-28) — driveTldrCompileStep advances a TL;DR by one
// step in the CALLER's valid request scope (the issue.reader data handler calls
// it). This replaces the dead scheduled-job/heartbeat driver on
// paperclipai@2026.525.0. Opening a task's Reader becomes the compile trigger;
// cache hits return instantly (no recompile).
//
// Pins: cache-hit returns instantly (no op created); cache-miss with a resolvable
// agent starts the compile (compiling); a ready in-flight op is consumed + cached
// + the op marked done; no resolvable agent → unavailable; the truncated flag
// flows through.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { driveTldrCompileStep } from '../../../src/worker/agents/editor.ts';
import { operationOriginKind } from '../../../src/worker/agents/agent-task-delivery.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

const CID = 'co-1';
const EDITOR_UUID = '618eec58-2a0d-422f-9fbd-672c0cdddf2c';
const ISSUE = 'BEAAA-702';

// A ctx with: in-memory tldr_cache, an issues surface
// (list/create/update/requestWakeup/documents/listComments), an agents surface
// whose managed.reconcile resolves the editor id (the authoritative source), and a
// controllable document readback.
function makeCtx({ seedTldr = [], seedOps = [], ready = false, resultBody = 'crisp tldr', agentStatus = 'idle', reconcileEditorId = EDITOR_UUID } = {}) {
  const tldrCache = [...seedTldr];
  const operationIssues = [...seedOps]; // {id, originId, originKind, status, assigneeAgentId}
  const updates = [];
  const state = { ready, resultBody };

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    // resolveEditorAgentId resolves the editor from the AUTHORITATIVE managed-agent
    // registry (ctx.agents.managed.reconcile by stable key) — the same source
    // compile-bulletin trusts — NOT from an op-issue assignee (debug
    // tldr-compile-op-misassigned-agent, 2026-06-18). `get` is still used for the
    // paused-status check.
    agents: {
      async get() { return { status: agentStatus, pausedAt: agentStatus === 'paused' ? new Date().toISOString() : null }; },
      managed: { async reconcile() { return { agentId: reconcileEditorId }; } },
    },
    db: {
      async query(sql, params) {
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scopeId] = params;
          return tldrCache
            .filter((r) => r.surface === surface && r.scope_id === scopeId)
            .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))
            .slice(0, 1);
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) return [];
        return [];
      },
      async execute(sql, params) {
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scope_id, content_hash, body, generated_at, , , tags] = params;
          tldrCache.push({ surface, scope_id, content_hash, body, generated_at, tags });
        }
        return { rowCount: 1 };
      },
    },
    issues: {
      async list(input = {}) {
        if (input.originKindPrefix) {
          return operationIssues.filter(
            (oi) =>
              oi.originKind &&
              oi.originKind.startsWith(input.originKindPrefix) &&
              (input.originId === undefined || oi.originId === input.originId),
          );
        }
        return [];
      },
      async create(args) {
        const created = { id: `op-${operationIssues.length + 1}`, status: 'todo', assigneeAgentId: args.assigneeAgentId, originId: args.originId, originKind: args.originKind, createdAt: new Date() };
        operationIssues.push(created);
        return created;
      },
      async update(issueId, patch) {
        updates.push({ issueId, patch });
        const op = operationIssues.find((o) => o.id === issueId);
        if (op && patch.status) op.status = patch.status;
        return { id: issueId };
      },
      async requestWakeup() { return { queued: true }; },
      async listComments() { return []; },
      documents: {
        async list(issueId) { return state.ready ? [{ id: 'd', issueId, key: 'compile-result', format: 'markdown', createdAt: new Date(), updatedAt: new Date() }] : []; },
        async get(issueId, key) { return state.ready && key === 'compile-result' ? { id: 'd', issueId, key, format: 'markdown', createdAt: new Date(), updatedAt: new Date(), body: state.resultBody } : null; },
      },
    },
  };
  return { ctx, tldrCache, operationIssues, updates, state };
}

const inputs = { body: 'a normal-length task body', comments: [], refs: ['BEAAA-1'] };
// A prior done op (consume-before-spawn read-back fodder). The editor id itself is
// resolved from the managed registry (agents.managed.reconcile), not this op's
// assignee — see makeCtx (debug tldr-compile-op-misassigned-agent).
const seededAgentOp = { id: 'op-seed', originId: 'cycle-1', originKind: operationOriginKind('bulletin-compile'), status: 'done', assigneeAgentId: EDITOR_UUID };

test('driveTldrCompileStep — cache HIT returns instantly, no op created (no recompile)', async () => {
  resetCircuitBreakerState();
  // contentHash for these inputs is computed internally; seed a row with the matching hash by
  // letting a first miss-compile populate it, then re-run. Simpler: seed via a first pass.
  const { ctx, operationIssues } = makeCtx({ seedOps: [seededAgentOp], ready: true, resultBody: 'cached body' });
  // First pass: miss → start → ready → consume → cache.
  const first = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(first.status, 'cached', `first pass should consume the ready result; got ${first.status}`);
  const opsAfterFirst = operationIssues.length;
  // Second pass: identical inputs → cache HIT → instant, no new op.
  const second = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(second.status, 'cached');
  assert.ok(second.tldr && second.tldr.body === 'cached body', 'returns the cached TL;DR');
  assert.equal(operationIssues.length, opsAfterFirst, 'cache hit creates NO new operation issue (no recompile)');
});

test('driveTldrCompileStep — cache MISS, agent not yet answered → status compiling, one op started', async () => {
  resetCircuitBreakerState();
  const { ctx, operationIssues } = makeCtx({ seedOps: [seededAgentOp], ready: false });
  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(res.status, 'compiling', `cache miss + slow agent → compiling; got ${res.status}`);
  assert.equal(res.tldr, null);
  // One tldr-compile op was started (besides the seeded bulletin op).
  const tldrOps = operationIssues.filter((o) => o.originKind.includes('tldr-compile'));
  assert.equal(tldrOps.length, 1, 'exactly one tldr-compile op started');
});

test('driveTldrCompileStep — cache MISS, agent answered → consumes, caches, marks op done', async () => {
  resetCircuitBreakerState();
  const { ctx, tldrCache, updates } = makeCtx({ seedOps: [seededAgentOp], ready: true, resultBody: 'the freshly compiled tldr' });
  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(res.status, 'cached');
  assert.equal(res.tldr.body, 'the freshly compiled tldr');
  assert.ok(tldrCache.some((r) => r.scope_id === ISSUE), 'the TL;DR was cached');
  assert.ok(updates.some((u) => u.patch.status === 'done'), 'the consumed op issue is marked done (so a task edit recompiles)');
});

test('driveTldrCompileStep — no resolvable Editor-Agent (registry returns null) → unavailable, no compile', async () => {
  resetCircuitBreakerState();
  // The managed registry resolves no editor (e.g. not yet registered) → null.
  const { ctx, operationIssues } = makeCtx({ seedOps: [], ready: false, reconcileEditorId: null });
  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(res.status, 'unavailable', `no agent resolvable → unavailable; got ${res.status}`);
  assert.equal(operationIssues.length, 0, 'no compile started when the agent cannot be resolved');
});

test('driveTldrCompileStep — a PAUSED Editor-Agent → status paused, no op started, no auto-resume', async () => {
  resetCircuitBreakerState();
  const { ctx, operationIssues, updates } = makeCtx({ seedOps: [seededAgentOp], ready: true, agentStatus: 'paused' });
  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });
  assert.equal(res.status, 'paused', `paused agent → status paused; got ${res.status}`);
  // No tldr-compile op started (the agent won't process it), and we never resumed it.
  const tldrOps = operationIssues.filter((o) => o.originKind.includes('tldr-compile'));
  assert.equal(tldrOps.length, 0, 'no compile started against a paused agent');
  assert.equal(updates.filter((u) => u.patch?.status === 'idle').length, 0, 'the driver must NOT auto-resume the agent');
});

test('driveTldrCompileStep — truncated flag flows through to the result on a big task', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx({ seedOps: [seededAgentOp], ready: true, resultBody: 'tldr of a huge task' });
  const big = { body: 'q'.repeat(200_000), comments: [], refs: [] };
  const res = await driveTldrCompileStep(ctx, { issueId: 'BEAAA-BIG', companyId: CID, inputs: big });
  assert.equal(res.status, 'cached');
  assert.equal(res.truncated, true, 'a truncated big-task compile is flagged so the Reader can surface it');
});
