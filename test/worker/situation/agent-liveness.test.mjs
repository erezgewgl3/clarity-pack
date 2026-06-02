// test/worker/situation/agent-liveness.test.mjs
//
// Plan 11-02 Task 1 RED — the pure worker liveness helper resolveAgentState
// (D-02/D-03/D-04). Projects an agent's heartbeat/run-state to the engine's
// injected agentState string ('working' | 'stuck' | null).
//
// This is the SINGLE liveness source both buildEdges (Task 2) and the rollup
// (Plan 11-03) import — no liveness math lives in the engine. The helper is
// pure: nowMs is injected (mirrors classify-employee-state.ts), so every
// boundary is deterministically unit-testable.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveAgentState } from '../../../src/worker/situation/agent-liveness.ts';

const MINUTE = 60 * 1000;
const NOW = 1_000_000_000_000;

// ---------------------------------------------------------------------------
// working — fresh heartbeat (under the stale window)
// ---------------------------------------------------------------------------

test('resolveAgentState — fresh heartbeat (1 min old) → working', () => {
  const state = resolveAgentState({
    lastHeartbeatMs: NOW - 1 * MINUTE,
    hasQueuedWork: true,
    nowMs: NOW,
  });
  assert.equal(state, 'working');
});

test('resolveAgentState — heartbeat just under the default 10-min stale window → working', () => {
  // Default stale window = 2 * RUNNING_WINDOW_MS (5 min) = 10 min.
  const state = resolveAgentState({
    lastHeartbeatMs: NOW - (10 * MINUTE - 1),
    hasQueuedWork: false,
    nowMs: NOW,
  });
  assert.equal(state, 'working');
});

// ---------------------------------------------------------------------------
// stuck — stale heartbeat AND nothing queued (D-02)
// ---------------------------------------------------------------------------

test('resolveAgentState — stale heartbeat AND no queued work → stuck (D-02)', () => {
  const state = resolveAgentState({
    lastHeartbeatMs: NOW - 30 * MINUTE,
    hasQueuedWork: false,
    nowMs: NOW,
  });
  assert.equal(state, 'stuck');
});

test('resolveAgentState — stale heartbeat BUT has queued work → working (not stuck — D-02 needs BOTH)', () => {
  const state = resolveAgentState({
    lastHeartbeatMs: NOW - 30 * MINUTE,
    hasQueuedWork: true,
    nowMs: NOW,
  });
  assert.equal(state, 'working');
});

// ---------------------------------------------------------------------------
// D-04 conservative — missing heartbeat (Infinity age) ⇒ stuck
// ---------------------------------------------------------------------------

test('resolveAgentState — null lastHeartbeatMs (heartbeatAge=Infinity) → stuck (D-04 conservative)', () => {
  const state = resolveAgentState({
    lastHeartbeatMs: null,
    hasQueuedWork: false,
    nowMs: NOW,
  });
  assert.equal(state, 'stuck');
});

test('resolveAgentState — null heartbeat even WITH queued work → stuck (no signal ⇒ conservative stuck)', () => {
  const state = resolveAgentState({
    lastHeartbeatMs: null,
    hasQueuedWork: true,
    nowMs: NOW,
  });
  assert.equal(state, 'stuck');
});

// ---------------------------------------------------------------------------
// D-03 self-tuning — expectedCadenceMs widens the stale window to 2x cadence
// ---------------------------------------------------------------------------

test('resolveAgentState — expectedCadenceMs widens stale window to 2x cadence (D-03)', () => {
  // cadence 20 min ⇒ stale window 40 min. A 30-min-old heartbeat is fresh.
  const fresh = resolveAgentState({
    lastHeartbeatMs: NOW - 30 * MINUTE,
    hasQueuedWork: false,
    nowMs: NOW,
    expectedCadenceMs: 20 * MINUTE,
  });
  assert.equal(fresh, 'working');

  // Same heartbeat is stale at the default 5-min cadence (10-min window).
  const stale = resolveAgentState({
    lastHeartbeatMs: NOW - 30 * MINUTE,
    hasQueuedWork: false,
    nowMs: NOW,
  });
  assert.equal(stale, 'stuck');
});

// ---------------------------------------------------------------------------
// Purity — no wall-clock read (nowMs is injected)
// ---------------------------------------------------------------------------

test('resolveAgentState — deterministic across calls with identical input (pure)', () => {
  const args = { lastHeartbeatMs: NOW - 7 * MINUTE, hasQueuedWork: false, nowMs: NOW };
  const a = resolveAgentState({ ...args });
  const b = resolveAgentState({ ...args });
  assert.equal(a, b);
});
