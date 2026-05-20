// test/worker/chat/comment-classify.test.mjs
//
// Plan 04.1-04 Task 1 RED — classifyComment pure function.
//
// `classifyComment(c)` is a PURE function returning 'conversation' |
// 'runtime-noise' for one IssueComment row. Discriminator order is LOCKED by
// 04.1-01-SPIKE-FINDINGS (PROBE-D14-DISCRIM PASS, dual-keyed):
//
//   1. PRIMARY  — `authorType === 'system'` (HIGH-confidence, host-stamped on
//                 every disposition/recovery notice the live spike captured).
//   2. SECONDARY — `presentation.kind === 'system_notice'` (correlated; provides
//                 the structured envelope D-16 diagnostics renders).
//   3. FALLBACK — narrow body-pattern blocklist (defense-in-depth for any host
//                 build that misses the authorType stamp). Locked five-phrase
//                 list per 04.1-01-SPIKE-FINDINGS (RESEARCH.md's four PLUS the
//                 verbatim disposition phrase captured live on Countermoves).
//
// Pitfall 4 pin: the Plan 04.1-02 marker-comment wording
// `"Task created — <issueId>, assigned to <employeeName>."` MUST classify as
// 'conversation'. The marker is authored by the plugin worker (authorType is
// 'agent', not 'system') and its wording does not overlap RUNTIME_PHRASES; this
// file pins both invariants so a future RUNTIME_PHRASES addition that
// accidentally matches the marker fails the suite.
//
// Pattern analog: `test/worker/bulletin/verifier.test.mjs` — a pure I/O-free
// helper test. No spies, no ctx, no host mocks.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  classifyComment,
  RUNTIME_PHRASES,
} from '../../../src/worker/chat/comment-classify.ts';

// ---------------------------------------------------------------------------
// PRIMARY discriminator — authorType === 'system'
// ---------------------------------------------------------------------------

test('Test 1 (SYSTEM-AUTHOR): authorType=system → runtime-noise', () => {
  assert.equal(classifyComment({ authorType: 'system', body: 'hi' }), 'runtime-noise');
});

test('Test 2 (AGENT-AUTHOR): authorType=agent + conversational body → conversation', () => {
  assert.equal(
    classifyComment({ authorType: 'agent', body: 'OK, I will handle that.' }),
    'conversation',
  );
});

test('Test 3 (USER-AUTHOR): authorType=user + operator body → conversation', () => {
  assert.equal(
    classifyComment({ authorType: 'user', body: 'Lock the rate at 12%' }),
    'conversation',
  );
});

// ---------------------------------------------------------------------------
// SECONDARY discriminator — presentation.kind === 'system_notice'
// ---------------------------------------------------------------------------

test('Test 4 (PRESENTATION-SYSTEM-NOTICE): presentation.kind=system_notice → runtime-noise', () => {
  // The live spike captured authorType:'system' + presentation.kind:'system_notice'
  // co-occurring. The secondary discriminator catches any host build that ever
  // stamps the presentation envelope without the authorType (defense-in-depth).
  assert.equal(
    classifyComment({
      authorType: 'agent',
      presentation: { kind: 'system_notice' },
      body: 'Missing disposition.',
    }),
    'runtime-noise',
  );
});

test('Test 5 (PRESENTATION-MESSAGE): presentation.kind=message + agent → conversation', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      presentation: { kind: 'message' },
      body: 'normal reply',
    }),
    'conversation',
  );
});

// ---------------------------------------------------------------------------
// FALLBACK — body-pattern blocklist (5 phrases per 04.1-01-SPIKE-FINDINGS)
// ---------------------------------------------------------------------------

test('Test 6 (BODY-PATTERN-DISPOSITION): "needs a disposition" → runtime-noise', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'Paperclip needs a disposition before this can continue.',
    }),
    'runtime-noise',
  );
});

test('Test 7 (BODY-PATTERN-RECOVERY-OWNER): "blocked on a recovery owner" → runtime-noise', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'This issue is blocked on a recovery owner.',
    }),
    'runtime-noise',
  );
});

test('Test 8 (BODY-PATTERN-FINISH-HANDOFF): "finish_successful_run_handoff" → runtime-noise', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'The wake was a finish_successful_run_handoff with nothing new.',
    }),
    'runtime-noise',
  );
});

test('Test 9 (BODY-PATTERN-EXHAUSTED): "exhausted the bounded corrective handoff" → runtime-noise', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'This run exhausted the bounded corrective handoff.',
    }),
    'runtime-noise',
  );
});

test('Test 9b (BODY-PATTERN-PAPERCLIP-DISPOSITION — 5th phrase from live spike): "Paperclip needs a disposition" verbatim → runtime-noise', () => {
  // Verbatim from 04.1-01-SPIKE-FINDINGS PROBE-OQ3 attempt 2: the live host's
  // disposition-recovery service stamped this exact wording on the captured
  // system_notice. The 5th phrase exists to defense-in-depth catch any future
  // host build that drops authorType/presentation stamps but keeps this body.
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'Paperclip needs a disposition before this issue can continue.',
    }),
    'runtime-noise',
  );
});

test('Test 10 (BODY-CASE-INSENSITIVE): "NEEDS A DISPOSITION" caps → runtime-noise', () => {
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'PAPERCLIP NEEDS A DISPOSITION RIGHT NOW.',
    }),
    'runtime-noise',
  );
});

// ---------------------------------------------------------------------------
// Pitfall 4 PIN — Plan 04.1-02 marker comment MUST NOT be stripped
// ---------------------------------------------------------------------------

test('Test 11 (MARKER-NEVER-NOISE — Pitfall 4): "Task created — <id>, assigned to <name>." → conversation', () => {
  // Locked wording from src/worker/chat/true-task.ts line 78. The marker is
  // plugin-authored (authorType !== 'system') and its prose does not overlap
  // RUNTIME_PHRASES. A future RUNTIME_PHRASES addition that accidentally
  // matches this wording would fail this test before it could ever strip a
  // real marker from a live chat thread.
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'Task created — BEAAA-202, assigned to CFO.',
    }),
    'conversation',
  );
});

test('Test 11b (MARKER-NEVER-NOISE — realistic uuid + employee name): "Task created — abc12345, assigned to CEO." → conversation', () => {
  // Realistic shape per Plan 04.1-02 e7bd567 (host issue id + named employee).
  assert.equal(
    classifyComment({
      authorType: 'agent',
      body: 'Task created — abc12345, assigned to CEO.',
    }),
    'conversation',
  );
});

// ---------------------------------------------------------------------------
// DEFENSIVE — null / empty fields
// ---------------------------------------------------------------------------

test('Test 12 (NULL-FIELDS): authorType/body/presentation null → conversation (defensive default)', () => {
  // A null author is treated as conversational so we never strip a legitimate-
  // but-incomplete comment. The discriminator only filters on a POSITIVE
  // system-stamp, never on absence.
  assert.equal(
    classifyComment({ authorType: null, body: null, presentation: null }),
    'conversation',
  );
});

test('Test 13 (EMPTY-BODY-USER): authorType=user + body="" → conversation', () => {
  // An empty user comment is still a user comment.
  assert.equal(classifyComment({ authorType: 'user', body: '' }), 'conversation');
});

test('Test 14 (EMPTY-BODY-SYSTEM): authorType=system + body="" → runtime-noise', () => {
  // The authorType discriminator wins regardless of body presence.
  assert.equal(classifyComment({ authorType: 'system', body: '' }), 'runtime-noise');
});

// ---------------------------------------------------------------------------
// CONTRACT — exported RUNTIME_PHRASES list (5 entries per Wave 1 findings)
// ---------------------------------------------------------------------------

test('RUNTIME_PHRASES exports five phrases including the new disposition phrase from the live spike', () => {
  assert.ok(Array.isArray(RUNTIME_PHRASES), 'RUNTIME_PHRASES is an array');
  assert.equal(RUNTIME_PHRASES.length, 5, 'five phrases: RESEARCH.md\'s four + the new spike-captured phrase');
  // Membership — all five must be present (order is unimportant; case is whatever the source uses).
  const lower = RUNTIME_PHRASES.map((p) => p.toLowerCase());
  assert.ok(lower.some((p) => p.includes('needs a disposition')), 'phrase 1: needs a disposition');
  assert.ok(lower.some((p) => p.includes('recovery owner')), 'phrase 2: recovery owner');
  assert.ok(lower.some((p) => p.includes('finish_successful_run_handoff')), 'phrase 3: finish_successful_run_handoff');
  assert.ok(lower.some((p) => p.includes('exhausted')), 'phrase 4: exhausted (bounded corrective handoff)');
  // The 5th phrase locked by 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM (live capture).
  assert.ok(
    lower.some((p) => p.includes('paperclip needs a disposition')),
    'phrase 5: the verbatim disposition phrase from the live Countermoves spike',
  );
});
