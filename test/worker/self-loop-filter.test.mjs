// test/worker/self-loop-filter.test.mjs
//
// Plan 02-03 Task 1 — D-04 belt-and-suspenders self-loop filter. Drops any
// event where (a) author_id matches the Editor-Agent id OR (b) the event
// carries the 'clarity:editor-write' tag. Either condition excludes the row;
// both checks ensure the agent never re-triggers itself.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  filterSelfLoopEvents,
  EDITOR_WRITE_TAG,
} from '../../src/worker/agents/self-loop-filter.ts';

test('EDITOR_WRITE_TAG is the locked literal "clarity:editor-write"', () => {
  assert.equal(EDITOR_WRITE_TAG, 'clarity:editor-write');
});

test('filterSelfLoopEvents drops events authored by the editor-agent id (author-id match)', () => {
  const events = [{ author_id: 'editor-agent-1', tags: [] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents drops events carrying clarity:editor-write tag even when author differs (tag match)', () => {
  const events = [{ author_id: 'other-author', tags: ['clarity:editor-write'] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents passes through normal user events (no author match + no tag)', () => {
  const events = [{ author_id: 'eric', tags: ['user-edit'] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.equal(out.length, 1);
  assert.equal(out[0].author_id, 'eric');
});

test('filterSelfLoopEvents drops events matching BOTH author and tag (defense in depth)', () => {
  const events = [{ author_id: 'editor-agent-1', tags: ['clarity:editor-write'] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents preserves input order for events that pass', () => {
  const events = [
    { author_id: 'a', tags: [] },
    { author_id: 'editor-agent-1', tags: [] }, // drop
    { author_id: 'b', tags: [] },
    { author_id: 'c', tags: ['clarity:editor-write'] }, // drop
    { author_id: 'd', tags: [] },
  ];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out.map((e) => e.author_id), ['a', 'b', 'd']);
});

test('filterSelfLoopEvents tolerates missing tags (treats undefined as empty array)', () => {
  const events = [{ author_id: 'eric' }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.equal(out.length, 1);
});
