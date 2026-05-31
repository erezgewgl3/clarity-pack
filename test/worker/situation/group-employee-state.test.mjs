// test/worker/situation/group-employee-state.test.mjs
//
// Plan 09-01 Task 1 (RED) — the pure worker-tier group classifier (R2).
//
// Maps the locked 6-value EmployeeState union to the 3-value display group
// the UI renders verbatim (R2 — worker-tier grouping, UI does no re-sort):
//   needs_you = blocked
//   working   = running | reviewing
//   idle      = idle | stale | unknown   (unknown degrades to idle — it NEVER
//               lands in needs_you/working, the degrade-safe fallback)
//
// Pure-function discipline: no SDK import, no I/O — same as
// classify-employee-state.ts (single source of truth for the mapping).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { groupForState } from '../../../src/worker/situation/group-employee-state.ts';

// ---- 1-6: each state maps to its locked group ------------------------------

test('groupForState: blocked → needs_you', () => {
  assert.equal(groupForState('blocked'), 'needs_you');
});

test('groupForState: running → working', () => {
  assert.equal(groupForState('running'), 'working');
});

test('groupForState: reviewing → working', () => {
  assert.equal(groupForState('reviewing'), 'working');
});

test('groupForState: idle → idle', () => {
  assert.equal(groupForState('idle'), 'idle');
});

test('groupForState: stale → idle', () => {
  assert.equal(groupForState('stale'), 'idle');
});

test('groupForState: unknown → idle (degrade-safe fallback)', () => {
  // unknown must NEVER land in needs_you or working — it degrades to idle.
  assert.equal(groupForState('unknown'), 'idle');
});

// ---- 7: exhaustiveness — every EmployeeState maps to exactly one group ------

test('groupForState: every EmployeeState maps to exactly one EmployeeGroup', () => {
  const ALL_STATES = ['running', 'reviewing', 'blocked', 'idle', 'stale', 'unknown'];
  const VALID_GROUPS = new Set(['needs_you', 'working', 'idle']);
  for (const state of ALL_STATES) {
    const group = groupForState(state);
    assert.ok(
      VALID_GROUPS.has(group),
      `state '${state}' produced invalid group '${group}'`,
    );
  }
  // And unknown specifically degrades safe (never needs_you/working).
  assert.equal(groupForState('unknown'), 'idle');
  // Sanity: the three buckets are all reachable from the union.
  const produced = new Set(ALL_STATES.map((s) => groupForState(s)));
  assert.deepEqual([...produced].sort(), ['idle', 'needs_you', 'working']);
});
