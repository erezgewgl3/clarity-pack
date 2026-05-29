// test/ui/reader-render-state.test.mjs
//
// Scroll-stability fix (2026-05-29) — pins the pure render-state decision that
// keeps the populated Reader mounted across a background TL;DR poll.
//
// THE BUG: usePluginData NULLS `data` and sets `loading=true` for the in-flight
// window of every refresh() (SDK PluginDataResult contract: "data: null while
// loading", "loading: true while the initial request OR a refresh is in
// flight"). The Reader's TL;DR compile poll calls refresh() every 6s, so the
// old gate `if (loading || !data) return <Loading/>` unmounted the entire
// populated Reader on every tick — the tall page collapsed to a one-line
// placeholder and the operator's scroll snapped back to the top. After the
// TL;DR cached, the poll stopped and scroll behaved — exactly the reported
// symptom.
//
// THE FIX: `resolveReaderData(rawData, cachedLastGood)` keeps rendering the last
// good payload while a refresh is in flight (rawData momentarily null), so the
// tree is never unmounted and scroll is preserved. A fresh good payload always
// wins; only a genuine initial load (no data + no cache) shows the placeholder.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveReaderData } from '../../src/ui/surfaces/reader/reader-render-state.ts';

const GOOD = { tldr: { summary: 'x' }, tldrStatus: 'cached', refCards: [] };
const GOOD_COMPILING = { tldr: null, tldrStatus: 'compiling', refCards: [] };
const ERR = { error: 'OPT_IN_REQUIRED' };

test('a fresh good payload is returned as-is', () => {
  assert.equal(resolveReaderData(GOOD, null), GOOD);
});

test('THE FIX: during a background refresh (rawData null) the cached last-good payload is kept — NOT null', () => {
  // This is what prevents the unmount→scroll-reset. The old code path returned
  // the loading placeholder here (gated on `loading`); we must return content.
  assert.equal(resolveReaderData(null, GOOD_COMPILING), GOOD_COMPILING);
});

test('a transient error payload WITH a cache keeps the cached payload (never blanks a loaded Reader)', () => {
  assert.equal(resolveReaderData(ERR, GOOD), GOOD);
});

test('initial load (rawData null + no cache) → null so the caller shows the loading placeholder', () => {
  assert.equal(resolveReaderData(null, null), null);
});

test('an error payload with no cache → null (initial opt-in/guard short-circuit shows the placeholder)', () => {
  assert.equal(resolveReaderData(ERR, null), null);
});

test('a fresh good payload always wins over a stale cache (TL;DR cached lands → swaps in)', () => {
  assert.equal(resolveReaderData(GOOD, GOOD_COMPILING), GOOD);
});

test('a non-object truthy rawData never throws on the `error in` guard → falls back to cache', () => {
  // Defensive: the `'error' in rawData` test must not throw on a primitive.
  assert.equal(resolveReaderData('weird', GOOD), GOOD);
});
