// test/worker/chat/topic-watchdog.test.mjs
//
// Plan 04.1-03 Task 1 RED — topic-watchdog helper.
//
// `ensureTopicWakeable(ctx, topicIssueId, companyId)` is the single helper that
// enforces D-09 / D-11 across both chat.send (per-message) and chat.messages
// (per-poll, wired by Plan 04.1-04). Per the locked 04.1-01-SPIKE-FINDINGS
// (PROBE-OQ3 verdict PASS-NATIVE), multi-turn native re-wake works without
// `ctx.issues.requestWakeup` — the REST surface returns 404 anyway. The helper
// therefore performs ONLY the D-11 defensive flip-off-done check:
//
//   ctx.issues.get → status-check → ctx.issues.update IF status ∈
//     {done, cancelled, blocked} (flip to NON_TERMINAL_CONVERSATION_STATUS).
//
// Every step is wrapped in try/catch + warn-log; a failure NEVER bubbles to the
// caller (chat.send must not fail because of a watchdog mishap).
//
// `isTopicStuck(issue)` is the UI-SPEC Pattern G trigger — returns TRUE when
// the topic issue's activeRecoveryAction is set OR successfulRunHandoff is
// exhausted (host-stuck banner wired by Plan 04.1-04).
//
// `NON_TERMINAL_CONVERSATION_STATUS` (literal 'in_progress') is the value
// chat-topics.ts uses for both the initial child-topic status (Task 3) and the
// watchdog flip target (this Task 1) — single source of truth, no thrash.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ensureTopicWakeable,
  isTopicStuck,
  NON_TERMINAL_CONVERSATION_STATUS,
} from '../../../src/worker/chat/topic-watchdog.ts';

// makeCtx — minimal stand-in for { issues, logger }. `issueStatus` controls
// what ctx.issues.get returns; `getThrows` / `updateThrows` simulate host
// failures; `issueNull` makes ctx.issues.get resolve with `null`.
function makeCtx({
  issueStatus = 'in_progress',
  issueNull = false,
  getThrows = false,
  updateThrows = false,
} = {}) {
  const getCalls = [];
  const updateCalls = [];
  const wakeupCalls = [];
  const warnLogs = [];
  const infoLogs = [];

  const ctx = {
    logger: {
      warn(msg, meta) {
        warnLogs.push({ msg, meta });
      },
      info(msg, meta) {
        infoLogs.push({ msg, meta });
      },
    },
    issues: {
      async get(issueId, companyId) {
        getCalls.push({ issueId, companyId });
        if (getThrows) throw new Error('host issues.get 503');
        if (issueNull) return null;
        return { id: issueId, companyId, status: issueStatus };
      },
      async update(issueId, patch, companyId) {
        updateCalls.push({ issueId, patch, companyId });
        if (updateThrows) throw new Error('host issues.update 503');
        return { id: issueId };
      },
      async requestWakeup(issueId, companyId, opts) {
        // REGRESSION GUARD — the spike findings (PROBE-OQ3 PASS-NATIVE) prove
        // multi-turn native re-wake works and the REST surface returns 404
        // anyway. The watchdog MUST NOT call requestWakeup; if it does, this
        // mock records the call and the test suite catches the regression.
        wakeupCalls.push({ issueId, companyId, opts });
        return { queued: true, runId: null };
      },
    },
    _getCalls: getCalls,
    _updateCalls: updateCalls,
    _wakeupCalls: wakeupCalls,
    _warnLogs: warnLogs,
    _infoLogs: infoLogs,
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// NON_TERMINAL_CONVERSATION_STATUS export — the literal value chat-topics.ts
// reads for the initial child-topic status (Task 3) and the watchdog flip
// target (this Task 1) must agree.
// ---------------------------------------------------------------------------

test('NON_TERMINAL_CONVERSATION_STATUS export === "in_progress"', () => {
  assert.equal(NON_TERMINAL_CONVERSATION_STATUS, 'in_progress');
});

// ---------------------------------------------------------------------------
// HAPPY PATHS — non-terminal statuses, no flip.
// ---------------------------------------------------------------------------

test('ensureTopicWakeable: status in_progress → does NOT call ctx.issues.update', async () => {
  const ctx = makeCtx({ issueStatus: 'in_progress' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._getCalls.length, 1, 'issues.get is always called');
  assert.equal(ctx._updateCalls.length, 0, 'no-op when status is already non-terminal');
});

test('ensureTopicWakeable: status backlog → does NOT flip (terminal-only)', async () => {
  const ctx = makeCtx({ issueStatus: 'backlog' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0);
});

test('ensureTopicWakeable: status todo → does NOT flip', async () => {
  const ctx = makeCtx({ issueStatus: 'todo' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0);
});

test('ensureTopicWakeable: status in_review → does NOT flip (non-terminal, agent may legitimately move there)', async () => {
  const ctx = makeCtx({ issueStatus: 'in_review' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0);
});

// ---------------------------------------------------------------------------
// FLIP PATHS — terminal/blocked statuses, flip to in_progress.
// ---------------------------------------------------------------------------

// rc.8 hotfix 2026-05-26 (CTT-07 restoration): the watchdog NO LONGER calls
// ctx.issues.update on terminal status. The host's disposition-recovery is
// the rightful owner of status restoration; the manifest does not declare
// issues.update (per CTT-07 — plugin actions NEVER mutate
// public.issues.updated_at). Tests below assert ZERO update calls on every
// status path AND that an info-level hint is logged on terminal status.

test('ensureTopicWakeable: status done → logs info-hint, does NOT call ctx.issues.update (CTT-07)', async () => {
  const ctx = makeCtx({ issueStatus: 'done' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0, 'CTT-07: zero issues.update calls');
  assert.ok(
    ctx._infoLogs?.some((l) => /terminal status/i.test(l.msg)),
    'info-log records the terminal-status observation for operator visibility',
  );
});

test('ensureTopicWakeable: status cancelled → logs info-hint, does NOT call ctx.issues.update (CTT-07)', async () => {
  const ctx = makeCtx({ issueStatus: 'cancelled' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0);
});

test('ensureTopicWakeable: status blocked → logs info-hint, does NOT call ctx.issues.update (CTT-07)', async () => {
  const ctx = makeCtx({ issueStatus: 'blocked' });
  await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
  assert.equal(ctx._updateCalls.length, 0);
});

// ---------------------------------------------------------------------------
// DEFENSIVE PATHS — null issue, host failures, never bubble.
// ---------------------------------------------------------------------------

test('ensureTopicWakeable: issues.get returns null → no update, no throw', async () => {
  const ctx = makeCtx({ issueNull: true });
  await assert.doesNotReject(() => ensureTopicWakeable(ctx, 'topic-1', 'co-1'));
  assert.equal(ctx._updateCalls.length, 0);
});

test('ensureTopicWakeable: issues.get throws → warn-logs + returns; no throw to caller', async () => {
  const ctx = makeCtx({ getThrows: true });
  await assert.doesNotReject(() => ensureTopicWakeable(ctx, 'topic-1', 'co-1'));
  assert.equal(ctx._updateCalls.length, 0);
  assert.ok(
    ctx._warnLogs.some((l) => /get/i.test(l.msg)),
    'warn-log records the issues.get failure',
  );
});

test('ensureTopicWakeable: terminal status with hostile mock → still NO update call (CTT-07 unconditional)', async () => {
  // Even if the host were to mis-implement update such that it succeeded
  // accidentally, the plugin must NOT invoke it. rc.8 hotfix removed the
  // call entirely; this test pins that no future regression re-introduces
  // it on a flaky-host code path.
  const ctx = makeCtx({ issueStatus: 'done', updateThrows: true });
  await assert.doesNotReject(() => ensureTopicWakeable(ctx, 'topic-1', 'co-1'));
  assert.equal(ctx._updateCalls.length, 0, 'CTT-07: zero update calls regardless of host behavior');
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD — the spike's PROBE-OQ3 PASS-NATIVE finding is load-bearing.
// Multi-turn native re-wake works WITHOUT requestWakeup; the REST surface
// returns 404. If a future "helpful" edit re-introduces the requestWakeup call,
// this test fails immediately.
// ---------------------------------------------------------------------------

test('ensureTopicWakeable: NEVER calls ctx.issues.requestWakeup (spike PASS-NATIVE — REST 404)', async () => {
  for (const status of ['in_progress', 'todo', 'backlog', 'in_review', 'done', 'cancelled', 'blocked']) {
    const ctx = makeCtx({ issueStatus: status });
    await ensureTopicWakeable(ctx, 'topic-1', 'co-1');
    assert.equal(
      ctx._wakeupCalls.length,
      0,
      `requestWakeup must NOT be called (status=${status}) — 04.1-01-SPIKE-FINDINGS PROBE-OQ3 PASS-NATIVE`,
    );
  }
});

// ---------------------------------------------------------------------------
// isTopicStuck — UI-SPEC Pattern G trigger (host-stuck banner — Plan 04.1-04
// wires this signal into chat.messages response shape).
// ---------------------------------------------------------------------------

test('isTopicStuck: vanilla in_progress issue → false', () => {
  assert.equal(isTopicStuck({ status: 'in_progress' }), false);
});

test('isTopicStuck: activeRecoveryAction set → true', () => {
  assert.equal(
    isTopicStuck({ status: 'in_progress', activeRecoveryAction: { kind: 'recovery_owner' } }),
    true,
  );
});

test('isTopicStuck: successfulRunHandoff.exhausted true → true', () => {
  assert.equal(
    isTopicStuck({ status: 'in_progress', successfulRunHandoff: { exhausted: true } }),
    true,
  );
});

test('isTopicStuck: successfulRunHandoff.exhausted false (benign retry state) → false', () => {
  assert.equal(
    isTopicStuck({ status: 'in_progress', successfulRunHandoff: { exhausted: false } }),
    false,
  );
});

test('isTopicStuck: null / undefined issue → false (defensive)', () => {
  assert.equal(isTopicStuck(null), false);
  assert.equal(isTopicStuck(undefined), false);
});
