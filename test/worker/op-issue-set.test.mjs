// test/worker/op-issue-set.test.mjs
//
// Debug editor-heartbeat-db-churn (v1.4.4) — Fix 2. The bounded, TTL'd set of
// operation-issue ids the plugin created. Backs the zero-DB recursion guard:
// the heartbeat dispatcher drops events whose entityId is in this set before
// any reconcile/DB call.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  OwnOperationIssueSet,
  rememberOwnOperationIssue,
  isRememberedOwnOperationIssue,
} from '../../src/worker/agents/op-issue-set.ts';

test('add + has — a remembered id is reported present', () => {
  const s = new OwnOperationIssueSet();
  s.add('op-1');
  assert.equal(s.has('op-1'), true);
  assert.equal(s.has('op-2'), false);
});

test('empty / falsy ids are ignored on add and absent on has', () => {
  const s = new OwnOperationIssueSet();
  s.add('');
  assert.equal(s.size, 0);
  assert.equal(s.has(''), false);
});

test('TTL — an entry older than the window is treated as absent and lazily evicted', () => {
  let nowMs = 1_000_000;
  const ttl = 10_000;
  const s = new OwnOperationIssueSet(ttl, 100, () => nowMs);
  s.add('op-1');
  assert.equal(s.has('op-1'), true);

  // Just inside the window.
  nowMs += ttl;
  assert.equal(s.has('op-1'), true);

  // Past the window — absent, and the lazy eviction shrinks the set.
  nowMs += 1;
  assert.equal(s.has('op-1'), false);
  assert.equal(s.size, 0);
});

test('re-add refreshes the TTL (sliding window for a long-lived in-flight op)', () => {
  let nowMs = 0;
  const ttl = 100;
  const s = new OwnOperationIssueSet(ttl, 100, () => nowMs);
  s.add('op-1');
  nowMs = 80;
  s.add('op-1'); // refresh — resets insertedAt to 80
  nowMs = 150; // 70ms after refresh, still inside the 100ms window
  assert.equal(s.has('op-1'), true);
});

test('hard size cap — oldest entries are LRU-evicted on overflow', () => {
  const s = new OwnOperationIssueSet(1_000_000, 3); // huge TTL, cap of 3
  s.add('a');
  s.add('b');
  s.add('c');
  s.add('d'); // overflow — evicts the oldest ('a')
  assert.equal(s.size, 3);
  assert.equal(s.has('a'), false);
  assert.equal(s.has('b'), true);
  assert.equal(s.has('c'), true);
  assert.equal(s.has('d'), true);
});

test('re-add moves an entry to the tail so it survives a later eviction', () => {
  const s = new OwnOperationIssueSet(1_000_000, 3);
  s.add('a');
  s.add('b');
  s.add('c');
  s.add('a'); // touch 'a' — now 'b' is the oldest
  s.add('d'); // overflow — evicts 'b', not 'a'
  assert.equal(s.has('a'), true);
  assert.equal(s.has('b'), false);
});

test('module-level shared set: remember + isRemembered round-trip', () => {
  const id = 'shared-op-' + Math.random().toString(36).slice(2);
  assert.equal(isRememberedOwnOperationIssue(id), false);
  rememberOwnOperationIssue(id);
  assert.equal(isRememberedOwnOperationIssue(id), true);
  // null / undefined are absent, never throw.
  assert.equal(isRememberedOwnOperationIssue(null), false);
  assert.equal(isRememberedOwnOperationIssue(undefined), false);
});
