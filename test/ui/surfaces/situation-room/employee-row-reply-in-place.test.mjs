// test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs
//
// Plan 14-03 Task 1 (SC3 / SC4 / SC5 / DO-01) — the Situation Room employee row
// mounts the ONE shared <ReplyInPlace> on its reply branch (⇔ AWAITING_HUMAN via
// isReplyReachable(chain.terminalKind)), passing the REAL 14-04 row fields and
// NEVER a data.terminal.kind proxy for needsDurabilityFlip.
//
// Convention: source-grep (no jsdom in devDependencies — same convention as
// employee-row-no-uuid-leak.test.mjs / reply-in-place.test.mjs). The render
// branch is proven structurally; the no-copy / single-import claim (SC3) is
// proven by pinning the import to the SAME _shared module the other surfaces use.

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
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row.tsx'),
  'utf8',
);
const CODE = stripComments(SRC);

// ---------------------------------------------------------------------------
// SC3 — the SAME shared primitive + the SAME shared predicate (no copies).
// ---------------------------------------------------------------------------

test('imports ReplyInPlace from the SAME ../_shared/reply-in-place (no copy — SC3)', () => {
  assert.match(
    CODE,
    /import\s*\{\s*ReplyInPlace\s*\}\s*from\s*'\.\.\/_shared\/reply-in-place\.tsx'/,
  );
});

test('imports isReplyReachable from the shared helper (no inline reachable logic)', () => {
  assert.match(
    CODE,
    /import\s*\{\s*isReplyReachable\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/reply-reachable\.ts'/,
  );
});

// ---------------------------------------------------------------------------
// The reply branch mounts <ReplyInPlace> (NOT the chat-deep-link path).
// ---------------------------------------------------------------------------

test('mounts <ReplyInPlace> on the reply affordance branch', () => {
  assert.match(CODE, /<ReplyInPlace\b/);
  // The reply branch is gated on actionAffordance === 'reply'.
  assert.match(CODE, /actionAffordance\s*===\s*'reply'/);
});

test('passes leafIssueUuid (mutation id) AND leafIssueId (display) from the chain', () => {
  assert.match(CODE, /leafIssueUuid=\{chain\.leafIssueUuid\}/);
  assert.match(CODE, /leafIssueId=\{chain\.leafIssueId\}/);
});

test('passes awaitedPartyLabel + decisionOptions from the chain / actionCard', () => {
  assert.match(CODE, /awaitedPartyLabel=\{chain\.awaitedPartyLabel\}/);
  assert.match(CODE, /decisionOptions=\{row\.actionCard\?\.decisionOptions\s*\?\?\s*null\}/);
});

test('forwards onAssignSuccess as onActed (live re-resolve)', () => {
  assert.match(CODE, /onActed=\{onAssignSuccess\}/);
});

// ---------------------------------------------------------------------------
// reachable is computed off chain.terminalKind — NOT an inline Terminal object.
// ---------------------------------------------------------------------------

test('reachable = isReplyReachable(chain.terminalKind) — the threaded kind string', () => {
  assert.match(CODE, /reachable=\{isReplyReachable\(chain\.terminalKind\)\}/);
});

test('NO inline Terminal construction passed to isReplyReachable', () => {
  // No `isReplyReachable({ terminal: ... })` or `isReplyReachable({ kind:`.
  assert.doesNotMatch(CODE, /isReplyReachable\(\s*\{/);
});

// ---------------------------------------------------------------------------
// needsDurabilityFlip is the REAL 14-04 boolean — NOT a terminal.kind proxy.
// ---------------------------------------------------------------------------

test('needsDurabilityFlip = chain.needsDurabilityFlip (the real 14-04 boolean)', () => {
  assert.match(CODE, /needsDurabilityFlip=\{chain\.needsDurabilityFlip\}/);
});

test('needsDurabilityFlip is NOT derived from terminal.kind anywhere', () => {
  // No `needsDurabilityFlip={... terminal.kind ...}` proxy.
  assert.doesNotMatch(CODE, /needsDurabilityFlip=\{[^}]*terminalKind[^}]*===/);
  assert.doesNotMatch(CODE, /needsDurabilityFlip=\{[^}]*terminal\.kind/);
});

// ---------------------------------------------------------------------------
// assign branch (Phase 12) untouched — OwnerPickerPopover stays for 'assign'.
// ---------------------------------------------------------------------------

test('OwnerPickerPopover still renders for the assign branch (Phase 12 untouched)', () => {
  assert.match(CODE, /OwnerPickerPopover/);
  assert.match(CODE, /showAssign\s*=\s*chain\?\.actionAffordance\s*===\s*'assign'/);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — the *Uuid fields are dispatch props only, never a render node.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — no chain.leafIssueUuid / targetAgentUuid interpolated as a JSX text node', () => {
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*leafIssueUuid[^{}]*\}\s*</g) || []).length,
    0,
    'leafIssueUuid must not be a JSX text node',
  );
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*targetAgentUuid[^{}]*\}\s*</g) || []).length,
    0,
    'targetAgentUuid must not be a JSX text node',
  );
  // No literal UUID anywhere in source either.
  assert.doesNotMatch(CODE, UUID_RE);
});
