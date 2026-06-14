// test/ui/surfaces/_shared/reply-in-place.test.mjs
//
// Plan 14-02 Task 2 — behavior coverage for the shared <ReplyInPlace> primitive.
//
// Convention: source-grep (no jsdom in devDependencies — same convention as
// employee-row-no-uuid-leak.test.mjs and owner-picker tests) PLUS direct unit
// tests of the exported pure helper cannedSentence(). The render branches are
// proven structurally by asserting the source wires the right affordances /
// guards; the dispatch shape + await-confirm posture are proven by the structural
// guards on dispatchReply.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// NOTE: the component lives in a .tsx (JSX) file that node:test cannot import
// directly (native TS type-stripping handles .ts but not JSX). So — exactly the
// employee-row-no-uuid-leak convention — this suite is source-grep based. The pure
// cannedSentence mapping is re-implemented locally and asserted to MATCH the source
// branches (the grep guards below pin the source to this mapping).

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/_shared/reply-in-place.tsx'),
  'utf8',
);
const CODE = stripComments(SRC);

// ---------------------------------------------------------------------------
// The action is wired to situation.replyAndResume (key_link).
// ---------------------------------------------------------------------------

test('wires usePluginAction(situation.replyAndResume)', () => {
  assert.match(CODE, /usePluginAction\('situation\.replyAndResume'\)/);
});

// ---------------------------------------------------------------------------
// reachable === false → Open↗ to the human-key URL, NO input/Send/chips (SC4).
// ---------------------------------------------------------------------------

test('reachable===false branch renders the named action + Open↗ at /<prefix>/issues/<leafIssueId>', () => {
  // The early-return on !reachable.
  assert.match(CODE, /if\s*\(\s*!reachable\s*\)/);
  // Plan 18-01 (LEG-01): Open↗ now funnels through buildReaderHref (the single
  // Tier-1/Tier-2 decision site) — no longer an inline /issues/${ template. It
  // still passes the HUMAN key (leafIssueId), never the UUID.
  assert.match(CODE, /navigate\(buildReaderHref\(companyPrefix,\s*leafIssueId\)\)/);
  assert.doesNotMatch(CODE, /\/issues\/\$\{leafIssueId\}/, 'no inline issue path — funnel through buildReaderHref');
  // The Open↗ button label.
  assert.match(CODE, /Open ↗/);
});

test('reachable===false honest degrade — Open↗ renders ONLY when leafIssueId is non-null (no 404)', () => {
  // The button is gated on leafIssueId truthiness inside the !reachable branch.
  const unreachable = CODE.slice(CODE.indexOf('if (!reachable)'), CODE.indexOf('hasChips'));
  assert.match(unreachable, /leafIssueId\s*\?/, 'Open↗ gated on leafIssueId');
  // No text input or Send in the unreachable branch.
  assert.doesNotMatch(unreachable, /clarity-reply-input/, 'no input in unreachable branch');
  assert.doesNotMatch(unreachable, /clarity-reply-send/, 'no Send in unreachable branch');
  assert.doesNotMatch(unreachable, /clarity-reply-chip\b/, 'no chips in unreachable branch');
});

// ---------------------------------------------------------------------------
// Chips render iff decisionOptions is a non-empty array; chip → SAME dispatch (SC2).
// ---------------------------------------------------------------------------

test('chips gated on a non-empty decisionOptions array', () => {
  assert.match(
    CODE,
    /Array\.isArray\(decisionOptions\)\s*&&\s*decisionOptions\.length\s*>\s*0/,
    'hasChips = non-empty decisionOptions array',
  );
  assert.match(CODE, /hasChips\s*\?/, 'chips render gated on hasChips');
});

test('each chip dispatches the SAME dispatchReply path with a canned sentence (no separate decide handler)', () => {
  assert.match(CODE, /dispatchReply\(cannedSentence\(option\)\)/);
  // There is exactly ONE dispatch function (the chip and Send share it).
  assert.doesNotMatch(CODE, /situation\.decide/, 'no separate decide handler/action');
});

// ---------------------------------------------------------------------------
// Dispatch shape: leafIssueUuid (mutation) + leafIssueId (echo) + messageUuid +
// needsDurabilityFlip; UUID falls back to leafIssueId for UUID-only mounts.
// ---------------------------------------------------------------------------

test('dispatch sends leafIssueUuid (mutation) + leafIssueId (echo) + messageUuid + needsDurabilityFlip', () => {
  assert.match(CODE, /leafIssueUuid:\s*mutationIssueUuid/, 'dispatches the mutation UUID');
  assert.match(CODE, /const mutationIssueUuid = leafIssueUuid \?\? leafIssueId/, 'UUID fallback to leafIssueId');
  assert.match(CODE, /\bleafIssueId,/, 'echoes leafIssueId');
  assert.match(CODE, /\bmessageUuid,/, 'dispatches messageUuid');
  assert.match(CODE, /\bneedsDurabilityFlip,/, 'dispatches needsDurabilityFlip');
});

test('messageUuid is reused on a Retry of the same click (idempotency — D-15)', () => {
  assert.match(CODE, /pendingMessageUuid\.current\s*\?\?\s*freshMessageUuid\(\)/, 'reuse-or-mint');
  assert.match(CODE, /pendingMessageUuid\.current = messageUuid/, 'pins the in-flight uuid');
  // Cleared ONLY after a confirmed { ok } so the next reply mints a fresh key.
  assert.match(CODE, /pendingMessageUuid\.current = null/, 'cleared on success');
});

// ---------------------------------------------------------------------------
// Await-confirm honesty (SC1 / D-12): success ONLY on the structured { ok };
// { error } → honest error toast, onActed NOT called, input kept.
// ---------------------------------------------------------------------------

test('await-confirm — success gated on the structured `ok in result` guard; onActed only then', () => {
  assert.match(CODE, /if\s*\(result\s*&&\s*'ok' in result\s*&&\s*result\.ok\)/, 'structured ok guard');
  // onActed() lives inside the success branch only.
  const okBranch = CODE.slice(CODE.indexOf("'ok' in result"), CODE.indexOf('} else {'));
  assert.match(okBranch, /onActed\(\)/, 'onActed inside the ok branch');
});

test('honest error path — error toast on non-ok / throw; onActed NOT called; no optimistic success', () => {
  // Two honest-error toasts (else branch + catch), both saying NOT sent.
  assert.match(CODE, /your reply was not sent/, 'honest error copy (not a fake resume)');
  // onActed appears only once (in the ok branch) — never in the error/catch paths.
  assert.equal((CODE.match(/onActed\(\)/g) || []).length, 1, 'onActed fires only on success');
  // No optimistic "resumed!" success copy in an error path.
  assert.doesNotMatch(CODE, /resumed!/i, 'no optimistic resumed toast');
});

test('pending posture — Sending… label + disabled controls during the in-flight window', () => {
  assert.match(CODE, /sending\s*\?\s*'Sending…'\s*:\s*'Send'/, 'Send→Sending… while in flight');
  assert.match(CODE, /disabled=\{sending/, 'controls disabled while sending');
});

// ---------------------------------------------------------------------------
// cannedSentence — plain operator answer sentences, never a structured command.
// ---------------------------------------------------------------------------

// Local mirror of the source mapping — the grep guards below pin the source to it.
function cannedSentence(option) {
  switch (option.trim().toLowerCase()) {
    case 'approve':
      return 'Approved.';
    case 'reject':
      return 'Rejected.';
    case 'yes':
      return 'Yes.';
    case 'no':
      return 'No.';
    default:
      return `${option.trim()}.`;
  }
}

test('cannedSentence (mirror) maps the canonical binaries to plain answer sentences', () => {
  assert.equal(cannedSentence('Approve'), 'Approved.');
  assert.equal(cannedSentence('Reject'), 'Rejected.');
  assert.equal(cannedSentence('Yes'), 'Yes.');
  assert.equal(cannedSentence('No'), 'No.');
  // case-insensitive + trims.
  assert.equal(cannedSentence('  approve '), 'Approved.');
});

test('cannedSentence (mirror) maps a pick-one option to a plain sentence (X → "X.")', () => {
  assert.equal(cannedSentence('Option B'), 'Option B.');
  assert.equal(cannedSentence('Ship it'), 'Ship it.');
});

test('source pins the cannedSentence mapping (Approve→Approved., Reject→Rejected., pick-one→`${...}.`)', () => {
  assert.match(CODE, /export function cannedSentence\(option: string\): string/);
  assert.match(CODE, /case 'approve':\s*return 'Approved\.'/);
  assert.match(CODE, /case 'reject':\s*return 'Rejected\.'/);
  assert.match(CODE, /case 'yes':\s*return 'Yes\.'/);
  assert.match(CODE, /case 'no':\s*return 'No\.'/);
  // pick-one default: a plain sentence, NEVER a structured command grammar.
  assert.match(CODE, /return `\$\{option\.trim\(\)\}\.`/);
});
