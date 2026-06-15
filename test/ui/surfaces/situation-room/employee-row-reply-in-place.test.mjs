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
  // Plan 18-02 (LEG-02e) — the display string is threaded from chain
  // .awaitedPartyLabel, now wrapped in the read-time rescrubPersisted pass
  // (cleans any historical persisted leak with zero new fetches). The intent
  // (sourced from the chain, not fabricated) is unchanged.
  assert.match(CODE, /awaitedPartyLabel=\{rescrubPersisted\(chain\.awaitedPartyLabel\)\}/);
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
// Plan 21-04 Task 1 (STUCK-01 / D-3) — the Watch-tier STUCK (nudge) branch
// mounts the SAME shared <ReplyInPlace variant="nudge"> (reply-to-unstick),
// gated on the engine verdict actionAffordance === 'nudge' (NOT a terminal.kind
// list). The row stays in the QUIET Watch tier (no Needs-you promotion). The
// reachable + needsDurabilityFlip pins hold for the nudge path exactly as the
// reply path. Extends the Phase-14 suite — every reply-branch assertion above
// still holds unchanged.
// ---------------------------------------------------------------------------

test('showNudge is gated STRICTLY on the engine verdict actionAffordance === nudge', () => {
  assert.match(CODE, /showNudge\s*=\s*chain\?\.actionAffordance\s*===\s*'nudge'/);
});

test('the Watch-tier body mounts <ReplyInPlace variant="nudge"> on the nudge branch', () => {
  // The nudge ReplyInPlace must carry variant="nudge" (the stuck-context copy).
  assert.match(CODE, /<ReplyInPlace\s+variant="nudge"/);
  // It is gated on showNudge inside the Watch-tier body.
  assert.match(CODE, /showNudge\s*\?/);
});

test('the nudge mount passes the REAL reachable + needsDurabilityFlip (no terminal.kind proxy)', () => {
  // Both reply AND nudge branches read the SAME real chain fields. The whole-file
  // grep guarantees the nudge mount uses chain.terminalKind for reachable and
  // chain.needsDurabilityFlip for the durable flip — never a terminal.kind proxy.
  assert.match(CODE, /reachable=\{isReplyReachable\(chain\.terminalKind\)\}/);
  assert.match(CODE, /needsDurabilityFlip=\{chain\.needsDurabilityFlip\}/);
});

test('the stuck row stays in the QUIET Watch tier (visualTierOf NOT forked for nudge)', () => {
  // The nudge branch lives inside the Watch-tier body block; the row is NOT
  // promoted to needs-you. visualTierOf is the single source (tier-utils.ts) — no
  // re-derivation of the tier from the nudge affordance.
  assert.match(CODE, /visualTier\s*===\s*'watch'\s*&&\s*chain\s*&&\s*!isChainlessIdle/);
  assert.doesNotMatch(CODE, /showNudge[\s\S]{0,40}needs-you/);
});

test('NO stale "assign an owner" copy remains on the stuck Watch path', () => {
  // After the Phase-21 flip a stuck row is 'nudge', never 'assign' — the old
  // "agent stuck · assign an owner" dead-end copy must be gone from this file.
  assert.doesNotMatch(CODE, /agent stuck\s*·\s*assign an owner/);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — the *Uuid fields are dispatch props only, never a render node.
// (STUCK-06 — the existing whole-file JSX-text-node scan below covers the new
//  nudge render path; no new exemption.)
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
