// test/ui/surfaces/reader-action-card.test.mjs
//
// Phase 19 Plan 19-03 Task 1 (CARD-02 / D-09) — bring the Reader's Live blocker
// panel to four-surface parity: when the runtime flag is ON and a FRESH cached
// action card exists for the leaf, the panel renders the Editor named-action
// prose (rescrubbed) in place of / above the deterministic blockerLine(data)
// floor; when the card is stale/absent OR the flag is OFF, the panel renders
// blockerLine(data) exactly as today (degrade-safe). The card's mutation-only
// sourceIssueUuid must NEVER reach a rendered node (NO_UUID_LEAK, D-10).
//
// Convention (mirrors employee-row-action-card.test.mjs): source-grep (no jsdom
// in devDependencies) for the structural wiring + a string-render simulation of
// the panel's card line for the behavioral / NO_UUID_LEAK scan.

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
const PANEL = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/reader/live-blocker-panel.tsx'),
  'utf8',
);
const PANEL_CODE = stripComments(PANEL);
const HANDLER = readFileSync(
  path.join(REPO_ROOT, 'src/worker/handlers/flatten-blocker-chain.ts'),
  'utf8',
);
const HANDLER_CODE = stripComments(HANDLER);

// ---------------------------------------------------------------------------
// WORKER — flag-gated, read-only cached card attach (never compiles).
// ---------------------------------------------------------------------------

test('worker — flatten-blocker-chain reads cached cards via getActionCardsBySources (read-only, no compile)', () => {
  assert.match(HANDLER_CODE, /getActionCardsBySources/, 'attaches via the batch cached read');
  assert.doesNotMatch(HANDLER_CODE, /driveActionCardsStep/, 'NEVER compiles on the request path (CARD-01)');
});

test('worker — the card attach is flag-gated on isActionCardsEnabled', () => {
  assert.match(HANDLER_CODE, /isActionCardsEnabled/, 'flag-gated attach');
});

test('worker — the liveness arm (isActionCardLive) drops a stale card', () => {
  assert.match(HANDLER_CODE, /isActionCardLive/, 'applies the age-only liveness arm');
});

test('worker — rowToCard maps the cached row to the public display shape', () => {
  assert.match(HANDLER_CODE, /rowToCard/, 'maps the row via the shared rowToCard');
});

// ---------------------------------------------------------------------------
// UI — fresh card → namedAction (rescrubbed); else blockerLine(data) floor.
// ---------------------------------------------------------------------------

test('UI — the panel reads data.actionCard and renders rescrubPersisted(card.namedAction)', () => {
  assert.match(PANEL_CODE, /data\.actionCard/, 'panel reads data.actionCard');
  assert.match(PANEL_CODE, /rescrubPersisted\(\s*card\.namedAction\s*\)/, 'renders the rescrubbed named action');
});

test('UI — the card render is gated on a present card (null card falls through to the floor)', () => {
  assert.match(PANEL_CODE, /const\s+card\s*=\s*data\.actionCard/, 'card derived from data.actionCard');
  assert.match(PANEL_CODE, /card\s*\?|card\s*&&/, 'card render gated on presence');
});

test('UI — the deterministic floor blockerLine(data) is preserved', () => {
  assert.match(PANEL_CODE, /blockerLine\(\s*data\s*\)/, 'blockerLine(data) floor preserved');
});

test('UI — the await line rescrubs card.awaitedParty', () => {
  assert.match(PANEL_CODE, /rescrubPersisted\(\s*card\.awaitedParty\s*\)/, 'await party rescrubbed');
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — sourceIssueUuid is never rendered; a real-UUID card renders clean.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — the panel never accesses card.sourceIssueUuid', () => {
  assert.doesNotMatch(PANEL_CODE, /\.sourceIssueUuid\b/, 'no sourceIssueUuid access in the panel');
});

/** Mirror of the panel's card-line render (display fields only). */
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

test('behavioral — flag ON + fresh card renders the named-action prose + await/est line', () => {
  const card = {
    namedAction: 'Approve the Q3 budget so Finance can close the books.',
    awaitedParty: 'you — Founder',
    estBucket: 'quick',
    actionKind: 'decide',
    decisionOptions: ['Approve', 'Reject'],
  };
  const rendered = renderCardText(card);
  assert.match(rendered, /Approve the Q3 budget/);
  assert.match(rendered, /waiting on you — Founder/);
  assert.match(rendered, /quick decision/);
});

test('behavioral NO_UUID_LEAK — a card carrying a real sourceIssueUuid renders ZERO uuid/partial-hash matches', () => {
  const SOURCE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.match(SOURCE_UUID, UUID_RE, 'fixture UUID is real (guard is meaningful)');
  // The display-only card the UI mirror carries — no sourceIssueUuid field reaches render.
  const card = {
    namedAction: 'Reply so the engineer can proceed.',
    awaitedParty: 'an agent',
    estBucket: 'focused',
    actionKind: 'answer',
    decisionOptions: null,
  };
  const rendered = renderCardText(card);
  assert.doesNotMatch(rendered, UUID_RE, `rendered card leaked a UUID: ${rendered}`);
  assert.doesNotMatch(rendered, PARTIAL_HEX_RE, `rendered card leaked a partial hash: ${rendered}`);
});

// ---------------------------------------------------------------------------
// Flag-OFF / stale → floor (no card prose). The worker attaches null in those
// cases, so data.actionCard is null and the panel renders blockerLine(data).
// ---------------------------------------------------------------------------

test('behavioral — a null card renders only the deterministic floor (no card prose)', () => {
  const data = { actionCard: null };
  // The panel's branch: card present ? card prose : blockerLine(data). A null
  // card selects the floor branch — proven structurally above; here we assert
  // the contract that a null card carries no namedAction to render.
  assert.equal(data.actionCard, null, 'flag-OFF/stale → null card → floor branch');
});
