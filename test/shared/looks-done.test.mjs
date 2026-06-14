// test/shared/looks-done.test.mjs
//
// Plan 18-03 Task 1 (LEG-03 / D-05 / D-06) — the deterministic high-precision
// completion-phrase detector. These tests pin the trigger contract: explicit,
// unhedged completion phrasing → true; hedged / negated / empty → false. The
// bias is PRECISION (D-06) — tolerate misses over false prompts, because a false
// "Looks done — close it?" on a genuinely-blocked item erodes trust.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { looksDone } from '../../src/shared/looks-done.ts';

// ---------------------------------------------------------------------------
// POSITIVE — explicit, unhedged completion claims fire.
// ---------------------------------------------------------------------------

test('looksDone — "This task is done and shipped." → true', () => {
  assert.equal(looksDone('This task is done and shipped.'), true);
});

test('looksDone — "Work is complete." → true', () => {
  assert.equal(looksDone('Work is complete.'), true);
});

test('looksDone — "The PR has been merged." → true', () => {
  assert.equal(looksDone('The PR has been merged.'), true);
});

test('looksDone — "Feature delivered." → true', () => {
  assert.equal(looksDone('Feature delivered.'), true);
});

test('looksDone — "Issue resolved." → true', () => {
  assert.equal(looksDone('Issue resolved.'), true);
});

test('looksDone — "The migration has shipped to production." → true', () => {
  assert.equal(looksDone('The migration has shipped to production.'), true);
});

test('looksDone — "Everything is finished now." → true', () => {
  assert.equal(looksDone('Everything is finished now.'), true);
});

test('looksDone — a multi-sentence body whose LAST sentence is an explicit completion claim → true', () => {
  assert.equal(
    looksDone('Implemented the parser. Wrote tests. The work is complete.'),
    true,
  );
});

// ---------------------------------------------------------------------------
// NEGATIVE — hedged / negated / non-completion phrasing does NOT fire (D-06).
// ---------------------------------------------------------------------------

test('looksDone — "Almost done, blocked on review." → false (hedged "almost" + "blocked")', () => {
  assert.equal(looksDone('Almost done, blocked on review.'), false);
});

test('looksDone — "Not done yet." → false (negated)', () => {
  assert.equal(looksDone('Not done yet.'), false);
});

test('looksDone — "This is nearly complete but pending sign-off." → false (hedged "nearly"/"pending")', () => {
  assert.equal(looksDone('This is nearly complete but pending sign-off.'), false);
});

test('looksDone — "Will be done once the API is merged." → false (future/conditional "once")', () => {
  assert.equal(looksDone('Will be done once the API is merged.'), false);
});

test('looksDone — "Needs to be completed before launch." → false (hedged "needs to"/"before")', () => {
  assert.equal(looksDone('Needs to be completed before launch.'), false);
});

test('looksDone — "Please merge the branch and deploy." → false (imperative "merge", not a completion claim)', () => {
  assert.equal(looksDone('Please merge the branch and deploy.'), false);
});

test('looksDone — "Investigating the root cause of the failure." → false (no completion term)', () => {
  assert.equal(looksDone('Investigating the root cause of the failure.'), false);
});

// ---------------------------------------------------------------------------
// DEGRADE-SAFE — empty / null / undefined → false (no false prompt).
// ---------------------------------------------------------------------------

test('looksDone — empty string → false', () => {
  assert.equal(looksDone(''), false);
});

test('looksDone — whitespace-only → false', () => {
  assert.equal(looksDone('   \n  '), false);
});

test('looksDone — null → false', () => {
  assert.equal(looksDone(null), false);
});

test('looksDone — undefined → false', () => {
  assert.equal(looksDone(undefined), false);
});

// ---------------------------------------------------------------------------
// PRECISION ISOLATION — a same-sentence hedge vetoes; a DIFFERENT-sentence
// completion claim still fires (the per-sentence judgement, D-06).
// ---------------------------------------------------------------------------

test('looksDone — "Almost done. The build is complete." → true (the 2nd sentence is an unhedged claim)', () => {
  assert.equal(looksDone('Almost done. The build is complete.'), true);
});

test('looksDone — "The build is complete but the review is still pending." → false (same-sentence hedge "still"/"pending")', () => {
  assert.equal(
    looksDone('The build is complete but the review is still pending.'),
    false,
  );
});
