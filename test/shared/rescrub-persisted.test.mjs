// test/shared/rescrub-persisted.test.mjs
//
// Plan 18-02 Task 1 (LEG-02e) — unit + idempotency coverage for the read-time
// re-scrub pass `rescrubPersisted`, plus the anchored `PARTIAL_HEX_RE` guard.
//
// rescrubPersisted cleans ALREADY-PERSISTED display strings at render time:
// every bare UUID AND every legacy `agent#<hex{6,}>` partial-hash becomes the
// plain-English AGENT_FALLBACK ("an agent"). It is pure, additive, idempotent,
// and never touches the DB (regex over an in-memory string only).
//
// The PARTIAL_HEX_RE anchor is the LOAD-BEARING bit: it is anchored to the
// literal `agent#` prefix so it does NOT false-positive on a bare git SHA or a
// hex color (landmine #5 — a blanket `/[0-9a-f]{8,}/` would fail the build on
// legitimate SHAs/colors). This file pins both the match and the non-match.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  AGENT_FALLBACK,
  PARTIAL_HEX_RE,
  UUID_RE,
  rescrubPersisted,
} from '../../src/shared/scrub-human-action.ts';

// ---------------------------------------------------------------------------
// AGENT_FALLBACK is the single plain-English vocabulary.
// ---------------------------------------------------------------------------

test('AGENT_FALLBACK is the literal "an agent"', () => {
  assert.equal(AGENT_FALLBACK, 'an agent');
});

// ---------------------------------------------------------------------------
// rescrubPersisted — the legacy partial-hash leak (the live BEAAA-972 string).
// ---------------------------------------------------------------------------

test('rescrubPersisted — a persisted agent#<hex> partial hash → "an agent"', () => {
  const out = rescrubPersisted('...stuck on agent#04fcac7c is stuck');
  assert.equal(out, '...stuck on an agent is stuck');
  assert.doesNotMatch(out, PARTIAL_HEX_RE, `partial hash survived: ${out}`);
});

test('rescrubPersisted — a longer partial hash (agent#deadbeef12) → "an agent"', () => {
  const out = rescrubPersisted('blocked on agent#deadbeef12 forever');
  assert.equal(out, 'blocked on an agent forever');
  assert.doesNotMatch(out, PARTIAL_HEX_RE, out);
});

test('rescrubPersisted — a bare UUID in the string is also replaced', () => {
  const out = rescrubPersisted('Waiting on 7b5c7deb-8135-4d23-b41b-6cf7b724e945 to decide');
  assert.equal(out, 'Waiting on an agent to decide');
  assert.ok(!UUID_RE.test(out), `bare UUID survived: ${out}`);
});

test('rescrubPersisted — multiple leaks (UUID + partial hash) in one string', () => {
  const out = rescrubPersisted(
    'agent#04fcac7c blocked by aaaaaaaa-1111-2222-3333-444444444444',
  );
  assert.equal(out, 'an agent blocked by an agent');
  assert.doesNotMatch(out, PARTIAL_HEX_RE, out);
  assert.ok(!UUID_RE.test(out), out);
});

// ---------------------------------------------------------------------------
// Idempotency — re-running over clean text is a no-op.
// ---------------------------------------------------------------------------

test('rescrubPersisted — idempotent: a second pass changes nothing', () => {
  const dirty = '...stuck on agent#04fcac7c is stuck';
  const once = rescrubPersisted(dirty);
  const twice = rescrubPersisted(once);
  assert.equal(twice, once);
});

test('rescrubPersisted — already-clean prose is returned unchanged', () => {
  const clean = 'Approve the Q3 budget so Finance can close the books.';
  assert.equal(rescrubPersisted(clean), clean);
});

test('rescrubPersisted — text containing the literal "an agent" is a no-op', () => {
  const text = 'Waiting on an agent (stuck)';
  assert.equal(rescrubPersisted(text), text);
});

test('rescrubPersisted — empty / non-string inputs are returned as-is', () => {
  assert.equal(rescrubPersisted(''), '');
  assert.equal(rescrubPersisted(null), null);
  assert.equal(rescrubPersisted(undefined), undefined);
});

// ---------------------------------------------------------------------------
// PARTIAL_HEX_RE — ANCHORED. Matches agent#<hex{6,}>; does NOT false-positive
// on a bare git SHA or a hex color (landmine #5).
// ---------------------------------------------------------------------------

test('PARTIAL_HEX_RE matches agent#<hex{6,}>', () => {
  assert.match('agent#04fcac7c', PARTIAL_HEX_RE);
  assert.match('agent#deadbeef12', PARTIAL_HEX_RE);
  assert.match('agent#abcdef', PARTIAL_HEX_RE); // exactly 6 hex
});

test('PARTIAL_HEX_RE does NOT match a bare git SHA (no agent# prefix)', () => {
  assert.doesNotMatch('deadbeef', PARTIAL_HEX_RE);
  assert.doesNotMatch('commit 35d4945 fixed it', PARTIAL_HEX_RE);
  assert.doesNotMatch('see 04fcac7cabc123', PARTIAL_HEX_RE);
});

test('PARTIAL_HEX_RE does NOT match a hex color', () => {
  assert.doesNotMatch('#0E0D0A', PARTIAL_HEX_RE);
  assert.doesNotMatch('color: #aabbcc;', PARTIAL_HEX_RE);
});

test('PARTIAL_HEX_RE does NOT match agent#<hex{<6}> (too short to be the leak shape)', () => {
  assert.doesNotMatch('agent#abc', PARTIAL_HEX_RE); // 3 hex
  assert.doesNotMatch('agent#1234', PARTIAL_HEX_RE); // 4 hex
});

test('rescrubPersisted — does NOT touch a bare git SHA or a hex color (anchored)', () => {
  const text = 'commit 35d4945 set color #0E0D0A on the chip';
  assert.equal(rescrubPersisted(text), text);
});
