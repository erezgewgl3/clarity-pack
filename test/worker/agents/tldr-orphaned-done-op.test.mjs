// test/worker/agents/tldr-orphaned-done-op.test.mjs
//
// Debug: reader-tldr-stuck-compiling (2026-05-30) — the Reader sticks on
// "Compiling TL;DR…" forever on live BEAAA v1.2.0.
//
// ROOT CAUSE (validated against src/worker/agents/agent-task-delivery.ts +
// editor.ts): the Editor-Agent compiles successfully, files the `compile-result`
// document, and marks the operation issue `done` (~1m36s). On the NEXT Reader
// poll, `driveTldrCompileStep` cache-misses and calls `startAgentTask`, whose
// idempotency search EXCLUDES terminal (`done`/`cancelled`) ops
// (TERMINAL_STATUSES) — so it spawns a BRAND-NEW empty op and polls THAT,
// returning `compiling`. The just-completed op's result document is ORPHANED.
// The only mechanism that would consume a `done` op's result on a later tick —
// `drainTldrOperations` — is dead (it runs only from the scope-dead
// compile-bulletin job, PR #6547). Net: tldr_cache is never written from the
// view path; the Reader loops forever respawning ops.
//
// THE FIX (decoupling "don't re-DRIVE a done op" from "DO read its result"): on
// cache-miss, FIRST poll the most-recent EXISTING tldr-compile op for this scope
// — INCLUDING a recently-`done` one within the recency window — via
// pollAgentTaskResult; on a valid `compile-result` document, finalizeTldr +
// return `status:'cached'`. Only spawn a NEW op if no existing op has a
// consumable result.
//
// This test models the production bug with PER-OP document fidelity: the result
// document is attached ONLY to the pre-existing `done` op. A freshly-spawned op
// has NO document — so the only way to reach `cached` is to poll the done op.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { driveTldrCompileStep } from '../../../src/worker/agents/editor.ts';
import { operationOriginKind } from '../../../src/worker/agents/agent-task-delivery.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

const CID = 'co-1';
const EDITOR_UUID = '618eec58-2a0d-422f-9fbd-672c0cdddf2c';
const ISSUE = 'BEAAA-1101';

const inputs = { body: 'a normal-length task body', comments: [], refs: ['BEAAA-1'] };

// A ctx whose document readback is PER-OP: only ops listed in `docsByOpId` have
// a `compile-result` document. This is the fidelity the live bug needs — a
// freshly-spawned op must come back EMPTY so the test can only go `cached` by
// reading the pre-existing done op's result.
function makeCtx({ seedTldr = [], seedOps = [], docsByOpId = {} } = {}) {
  const tldrCache = [...seedTldr];
  const operationIssues = [...seedOps]; // {id, originId, originKind, status, assigneeAgentId, createdAt}
  const updates = [];

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    // The editor id is resolved from the managed registry (the authoritative,
    // non-poisonable source — debug tldr-compile-op-misassigned-agent, 2026-06-18),
    // NOT from an op-issue assignee. `get` is used only for the paused check.
    agents: {
      async get() { return { status: 'idle', pausedAt: null }; },
      managed: { async reconcile() { return { agentId: EDITOR_UUID }; } },
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
        const created = {
          id: `op-new-${operationIssues.length + 1}`,
          status: 'todo',
          assigneeAgentId: args.assigneeAgentId,
          originId: args.originId,
          originKind: args.originKind,
          createdAt: new Date(),
        };
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
        // PER-OP: only ops present in docsByOpId carry a compile-result document.
        async list(issueId) {
          return docsByOpId[issueId]
            ? [{ id: `d-${issueId}`, issueId, key: 'compile-result', format: 'markdown', createdAt: new Date(), updatedAt: new Date() }]
            : [];
        },
        async get(issueId, key) {
          if (key === 'compile-result' && docsByOpId[issueId]) {
            return { id: `d-${issueId}`, issueId, key, format: 'markdown', createdAt: new Date(), updatedAt: new Date(), body: docsByOpId[issueId] };
          }
          return null;
        },
      },
    },
  };
  return { ctx, tldrCache, operationIssues, updates };
}

// The pre-existing, recently-DONE op carrying a valid compile-result document.
// Its originId matches the scope (`tldr-<issueId>`), so the idempotency search
// finds it — but TERMINAL_STATUSES excludes it from REUSE today.
const doneOpId = 'op-done-911d5';
const doneOp = {
  id: doneOpId,
  originId: `tldr-${ISSUE}`,
  originKind: operationOriginKind('tldr-compile'),
  status: 'done',
  assigneeAgentId: EDITOR_UUID,
  createdAt: new Date(Date.now() - 96_000), // ~1m36s ago, the observed live duration
};

test('driveTldrCompileStep — cache MISS + a recently-DONE op with a valid result document → consumes it, caches, returns cached (NOT compiling)', async () => {
  resetCircuitBreakerState();
  const { ctx, tldrCache, operationIssues } = makeCtx({
    seedOps: [doneOp],
    docsByOpId: { [doneOpId]: 'The Editorial Desk TL;DR for BEAAA-1101.' },
  });

  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });

  // The live bug: this returns `compiling` (spawns a new empty op, ignores the
  // done op's document). The fix must read the done op's result and cache it.
  assert.equal(
    res.status,
    'cached',
    `a completed op's result must be consumed, not re-spawned; got ${res.status}`,
  );
  assert.ok(res.tldr, 'the TL;DR row is returned, not null');
  assert.equal(res.tldr.body, 'The Editorial Desk TL;DR for BEAAA-1101.', 'the cached body is the done op result');
  assert.ok(tldrCache.some((r) => r.scope_id === ISSUE), 'the result is written to tldr_cache');

  // And it must NOT have spawned a fresh empty op to poll.
  const spawned = operationIssues.filter((o) => o.id.startsWith('op-new-'));
  assert.equal(spawned.length, 0, 'no NEW operation issue is spawned when a completed op already has a result');
});

test('driveTldrCompileStep — cache MISS + a recently-DONE op with NO result document → spawns a fresh compile (compiling)', async () => {
  // Guard the fix does not over-reach: a done op that filed no consumable result
  // (edge case) must still fall through to a fresh compile, not hang.
  resetCircuitBreakerState();
  const { ctx, operationIssues } = makeCtx({
    seedOps: [doneOp],
    docsByOpId: {}, // the done op carries NO compile-result document
  });

  const res = await driveTldrCompileStep(ctx, { issueId: ISSUE, companyId: CID, inputs });

  assert.equal(res.status, 'compiling', `no consumable result anywhere → start a fresh compile; got ${res.status}`);
  const spawned = operationIssues.filter((o) => o.id.startsWith('op-new-'));
  assert.equal(spawned.length, 1, 'exactly one fresh tldr-compile op is started when no result is consumable');
});
