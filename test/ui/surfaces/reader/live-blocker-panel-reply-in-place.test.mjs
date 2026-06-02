// test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs
//
// Plan 14-03 Task 1 (SC3 / SC4 / SC5 / WARNING 2 / CR-01) — the Reader live
// blocker panel mounts the ONE shared <ReplyInPlace> on the 'reply' affordance
// (replacing the navigate-to-chat path), suppresses the duplicate blockerLine
// <p> for the reply branch, and degrades the multi-hop chain honestly
// (leafIssueId=null). needsDurabilityFlip is NOT proxied from data.terminal.kind.
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
  path.join(REPO_ROOT, 'src/ui/surfaces/reader/live-blocker-panel.tsx'),
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

test('imports isReplyReachable from the shared helper', () => {
  assert.match(
    CODE,
    /import\s*\{\s*isReplyReachable\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/reply-reachable\.ts'/,
  );
});

// ---------------------------------------------------------------------------
// The 'reply' affordance mounts <ReplyInPlace> (the navigate-to-chat path is gone).
// ---------------------------------------------------------------------------

test('mounts <ReplyInPlace> on the reply branch', () => {
  assert.match(CODE, /<ReplyInPlace\b/);
});

test('the dead replyInChat navigate-to-chat path for reply is removed', () => {
  // The old `case 'reply': onAction = () => replyInChat(...)` must be gone.
  assert.doesNotMatch(CODE, /onAction\s*=\s*\(\)\s*=>\s*replyInChat/);
});

// ---------------------------------------------------------------------------
// reachable computed off data.terminal.kind (native here) — no inline Terminal.
// ---------------------------------------------------------------------------

test('reachable = isReplyReachable(data.terminal.kind)', () => {
  assert.match(CODE, /reachable=\{isReplyReachable\(data\.terminal\.kind\)\}/);
});

test('NO inline Terminal construction passed to isReplyReachable', () => {
  assert.doesNotMatch(CODE, /isReplyReachable\(\s*\{/);
});

// ---------------------------------------------------------------------------
// CR-01 — leafIssueId is the open issue only for a single-hop chain, else null.
// ---------------------------------------------------------------------------

test('leafIssueId = single-hop issueId else null (CR-01 honest degrade)', () => {
  assert.match(CODE, /leafIssueId=\{data\.pathIds\.length\s*<=\s*1\s*\?\s*issueId\s*:\s*null\}/);
});

test('leafIssueUuid = data.targetIssueUuid (the leaf mutation id)', () => {
  assert.match(CODE, /leafIssueUuid=\{data\.targetIssueUuid\s*\?\?\s*null\}/);
});

// ---------------------------------------------------------------------------
// WARNING 2 — the standalone blockerLine <p> is SUPPRESSED for the reply branch.
// ---------------------------------------------------------------------------

test('blockerLine <p> is guarded by affordance !== reply (no duplicate headline)', () => {
  // The standalone blockerLine render must be conditional on a non-reply affordance.
  assert.match(
    CODE,
    /actionAffordance\s*!==\s*'reply'[\s\S]*?clarity-blocker-label[\s\S]*?blockerLine\(data\)/,
  );
});

test('blockerLine still renders for non-reply affordances (no regression)', () => {
  // blockerLine(data) is still referenced (for the non-reply branch).
  assert.match(CODE, /blockerLine\(data\)/);
});

// ---------------------------------------------------------------------------
// needsDurabilityFlip — false on this surface (no leaf-status field); NOT a
// terminal.kind proxy.
// ---------------------------------------------------------------------------

test('needsDurabilityFlip is NOT derived from data.terminal.kind', () => {
  assert.doesNotMatch(CODE, /needsDurabilityFlip=\{[^}]*terminal\.kind/);
});

test('needsDurabilityFlip is passed as a literal false (spike-safe, comment-only)', () => {
  assert.match(CODE, /needsDurabilityFlip=\{false\}/);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — the *Uuid fields are dispatch props only.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — no targetIssueUuid / targetAgentUuid as a JSX text node', () => {
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*targetIssueUuid[^{}]*\}\s*</g) || []).length,
    0,
  );
  assert.equal(
    (CODE.match(/>\s*\{[^{}]*targetAgentUuid[^{}]*\}\s*</g) || []).length,
    0,
  );
  assert.doesNotMatch(CODE, UUID_RE);
});
