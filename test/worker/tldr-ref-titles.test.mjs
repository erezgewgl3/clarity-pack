// test/worker/tldr-ref-titles.test.mjs
//
// Plan 07-02 Task 2 (D-I3-02) — the refs→title post-processor for a TL;DR body.
// A `<PREFIX>-NNN` token in the compiled TL;DR (e.g. `BEAAA-704`) is rewritten
// in place to `BEAAA-704 — <title>` using the title resolved by the EXISTING
// 07-01 SDK resolver (resolveRefsViaSdk) — keeping the raw ID traceable. The
// rewrite is prefix-derived / instance-agnostic (reuses prefixFromIdentifier;
// no BEAAA hardcoding), idempotent, degrade-safe, and never throws.
//
// PURE-MODULE tests (Node strip-types loads .ts directly). The wire-in to the
// reader handler is asserted in test/worker/issue-reader.test.mjs.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { inlineRefTitles, buildTitleMap } from '../../src/worker/handlers/tldr-ref-titles.ts';

// ---------------------------------------------------------------------------
// inlineRefTitles — the pure rewrite
// ---------------------------------------------------------------------------

test('inlineRefTitles rewrites a resolved token to "ID — title" (ID kept traceable)', () => {
  const map = new Map([['BEAAA-704', 'CSO review of updated strategy']]);
  const out = inlineRefTitles('Blocked by BEAAA-704 until review', 'BEAAA-828', map);
  assert.equal(out, 'Blocked by BEAAA-704 — CSO review of updated strategy until review');
});

test('inlineRefTitles leaves an unresolved token as the bare ID', () => {
  const map = new Map([['BEAAA-704', 'CSO review']]);
  const out = inlineRefTitles('See BEAAA-704 and BEAAA-999 now', 'BEAAA-828', map);
  assert.match(out, /BEAAA-704 — CSO review/);
  assert.match(out, /BEAAA-999\b/);
  assert.equal(/BEAAA-999 —/.test(out), false, 'unresolved token stays bare (no em-dash suffix)');
});

test('inlineRefTitles is idempotent — a second pass does not double-rewrite', () => {
  const map = new Map([['BEAAA-704', 'CSO review of updated strategy']]);
  const once = inlineRefTitles('Blocked by BEAAA-704 until review', 'BEAAA-828', map);
  const twice = inlineRefTitles(once, 'BEAAA-828', map);
  assert.equal(twice, once, 'running twice yields the same string');
});

test('inlineRefTitles is instance-agnostic — on a COU issue, COU-12 is rewritten and BEAAA-807 is NOT', () => {
  const map = new Map([
    ['COU-12', 'Recovery disposition'],
    ['BEAAA-807', 'should never be touched on a COU issue'],
  ]);
  const out = inlineRefTitles('see COU-12 and BEAAA-807', 'COU-2486', map);
  assert.match(out, /COU-12 — Recovery disposition/);
  assert.match(out, /BEAAA-807\b/);
  assert.equal(/BEAAA-807 —/.test(out), false, 'cross-company token is NOT rewritten (prefix-narrowed)');
});

test('inlineRefTitles returns the original string unchanged when there are no resolvable tokens', () => {
  const map = new Map([['BEAAA-1', 'x']]);
  const body = 'plain prose with no refs at all';
  assert.equal(inlineRefTitles(body, 'BEAAA-828', map), body);
});

test('inlineRefTitles never throws on empty / null inputs', () => {
  assert.doesNotThrow(() => inlineRefTitles('', 'BEAAA-1', new Map()));
  assert.doesNotThrow(() => inlineRefTitles('BEAAA-1 here', null, new Map()));
  assert.doesNotThrow(() => inlineRefTitles('BEAAA-1 here', 'BEAAA-9', new Map()));
});

// ---------------------------------------------------------------------------
// buildTitleMap — async orchestrator over the 07-01 SDK resolver
// ---------------------------------------------------------------------------

function stubIssuesClient(byId, opts = {}) {
  return {
    async get(id) {
      if (opts.getThrows) throw new Error('simulated get failure');
      const issue = byId.get(id);
      return issue ?? null;
    },
    async list() {
      return opts.list ?? [];
    },
  };
}

test('buildTitleMap resolves requestedId → title via the SDK resolver', async () => {
  const issues = stubIssuesClient(
    new Map([
      ['BEAAA-704', { id: 'uuid-704', identifier: 'BEAAA-704', title: 'CSO review of updated strategy', status: 'todo' }],
      ['BEAAA-713', { id: 'uuid-713', identifier: 'BEAAA-713', title: 'Carrier addendum', status: 'done' }],
    ]),
  );
  const body = 'Blocked by BEAAA-704; then BEAAA-713.';
  const map = await buildTitleMap(issues, body, 'BEAAA-828', 'co-1');
  assert.equal(map.get('BEAAA-704'), 'CSO review of updated strategy');
  assert.equal(map.get('BEAAA-713'), 'Carrier addendum');
});

test('buildTitleMap returns an empty Map and skips the SDK call when no tokens are present', async () => {
  let getCalls = 0;
  const issues = {
    async get() {
      getCalls += 1;
      return null;
    },
    async list() {
      return [];
    },
  };
  const map = await buildTitleMap(issues, 'no refs here', 'BEAAA-828', 'co-1');
  assert.equal(map.size, 0);
  assert.equal(getCalls, 0, 'no SDK get call when there are no tokens to resolve');
});

test('buildTitleMap degrades to an empty Map when the resolver throws (inlineRefTitles then leaves bare IDs)', async () => {
  const issues = stubIssuesClient(new Map(), { getThrows: true });
  const body = 'Blocked by BEAAA-704 until review';
  const map = await buildTitleMap(issues, body, 'BEAAA-828', 'co-1');
  assert.equal(map.size, 0, 'a thrown resolver degrades to an empty map (no throw)');
  // The rewrite then leaves the bare ID — end-to-end degrade-safe.
  const out = inlineRefTitles(body, 'BEAAA-828', map);
  assert.equal(out, body, 'bare ID survives when the map is empty');
});

test('buildTitleMap is instance-agnostic — only the COU- token is resolved on a COU issue', async () => {
  let askedIds = [];
  const issues = {
    async get(id) {
      askedIds.push(id);
      if (id === 'COU-12') return { id: 'uuid', identifier: 'COU-12', title: 'Recovery', status: 'todo' };
      return null;
    },
    async list() {
      return [];
    },
  };
  const map = await buildTitleMap(issues, 'see COU-12 and BEAAA-807', 'COU-2486', 'co-1');
  assert.equal(map.get('COU-12'), 'Recovery');
  assert.equal(map.has('BEAAA-807'), false, 'cross-company token never reaches the resolver on a COU issue');
  assert.equal(askedIds.includes('BEAAA-807'), false, 'resolver is never asked for a non-prefix token');
});
