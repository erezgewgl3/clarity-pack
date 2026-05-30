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
// Plan 04.1-11 (2026-05-21) — production fix regression suite.
//
// The host stamps plugin-worker createComment() calls with
// authorType:'system' on Countermoves. The Plan 04.1-02 marker must survive
// the host's classifier override; non-marker system comments must still be
// filtered. The allowlist runs BEFORE the primary authorType check.
// ---------------------------------------------------------------------------

test('Test 15 (PLAN-04.1-11 MARKER + AUTHORTYPE=SYSTEM): marker text + authorType=system → conversation', () => {
  // The exact production failure mode pinned by Eric's diagnostics-on test
  // on Countermoves 2026-05-21. Before this fix the marker was visible as
  // a system-noise row (when diagnostics on) and absent from the rendered
  // conversation (when diagnostics off) — proving the PRIMARY authorType
  // discriminator was stripping it. The allowlist now bypasses the primary
  // check for any body matching the canonical marker shape.
  const marker = {
    body: 'Task created — abc12345-def6-789a-bcde-f01234567890, assigned to CEO.',
    authorType: 'system',
  };
  assert.strictEqual(classifyComment(marker), 'conversation');
});

test('Test 16 (PLAN-04.1-11 CONTROL — non-marker authorType=system): random system body → runtime-noise', () => {
  // Defensive control: the allowlist is PRECISE, not a catch-all. A
  // non-marker body stamped authorType:'system' must still classify as
  // runtime-noise. If the regex were broadened to anything looser than the
  // canonical marker shape, this assertion would catch the regression.
  const random = {
    body: 'Paperclip needs a disposition before this issue can continue.',
    authorType: 'system',
  };
  assert.strictEqual(classifyComment(random), 'runtime-noise');
});

test('Test 17 (PLAN-04.1-11 EDGE — hyphen-minus not em-dash): marker with wrong dash → falls through to authorType', () => {
  // The regex requires the em-dash literal (U+2014 — same character
  // true-task.ts emits). A marker miswritten with a hyphen-minus does NOT
  // match the allowlist, falls through, and gets filtered by the
  // authorType:'system' primary check. Documents that the regex is tight.
  const wrongDash = {
    body: 'Task created - abc12345, assigned to CEO.', // hyphen-minus, NOT em-dash
    authorType: 'system',
  };
  assert.strictEqual(classifyComment(wrongDash), 'runtime-noise');
});

test('Test 18 (PLAN-04.1-11 EDGE — trailing whitespace): marker + spaces after period → conversation (trimmed)', () => {
  // The allowlist trims body before matching, so a marker with stray
  // trailing whitespace still passes. Defensive against host stores that
  // pad row text.
  const padded = {
    body: '  Task created — abc12345, assigned to CEO.   \n',
    authorType: 'system',
  };
  assert.strictEqual(classifyComment(padded), 'conversation');
});

test('Test 19 (PLAN-04.1-11 EDGE — empty body system): empty body + system → runtime-noise', () => {
  // After trim, body is empty → regex doesn't match → falls through to the
  // authorType:'system' primary → runtime-noise. Mirrors Test 14's logic
  // post-allowlist insertion to prove the allowlist is non-greedy on empty
  // bodies.
  assert.strictEqual(
    classifyComment({ authorType: 'system', body: '' }),
    'runtime-noise',
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

test('RUNTIME_PHRASES exports the 5 host-system phrases + the 4 v1.1.11 agent-heartbeat phrases', () => {
  assert.ok(Array.isArray(RUNTIME_PHRASES), 'RUNTIME_PHRASES is an array');
  assert.equal(RUNTIME_PHRASES.length, 9, '5 host-system + 4 agent-heartbeat = 9 phrases');
  // Host-system phrases (first 5) — membership locked by 04.1-01-SPIKE-FINDINGS.
  const lower = RUNTIME_PHRASES.map((p) => p.toLowerCase());
  assert.ok(lower.some((p) => p.includes('needs a disposition')), 'phrase 1: needs a disposition');
  assert.ok(lower.some((p) => p.includes('recovery owner')), 'phrase 2: recovery owner');
  assert.ok(lower.some((p) => p.includes('finish_successful_run_handoff')), 'phrase 3: finish_successful_run_handoff');
  assert.ok(lower.some((p) => p.includes('exhausted')), 'phrase 4: exhausted (bounded corrective handoff)');
  assert.ok(
    lower.some((p) => p.includes('paperclip needs a disposition')),
    'phrase 5: the verbatim disposition phrase from the live Countermoves spike',
  );
  // Plan 250530 v1.1.11 — agent-heartbeat noise phrases (BEAAA-1000 loop fix).
  assert.ok(lower.some((p) => p === 'this heartbeat'), 'phrase 6: "this heartbeat"');
  assert.ok(lower.some((p) => p === 'no new operator comments'), 'phrase 7: "no new operator comments"');
  assert.ok(lower.some((p) => p === 'no pending comments'), 'phrase 8: "no pending comments"');
  assert.ok(lower.some((p) => p === 'conversation container'), 'phrase 9: "conversation container"');
});

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.11 — AGENT-HEARTBEAT-NOISE classification. The CTO agent's
// heartbeat on BEAAA-1000 posted three identical "No new operator comments.
// Still awaiting reply. No action needed this heartbeat." messages per
// minute. None matched the original 5 host-system phrases (those target the
// recovery service, not agent self-talk). The 4 new phrases catch the
// agent's heartbeat-meta vocabulary while staying narrow enough to avoid
// false positives on real operator/agent prose.
// ---------------------------------------------------------------------------

test('v1.1.11 (BEAAA-1000 LOOP): the exact verbatim CTO loop message → runtime-noise', () => {
  // Verbatim from the operator's BEAAA-1000 screenshot (2026-05-30):
  // three identical agent comments at 14:05/14:06/14:07.
  const bodyA = 'No new operator comments. Still awaiting reply. No action needed this heartbeat.';
  assert.equal(
    classifyComment({ authorType: 'agent', body: bodyA }),
    'runtime-noise',
    'CTO heartbeat loop on BEAAA-1000 is classified as noise',
  );
});

test('v1.1.11 (HEARTBEAT-VARIANTS): the BEAAA-808 heartbeat patterns → runtime-noise', () => {
  // Verbatim from the earlier BEAAA-808 screenshot — variant agent heartbeat noise.
  const variants = [
    'No pending comments on this conversation container. Status is already in_progress — no action needed this heartbeat.',
    'Conversation container — resetting to in_progress. No pending messages; waiting for operator input.',
    'Cancelling this idle conversation container.',
    'No pending comments, status is in_progress. Idle conversation container — nothing to do this heartbeat.',
  ];
  for (const body of variants) {
    assert.equal(
      classifyComment({ authorType: 'agent', body }),
      'runtime-noise',
      `agent heartbeat variant must classify as noise: ${JSON.stringify(body.slice(0, 60))}…`,
    );
  }
});

test('v1.1.11 (HEARTBEAT-PHRASES): each new phrase classifies alone → runtime-noise', () => {
  for (const phrase of ['this heartbeat', 'no new operator comments', 'no pending comments', 'conversation container']) {
    assert.equal(
      classifyComment({ authorType: 'agent', body: `Something happened — ${phrase} — and that's it.` }),
      'runtime-noise',
      `${JSON.stringify(phrase)} alone triggers the runtime-noise classifier`,
    );
  }
});

test('v1.1.11 (NO FALSE POSITIVES): legit operator + agent conversational comments are PRESERVED as conversation', () => {
  // Operator messages do not use agent-self-talk vocabulary.
  const conversational = [
    'Lock the rate at 12% and ship.',
    'OK, I will reach out to HoUW on the countersign.',
    'Why is BEAAA-933 still blocking?',
    'Adding a comment so we can recompile.',
    'compile test',
    // The Plan 04.1-02 marker (Pitfall 4 contract) MUST stay conversation:
    'Task created — BEAAA-2001, assigned to Scanner Engineer.',
  ];
  for (const body of conversational) {
    assert.equal(
      classifyComment({ authorType: 'agent', body }),
      'conversation',
      `legit comment must classify as conversation: ${JSON.stringify(body.slice(0, 60))}`,
    );
  }
});
