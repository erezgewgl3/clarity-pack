// test/worker/heartbeat-dispatcher.test.mjs
//
// Debug editor-heartbeat-db-churn (v1.4.4) — Fix 1 (batch + debounce) + the
// Fix-2 read-side short-circuit. The dispatcher:
//   - drops the plugin's OWN operation-issue events before any reconcile (Fix 2),
//   - drops plugin-authored events (actorType 'plugin'),
//   - coalesces a burst of events into ONE reconcile + ONE batched heartbeat per
//     company per debounce window (Fix 1),
//   - dedupes issue ids within the window,
//   - flushes early when the per-company batch cap is hit,
//   - caches the resolved agent id across flushes.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HeartbeatDispatcher,
} from '../../src/worker/agents/heartbeat-dispatcher.ts';
import {
  rememberOwnOperationIssue,
} from '../../src/worker/agents/op-issue-set.ts';

/** Build a dispatcher with recording deps + a short debounce. */
function makeHarness(opts = {}) {
  const calls = { resolve: [], heartbeat: [] };
  const deps = {
    async resolveAgentId(companyId) {
      calls.resolve.push(companyId);
      // 'agentId' in opts honors an explicit null (Object.hasOwn distinguishes
      // unset from null — '??' would mask null as the default).
      return Object.hasOwn(opts, 'agentId') ? opts.agentId : 'editor-agent-uuid';
    },
    async runHeartbeat(companyId, agentId, events) {
      calls.heartbeat.push({ companyId, agentId, events });
    },
    logger: { info() {}, warn() {} },
  };
  const dispatcher = new HeartbeatDispatcher(deps, {
    debounceMs: opts.debounceMs ?? 20,
    maxBatch: opts.maxBatch ?? 50,
  });
  return { dispatcher, calls };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('Fix 1 — a burst of events for one company collapses to ONE reconcile + ONE batched heartbeat', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  for (let i = 0; i < 5; i++) {
    dispatcher.enqueue({ companyId: 'co-1', entityId: `issue-${i}`, entityType: 'issue', actorId: 'eric' });
  }
  await tick(40);
  assert.equal(calls.resolve.length, 1, 'reconcile runs once per flush, not per event');
  assert.equal(calls.heartbeat.length, 1, 'one batched heartbeat');
  assert.equal(calls.heartbeat[0].events.length, 5, 'all five distinct issues in one batch');
  assert.equal(calls.heartbeat[0].agentId, 'editor-agent-uuid');
});

test('Fix 1 — issue ids are deduped within the debounce window', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'issue-A', entityType: 'issue', actorId: 'eric' });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'issue-A', entityType: 'issue', actorId: 'eric' });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'issue-B', entityType: 'issue', actorId: 'eric' });
  await tick(40);
  assert.equal(calls.heartbeat.length, 1);
  const ids = calls.heartbeat[0].events.map((e) => e.entity_id).sort();
  assert.deepEqual(ids, ['issue-A', 'issue-B']);
});

test('Fix 2 — a remembered own-operation-issue event is dropped BEFORE any reconcile', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  const opId = 'own-op-' + Math.random().toString(36).slice(2);
  rememberOwnOperationIssue(opId);
  dispatcher.enqueue({ companyId: 'co-1', entityId: opId, entityType: 'issue', actorId: 'editor' });
  await tick(40);
  assert.equal(calls.resolve.length, 0, 'no reconcile — the self-event never scheduled a flush');
  assert.equal(calls.heartbeat.length, 0, 'no heartbeat for a self-event');
});

test('Fix 2 — a plugin-authored event (actorType "plugin") is dropped', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'issue-X', entityType: 'issue', actorType: 'plugin' });
  await tick(40);
  assert.equal(calls.resolve.length, 0);
  assert.equal(calls.heartbeat.length, 0);
});

test('events missing companyId or entityId are ignored (no throw, no flush)', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  dispatcher.enqueue({ entityId: 'issue-1', entityType: 'issue' }); // no companyId
  dispatcher.enqueue({ companyId: 'co-1', entityType: 'issue' }); // no entityId
  await tick(40);
  assert.equal(calls.heartbeat.length, 0);
});

test('Fix 1 — distinct companies flush independently (each one reconcile + heartbeat)', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 20 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i1', entityType: 'issue', actorId: 'a' });
  dispatcher.enqueue({ companyId: 'co-2', entityId: 'i2', entityType: 'issue', actorId: 'b' });
  await tick(40);
  assert.equal(calls.heartbeat.length, 2);
  const cos = calls.heartbeat.map((h) => h.companyId).sort();
  assert.deepEqual(cos, ['co-1', 'co-2']);
});

test('burst cap — hitting maxBatch distinct issues flushes immediately (before the debounce elapses)', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 10_000, maxBatch: 3 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i1', entityType: 'issue', actorId: 'a' });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i2', entityType: 'issue', actorId: 'a' });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i3', entityType: 'issue', actorId: 'a' }); // hits cap
  // No debounce wait — the cap should have flushed synchronously-ish. Give the
  // microtask/promise a beat.
  await tick(10);
  assert.equal(calls.heartbeat.length, 1, 'the cap flushed without waiting for the 10s debounce');
  assert.equal(calls.heartbeat[0].events.length, 3);
});

test('agent id is cached across flushes (one reconcile total for two windows)', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 15 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i1', entityType: 'issue', actorId: 'a' });
  await tick(30);
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i2', entityType: 'issue', actorId: 'a' });
  await tick(30);
  assert.equal(calls.heartbeat.length, 2, 'two separate flushes');
  assert.equal(calls.resolve.length, 1, 'resolve cached — only the first flush reconciled');
});

test('unresolvable agent (resolveAgentId null) skips the heartbeat for that flush', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 15, agentId: null });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i1', entityType: 'issue', actorId: 'a' });
  await tick(30);
  assert.equal(calls.resolve.length, 1);
  assert.equal(calls.heartbeat.length, 0, 'no agent → no heartbeat');
});

test('flushAll drains pending buffers synchronously (shutdown/test path)', async () => {
  const { dispatcher, calls } = makeHarness({ debounceMs: 10_000 });
  dispatcher.enqueue({ companyId: 'co-1', entityId: 'i1', entityType: 'issue', actorId: 'a' });
  assert.equal(calls.heartbeat.length, 0, 'nothing flushed yet (10s debounce)');
  await dispatcher.flushAll();
  assert.equal(calls.heartbeat.length, 1, 'flushAll drained the pending buffer');
});
