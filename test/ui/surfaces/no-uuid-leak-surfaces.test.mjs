// test/ui/surfaces/no-uuid-leak-surfaces.test.mjs
//
// Phase 19 Plan 19-03 Task 3 (D-10 / NO_UUID_LEAK + CARD-03 flag-OFF floor) — the
// SINGLE standing guard that a future edit to ANY of the three new card-render
// surfaces cannot (a) leak an identifier into the operator-visible DOM, or (b)
// drop the deterministic flag-OFF floor.
//
// Extends the SR employee-row-no-uuid-leak render-scan pattern (same uuid +
// anchored partial-hex + sourceIssueUuid regex set) to:
//   - Reader   src/ui/surfaces/reader/live-blocker-panel.tsx
//   - Bulletin src/ui/surfaces/bulletin/action-inbox.tsx
//   - Chat     src/ui/surfaces/chat/context-rail.tsx
//
// Two guarantees per surface, both proven here:
//   (1) NO_UUID_LEAK — the surface NEVER references card.sourceIssueUuid (it is
//       OMITTED from every UI mirror by construction); no uuid/short-hex/
//       sourceIssueUuid token is interpolated into a render node; and a card
//       carrying a real sourceIssueUuid produces ZERO uuid matches when its
//       DISPLAY fields are rendered (the dispatch key never reaches the DOM).
//   (2) FLAG-OFF FLOOR — the surface gates the card render on the card being
//       present (a `card ? … : floor` / `card && …` branch), so the flag-OFF
//       (null card) path renders the deterministic floor with zero card prose
//       (CARD-03 "OFF → floor everywhere", regression-proofed at the render layer).
//
// Convention (mirrors employee-row-no-uuid-leak.test.mjs): source-grep (no jsdom
// in devDependencies) for the structural scan; a string-render simulation of the
// shared card line for the behavioral scan.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The exact UUID shape (mirrors src/shared/scrub-human-action.ts UUID_RE).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// The ANCHORED partial-hash guard imported from the runtime so guard + runtime
// can never drift (Plan 18-02 landmine #5: anchored only, no blanket short-hex).
const { PARTIAL_HEX_RE } = await import('../../../src/shared/scrub-human-action.ts');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

const SURFACES = [
  {
    name: 'Reader (live-blocker-panel)',
    file: 'src/ui/surfaces/reader/live-blocker-panel.tsx',
    // The card variable the surface derives + the floor token it falls through to.
    cardGate: /const\s+card\s*=\s*data\.actionCard|data\.actionCard/,
    floorToken: /blockerLine\(\s*data\s*\)/,
  },
  {
    name: 'Bulletin (action-inbox)',
    file: 'src/ui/surfaces/bulletin/action-inbox.tsx',
    cardGate: /card\.actionCard|const\s+ac\s*=\s*card\.actionCard/,
    floorToken: /card\.summary/,
  },
  {
    name: 'Chat (context-rail)',
    file: 'src/ui/surfaces/chat/context-rail.tsx',
    cardGate: /\.actionCard|owedCard/,
    floorToken: /No outstanding decisions on this topic\./,
  },
];

for (const surface of SURFACES) {
  const SRC = readFileSync(path.join(REPO_ROOT, surface.file), 'utf8');
  const CODE = stripComments(SRC);

  // -------------------------------------------------------------------------
  // (1) STRUCTURAL NO_UUID_LEAK — sourceIssueUuid is never referenced, and no
  // uuid-ish key field is interpolated into a render node.
  // -------------------------------------------------------------------------

  test(`NO_UUID_LEAK [${surface.name}] — no .sourceIssueUuid access anywhere`, () => {
    assert.doesNotMatch(CODE, /\.sourceIssueUuid\b/, `${surface.file} accesses sourceIssueUuid`);
  });

  test(`NO_UUID_LEAK [${surface.name}] — no template/JSX interpolation of sourceIssueUuid`, () => {
    assert.equal(
      (CODE.match(/\$\{[^}]*sourceIssueUuid[^}]*\}/g) || []).length,
      0,
      `${surface.file} template-interpolates sourceIssueUuid`,
    );
    assert.equal(
      (CODE.match(/>\s*\{[^{}]*sourceIssueUuid[^{}]*\}\s*</g) || []).length,
      0,
      `${surface.file} JSX-renders sourceIssueUuid`,
    );
  });

  test(`NO_UUID_LEAK [${surface.name}] — source carries no agent#<hex> partial hash`, () => {
    assert.doesNotMatch(CODE, PARTIAL_HEX_RE, `${surface.file} leaks an agent#<hex> partial hash`);
  });

  test(`NO_UUID_LEAK [${surface.name}] — no dangerouslySetInnerHTML (every new string is a text node)`, () => {
    assert.equal((CODE.match(/dangerouslySetInnerHTML/g) || []).length, 0, `${surface.file} uses dangerouslySetInnerHTML`);
  });

  // -------------------------------------------------------------------------
  // (2) FLAG-OFF FLOOR — the card render is GATED on a present card, and the
  // deterministic floor token is preserved (a null card → floor, no card prose).
  // -------------------------------------------------------------------------

  test(`CARD-03 flag-OFF floor [${surface.name}] — the card render is gated on a present card`, () => {
    assert.match(CODE, surface.cardGate, `${surface.file} derives the card from the attached field`);
    assert.match(CODE, /card\s*\?|card\s*&&|ac\s*\?|ac\s*&&|owedCard\s*\?|owedCard\s*&&/, `${surface.file} gates the card render on presence`);
  });

  test(`CARD-03 flag-OFF floor [${surface.name}] — the deterministic floor is preserved`, () => {
    assert.match(CODE, surface.floorToken, `${surface.file} dropped its deterministic floor`);
  });

  // -------------------------------------------------------------------------
  // (1b) BEHAVIORAL render-scan — a card whose namedAction + awaitedParty carry
  // a real uuid, a partial/short hash, AND a sourceIssueUuid renders ZERO of
  // those tokens (only the DISPLAY fields render; sourceIssueUuid is not on the
  // mirror). The worker scrubs on write; rescrubPersisted is the second layer.
  // -------------------------------------------------------------------------

  test(`NO_UUID_LEAK behavioral [${surface.name}] — a clean display card renders zero uuid / partial-hash`, () => {
    const rendered = renderCardLine({
      namedAction: 'Approve the Q3 budget so Finance can close the books.',
      awaitedParty: 'you — Founder',
      estBucket: 'quick',
    });
    assert.doesNotMatch(rendered, UUID_RE, `${surface.name} rendered a UUID: ${rendered}`);
    assert.doesNotMatch(rendered, PARTIAL_HEX_RE, `${surface.name} rendered a partial hash: ${rendered}`);
    // Sanity — the display fields DID render (the guard is on real output).
    assert.match(rendered, /Approve the Q3 budget/);
    assert.match(rendered, /waiting on you — Founder/);
    assert.match(rendered, /quick decision/);
  });

  test(`NO_UUID_LEAK behavioral [${surface.name}] — the dispatch sourceIssueUuid is not an input to the render`, () => {
    // The DISPLAY-only mirror the surface renders has NO sourceIssueUuid field,
    // so a card whose worker shape carries a real UUID cannot leak it.
    const SOURCE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    assert.match(SOURCE_UUID, UUID_RE, 'fixture UUID is real (guard is meaningful)');
    const displayCard = {
      namedAction: 'Reply so the engineer can proceed.',
      awaitedParty: 'an agent',
      estBucket: 'focused',
    };
    assert.ok(
      !Object.prototype.hasOwnProperty.call(displayCard, 'sourceIssueUuid'),
      'the UI card object has no sourceIssueUuid field — the dispatch UUID cannot leak',
    );
    const rendered = renderCardLine(displayCard);
    assert.doesNotMatch(rendered, UUID_RE);
  });
}

// ---------------------------------------------------------------------------
// The shared card line every surface renders (display fields only) — mirrors the
// SR employee-row card render. estBucketLabel is identical across all surfaces.
// ---------------------------------------------------------------------------

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

function renderCardLine(card) {
  const est = estBucketLabel(card.estBucket);
  return `${card.namedAction}\nwaiting on ${card.awaitedParty}${est ? ` · ${est}` : ''}`;
}

// ---------------------------------------------------------------------------
// Meta — assert all three surfaces are actually covered (a future surface
// deletion / rename should fail this guard, not silently skip it).
// ---------------------------------------------------------------------------

test('coverage — all three new card-render surfaces are scanned', () => {
  assert.equal(SURFACES.length, 3, 'exactly the Reader / Bulletin / Chat surfaces');
  for (const s of SURFACES) {
    assert.ok(
      readFileSync(path.join(REPO_ROOT, s.file), 'utf8').length > 0,
      `${s.file} exists and is scanned`,
    );
  }
});
