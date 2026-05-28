// test/worker/agents/tldr-cross-tick.test.mjs
//
// Delivery-layer rework (2026-05-28) — §9.2 TL;DR cross-tick.
//
// The TL;DR compile has the SAME flaw the bulletin had: the synchronous
// in-invocation 5-min poll dies with "expired invocation scope"
// (paperclipai@2026.525.0 — PR #6547), so a slow agent's TL;DR never lands and
// the Reader sticks on "Compiling TL;DR…". The fix, driven off the operation
// ISSUES (no ctx.state needed for raw-text TL;DRs):
//   - the Editor heartbeat does startAgentTask + ONE immediate poll (warm agent
//     → cache the TL;DR now); a not-ready compile is LEFT for the drainer.
//   - a DRAINER (run from the every-minute compile-bulletin job) lists in-flight
//     tldr-compile operation issues, polls each, and on `ready` writes the
//     tldr-cache (scopeId parsed from originId `tldr-<issueId>`). Already-cached
//     (fresh) ops are skipped; ops older than the recency window are given up.
//
// These tests pin the heartbeat warm/slow split + the drainer's three branches.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { handleEditorHeartbeat, drainTldrOperations } from '../../../src/worker/agents/editor.ts';
import { operationOriginKind, AGENT_TASK_DELIVERY_TIMEOUT } from '../../../src/worker/agents/agent-task-delivery.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

const EDITOR_UUID = '22222222-2222-4222-8222-222222222222';
const CID = 'company-1';

// A fake ctx with: an in-memory tldr_cache (getTldrByScope / upsertTldr), an
// issues surface (get / listComments / create / list / requestWakeup / documents)
// whose document readback is controllable, and a reconcile that resolves the
// Editor-Agent UUID. `ready` flips the document channel on.
function makeCtx({ issuesById = {}, seedOps = [], seedTldr = [], ready = false, resultBody = 'A crisp TL;DR.' } = {}) {
  const tldrCache = [...seedTldr]; // {surface, scope_id, content_hash, body, generated_at}
  const createCalls = [];
  const operationIssues = [...seedOps]; // {id, originId, originKind, createdAt, status}
  const state = { ready, resultBody };

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scopeId] = params;
          const rows = tldrCache
            .filter((r) => r.surface === surface && r.scope_id === scopeId)
            .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
          return rows.slice(0, 1);
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) return [];
        return [];
      },
      async execute(sql, params) {
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scope_id, content_hash, body, generated_at] = params;
          tldrCache.push({ surface, scope_id, content_hash, body, generated_at });
        }
        return { rowCount: 1 };
      },
    },
    agents: {
      async pause() {},
      managed: { async reconcile() { return { agentId: EDITOR_UUID, agent: { id: EDITOR_UUID }, status: 'resolved' }; } },
    },
    issues: {
      async get(id) { return issuesById[id] ?? null; },
      async listComments() { return []; },
      async create(input) {
        createCalls.push(input);
        const created = { id: `op-${createCalls.length}`, originId: input.originId, originKind: input.originKind, createdAt: new Date(), status: 'todo' };
        operationIssues.push(created);
        return created;
      },
      async list(input = {}) {
        if (input.originKindPrefix) {
          return operationIssues.filter((oi) => oi.originKind && oi.originKind.startsWith(input.originKindPrefix) && (input.originId === undefined || oi.originId === input.originId));
        }
        return [];
      },
      async requestWakeup() { return { queued: true }; },
      documents: {
        async list(issueId) {
          if (!state.ready) return [];
          return [{ id: 'd', issueId, key: 'compile-result', format: 'markdown', createdAt: new Date(), updatedAt: new Date() }];
        },
        async get(issueId, key) {
          if (!state.ready || key !== 'compile-result') return null;
          return { id: 'd', issueId, key, format: 'markdown', createdAt: new Date(), updatedAt: new Date(), body: state.resultBody };
        },
      },
    },
  };
  return { ctx, tldrCache, createCalls, operationIssues, state };
}

const heartbeatEvent = (issueId) => ({
  companyId: CID,
  agentId: EDITOR_UUID,
  events: [{ entity_type: 'issue', entity_id: issueId, author_id: 'someone-else' }],
});

test('TL;DR heartbeat — WARM agent: result document ready on the immediate poll → TL;DR cached now', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const issueId = 'BEAAA-700';
  const { ctx, tldrCache, createCalls } = makeCtx({
    issuesById: { [issueId]: { id: issueId, description: 'do the thing', originKind: 'user' } },
    ready: true,
    resultBody: 'A crisp TL;DR.',
  });

  await handleEditorHeartbeat(ctx, heartbeatEvent(issueId));

  assert.equal(createCalls.length, 1, 'exactly one tldr-compile operation issue created');
  const row = tldrCache.find((r) => r.scope_id === issueId);
  assert.ok(row, 'a warm agent result is cached during the heartbeat');
  assert.equal(row.body, 'A crisp TL;DR.', 'the cached TL;DR is the agent result body');
});

test('TL;DR heartbeat — SLOW agent: no result yet → operation issue created, NO cache write (left for the drainer)', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const issueId = 'BEAAA-710';
  const { ctx, tldrCache, createCalls } = makeCtx({
    issuesById: { [issueId]: { id: issueId, description: 'a slow one', originKind: 'user' } },
    ready: false,
  });

  await handleEditorHeartbeat(ctx, heartbeatEvent(issueId));

  assert.equal(createCalls.length, 1, 'the operation issue is created even when the agent is slow');
  assert.equal(tldrCache.length, 0, 'NO TL;DR cached on a slow heartbeat — the drainer consumes it later');
});

test('TL;DR drainer — a ready in-flight operation issue → TL;DR cached (scopeId parsed from originId)', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const issueId = 'BEAAA-720';
  const op = { id: 'op-slow-1', originId: `tldr-${issueId}`, originKind: operationOriginKind('tldr-compile'), createdAt: new Date(), status: 'done' };
  const { ctx, tldrCache } = makeCtx({
    issuesById: { [issueId]: { id: issueId, description: 'drained issue', originKind: 'user' } },
    seedOps: [op],
    ready: true,
    resultBody: 'Drained TL;DR body.',
  });

  await drainTldrOperations(ctx, CID, new Date());

  const row = tldrCache.find((r) => r.scope_id === issueId);
  assert.ok(row, 'the drainer consumed the ready operation result + cached it');
  assert.equal(row.body, 'Drained TL;DR body.');
});

test('TL;DR drainer — an already-consumed operation (fresh cache row) is skipped, no duplicate write', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const issueId = 'BEAAA-730';
  const opCreatedAt = new Date(Date.now() - 30_000);
  const op = { id: 'op-done-1', originId: `tldr-${issueId}`, originKind: operationOriginKind('tldr-compile'), createdAt: opCreatedAt, status: 'done' };
  // A cache row NEWER than the op's createdAt = already consumed.
  const { ctx, tldrCache } = makeCtx({
    issuesById: { [issueId]: { id: issueId, description: 'already done', originKind: 'user' } },
    seedOps: [op],
    seedTldr: [{ surface: 'issue', scope_id: issueId, content_hash: 'h', body: 'previously cached', generated_at: new Date().toISOString() }],
    ready: true,
    resultBody: 'should NOT overwrite',
  });

  await drainTldrOperations(ctx, CID, new Date());

  const rows = tldrCache.filter((r) => r.scope_id === issueId);
  assert.equal(rows.length, 1, 'no duplicate cache write for an already-consumed operation');
  assert.equal(rows[0].body, 'previously cached', 'the existing fresh TL;DR is left untouched');
});

test('TL;DR drainer — an operation older than the recency window is given up (no cache write even if ready)', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const issueId = 'BEAAA-740';
  const stale = new Date(Date.now() - (2 * AGENT_TASK_DELIVERY_TIMEOUT + 60_000));
  const op = { id: 'op-stale-1', originId: `tldr-${issueId}`, originKind: operationOriginKind('tldr-compile'), createdAt: stale, status: 'todo' };
  const { ctx, tldrCache } = makeCtx({
    issuesById: { [issueId]: { id: issueId, description: 'stale', originKind: 'user' } },
    seedOps: [op],
    ready: true,
    resultBody: 'too late',
  });

  await drainTldrOperations(ctx, CID, new Date());

  assert.equal(tldrCache.length, 0, 'a stale operation past the recency window is not consumed');
});
