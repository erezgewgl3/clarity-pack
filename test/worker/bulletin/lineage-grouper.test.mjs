// test/worker/bulletin/lineage-grouper.test.mjs
//
// Plan 03-03 Task 1 RED — BULL-04 lineage grouper (D-21 fallback).
//
// groupLineageThreads is pure deterministic code: it clusters activity events
// by (entityId, actorChain) into threads where consecutive events are at most
// maxDeltaSec apart. Clusters > 8 nodes are truncated with a truncatedCount
// tail. The SDK has NO caused_by_activity_id field, so this temporal+actor
// proximity heuristic is the working contract.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { groupLineageThreads } from '../../../src/worker/bulletin/lineage-grouper.ts';

function ev(over = {}) {
  return {
    id: 'e-1',
    entityId: 'issue-1',
    actorId: 'agent-a',
    timestamp: '2026-05-15T09:00:00.000Z',
    message: 'did a thing',
    ...over,
  };
}

test('lineage-grouper: empty input → []', () => {
  assert.deepEqual(groupLineageThreads([]), []);
  assert.deepEqual(groupLineageThreads(null), []);
  assert.deepEqual(groupLineageThreads(undefined), []);
});

test('lineage-grouper: 2 events same entity + chain, 4 min apart → 1 thread, 2 nodes', () => {
  const events = [
    ev({ id: 'a', timestamp: '2026-05-15T09:00:00.000Z' }),
    ev({ id: 'b', timestamp: '2026-05-15T09:04:00.000Z' }),
  ];
  const threads = groupLineageThreads(events, { maxDeltaSec: 300 });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].nodes.length, 2);
});

test('lineage-grouper: 2 events 6 min apart → 2 threads (exceeds default 300s)', () => {
  const events = [
    ev({ id: 'a', timestamp: '2026-05-15T09:00:00.000Z' }),
    ev({ id: 'b', timestamp: '2026-05-15T09:06:00.000Z' }),
  ];
  const threads = groupLineageThreads(events);
  assert.equal(threads.length, 2);
});

test('lineage-grouper: 2 events different actorChain → 2 threads', () => {
  const events = [
    ev({ id: 'a', actorChain: 'chain-1', timestamp: '2026-05-15T09:00:00.000Z' }),
    ev({ id: 'b', actorChain: 'chain-2', timestamp: '2026-05-15T09:01:00.000Z' }),
  ];
  const threads = groupLineageThreads(events);
  assert.equal(threads.length, 2);
});

test('lineage-grouper: cluster of 12 → 1 thread, 8 nodes, truncatedCount 4', () => {
  const events = [];
  for (let i = 0; i < 12; i += 1) {
    events.push(
      ev({ id: `e${i}`, timestamp: new Date(Date.UTC(2026, 4, 15, 9, i, 0)).toISOString() }),
    );
  }
  const threads = groupLineageThreads(events, { maxDeltaSec: 300 });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].nodes.length, 8);
  assert.equal(threads[0].truncatedCount, 4);
});

test('lineage-grouper: deterministic — 100 iterations produce byte-equal JSON', () => {
  const events = [
    ev({ id: 'z', entityId: 'issue-3', timestamp: '2026-05-15T10:02:00.000Z' }),
    ev({ id: 'a', entityId: 'issue-1', timestamp: '2026-05-15T09:00:00.000Z' }),
    ev({ id: 'm', entityId: 'issue-2', actorChain: 'c2', timestamp: '2026-05-15T09:30:00.000Z' }),
    ev({ id: 'b', entityId: 'issue-1', timestamp: '2026-05-15T09:03:00.000Z' }),
  ];
  const first = JSON.stringify(groupLineageThreads(events, { maxDeltaSec: 300 }));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(groupLineageThreads(events, { maxDeltaSec: 300 })), first);
  }
});

test('lineage-grouper: last node of each thread carries isTerminal:true', () => {
  const events = [
    ev({ id: 'a', timestamp: '2026-05-15T09:00:00.000Z' }),
    ev({ id: 'b', timestamp: '2026-05-15T09:02:00.000Z' }),
    ev({ id: 'c', timestamp: '2026-05-15T09:04:00.000Z' }),
  ];
  const threads = groupLineageThreads(events, { maxDeltaSec: 300 });
  assert.equal(threads.length, 1);
  const nodes = threads[0].nodes;
  assert.equal(nodes[nodes.length - 1].isTerminal, true);
  for (let i = 0; i < nodes.length - 1; i += 1) {
    assert.equal(nodes[i].isTerminal, false);
  }
});
