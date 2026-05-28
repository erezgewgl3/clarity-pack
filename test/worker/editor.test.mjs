// test/worker/editor.test.mjs
//
// Plan 07-01 Task 4 — net-new tests for the de-BEAAA'd ref extraction. Before
// 07-01, src/worker/agents/editor.ts:extractRefsFromBody hardcoded
// /\bBEAAA-\d+\b/g and had ZERO unit tests, so it extracted ZERO refs on any
// non-BEAAA instance (COU/ACME). 07-01 derives the EXACT prefix from the
// current issue's `identifier` (mirroring the already-portable UI
// prose-with-ref-chips.tsx) and narrows the regex; the broad fallback
// /\b[A-Z][A-Z0-9]{1,7}-\d+\b/g fires ONLY when the identifier is null.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { extractRefsFromBody, prefixFromIdentifier } from '../../src/worker/agents/editor.ts';

// ---------------------------------------------------------------------------
// prefixFromIdentifier — the shared pure helper
// ---------------------------------------------------------------------------

test('prefixFromIdentifier extracts the alpha-numeric prefix before the first hyphen', () => {
  assert.equal(prefixFromIdentifier('COU-2486'), 'COU');
  assert.equal(prefixFromIdentifier('ACME-7'), 'ACME');
  assert.equal(prefixFromIdentifier('BEAAA-807'), 'BEAAA');
  assert.equal(prefixFromIdentifier('OPS2-3'), 'OPS2');
});

test('prefixFromIdentifier returns null for null / empty / no-hyphen-with-digits shapes', () => {
  assert.equal(prefixFromIdentifier(null), null);
  assert.equal(prefixFromIdentifier(undefined), null);
  assert.equal(prefixFromIdentifier(''), null);
  assert.equal(prefixFromIdentifier('noHyphenHere'), null);
  assert.equal(prefixFromIdentifier('lowercase-12'), null, 'prefix must start with an uppercase letter');
  assert.equal(prefixFromIdentifier('COU-notanumber'), null, 'must be <prefix>-<digits>');
});

// ---------------------------------------------------------------------------
// extractRefsFromBody — prefix-narrowed extraction (de-BEAAA'd)
// ---------------------------------------------------------------------------

test('extractRefsFromBody on a COU issue matches COU- refs and does NOT match BEAAA- (cross-company false-positive avoidance)', () => {
  const refs = extractRefsFromBody('see COU-12 and BEAAA-807', 'COU-2486');
  assert.deepEqual(refs, ['COU-12']);
});

test('extractRefsFromBody on an ACME issue matches ACME- and does NOT match COU-', () => {
  const refs = extractRefsFromBody('compare ACME-9 vs COU-3', 'ACME-7');
  assert.deepEqual(refs, ['ACME-9']);
});

test('extractRefsFromBody on a BEAAA issue matches BEAAA- and does NOT match COU-', () => {
  const refs = extractRefsFromBody('BEAAA-141 blocks COU-3', 'BEAAA-555');
  assert.deepEqual(refs, ['BEAAA-141']);
});

test('extractRefsFromBody falls back to the broad pattern when identifier is null (matches COU- AND ACME-)', () => {
  const refs = extractRefsFromBody('COU-1 and ACME-2 both appear', null);
  assert.deepEqual([...refs].sort(), ['ACME-2', 'COU-1']);
});

test('extractRefsFromBody (no second arg) falls back to the broad pattern (back-compat)', () => {
  const refs = extractRefsFromBody('COU-1 and ACME-2 both appear');
  assert.deepEqual([...refs].sort(), ['ACME-2', 'COU-1']);
});

test('extractRefsFromBody de-dupes repeated refs and preserves the string[] contract', () => {
  const refs = extractRefsFromBody('COU-12 then again COU-12 and COU-13', 'COU-2486');
  assert.deepEqual([...refs].sort(), ['COU-12', 'COU-13']);
});

test('extractRefsFromBody returns [] for an empty / undefined body', () => {
  assert.deepEqual(extractRefsFromBody(undefined, 'COU-2486'), []);
  assert.deepEqual(extractRefsFromBody('', 'COU-2486'), []);
  assert.deepEqual(extractRefsFromBody('no refs in this prose', 'COU-2486'), []);
});

test('a hostile identifier with regex metacharacters is rejected by prefixFromIdentifier (no injection reaches the pattern build)', () => {
  // prefixFromIdentifier restricts the prefix to [A-Z][A-Z0-9]{1,7} so a
  // metacharacter-bearing identifier never yields a prefix — extraction falls
  // back to the (linear, ReDoS-safe) broad pattern rather than interpreting the
  // metacharacters. The escapeRegex in extractRefsFromBody is belt-and-braces.
  assert.equal(prefixFromIdentifier('C.*-9'), null, 'metacharacter identifier yields no prefix');
  const refs = extractRefsFromBody('COU-1 appears', 'C.*-9');
  assert.deepEqual(refs, ['COU-1'], 'falls back to the broad pattern; no regex injection');
});
