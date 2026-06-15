// test/ui/surfaces/chat-action-card.test.mjs
//
// Phase 19 Plan 19-03 Task 2 (CARD-02 / D-09) — Chat four-surface parity. The
// chat needs-you rail (context-rail.tsx, fed by chat-active-tasks.ts) reads no
// action card today. This wires the read-cached-only attach (worker) + the
// card-or-floor render (UI): when the flag is ON and a FRESH cached card exists
// for an active task's leaf, render the Editor named-action prose (rescrubbed) in
// the "You owe" needs-you slot; else the existing deterministic line. No
// sourceIssueUuid reaches a render node.
//
// Convention: source-grep + a string-render simulation.

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
const RAIL = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/chat/context-rail.tsx'),
  'utf8',
);
const RAIL_CODE = stripComments(RAIL);
const HANDLER = readFileSync(
  path.join(REPO_ROOT, 'src/worker/handlers/chat-active-tasks.ts'),
  'utf8',
);
const HANDLER_CODE = stripComments(HANDLER);

// ---------------------------------------------------------------------------
// WORKER — flag-gated read-only cached card attach per active task (no compile).
// ---------------------------------------------------------------------------

test('worker — chat-active-tasks reads cached cards via getActionCardsBySources (read-only)', () => {
  assert.match(HANDLER_CODE, /getActionCardsBySources/, 'batch cached read');
  assert.doesNotMatch(HANDLER_CODE, /driveActionCardsStep/, 'NEVER compiles on the request path (CARD-01)');
});

test('worker — the attach is flag-gated + liveness-armed + mapped via rowToCard', () => {
  assert.match(HANDLER_CODE, /isActionCardsEnabled/, 'flag-gated');
  assert.match(HANDLER_CODE, /isActionCardLive/, 'liveness arm');
  assert.match(HANDLER_CODE, /rowToCard/, 'row → display shape');
});

// ---------------------------------------------------------------------------
// UI — fresh card → namedAction (rescrubbed) in the needs-you slot; else floor.
// ---------------------------------------------------------------------------

test('UI — the rail reads an attached actionCard and rescrubs the named action', () => {
  assert.match(RAIL_CODE, /actionCard/, 'reads the attached actionCard');
  assert.match(RAIL_CODE, /rescrubPersisted/, 'rescrubs display strings');
  assert.match(RAIL_CODE, /namedAction/, 'renders the named action');
});

test('UI — the existing You-owe deterministic floor is preserved', () => {
  assert.match(RAIL_CODE, /No outstanding decisions on this topic\.|You owe/, 'the existing You-owe floor is preserved');
});

test('UI — the card render is gated on a present card (null → floor)', () => {
  assert.match(RAIL_CODE, /actionCard\s*\?|actionCard\s*&&|owedCard\s*\?|owedCard\s*&&/, 'card render gated on presence');
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — the rail never accesses sourceIssueUuid', () => {
  assert.doesNotMatch(RAIL_CODE, /\.sourceIssueUuid\b/, 'no sourceIssueUuid access');
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

test('behavioral — flag ON + fresh card renders named-action prose', () => {
  const card = {
    namedAction: 'Reply to the CTO so the spec can lock.',
    awaitedParty: 'you — Founder',
    estBucket: 'quick',
    actionKind: 'answer',
    decisionOptions: null,
  };
  const rendered = renderCardText(card);
  assert.match(rendered, /Reply to the CTO/);
  assert.match(rendered, /waiting on you — Founder/);
  assert.match(rendered, /quick decision/);
});

test('behavioral NO_UUID_LEAK — a card carrying a real sourceIssueUuid renders ZERO leak', () => {
  const SOURCE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.match(SOURCE_UUID, UUID_RE);
  const card = {
    namedAction: 'Approve the plan so the build can start.',
    awaitedParty: 'an agent',
    estBucket: 'deep',
    actionKind: 'decide',
    decisionOptions: ['Approve', 'Revise'],
  };
  const rendered = renderCardText(card);
  assert.doesNotMatch(rendered, UUID_RE, `leaked a UUID: ${rendered}`);
  assert.doesNotMatch(rendered, PARTIAL_HEX_RE, `leaked a partial hash: ${rendered}`);
});

test('behavioral — a null card renders the deterministic You-owe floor (no card prose)', () => {
  const card = { actionCard: null };
  assert.equal(card.actionCard, null, 'flag-OFF/stale → null card → You-owe floor');
});
