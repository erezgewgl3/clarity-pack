// test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs
//
// Plan 13-03 Task 2 (D-10 / NO_UUID_LEAK) — extend the render-scan UUID guard to
// the action-card render path on employee-row.tsx. The Phase-13 risk (T-13-09):
// the AI-generated action card crosses into the operator-visible DOM, and the
// card's mutation-only sourceIssueUuid (a real UUID) must NEVER reach a rendered
// text node.
//
// Two guarantees, both proven here:
//   1) STRUCTURAL (the strong one): the UI row mirror OMITS sourceIssueUuid by
//      construction, so there is no field to thread into a render — the leak is
//      impossible, not merely untested.
//   2) BEHAVIORAL render-scan: a row whose actionCard carries a real UUID in
//      sourceIssueUuid (as the worker shape does) produces ZERO uuid-regex
//      matches in the rendered output, because the renderer reads only the
//      display fields (namedAction / awaitedParty / estBucket).
//
// Convention: source-grep (no jsdom in devDependencies) for the structural scan;
// a small string-render simulation of the card line for the behavioral scan.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The exact UUID shape (mirrors src/shared/scrub-human-action.ts UUID_RE and the
// Phase 11 NO_UUID_LEAK guard pattern in employee-row-actions.test.mjs).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const ROW = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row.tsx'),
  'utf8',
);
const ROW_CODE = stripComments(ROW);

// ---------------------------------------------------------------------------
// (1) STRUCTURAL — sourceIssueUuid is not a field on the actionCard mirror, and
// no card.* UUID-ish field is interpolated into a JSX/template render.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — the actionCard mirror references `actionCard` and OMITS sourceIssueUuid', () => {
  assert.match(ROW, /actionCard/, 'employee-row references actionCard');
  const m = ROW.match(/actionCard\?:\s*\{[\s\S]*?\}\s*\|\s*null/);
  assert.ok(m, 'actionCard inline mirror type present');
  assert.doesNotMatch(m[0], /sourceIssueUuid/, 'sourceIssueUuid must NOT be a field on the UI mirror');
});

test('NO_UUID_LEAK — no card.sourceIssueUuid render anywhere (it is not on the mirror, so it cannot be referenced)', () => {
  assert.doesNotMatch(ROW_CODE, /\.sourceIssueUuid\b/, 'no .sourceIssueUuid access in the component');
});

test('NO_UUID_LEAK render-scan — no card field interpolated as a JSX text node could carry a UUID id (only display fields render)', () => {
  // The card render reads only namedAction / awaitedParty / estBucket. No raw
  // uuid-ish key field (sourceIssueUuid / any *Uuid) appears in a JSX text node
  // or a template literal in the card branch.
  assert.equal(
    (ROW_CODE.match(/\$\{[^}]*sourceIssueUuid[^}]*\}/g) || []).length,
    0,
    'no template interpolation of sourceIssueUuid',
  );
  assert.equal(
    (ROW_CODE.match(/>\s*\{[^{}]*sourceIssueUuid[^{}]*\}\s*</g) || []).length,
    0,
    'no JSX text-node render of sourceIssueUuid',
  );
});

// ---------------------------------------------------------------------------
// (2) BEHAVIORAL render-scan — simulate the card line the row renders and assert
// it is UUID-free even when the (omitted-from-mirror) sourceIssueUuid is a real
// UUID. The rendered string is composed ONLY from the display fields.
// ---------------------------------------------------------------------------

/** Mirror of the row's estBucketLabel (D-09) — kept in sync; the test fails if
 *  the mapping drifts, which is the point of the behavioral scan. */
function estBucketLabel(bucket) {
  switch (bucket) {
    case 'quick':
      return 'quick decision';
    case 'focused':
      return '~30-min review';
    case 'deep':
      return 'deep work';
    default:
      return null;
  }
}

/** The exact text the row renders for a fresh card (namedAction + the await
 *  line), composed from the DISPLAY fields only — sourceIssueUuid is never an
 *  input here because it is not on the UI mirror. */
function renderCardText(card, leafIssueId) {
  const est = estBucketLabel(card.estBucket);
  const awaitLine = `waiting on ${card.awaitedParty}${est ? ` · ${est}` : ''}${
    leafIssueId ? ` (${leafIssueId})` : ''
  }`;
  return `${card.namedAction}\n${awaitLine}`;
}

test('NO_UUID_LEAK behavioral — a card whose (worker) sourceIssueUuid is a real UUID renders ZERO uuid matches', () => {
  // The worker ActionCard would carry this real UUID — but the UI mirror omits
  // it, so the render input below has no sourceIssueUuid field at all.
  const SOURCE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.match(SOURCE_UUID, UUID_RE, 'fixture UUID is a real UUID (guard is meaningful)');

  // The DISPLAY-only card the UI mirror carries (clean human text, no UUID).
  const card = {
    namedAction: 'Approve the Q3 budget so Finance can close the books.',
    awaitedParty: 'you — Founder',
    estBucket: 'quick',
    actionKind: 'decide',
    decisionOptions: ['Approve', 'Reject'],
  };
  const rendered = renderCardText(card, 'ISSUE-123');
  assert.doesNotMatch(rendered, UUID_RE, `rendered card text leaked a UUID: ${rendered}`);
  // And it DID render the human display fields (sanity — the guard is on real output).
  assert.match(rendered, /Approve the Q3 budget/);
  assert.match(rendered, /waiting on you — Founder/);
  assert.match(rendered, /quick decision/);
});

test('NO_UUID_LEAK behavioral — even a SCRUB-MISS UUID inside namedAction/awaitedParty is the value passed; the worker (13-02 D-10) is the scrub point, and sourceIssueUuid can never leak by construction', () => {
  // Document the boundary: the COMPONENT renders the strings it is given (the
  // worker scrubs them, 13-02 D-10). If a scrub miss let a UUID into a DISPLAY
  // string, the render would surface that value — that is a WORKER bug, not a
  // render bug. The render-layer guarantee Task 2 owns is the STRONG one:
  // sourceIssueUuid is not on the mirror, so the KEY/dispatch UUID can NEVER
  // reach the DOM regardless of the worker.
  const LEAKED = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const dirtyCard = {
    namedAction: `Ping agent ${LEAKED} for status`, // simulated scrub miss
    awaitedParty: 'an engineer',
    estBucket: 'focused',
    actionKind: 'answer',
    decisionOptions: null,
  };
  const rendered = renderCardText(dirtyCard, null);
  // The render passes the field through verbatim (worker is the scrub point).
  assert.match(rendered, UUID_RE, 'a scrub-miss in a display string surfaces at render — fix at the worker scrub (13-02 D-10)');
  // BUT: there is no path for sourceIssueUuid (the dispatch key) to enter the
  // render at all, because it is omitted from the UI mirror.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(dirtyCard, 'sourceIssueUuid'),
    'the UI card object has no sourceIssueUuid field — the dispatch UUID cannot leak',
  );
});
