// test/worker/situation/classify-employee-state.test.mjs
//
// Plan 08-01 Task 2 RED — the pure deterministic 5-state classifier (ROOM-14).
//
// LOCKED boundaries (08-CONTEXT.md line 38; 08-RESEARCH Pattern 2):
//   running   = heartbeat-run active in last 5 min  (SOLE running signal —
//               heartbeat freshness wins; issue status NEVER promotes to running)
//   reviewing = stale heartbeat AND topOpenIssueStatus === 'in_review'
//   blocked   = stale heartbeat AND topOpenIssueStatus === 'blocked'
//   stale     = (M1) in_progress with a stale heartbeat → 'stale' (no evidence of
//               motion); OR no open issue AND last activity ≥ 24h; OR no signal
//   idle      = no open assigned issue AND last activity < 24h
//
// Pure — nowMs is injected; no Date.now() inside the classifier.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { classifyEmployeeState } from '../../../src/worker/situation/classify-employee-state.ts';

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Test 1 — running (heartbeat active).
test('classify — running: fresh heartbeat (60s) → running', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 60_000,
      topOpenIssueStatus: 'in_progress',
      lastActivityMs: NOW - 60_000,
      nowMs: NOW,
    }),
    'running',
  );
});

// Test 2 — running at the 5min boundary minus 1ms.
test('classify — running: heartbeatAge = 5min - 1ms → running', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - (5 * MIN - 1),
      topOpenIssueStatus: 'in_progress',
      lastActivityMs: NOW - (5 * MIN - 1),
      nowMs: NOW,
    }),
    'running',
  );
});

// Test 3 — NOT running at exactly 5min (falls through to status-based).
test('classify — NOT running at exactly 5min (falls through to status)', () => {
  const state = classifyEmployeeState({
    lastHeartbeatMs: NOW - 5 * MIN,
    topOpenIssueStatus: 'in_review',
    lastActivityMs: NOW - 5 * MIN,
    nowMs: NOW,
  });
  assert.notEqual(state, 'running');
  assert.equal(state, 'reviewing');
});

// Test 4 — reviewing.
test('classify — reviewing: stale heartbeat + in_review → reviewing', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 10 * MIN,
      topOpenIssueStatus: 'in_review',
      lastActivityMs: NOW - 10 * MIN,
      nowMs: NOW,
    }),
    'reviewing',
  );
});

// Test 5 — blocked.
test('classify — blocked: stale heartbeat + blocked → blocked', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 10 * MIN,
      topOpenIssueStatus: 'blocked',
      lastActivityMs: NOW - 10 * MIN,
      nowMs: NOW,
    }),
    'blocked',
  );
});

// Test 6 — idle: no open issue, recent activity (2h).
test('classify — idle: no open issue + activity 2h ago → idle', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 2 * HOUR,
      topOpenIssueStatus: null,
      lastActivityMs: NOW - 2 * HOUR,
      nowMs: NOW,
    }),
    'idle',
  );
});

// Test 7 — idle at the 24h boundary minus 1ms.
test('classify — idle: no open issue + activityAge = 24h - 1ms → idle', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - (24 * HOUR - 1),
      topOpenIssueStatus: null,
      lastActivityMs: NOW - (24 * HOUR - 1),
      nowMs: NOW,
    }),
    'idle',
  );
});

// Test 7b (M1) — in_progress with a stale heartbeat → stale (NEVER running).
test('classify — M1: in_progress + 10min-stale heartbeat → stale (not running)', () => {
  const state = classifyEmployeeState({
    lastHeartbeatMs: NOW - 10 * MIN,
    topOpenIssueStatus: 'in_progress',
    lastActivityMs: NOW - 10 * MIN,
    nowMs: NOW,
  });
  assert.notEqual(state, 'running');
  assert.equal(state, 'stale');
});

// Test 8 — stale at exactly 24h, no open issue.
test('classify — stale: no open issue + activityAge = exactly 24h → stale', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 24 * HOUR,
      topOpenIssueStatus: null,
      lastActivityMs: NOW - 24 * HOUR,
      nowMs: NOW,
    }),
    'stale',
  );
});

// Test 9 — stale: never seen (lastActivityMs null), no open issue.
test('classify — stale: never seen (lastActivityMs null) → stale', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: NOW - 48 * HOUR,
      topOpenIssueStatus: null,
      lastActivityMs: null,
      nowMs: NOW,
    }),
    'stale',
  );
});

// Test 10 — degrade-safe: all nulls → stale.
test('classify — degrade-safe: all nulls → stale', () => {
  assert.equal(
    classifyEmployeeState({
      lastHeartbeatMs: null,
      topOpenIssueStatus: null,
      lastActivityMs: null,
      nowMs: NOW,
    }),
    'stale',
  );
});
