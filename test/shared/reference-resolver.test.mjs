// test/shared/reference-resolver.test.mjs
//
// Plan 02-02 Task 1 — covers PRIM-01 (single round-trip) + PRIM-02 (viewer-permission
// excerpt forwarding) per the canonical interfaces block in 02-02-PLAN.md.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveRefs } from '../../src/shared/reference-resolver.ts';

function makeSpyFetcher(responses) {
  // responses: array of items (already aware of `id`) the fetcher returns
  let callCount = 0;
  let lastIds = null;
  const fetcher = async (ids) => {
    callCount += 1;
    lastIds = ids.slice();
    // Return ONLY the responses whose id is in the requested set (preserves
    // the contract: fetcher may omit ids — resolver handles missing entries).
    return responses.filter((r) => ids.includes(r.id));
  };
  fetcher.calls = () => callCount;
  fetcher.lastIds = () => lastIds;
  return fetcher;
}

test('resolveRefs([], fetcher) returns [] without calling fetcher', async () => {
  const fetcher = makeSpyFetcher([]);
  const result = await resolveRefs([], fetcher);
  assert.deepEqual(result, []);
  assert.equal(fetcher.calls(), 0, 'fetcher must NOT be called for empty input');
});

test('resolveRefs with N=3 ids calls fetcher exactly once with all ids (PRIM-01 single round-trip)', async () => {
  const fetcher = makeSpyFetcher([
    { id: 'BEAAA-1', title: 'A', status: 'todo', ownerUserId: 'eric', bodyExcerptForViewer: 'a', url: '/issues/BEAAA-1' },
    { id: 'BEAAA-2', title: 'B', status: 'done', ownerUserId: null, bodyExcerptForViewer: 'b', url: '/issues/BEAAA-2' },
    { id: 'BEAAA-3', title: 'C', status: 'in_progress', ownerUserId: 'eric', bodyExcerptForViewer: 'c', url: '/issues/BEAAA-3' },
  ]);
  const result = await resolveRefs(['BEAAA-1', 'BEAAA-2', 'BEAAA-3'], fetcher);
  assert.equal(fetcher.calls(), 1, 'fetcher must be called EXACTLY once (single round-trip)');
  assert.deepEqual(fetcher.lastIds(), ['BEAAA-1', 'BEAAA-2', 'BEAAA-3']);
  assert.equal(result.length, 3);
});

test('resolveRefs preserves INPUT ORDER even when fetcher returns out of order', async () => {
  // Fetcher returns reverse order on purpose
  const fetcher = async (_ids) => [
    { id: 'BEAAA-3', title: 'C', status: 'in_progress', ownerUserId: 'eric', bodyExcerptForViewer: 'c', url: '/issues/BEAAA-3' },
    { id: 'BEAAA-1', title: 'A', status: 'todo', ownerUserId: 'eric', bodyExcerptForViewer: 'a', url: '/issues/BEAAA-1' },
    { id: 'BEAAA-2', title: 'B', status: 'done', ownerUserId: null, bodyExcerptForViewer: 'b', url: '/issues/BEAAA-2' },
  ];
  const result = await resolveRefs(['BEAAA-1', 'BEAAA-2', 'BEAAA-3'], fetcher);
  assert.deepEqual(
    result.map((r) => r.id),
    ['BEAAA-1', 'BEAAA-2', 'BEAAA-3'],
    'output order must match input order, not fetcher response order',
  );
});

test('resolveRefs forwards bodyExcerptForViewer=null as RefCardData.excerpt=null (PRIM-02 permission-denied)', async () => {
  const fetcher = makeSpyFetcher([
    { id: 'BEAAA-1', title: 'A', status: 'todo', ownerUserId: 'eric', bodyExcerptForViewer: null, url: '/issues/BEAAA-1' },
  ]);
  const result = await resolveRefs(['BEAAA-1'], fetcher);
  assert.equal(result.length, 1);
  assert.equal(result[0].excerpt, null, 'PRIM-02: null excerpt means viewer cannot see the ref');
});

test('resolveRefs handles missing ids with unknown-status placeholder rather than throwing', async () => {
  const fetcher = makeSpyFetcher([
    { id: 'BEAAA-1', title: 'A', status: 'todo', ownerUserId: 'eric', bodyExcerptForViewer: 'a', url: '/issues/BEAAA-1' },
    // BEAAA-2 deliberately omitted — fetcher does not know about it (e.g., deleted issue)
  ]);
  const result = await resolveRefs(['BEAAA-1', 'BEAAA-2'], fetcher);
  assert.equal(result.length, 2);
  assert.equal(result[1].id, 'BEAAA-2');
  assert.equal(result[1].status, 'unknown');
  assert.equal(result[1].title, 'unknown');
  assert.equal(result[1].excerpt, null);
  assert.equal(result[1].ownerUserId, null);
  assert.equal(result[1].url, '');
});

test('resolveRefs dedupes input ids before the fetcher call (single round-trip preserved with duplicates)', async () => {
  const fetcher = makeSpyFetcher([
    { id: 'BEAAA-1', title: 'A', status: 'todo', ownerUserId: 'eric', bodyExcerptForViewer: 'a', url: '/issues/BEAAA-1' },
    { id: 'BEAAA-2', title: 'B', status: 'done', ownerUserId: null, bodyExcerptForViewer: 'b', url: '/issues/BEAAA-2' },
  ]);
  const result = await resolveRefs(['BEAAA-1', 'BEAAA-1', 'BEAAA-2'], fetcher);
  assert.equal(fetcher.calls(), 1, 'fetcher invoked exactly once');
  assert.deepEqual(fetcher.lastIds(), ['BEAAA-1', 'BEAAA-2'], 'deduped before round-trip');
  // Output still reflects every input position (duplicate present)
  assert.equal(result.length, 3);
  assert.equal(result[0].id, 'BEAAA-1');
  assert.equal(result[1].id, 'BEAAA-1');
  assert.equal(result[2].id, 'BEAAA-2');
});
