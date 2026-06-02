// test/ui/surfaces/situation-room/employee-row-action-card.test.mjs
//
// Plan 13-03 Task 1 — the minimal inline render of the Editor-Agent named-action
// card on the EXISTING Needs-you employee row (D-13), with a hard degrade to the
// deterministic engine line when no fresh card exists (D-12 / ACT-02).
//
// Convention: source-grep (no jsdom in devDependencies). Asserts the row WIRES
// the actionCard render path + the degrade fallback + the bucket→words mapping +
// the no-chip / no-Pulse / no-tier scope hold, by reading the component source.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
// D-14 — the UI mirror carries the ActionCard DISPLAY fields ONLY; the
// mutation-only sourceIssueUuid is omitted by construction (NO_UUID_LEAK).
// ---------------------------------------------------------------------------

test('D-14 — SituationEmployeeRow mirror has an optional actionCard field', () => {
  assert.match(ROW, /actionCard\?:/, 'mirror declares optional actionCard');
});

test('D-14 — the actionCard mirror carries the display fields (namedAction, awaitedParty, estBucket, actionKind, decisionOptions)', () => {
  // Isolate the actionCard mirror type block so the field asserts target it.
  const m = ROW.match(/actionCard\?:\s*\{[\s\S]*?\}\s*\|\s*null/);
  assert.ok(m, 'actionCard mirror is an inline object type | null');
  const block = m[0];
  assert.match(block, /namedAction:\s*string/);
  assert.match(block, /awaitedParty:\s*string/);
  assert.match(block, /estBucket:/);
  assert.match(block, /actionKind:/);
  assert.match(block, /decisionOptions:/);
});

test('D-14 / NO_UUID_LEAK — sourceIssueUuid is NOT a field on the actionCard mirror', () => {
  const m = ROW.match(/actionCard\?:\s*\{[\s\S]*?\}\s*\|\s*null/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /sourceIssueUuid/, 'sourceIssueUuid must be omitted from the UI mirror by construction');
});

test('D-14 — the row does not import worker/shared ActionCard type (mirrors structurally)', () => {
  // The mirror is declared inline; no `import ... ActionCard` from shared/worker.
  assert.doesNotMatch(ROW_CODE, /import\s+type\s*\{[^}]*ActionCard[^}]*\}/);
});

// ---------------------------------------------------------------------------
// D-09 — estBucketLabel maps quick/focused/deep → display words; else → null.
// ---------------------------------------------------------------------------

test('D-09 — estBucketLabel pure helper exists and maps the three buckets to display words', () => {
  assert.match(ROW, /function estBucketLabel/);
  assert.match(ROW, /quick decision/);
  assert.match(ROW, /~30-min review/);
  assert.match(ROW, /deep work/);
});

test('D-09 — estBucketLabel returns null for an unknown/garbage bucket (omit estimate, no fake number)', () => {
  // Isolate the helper body; the default arm returns null.
  const m = ROW.match(/function estBucketLabel[\s\S]*?\n\}/);
  assert.ok(m, 'estBucketLabel body present');
  assert.match(m[0], /return null/, 'unknown bucket → null');
});

// ---------------------------------------------------------------------------
// SC1 / ACT-01 — a fresh card renders the named-action sentence + party + est.
// ---------------------------------------------------------------------------

test('ACT-01 — the needs_you branch reads row.actionCard and renders namedAction', () => {
  assert.match(ROW, /row\.actionCard/);
  assert.match(ROW_CODE, /\.namedAction/, 'renders the card.namedAction sentence');
});

test('ACT-01 — a fresh card renders a "waiting on <party>" line from card.awaitedParty', () => {
  assert.match(ROW_CODE, /waiting on/);
  assert.match(ROW_CODE, /\.awaitedParty\b/, 'renders card.awaitedParty (the scrubbed party)');
});

test('ACT-01 — the estimate words are appended from estBucketLabel(card.estBucket)', () => {
  assert.match(ROW_CODE, /estBucketLabel\(\s*card\.estBucket\s*\)/);
});

// ---------------------------------------------------------------------------
// D-12 / ACT-02 — actionCard null/absent → the EXISTING deterministic line.
// ---------------------------------------------------------------------------

test('ACT-02 — the deterministic degrade line is preserved verbatim (awaitedPartyLabel / has no owner)', () => {
  assert.match(ROW_CODE, /awaitedPartyLabel/, 'degrade line uses chain.awaitedPartyLabel');
  assert.match(ROW_CODE, /has no owner/, 'unowned degrade line preserved');
});

test('ACT-02 — the card render is GATED on the card being present (a null card falls through to the deterministic line)', () => {
  // A `card ?` ternary / `card &&` guard must wrap the card render so a null
  // card renders the deterministic branch.
  assert.match(ROW_CODE, /const\s+card\s*=\s*row\.actionCard/, 'card is derived from row.actionCard');
  assert.match(ROW_CODE, /card\s*\?|card\s*&&/, 'card render is gated on the card being present');
});

// ---------------------------------------------------------------------------
// Scope hold (D-13) — NO chips, NO Pulse, NO tier reorg, NO reply input.
// ---------------------------------------------------------------------------

test('D-13 — decisionOptions is NOT rendered as chips this phase (no chip element / no .map over decisionOptions)', () => {
  assert.doesNotMatch(ROW_CODE, /decisionOptions[\s\S]{0,40}\.map\(/, 'no chip map over decisionOptions');
  assert.doesNotMatch(ROW_CODE, /clarity-decision-chip/, 'no decision-chip element');
});

test('D-13 — no Pulse header / tier reorg / reply input added (scope held to the inline sentence)', () => {
  assert.doesNotMatch(ROW_CODE, /Pulse/);
  assert.doesNotMatch(ROW_CODE, /<textarea/);
  assert.doesNotMatch(ROW_CODE, /clarity-reply-input/);
});

test('component contains NO dangerouslySetInnerHTML (every new string is a text node)', () => {
  assert.equal((ROW_CODE.match(/dangerouslySetInnerHTML/g) || []).length, 0);
});
