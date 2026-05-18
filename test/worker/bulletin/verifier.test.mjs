// test/worker/bulletin/verifier.test.mjs
//
// Plan 03-02 Task 1 — pass-2 deterministic verifier (CONTEXT.md D-15).
//
// v0.6.6 (debug bulletin-compile-cadence-runaway, Bug 2). `verifyDraft` no
// longer re-runs SQL. It now validates `draft.standingNumbers` against the
// FROZEN `StandingNumberRow[]` snapshot the pipeline handed the agent at
// compile START — verifying transcription fidelity (catches hallucination),
// never racing a live re-query. The verifier is a pure, sync, I/O-free
// function: `verifyDraft(draft, frozenStandingNumbers)`.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { verifyDraft } from '../../../src/worker/bulletin/bulletin-verifier.ts';

// Build a draft with the supplied standing-number rows. departments carry no
// `{{NUMBER:X}}` prose unless `prose` is given.
function makeDraft({ standingNumbers = [], prose = '' } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Monday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: prose ? [{ name: 'Sales', items: [], editorialSummary: prose }] : [],
    standingNumbers,
    lineageThreads: [],
  };
}

// A frozen standing-number row — the shape `computeStandingNumbers` feeds the
// pipeline and the verifier now checks against.
function frozen(key, value, format = 'currency', displayName = 'X') {
  return { key, displayName, value, format };
}

test('verifier: draft with no standing_numbers returns {ok:true}', () => {
  const result = verifyDraft(makeDraft(), []);
  assert.deepEqual(result, { ok: true });
});

test('verifier: claimed value matches the frozen snapshot -> {ok:true}', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: 2475, format: 'currency' }],
  });
  const result = verifyDraft(draft, [frozen('agent_spend_mtd', 2475)]);
  assert.deepEqual(result, { ok: true });
});

test('verifier: integer mismatch vs the frozen snapshot returns typed {ok:false, mismatches}', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: 2475, format: 'currency' }],
  });
  // The agent CLAIMED 2475 but the pipeline HANDED it 2470 — a hallucination.
  const result = verifyDraft(draft, [frozen('agent_spend_mtd', 2470)]);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.mismatches));
  assert.equal(result.mismatches[0].slot, 'agent_spend_mtd');
  assert.equal(result.mismatches[0].claimed, 2475);
  assert.equal(result.mismatches[0].actual, 2470);
  assert.equal(result.mismatches[0].tolerance, 0);
});

test('verifier: pct slot within ±0.01 tolerance passes', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'budget_used_pct', displayName: 'Budget used · MTD', value: 0.150, format: 'pct' }],
  });
  const result = verifyDraft(draft, [frozen('budget_used_pct', 0.145, 'pct')]);
  assert.deepEqual(result, { ok: true });
});

test('verifier: pct slot beyond ±0.01 tolerance fails', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'budget_used_pct', displayName: 'Budget used · MTD', value: 0.150, format: 'pct' }],
  });
  const result = verifyDraft(draft, [frozen('budget_used_pct', 0.100, 'pct')]);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.mismatches));
  assert.equal(result.mismatches[0].slot, 'budget_used_pct');
});

test('verifier: a claimed key absent from the frozen snapshot -> {ok:false, kind:UNKNOWN_SLOT}', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'foo', displayName: 'Foo', value: 1, format: 'count' }],
  });
  // The agent invented a slot key the pipeline never handed it.
  const result = verifyDraft(draft, [frozen('agent_spend_mtd', 2475)]);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'UNKNOWN_SLOT');
  assert.equal(result.slot, 'foo');
});

test('verifier: deterministic — twice with same inputs is deep-equal', () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: 2475, format: 'currency' }],
  });
  const a = verifyDraft(draft, [frozen('agent_spend_mtd', 2470)]);
  const b = verifyDraft(draft, [frozen('agent_spend_mtd', 2470)]);
  assert.deepEqual(a, b);
});

test('verifier: faithful transcription of every frozen slot passes — no SQL re-run, no race', () => {
  // The Bug-2 scenario: the agent was handed `completed_7d: 4` and faithfully
  // transcribed 4. Even if the LIVE count has since drifted to 5, the verifier
  // checks ONLY against the frozen snapshot — so a faithful draft is accepted.
  const draft = makeDraft({
    standingNumbers: [
      { key: 'open_issues', displayName: 'Open issues', value: 8, format: 'count' },
      { key: 'completed_7d', displayName: 'Issues completed · 7d', value: 4, format: 'count' },
    ],
  });
  const result = verifyDraft(draft, [
    frozen('open_issues', 8, 'count'),
    frozen('completed_7d', 4, 'count'),
  ]);
  assert.deepEqual(result, { ok: true });
});
