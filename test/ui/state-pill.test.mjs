// test/ui/state-pill.test.mjs
//
// Plan 02-02 Task 2 — exercises the pure helpers exported from
// src/ui/primitives/state-pill-format.ts. The JSX surface (state-pill.tsx) is
// not loaded here because Node 24's native strip-types doesn't extend to
// .tsx; visual + integration verification happens in Plan 02-03 when Reader
// view consumes the component through the bundled UI output. The format
// helpers are what would break in non-obvious ways (off-by-one age buckets,
// missing state-to-class entries) and they ARE testable as pure functions.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  formatAge,
  humaniseState,
  STATE_TO_CLASS,
} from '../../src/ui/primitives/state-pill-format.ts';

test('formatAge — bucket boundaries (Plan 02-02 Task 2 acceptance)', () => {
  assert.equal(formatAge(0), '<1m');
  assert.equal(formatAge(59_000), '<1m');
  assert.equal(formatAge(60_000), '1m');
  assert.equal(formatAge(5 * 60_000), '5m');
  assert.equal(formatAge(60 * 60_000), '1h');
  assert.equal(formatAge(24 * 60 * 60_000), '1d');
  assert.equal(formatAge(7 * 24 * 60 * 60_000), '7d');
  assert.equal(formatAge(-1), '?');
  assert.equal(formatAge(Number.NaN), '?');
});

test('humaniseState splits CamelCase with a space', () => {
  assert.equal(humaniseState('AwaitingYou'), 'Awaiting You');
  assert.equal(humaniseState('AwaitingPeer'), 'Awaiting Peer');
  assert.equal(humaniseState('Working'), 'Working');
  assert.equal(humaniseState('Standby'), 'Standby');
});

test('STATE_TO_CLASS covers all five states with the expected class tokens', () => {
  assert.equal(STATE_TO_CLASS.Working, 'clarity-state-working');
  assert.equal(STATE_TO_CLASS.Stuck, 'clarity-state-stuck');
  assert.equal(STATE_TO_CLASS.AwaitingYou, 'clarity-state-awaiting-you');
  assert.equal(STATE_TO_CLASS.Standby, 'clarity-state-standby');
  assert.equal(STATE_TO_CLASS.AwaitingPeer, 'clarity-state-awaiting-peer');
  // Every class token must be the kebab-case form of the state name (a sanity
  // check: regression-proofs the table against accidental edits).
  for (const [state, cls] of Object.entries(STATE_TO_CLASS)) {
    const expected =
      'clarity-state-' + state.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    assert.equal(cls, expected, `state ${state}: class token mismatch (got ${cls}, expected ${expected})`);
  }
});
