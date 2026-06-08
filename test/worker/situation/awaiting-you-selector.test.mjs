// test/worker/situation/awaiting-you-selector.test.mjs
//
// Phase 16.1 Plan 16.1-04 Task 1 (D-10) — unit proof for the PURE awaiting-you
// selector that feeds the bounded warm-on-heartbeat. The selector picks ONLY the
// issue ids of rollup rows whose blockerChain marks them awaiting-you (a person
// must act) — the viewer-invariant `needsYou === true` signal already carried on
// every SituationEmployeeRow — and returns them in stable order.
//
// The selector is PURE (no ctx, no DB, no host call): the heartbeat (Task 2)
// supplies the rows it already built and does all the staleness / governor work.
// So this test hand-builds rows and asserts the filter behavior directly.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { selectAwaitingYouIssueIds } from '../../../src/worker/situation/awaiting-you-selector.ts';

/**
 * Build a minimal SituationEmployeeRow-shaped fixture carrying ONLY the fields
 * the selector reads (agentId + blockerChain.{needsYou,terminalKind,leafIssueUuid,
 * targetIssueUuid}). Other row fields are irrelevant to the pure selector.
 */
function row(opts) {
  const {
    agentId,
    needsYou,
    terminalKind = needsYou ? 'AWAITING_HUMAN' : 'AWAITING_AGENT',
    leafIssueUuid = null,
    targetIssueUuid = null,
    blockerChain, // pass null explicitly to model a row with no chain
  } = opts;
  if (blockerChain === null) {
    return { agentId, blockerChain: null };
  }
  return {
    agentId,
    blockerChain: {
      needsYou,
      terminalKind,
      leafIssueUuid,
      targetIssueUuid,
    },
  };
}

test('D-10: includes only awaiting-you rows, excludes the rest, in stable order', () => {
  const rows = [
    row({ agentId: 'a1', needsYou: true, leafIssueUuid: 'uuid-1' }),
    row({ agentId: 'a2', needsYou: false, leafIssueUuid: 'uuid-2' }), // excluded — not awaiting-you
    row({ agentId: 'a3', needsYou: true, leafIssueUuid: 'uuid-3' }),
    row({ agentId: 'a4', blockerChain: null }), // excluded — no chain
  ];
  const ids = selectAwaitingYouIssueIds(rows);
  assert.deepEqual(
    ids,
    ['uuid-1', 'uuid-3'],
    'only the two awaiting-you rows contribute, in input order',
  );
});

test('D-10: empty rollup -> empty array (no throw)', () => {
  assert.deepEqual(selectAwaitingYouIssueIds([]), []);
});

test('D-10: rows with no resolvable issue uuid are dropped (no empty/null ids)', () => {
  const rows = [
    row({ agentId: 'a1', needsYou: true, leafIssueUuid: null, targetIssueUuid: null }),
    row({ agentId: 'a2', needsYou: true, leafIssueUuid: 'uuid-2' }),
  ];
  assert.deepEqual(
    selectAwaitingYouIssueIds(rows),
    ['uuid-2'],
    'a needsYou row with no uuid contributes nothing — warm targets need a real id',
  );
});

test('D-10: prefers targetIssueUuid then leafIssueUuid for the issue id', () => {
  const rows = [
    row({ agentId: 'a1', needsYou: true, targetIssueUuid: 'target-1', leafIssueUuid: 'leaf-1' }),
    row({ agentId: 'a2', needsYou: true, targetIssueUuid: null, leafIssueUuid: 'leaf-2' }),
  ];
  assert.deepEqual(selectAwaitingYouIssueIds(rows), ['target-1', 'leaf-2']);
});

test('D-10: de-dupes repeated issue ids while preserving first-seen order', () => {
  const rows = [
    row({ agentId: 'a1', needsYou: true, leafIssueUuid: 'dup' }),
    row({ agentId: 'a2', needsYou: true, leafIssueUuid: 'dup' }),
    row({ agentId: 'a3', needsYou: true, leafIssueUuid: 'other' }),
  ];
  assert.deepEqual(selectAwaitingYouIssueIds(rows), ['dup', 'other']);
});

test('selector is pure — does not mutate the input rows array', () => {
  const rows = [row({ agentId: 'a1', needsYou: true, leafIssueUuid: 'uuid-1' })];
  const snapshot = JSON.stringify(rows);
  selectAwaitingYouIssueIds(rows);
  assert.equal(JSON.stringify(rows), snapshot, 'input is not mutated');
});
