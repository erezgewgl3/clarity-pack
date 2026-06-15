// test/ui/surfaces/bulletin-action-card.test.mjs
//
// Phase 19 Plan 19-03 Task 2 (CARD-02 / D-09) — Bulletin four-surface parity.
// The bulletin's "Requires Your Decision" Action Inbox today has NO action-card /
// named-action render (a true D-09 gap). This wires the read-cached-only attach
// (worker) + the card-or-floor render (UI): when the runtime flag is ON and a
// FRESH cached card exists for the inbox item's leaf, render the Editor
// named-action prose (rescrubbed) + await/est line; else the existing
// awaiting-you summary floor. sourceIssueUuid never reaches a render node.
//
// Convention (mirrors employee-row-action-card.test.mjs): source-grep + a
// string-render simulation for the behavioral / NO_UUID_LEAK scan.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const { PARTIAL_HEX_RE } = await import('../../../src/shared/scrub-human-action.ts');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const INBOX = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/bulletin/action-inbox.tsx'),
  'utf8',
);
const INBOX_CODE = stripComments(INBOX);
const HANDLER = readFileSync(
  path.join(REPO_ROOT, 'src/worker/handlers/bulletin-by-cycle.ts'),
  'utf8',
);
const HANDLER_CODE = stripComments(HANDLER);

// ---------------------------------------------------------------------------
// WORKER — flag-gated read-only cached card attach per inbox item (no compile).
// ---------------------------------------------------------------------------

test('worker — bulletin-by-cycle reads cached cards via getActionCardsBySources (read-only)', () => {
  assert.match(HANDLER_CODE, /getActionCardsBySources/, 'batch cached read');
  assert.doesNotMatch(HANDLER_CODE, /driveActionCardsStep/, 'NEVER compiles on the request path (CARD-01)');
});

test('worker — the attach is flag-gated + liveness-armed + mapped via rowToCard', () => {
  assert.match(HANDLER_CODE, /isActionCardsEnabled/, 'flag-gated');
  assert.match(HANDLER_CODE, /isActionCardLive/, 'liveness arm');
  assert.match(HANDLER_CODE, /rowToCard/, 'row → display shape');
});

// ---------------------------------------------------------------------------
// UI — fresh card → namedAction (rescrubbed) + await/est; else summary floor.
// ---------------------------------------------------------------------------

test('UI — the inbox card reads card.actionCard and renders rescrubPersisted(card.namedAction)', () => {
  assert.match(INBOX_CODE, /\.actionCard/, 'reads the attached actionCard');
  assert.match(INBOX_CODE, /rescrubPersisted/, 'rescrubs display strings');
  assert.match(INBOX_CODE, /namedAction/, 'renders the named action');
});

test('UI — the existing awaiting-you summary floor is preserved', () => {
  assert.match(INBOX_CODE, /card\.summary/, 'the existing summary line is still rendered (floor)');
});

test('UI — the card render is gated on a present card (null → floor)', () => {
  assert.match(INBOX_CODE, /actionCard\s*\?|actionCard\s*&&|ac\s*\?|ac\s*&&/, 'card render gated on presence');
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — the inbox never accesses sourceIssueUuid', () => {
  assert.doesNotMatch(INBOX_CODE, /\.sourceIssueUuid\b/, 'no sourceIssueUuid access');
});

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
function renderCardText(card) {
  const est = estBucketLabel(card.estBucket);
  return `${card.namedAction}\nwaiting on ${card.awaitedParty}${est ? ` · ${est}` : ''}`;
}

test('behavioral — flag ON + fresh card renders named-action prose + await/est', () => {
  const card = {
    namedAction: 'Decide whether to ship the v1.8 cut.',
    awaitedParty: 'you — Founder',
    estBucket: 'focused',
    actionKind: 'decide',
    decisionOptions: ['Ship', 'Hold'],
  };
  const rendered = renderCardText(card);
  assert.match(rendered, /Decide whether to ship/);
  assert.match(rendered, /waiting on you — Founder/);
  assert.match(rendered, /~30-min review/);
});

test('behavioral NO_UUID_LEAK — a card carrying a real sourceIssueUuid renders ZERO leak', () => {
  const SOURCE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.match(SOURCE_UUID, UUID_RE);
  const card = {
    namedAction: 'Answer the open question so the team can proceed.',
    awaitedParty: 'an agent',
    estBucket: 'quick',
    actionKind: 'answer',
    decisionOptions: null,
  };
  const rendered = renderCardText(card);
  assert.doesNotMatch(rendered, UUID_RE, `leaked a UUID: ${rendered}`);
  assert.doesNotMatch(rendered, PARTIAL_HEX_RE, `leaked a partial hash: ${rendered}`);
});

test('behavioral — a null card renders the deterministic summary floor (no card prose)', () => {
  const card = { actionCard: null };
  assert.equal(card.actionCard, null, 'flag-OFF/stale → null card → summary floor');
});
