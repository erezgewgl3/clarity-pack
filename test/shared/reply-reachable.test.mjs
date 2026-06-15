// test/shared/reply-reachable.test.mjs
//
// Plan 14-02 Task 1 (DO-05 / SC4) — the pure reply-reachable predicate.
//
// isReplyReachable(terminalKind) returns TRUE for AWAITING_HUMAN and
// AWAITING_AGENT_STUCK — both resume via the spike-proven answer-comment recipe
// (the operator's reply triggers the assigned party's resume, Shape A/B). Every
// other kind → FALSE. Phase 21 (21-CONTEXT D-2) ACTIVATED AWAITING_AGENT_STUCK →
// TRUE (the Phase-12 D-05 LOCK that routed it to 'assign'/false is reversed); its
// verdict is now actionAffordance:'nudge' (blocker-chain.ts D-1) and it mounts the
// same <ReplyInPlace> Send. This suite pins the two-reachable set.
//
// Purity: the predicate reads ONLY the terminalKind string — no targetAgentUuid,
// no awaitedPartyLabel/ownerName string match, no AI/LLM token, no I/O, no clock.
// Mirrors the blocker-chain.ts AI-token / purity guard convention (source-grep).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { isReplyReachable } from '../../src/shared/reply-reachable.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'src', 'shared', 'reply-reachable.ts');

// ---------------------------------------------------------------------------
// Per-kind behavior — all 8 Terminal kinds.
// ---------------------------------------------------------------------------

test('AWAITING_HUMAN → true (the ONLY reachable kind — the spike-proven shape)', () => {
  assert.equal(isReplyReachable('AWAITING_HUMAN'), true);
});

test('AWAITING_AGENT_STUCK → true (Phase 21 activation — reply-to-unstick via Shape B answer-comment; 21-CONTEXT D-2)', () => {
  assert.equal(isReplyReachable('AWAITING_AGENT_STUCK'), true);
});

test('AWAITING_AGENT_WORKING → false (in motion, no action needed)', () => {
  assert.equal(isReplyReachable('AWAITING_AGENT_WORKING'), false);
});

test('SELF_RESOLVING → false', () => {
  assert.equal(isReplyReachable('SELF_RESOLVING'), false);
});

test('EXTERNAL → false (third party, no in-system thread)', () => {
  assert.equal(isReplyReachable('EXTERNAL'), false);
});

test('CYCLE → false (no single party to answer)', () => {
  assert.equal(isReplyReachable('CYCLE'), false);
});

test('UNOWNED → false (assignment, not reply, is the answer — OwnerPicker)', () => {
  assert.equal(isReplyReachable('UNOWNED'), false);
});

test('UNCLASSIFIED → false (honest degrade — open to investigate)', () => {
  assert.equal(isReplyReachable('UNCLASSIFIED'), false);
});

test('exactly TWO of the 8 kinds are reachable (AWAITING_HUMAN + AWAITING_AGENT_STUCK)', () => {
  const KINDS = [
    'AWAITING_HUMAN',
    'AWAITING_AGENT_WORKING',
    'AWAITING_AGENT_STUCK',
    'SELF_RESOLVING',
    'EXTERNAL',
    'CYCLE',
    'UNOWNED',
    'UNCLASSIFIED',
  ];
  const reachable = KINDS.filter((k) => isReplyReachable(k));
  assert.deepEqual(reachable, ['AWAITING_HUMAN', 'AWAITING_AGENT_STUCK']);
});

// ---------------------------------------------------------------------------
// Purity guard — keyed structurally on terminalKind, never a scrubbed label,
// never a UUID, never an AI token. Mirrors the blocker-chain AI-token guard.
// ---------------------------------------------------------------------------

// Strip comments before scanning code — mirrors the employee-row render-scan
// convention; the doc comment legitimately names other fields/anti-patterns, so
// the guard must inspect executable code only.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('purity guard — code reads ONLY terminalKind: no awaitedPartyLabel / ownerName / targetAgentUuid', () => {
  const code = stripComments(readFileSync(SRC, 'utf8'));
  assert.doesNotMatch(code, /awaitedPartyLabel/, 'must not read awaitedPartyLabel');
  assert.doesNotMatch(code, /ownerName/, 'must not read ownerName');
  assert.doesNotMatch(code, /targetAgentUuid/, 'must not read targetAgentUuid');
  assert.doesNotMatch(code, /targetIssueUuid/, 'must not read targetIssueUuid');
});

test('purity guard — no AI-vendor token / network / clock (the same boundary blocker-chain.ts holds)', () => {
  const code = stripComments(readFileSync(SRC, 'utf8'));
  // Word-boundaried specific tokens, mirroring blocker-chain.test.mjs PRIM-03.
  assert.doesNotMatch(code, /\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i, 'no AI-vendor token');
  assert.doesNotMatch(code, /\bfetch\(|https?:\/\//, 'no network call');
  assert.doesNotMatch(code, /Date\.now|new Date|performance\.now/, 'no wall-clock read');
});
