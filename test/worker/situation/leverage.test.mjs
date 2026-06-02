// test/worker/situation/leverage.test.mjs
//
// Plan 12-02 Task 1 (RED) — the pure leverage helper (NY-02).
//
// Leverage = count of distinct blocked items whose flattened chain TERMINATES at
// this action ("items it frees", D-01). The helper reverse-counts the engine's
// existing pathIds/targetIssueUuid (no new fetch). It is PURE — no ctx, no clock,
// no I/O — so the sort is deterministic and unit-testable (D-02). It collapses
// rows sharing a leaf into ONE action item (per-leaf dedup, D-03). Leverage is a
// SORT KEY ONLY (D-07): the helper never emits a rendered "unblocks N" string.
//
// These tests are the RED-first gate for src/worker/situation/leverage.ts.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  computeLeverageByLeaf,
  sortActionItemsByLeverage,
} from '../../../src/worker/situation/leverage.ts';

// A minimal needs-you-row shape the helper reverse-counts over. It carries only
// the structural fields the engine already produced (pathIds + the per-leaf
// dedup key targetIssueUuid) plus the source identifiers a topAction needs.
function row({ agentId, pathIds, targetIssueUuid, humanAction = 'do the thing', leafIssueId = null, leafIssueUuid = null }) {
  return { agentId, pathIds, targetIssueUuid, humanAction, leafIssueId, leafIssueUuid };
}

// ---------------------------------------------------------------------------
// Test 1 — distinct leaves → each frees exactly itself (leverage 1)
// ---------------------------------------------------------------------------
test('computeLeverageByLeaf — N rows at N distinct leaves → leverage 1 each, N action items', () => {
  const rows = [
    row({ agentId: 'ag-a', pathIds: ['root-a', 'leaf-a'], targetIssueUuid: 'leaf-a' }),
    row({ agentId: 'ag-b', pathIds: ['root-b', 'leaf-b'], targetIssueUuid: 'leaf-b' }),
    row({ agentId: 'ag-c', pathIds: ['root-c', 'leaf-c'], targetIssueUuid: 'leaf-c' }),
  ];
  const items = computeLeverageByLeaf(rows);
  assert.equal(items.length, 3, 'three distinct leaves → three action items');
  for (const it of items) {
    assert.equal(it.leverage, 1, `each distinct leaf frees exactly itself; got ${it.leverage}`);
  }
});

// ---------------------------------------------------------------------------
// Test 2 — M rows at the SAME leaf collapse to ONE item with leverage M (D-03)
// ---------------------------------------------------------------------------
test('computeLeverageByLeaf — M rows terminating at one leaf collapse to ONE item, leverage M (per-leaf dedup, D-03)', () => {
  const rows = [
    row({ agentId: 'ag-1', pathIds: ['r1', 'shared-leaf'], targetIssueUuid: 'shared-leaf' }),
    row({ agentId: 'ag-2', pathIds: ['r2', 'shared-leaf'], targetIssueUuid: 'shared-leaf' }),
    row({ agentId: 'ag-3', pathIds: ['r3', 'shared-leaf'], targetIssueUuid: 'shared-leaf' }),
  ];
  const items = computeLeverageByLeaf(rows);
  assert.equal(items.length, 1, 'three rows at one leaf → exactly one action item (dedup)');
  assert.equal(items[0].leverage, 3, 'leverage = the count of items the leaf frees');
});

// ---------------------------------------------------------------------------
// Test 3 — dedup key falls back to targetIssueUuid when pathIds is empty
// ---------------------------------------------------------------------------
test('computeLeverageByLeaf — empty pathIds falls back to targetIssueUuid as the leaf key', () => {
  const rows = [
    row({ agentId: 'ag-x', pathIds: [], targetIssueUuid: 'tgt-1' }),
    row({ agentId: 'ag-y', pathIds: [], targetIssueUuid: 'tgt-1' }),
  ];
  const items = computeLeverageByLeaf(rows);
  assert.equal(items.length, 1, 'both rows share targetIssueUuid → one item');
  assert.equal(items[0].leverage, 2);
});

// ---------------------------------------------------------------------------
// Test 4 — sort by leverage DESCENDING
// ---------------------------------------------------------------------------
test('sortActionItemsByLeverage — orders by leverage descending', () => {
  const rows = [
    row({ agentId: 'ag-low', pathIds: ['r', 'leaf-low'], targetIssueUuid: 'leaf-low' }),
    row({ agentId: 'ag-hi1', pathIds: ['r', 'leaf-hi'], targetIssueUuid: 'leaf-hi' }),
    row({ agentId: 'ag-hi2', pathIds: ['r', 'leaf-hi'], targetIssueUuid: 'leaf-hi' }),
    row({ agentId: 'ag-hi3', pathIds: ['r', 'leaf-hi'], targetIssueUuid: 'leaf-hi' }),
  ];
  const items = computeLeverageByLeaf(rows);
  const sorted = sortActionItemsByLeverage(items);
  assert.equal(sorted[0].stableId, 'leaf-hi', 'highest-leverage (3) first');
  assert.equal(sorted[0].leverage, 3);
  assert.equal(sorted[1].stableId, 'leaf-low', 'lower-leverage (1) after');
});

// ---------------------------------------------------------------------------
// Test 5 — equal leverage → stable id ASCENDING (lexicographic), NO time field
// ---------------------------------------------------------------------------
test('sortActionItemsByLeverage — equal leverage breaks ties by stable id ascending (no time input)', () => {
  const rows = [
    row({ agentId: 'ag-z', pathIds: ['r', 'zzz'], targetIssueUuid: 'zzz' }),
    row({ agentId: 'ag-a', pathIds: ['r', 'aaa'], targetIssueUuid: 'aaa' }),
    row({ agentId: 'ag-m', pathIds: ['r', 'mmm'], targetIssueUuid: 'mmm' }),
  ];
  const items = computeLeverageByLeaf(rows);
  const sorted = sortActionItemsByLeverage(items);
  assert.deepEqual(
    sorted.map((i) => i.stableId),
    ['aaa', 'mmm', 'zzz'],
    'equal-leverage items sort by stable id ascending',
  );
});

// ---------------------------------------------------------------------------
// Test 6 — determinism: same input twice → byte-identical order; no mutation
// ---------------------------------------------------------------------------
test('sortActionItemsByLeverage — deterministic (byte-identical) and does NOT mutate the input', () => {
  const rows = [
    row({ agentId: 'ag-1', pathIds: ['r', 'l-b'], targetIssueUuid: 'l-b' }),
    row({ agentId: 'ag-2', pathIds: ['r', 'l-a'], targetIssueUuid: 'l-a' }),
    row({ agentId: 'ag-3', pathIds: ['r', 'l-a'], targetIssueUuid: 'l-a' }),
  ];
  const items = computeLeverageByLeaf(rows);
  const snapshotBefore = JSON.stringify(items);
  const first = JSON.stringify(sortActionItemsByLeverage(items));
  const second = JSON.stringify(sortActionItemsByLeverage(items));
  assert.equal(first, second, 'sorting the same input twice is byte-identical');
  assert.equal(JSON.stringify(items), snapshotBefore, 'sort does not mutate the input array');
});

// ---------------------------------------------------------------------------
// Test 7 — time-invariance: a row's order is independent of any age/timestamp
// ---------------------------------------------------------------------------
test('sortActionItemsByLeverage — order is time-free (no age/timestamp field is read)', () => {
  // Two rows, equal leverage. Even if we attach wildly different activity stamps,
  // the order is purely leverage-desc then stable-id-asc — the timestamps are
  // never consulted (D-02).
  const a = row({ agentId: 'ag-old', pathIds: ['r', 'leaf-z'], targetIssueUuid: 'leaf-z' });
  const b = row({ agentId: 'ag-new', pathIds: ['r', 'leaf-a'], targetIssueUuid: 'leaf-a' });
  a.__activityMs = 1; // ancient
  b.__activityMs = Number.MAX_SAFE_INTEGER; // brand new
  const sortedFwd = sortActionItemsByLeverage(computeLeverageByLeaf([a, b]));
  const sortedRev = sortActionItemsByLeverage(computeLeverageByLeaf([b, a]));
  // leaf-a < leaf-z ascending → leaf-a first regardless of timestamps or input order.
  assert.deepEqual(sortedFwd.map((i) => i.stableId), ['leaf-a', 'leaf-z']);
  assert.deepEqual(sortedRev.map((i) => i.stableId), ['leaf-a', 'leaf-z']);
});

// ---------------------------------------------------------------------------
// Test 8 — the collapsed representative is the smallest issue id (deterministic)
// ---------------------------------------------------------------------------
test('computeLeverageByLeaf — representative carries the smallest leaf key as stableId', () => {
  const items = computeLeverageByLeaf([
    row({ agentId: 'ag-1', pathIds: ['r', 'shared'], targetIssueUuid: 'shared', humanAction: 'A' }),
    row({ agentId: 'ag-2', pathIds: ['r', 'shared'], targetIssueUuid: 'shared', humanAction: 'B' }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].stableId, 'shared', 'the per-leaf key is the stable tie-break id');
  // The representative row is carried so a banner can read agentId/humanAction.
  assert.ok(items[0].representative, 'an item carries a representative row');
  assert.ok(items[0].representative.agentId, 'representative carries agentId for the topAction pick');
});
