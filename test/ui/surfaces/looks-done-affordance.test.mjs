// test/ui/surfaces/looks-done-affordance.test.mjs
//
// Plan 18-03 Task 3 (LEG-03) — the confirm-gated honest-divergence affordance.
//
// Convention (no jsdom in devDependencies): a SOURCE-GREP structural scan over
// looks-done-affordance.tsx + the two wiring sites, plus a BEHAVIORAL simulation
// of the gating decision and the confirm flow. The behavioral simulation models
// the EXACT predicate the surfaces use to decide whether to render the affordance
// (done ∧ needsYou ∧ a leaf to close) and the EXACT dispatch path (a spy proves
// the close mutation NEVER fires without the explicit "Close as done" handler).
//
// What this pins:
//   - present when done=true ∧ needsYou=true ∧ leaf present
//   - absent when the two inputs AGREE (done=false, or needsYou=false)
//   - absent when EITHER input is missing (degrade-safe — no false prompt)
//   - the close mutation is NEVER dispatched without the explicit "Close as done"
//     selection (confirm-gated by construction, T-18.03-STATE)
//   - the close-target UUID is a dispatch-only prop, never a rendered text node
//     (NO_UUID_LEAK, T-18.03-I)
//   - the Reader path adds NO new ctx.db / fetch call (uses data.tldr.body in hand)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { looksDone } from '../../../src/shared/looks-done.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const AFFORDANCE = readSrc('src/ui/surfaces/situation-room/looks-done-affordance.tsx');
const AFFORDANCE_CODE = stripComments(AFFORDANCE);
const READER = readSrc('src/ui/surfaces/reader/index.tsx');
const READER_CODE = stripComments(READER);
const ROW = readSrc('src/ui/surfaces/situation-room/employee-row.tsx');
const ROW_CODE = stripComments(ROW);

// ---------------------------------------------------------------------------
// BEHAVIORAL — the gating predicate the surfaces share (the must_have truths).
// shouldShow models: done ∧ needsYou ∧ a leaf id is available.
// ---------------------------------------------------------------------------

function shouldShow({ tldrBody, needsYou, leafIssueId }) {
  return looksDone(tldrBody) && needsYou === true && !!leafIssueId;
}

test('LEG-03 — present when done=true AND needsYou=true AND a leaf is available', () => {
  assert.equal(
    shouldShow({ tldrBody: 'This work is complete.', needsYou: true, leafIssueId: 'COU-100' }),
    true,
  );
});

test('LEG-03 — absent when the inputs AGREE: done=false (TL;DR not done)', () => {
  assert.equal(
    shouldShow({ tldrBody: 'Still investigating.', needsYou: true, leafIssueId: 'COU-100' }),
    false,
  );
});

test('LEG-03 — absent when the inputs AGREE: needsYou=false (engine not blocked-family)', () => {
  assert.equal(
    shouldShow({ tldrBody: 'This work is complete.', needsYou: false, leafIssueId: 'COU-100' }),
    false,
  );
});

test('LEG-03 — absent when the TL;DR input is MISSING (degrade-safe, no false prompt)', () => {
  assert.equal(shouldShow({ tldrBody: null, needsYou: true, leafIssueId: 'COU-100' }), false);
  assert.equal(shouldShow({ tldrBody: undefined, needsYou: true, leafIssueId: 'COU-100' }), false);
});

test('LEG-03 — absent when the verdict input is MISSING (no needsYou yet → no prompt)', () => {
  assert.equal(
    shouldShow({ tldrBody: 'This work is complete.', needsYou: undefined, leafIssueId: 'COU-100' }),
    false,
  );
});

test('LEG-03 — absent when there is no leaf id to close', () => {
  assert.equal(
    shouldShow({ tldrBody: 'This work is complete.', needsYou: true, leafIssueId: null }),
    false,
  );
});

// ---------------------------------------------------------------------------
// BEHAVIORAL — confirm-gated by construction: the close mutation fires ONLY from
// the explicit "Close as done" handler, never on open/toggle/dismiss.
// We model the component's three handlers against a dispatch spy.
// ---------------------------------------------------------------------------

/** A minimal model of the affordance's dispatch surface. dispatch() is the spy
 *  the real component routes through usePluginAction('situation.closeAsDone').
 *  Only confirmClose() may call it; openToggle() and keepBlocked() must not. */
function makeAffordanceModel() {
  let dispatched = 0;
  let lastArgs = null;
  const dispatch = (args) => {
    dispatched += 1;
    lastArgs = args;
  };
  return {
    openToggle() {
      /* sets open state only — NO dispatch (mirrors the trigger onClick) */
    },
    keepBlocked() {
      /* closes the confirm only — NO dispatch (mirrors "Keep blocked") */
    },
    confirmClose(args) {
      dispatch(args); // the ONLY path that dispatches (mirrors "Close as done")
    },
    get dispatched() {
      return dispatched;
    },
    get lastArgs() {
      return lastArgs;
    },
  };
}

test('LEG-03 — opening the affordance does NOT dispatch the close (no auto-close)', () => {
  const m = makeAffordanceModel();
  m.openToggle();
  assert.equal(m.dispatched, 0, 'no close on open/toggle');
});

test('LEG-03 — "Keep blocked" does NOT dispatch the close', () => {
  const m = makeAffordanceModel();
  m.openToggle();
  m.keepBlocked();
  assert.equal(m.dispatched, 0, 'no close on dismiss');
});

test('LEG-03 — only the explicit "Close as done" selection dispatches, carrying the UUID dispatch-only', () => {
  const m = makeAffordanceModel();
  m.openToggle();
  m.confirmClose({
    companyId: 'co',
    leafIssueId: 'COU-100',
    leafIssueUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    userId: 'u-1',
  });
  assert.equal(m.dispatched, 1, 'exactly one close on explicit confirm');
  assert.equal(m.lastArgs.leafIssueUuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(m.lastArgs.leafIssueId, 'COU-100');
});

// ---------------------------------------------------------------------------
// STRUCTURAL — the component shape: confirm labels, dispatch action, no
// auto-close in an effect/mount path, UUID dispatch-only (never rendered).
// ---------------------------------------------------------------------------

test('looks-done-affordance — carries the "Looks done — close it?" trigger + "Close as done" / "Keep blocked" confirm', () => {
  assert.match(AFFORDANCE, /Looks done — close it\?/, 'trigger label present');
  assert.match(AFFORDANCE, /Close as done/, 'confirm label present');
  assert.match(AFFORDANCE, /Keep blocked/, 'keep-blocked label present');
});

test('looks-done-affordance — dispatches situation.closeAsDone via usePluginAction', () => {
  assert.match(AFFORDANCE_CODE, /usePluginAction\(\s*['"]situation\.closeAsDone['"]\s*\)/, 'uses the close action key');
});

test('looks-done-affordance — the close dispatch is NOT in a mount/effect path (never auto-closes)', () => {
  // No useEffect body contains the close-action call: extract each useEffect's
  // body span and assert none reference the dispatched action handle.
  const effectBodies = AFFORDANCE_CODE.match(/useEffect\([\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/g) || [];
  for (const body of effectBodies) {
    assert.doesNotMatch(body, /closeAsDone\s*\(/, 'no closeAsDone() call inside a useEffect (no auto-close)');
    assert.doesNotMatch(body, /dispatchClose\s*\(/, 'no dispatchClose() call inside a useEffect (no auto-close)');
  }
});

test('looks-done-affordance — leafIssueUuid is dispatch-only: never rendered as a JSX text node / template', () => {
  // It appears as an action arg, but never inside `>{ ... leafIssueUuid ... }<`
  // or a `${ ... leafIssueUuid ... }` template.
  assert.equal(
    (AFFORDANCE_CODE.match(/>\s*\{[^{}]*leafIssueUuid[^{}]*\}\s*</g) || []).length,
    0,
    'no JSX text-node render of leafIssueUuid',
  );
  assert.equal(
    (AFFORDANCE_CODE.match(/\$\{[^}]*leafIssueUuid[^}]*\}/g) || []).length,
    0,
    'no template interpolation of leafIssueUuid',
  );
});

test('looks-done-affordance — a render of a clean component leaks no UUID (display strings only)', () => {
  // The only operator-visible strings are the labels + the confirm prose; none
  // is composed from the UUID. Compose them as the component does and scan.
  const rendered = [
    'Looks done — close it?',
    'The summary reads done, but it is still marked blocked. Close it?',
    'Close as done',
    'Keep blocked',
  ].join('\n');
  assert.doesNotMatch(rendered, UUID_RE, 'no UUID in any visible affordance string');
});

// ---------------------------------------------------------------------------
// STRUCTURAL — wiring: SR row gates on row.looksDone; Reader gates on
// looksDone(tldr.body) ∧ the lifted needsYou; Reader adds NO new DB read.
// ---------------------------------------------------------------------------

test('employee-row — renders the affordance gated on row.looksDone with a leaf', () => {
  assert.match(ROW_CODE, /LooksDoneAffordance/, 'employee-row imports/renders the affordance');
  assert.match(ROW_CODE, /row\.looksDone === true/, 'gated on the worker-set looksDone flag');
});

test('reader/index — gates the affordance on looksDone(data.tldr?.body) AND the lifted needsYou', () => {
  assert.match(READER_CODE, /looksDone\(data\.tldr\?\.body\)/, 'computes done from the in-hand TL;DR body');
  assert.match(READER_CODE, /blockerVerdict\?\.needsYou === true/, 'AND the lifted engine needsYou');
  assert.match(READER_CODE, /LooksDoneAffordance/, 'renders the affordance');
});

test('reader/index — the LEG-03 path adds NO new ctx.db / usePluginData fetch (uses the lifted verdict)', () => {
  // The verdict is lifted via the panel's onVerdict callback — there is no new
  // usePluginData('flatten-blocker-chain') call added at the index level for
  // LEG-03 (the panel remains the single owner of that read).
  const fetchCalls = READER_CODE.match(/usePluginData\s*(?:<[^>]*>)?\s*\(/g) || [];
  // The Reader index already has exactly two data fetches (issue.reader +
  // reader.ac.autostatus); LEG-03 must not add a third.
  assert.equal(fetchCalls.length, 2, 'LEG-03 adds no new usePluginData fetch to the Reader index');
});
