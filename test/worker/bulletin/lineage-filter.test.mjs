// test/worker/bulletin/lineage-filter.test.mjs
//
// Plan 07-05 Task 1 RED — Phase 7 ITEM 5 (D-I5-01).
//
// The Daily Bulletin's lineage section reads like a flat activity LOG because
// it includes routine/scheduled outputs (Daily Founder digest, Daily CEO status
// report, Nightly Auditor Report) AND exact-duplicate threads. The pure filter
// `filterLineageThreads` (+ the unit-testable `isRoutineThread` predicate) drops
// routine/scheduled + exact-duplicate threads, KEEPS agent-self substantive
// threads, and is CONSERVATIVE — when the heuristic is unsure it keeps the
// thread (D-I5-01 "when unsure, keep"). Pure: no ctx, no I/O, byte-equal output
// for byte-equal input.
//
// Convention: instance-neutral fixtures (no BEAAA literal); node:test only.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  filterLineageThreads,
  isRoutineThread,
} from '../../../src/worker/bulletin/lineage-filter.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function thread(id, entityId, nodes, truncatedCount = 0) {
  return { id, entityId, nodes, truncatedCount };
}
function node(name, detail, time = '09:00', isTerminal = false) {
  return { time, name, detail, isTerminal };
}

// ---------------------------------------------------------------------------
// isRoutineThread — the conservative cadence heuristic
// ---------------------------------------------------------------------------

test('isRoutineThread: a thread whose EVERY node is a cadence/digest/report output is routine', () => {
  const t = thread('t-routine', 'iss-routine', [
    node('Daily Founder digest', 'Daily Founder digest', '06:30', false),
    node('Daily CEO status report', 'Daily CEO status report', '06:31', true),
  ]);
  assert.equal(isRoutineThread(t), true);
});

test('isRoutineThread: a Nightly Auditor Report thread is routine', () => {
  const t = thread('t-night', 'iss-night', [
    node('Nightly Auditor Report', 'Nightly Auditor Report', '02:00', true),
  ]);
  assert.equal(isRoutineThread(t), true);
});

test('isRoutineThread: a SINGLE substantive node defeats the routine flag (conservative)', () => {
  const t = thread('t-mixed', 'iss-mixed', [
    node('Daily CEO status report', 'Daily CEO status report', '06:31', false),
    node('Pricing sheet draft', 'Pricing sheet draft v2', '11:02', true),
  ]);
  assert.equal(isRoutineThread(t), false);
});

test('isRoutineThread: a fully substantive thread is NOT routine', () => {
  const t = thread('t-sub', 'iss-sub', [
    node('CSO review of strategy', 'CSO review of strategy memo', '14:00', true),
  ]);
  assert.equal(isRoutineThread(t), false);
});

test('isRoutineThread: an empty-node thread is NOT routine (conservative — keep)', () => {
  const t = thread('t-empty', 'iss-empty', []);
  assert.equal(isRoutineThread(t), false);
});

// ---------------------------------------------------------------------------
// filterLineageThreads — drops routine + exact dups, keeps agent-self
// ---------------------------------------------------------------------------

test('filterLineageThreads: drops a routine thread, keeps the substantive one', () => {
  const routine = thread('t-routine', 'iss-routine', [
    node('Daily Founder digest', 'Daily Founder digest', '06:30', true),
  ]);
  const substantive = thread('t-sub', 'iss-sub', [
    node('Pricing sheet draft', 'Pricing sheet draft v2', '11:02', true),
  ]);
  const out = filterLineageThreads([routine, substantive]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 't-sub');
});

test('filterLineageThreads: drops exact-duplicate threads, keeps the FIRST (order preserved)', () => {
  const a = thread('t-a', 'iss-x', [node('Build report engine', 'Build the report engine', '10:00', true)]);
  const aDup = thread('t-a2', 'iss-x', [node('Build report engine', 'Build the report engine', '10:00', true)]);
  const b = thread('t-b', 'iss-y', [node('Wire chat surface', 'Wire chat surface', '12:00', true)]);
  const out = filterLineageThreads([a, aDup, b]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.id), ['t-a', 't-b']);
});

test('filterLineageThreads: a mixed set returns only the unique substantive threads in input order', () => {
  const founderDigest = thread('t-1', 'iss-1', [node('Daily Founder digest', 'Daily Founder digest', '06:30', true)]);
  const work = thread('t-2', 'iss-2', [node('Draft Q3 plan', 'Draft the Q3 plan', '09:00', true)]);
  const ceoStatus1 = thread('t-3', 'iss-3', [node('Daily CEO status report', 'Daily CEO status report', '06:31', true)]);
  const workDup = thread('t-4', 'iss-2', [node('Draft Q3 plan', 'Draft the Q3 plan', '09:00', true)]);
  const ceoStatus2 = thread('t-5', 'iss-5', [node('Daily CEO status report', 'Daily CEO status report', '06:32', true)]);
  const work2 = thread('t-6', 'iss-6', [node('Review legal terms', 'Review the legal terms', '15:00', true)]);
  const out = filterLineageThreads([founderDigest, work, ceoStatus1, workDup, ceoStatus2, work2]);
  assert.deepEqual(out.map((t) => t.id), ['t-2', 't-6']);
});

test('filterLineageThreads: empty / null / undefined → []', () => {
  assert.deepEqual(filterLineageThreads([]), []);
  assert.deepEqual(filterLineageThreads(null), []);
  assert.deepEqual(filterLineageThreads(undefined), []);
});

test('filterLineageThreads: a malformed thread (node missing name/detail) does NOT throw', () => {
  const malformed = thread('t-bad', 'iss-bad', [{ time: '09:00', isTerminal: true }]);
  let out;
  assert.doesNotThrow(() => {
    out = filterLineageThreads([malformed]);
  });
  // a node with no cadence tokens (empty strings) is NOT routine → kept (conservative)
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 't-bad');
});

test('filterLineageThreads: PURE — byte-equal output for byte-equal input, no input mutation', () => {
  const input = [
    thread('t-keep', 'iss-keep', [node('Ship feature', 'Ship the feature', '10:00', true)]),
    thread('t-routine', 'iss-routine', [node('Nightly Auditor Report', 'Nightly Auditor Report', '02:00', true)]),
  ];
  const snapshot = JSON.stringify(input);
  const a = filterLineageThreads(input);
  const b = filterLineageThreads(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(input), snapshot, 'input must not be mutated');
});

test('NO_UUID_LEAK: the filter never injects a UUID into any output thread id/name/detail', () => {
  // composite-id fixture (NOT a bare 8-4-4-4-12 UUID) — the filter passes ids through unchanged
  const t = thread('iss-uuid:actor:ts', 'iss-uuid', [node('Draft plan', 'Draft the plan', '09:00', true)]);
  const out = filterLineageThreads([t]);
  const serialized = JSON.stringify(out);
  assert.ok(!UUID_RE.test(serialized), 'no raw UUID should appear in the filtered output');
});
