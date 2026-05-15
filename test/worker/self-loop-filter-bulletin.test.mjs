// test/worker/self-loop-filter-bulletin.test.mjs
//
// Plan 03-01 Task 1 RED — BULL-02 self-loop recursion guard for the Daily
// Bulletin. Phase 2's filterSelfLoopEvents already drops Editor-Agent-authored
// events and 'clarity:editor-write'-tagged events. Phase 3 extends it: the
// bulletin compile persists a Paperclip issue tagged 'clarity:bulletin' /
// 'clarity:bulletin-issue'. Without the extension, day-N+1's compile reads
// day-N's bulletin issue as fresh agent activity and recurses forever.
//
// This is a SEPARATE test file from test/worker/self-loop-filter.test.mjs —
// the Phase 2 file stays untouched as a backward-compat regression guard;
// this file adds explicit BULL-02 bulletin-tag coverage.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  filterSelfLoopEvents,
  EDITOR_WRITE_TAG,
  BULLETIN_TAG_PREFIX,
} from '../../src/worker/agents/self-loop-filter.ts';

test('BULLETIN_TAG_PREFIX is the locked literal "clarity:bulletin"', () => {
  assert.equal(BULLETIN_TAG_PREFIX, 'clarity:bulletin');
});

test('filterSelfLoopEvents drops an event tagged exactly "clarity:bulletin"', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'other', tags: ['clarity:bulletin'] }],
    'editor-1',
  );
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents drops an event tagged "clarity:bulletin-issue" (prefix match)', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'other', tags: ['clarity:bulletin-issue'] }],
    'editor-1',
  );
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents does NOT drop an event tagged only "cycle:5" (no false-positive over-filtering)', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'other', tags: ['cycle:5'] }],
    'editor-1',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].author_id, 'other');
});

test('REGRESSION: filterSelfLoopEvents still drops "clarity:editor-write"-tagged events (Phase 2 behavior unchanged)', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'other', tags: [EDITOR_WRITE_TAG] }],
    'editor-1',
  );
  assert.deepEqual(out, []);
});

test('REGRESSION: filterSelfLoopEvents still drops events authored by the editor agent id', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'editor-1', tags: [] }],
    'editor-1',
  );
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents drops an event with mixed tags when ANY tag matches the bulletin prefix', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'other', tags: ['clarity:bulletin', 'something-else'] }],
    'editor-1',
  );
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents passes through an untagged event from a safe author', () => {
  const out = filterSelfLoopEvents(
    [{ author_id: 'eric', tags: [] }],
    'editor-1',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].author_id, 'eric');
});
