// test/ui/surfaces/situation-room/blocked-backlog-reply-in-place.test.mjs
//
// Plan 14-03 Task 2 (SC3 / SC4 / SC5 / DO-01) — the org-blocked backlog expander
// mounts the ONE shared <ReplyInPlace> on its reply orphan rows (⇔ AWAITING_HUMAN
// via isReplyReachable(row.terminalKind)), passing the LEAF UUID (row.leafIssueUuid,
// NOT row.issueId the root) as the mutation id and row.identifier as the display
// key. Assign (Phase 12) stays on OwnerPickerPopover. NO_UUID_LEAK preserved.
//
// Convention: source-grep (no jsdom — same as the sibling reply-in-place tests).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx'),
  'utf8',
);
const CODE = stripComments(SRC);

// ---------------------------------------------------------------------------
// SC3 — the SAME shared primitive + the SAME shared predicate (no copies). This
// is the THIRD mount; asserting the identical import path across all three is the
// by-construction proof of SC3.
// ---------------------------------------------------------------------------

test('imports ReplyInPlace from the SAME ../_shared/reply-in-place (no copy — SC3)', () => {
  assert.match(
    CODE,
    /import\s*\{\s*ReplyInPlace\s*\}\s*from\s*'\.\.\/_shared\/reply-in-place\.tsx'/,
  );
});

test('imports isReplyReachable from the shared helper', () => {
  assert.match(
    CODE,
    /import\s*\{\s*isReplyReachable\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/reply-reachable\.ts'/,
  );
});

// ---------------------------------------------------------------------------
// The reply orphan row mounts <ReplyInPlace>; assign keeps OwnerPickerPopover.
// ---------------------------------------------------------------------------

test('mounts <ReplyInPlace> on the reply orphan-row branch', () => {
  assert.match(CODE, /<ReplyInPlace\b/);
  assert.match(CODE, /row\.actionAffordance\s*===\s*'reply'/);
});

test('OwnerPickerPopover still gated on actionAffordance === assign (Phase 12 untouched)', () => {
  assert.match(CODE, /OwnerPickerPopover/);
  assert.match(CODE, /row\.actionAffordance\s*===\s*'assign'/);
});

// ---------------------------------------------------------------------------
// WR-02 (14-REVIEW / NO_UUID_LEAK) — the assign-branch OwnerPickerPopover must
// receive the HUMAN key (row.identifier) as leafIssueId and the UUID
// (row.leafIssueUuid ?? row.issueId) as the dispatch-only leafIssueUuid. The
// previous code passed leafIssueId={row.issueId} (a UUID), which the popover
// would echo in its success toast.
// ---------------------------------------------------------------------------

test('WR-02 — OwnerPickerPopover leafIssueId is the HUMAN key row.identifier, NOT row.issueId', () => {
  assert.match(CODE, /leafIssueId=\{row\.identifier\}/);
  // the root UUID must NOT be passed as the human echo key anywhere.
  assert.doesNotMatch(CODE, /leafIssueId=\{row\.issueId\}/);
});

test('WR-02 — OwnerPickerPopover leafIssueUuid carries the UUID (row.leafIssueUuid ?? row.issueId)', () => {
  assert.match(CODE, /leafIssueUuid=\{row\.leafIssueUuid\s*\?\?\s*row\.issueId\}/);
});

// ---------------------------------------------------------------------------
// LEAF UUID is the mutation id — NOT row.issueId (the root).
// ---------------------------------------------------------------------------

test('passes row.leafIssueUuid (the LEAF uuid) as the mutation id, NOT row.issueId', () => {
  assert.match(CODE, /leafIssueUuid=\{row\.leafIssueUuid\}/);
  // row.issueId (the ROOT uuid) must NOT be passed as leafIssueUuid.
  assert.doesNotMatch(CODE, /leafIssueUuid=\{row\.issueId\}/);
});

test('passes row.identifier as the display key (leafIssueId)', () => {
  assert.match(CODE, /leafIssueId=\{row\.identifier\}/);
});

test('passes awaitedPartyLabel + decisionOptions + humanAction from the row', () => {
  assert.match(CODE, /awaitedPartyLabel=\{row\.awaitedPartyLabel\}/);
  assert.match(CODE, /decisionOptions=\{row\.decisionOptions\}/);
  assert.match(CODE, /namedAction=\{row\.humanAction\}/);
});

test('forwards onAssignSuccess as onActed', () => {
  assert.match(CODE, /onActed=\{onAssignSuccess\}/);
});

// ---------------------------------------------------------------------------
// reachable computed off row.terminalKind — no inline Terminal construction.
// ---------------------------------------------------------------------------

test('reachable = isReplyReachable(row.terminalKind)', () => {
  assert.match(CODE, /reachable=\{isReplyReachable\(row\.terminalKind\)\}/);
});

test('NO inline Terminal construction passed to isReplyReachable', () => {
  assert.doesNotMatch(CODE, /isReplyReachable\(\s*\{/);
});

// ---------------------------------------------------------------------------
// needsDurabilityFlip is the REAL 14-04 boolean — NOT a terminalKind proxy.
// ---------------------------------------------------------------------------

test('needsDurabilityFlip = row.needsDurabilityFlip (the real 14-04 boolean)', () => {
  assert.match(CODE, /needsDurabilityFlip=\{row\.needsDurabilityFlip\}/);
});

test('needsDurabilityFlip is NOT derived from terminalKind', () => {
  assert.doesNotMatch(CODE, /needsDurabilityFlip=\{[^}]*terminalKind/);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — issueId / leafIssueUuid / targetAgentUuid stay dispatch-only.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — no row.leafIssueUuid / issueId / targetAgentUuid as a JSX text node', () => {
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*leafIssueUuid[^{}]*\}\s*</g) || []).length,
    0,
  );
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*targetAgentUuid[^{}]*\}\s*</g) || []).length,
    0,
  );
  // row.issueId is only used as a React key (key={row.issueId}), never a text node.
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*row\.issueId[^{}]*\}\s*</g) || []).length,
    0,
  );
  assert.doesNotMatch(CODE, UUID_RE);
});
