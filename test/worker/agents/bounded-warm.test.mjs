// test/worker/agents/bounded-warm.test.mjs
//
// Phase 16.1 Plan 16.1-04 Task 2 (W-3) — the BEHAVIORAL proof of the bounded
// warm-on-heartbeat. Not a source-grep: this drives runBoundedWarm with an
// injected rollup + a fake ctx whose tldr-cache returns scripted generated_at
// timestamps (some stale, some fresh) and whose wake-governor is controllable via
// the scripted kill-switch / wake-ledger SQL, then asserts the four contract
// behaviors directly by counting compile attempts:
//
//   1. CAP — >5 stale awaiting-you rows -> at most N=5 compiles attempted.
//   2. SKIP-FRESH — fresh tldrs-cache hits are NOT compiled; only stale rows
//      count toward the cap.
//   3. GOVERNOR-GATES-EACH-WARM — when checkAndRecordWake returns false for all
//      calls (kill-switch engaged), ZERO compiles happen.
//   4. ENV-TUNABLE — CLARITY_WARM_MAX_ROWS overrides the default cap.
//
// Plus: the warm creates op-issues for the agent to pull — it does NOT
// requestWakeup (no requestWakeup call on the fake ctx).
//
// Forks the editor-heartbeat-recursion makeCtx idiom: a plain-object ctx + capture
// arrays + assert.equal(arr.length, N). Staleness is read against the per-row
// tldrs cache (tldr_cache SELECT) — A2 resolution, NOT situation_snapshots.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  runBoundedWarm,
  DEFAULT_WARM_MAX_ROWS,
  WARM_FRESHNESS_WINDOW_MS,
} from '../../../src/worker/agents/editor.ts';

const NOW = Date.UTC(2026, 5, 8, 12, 0, 0);
const FRESH_ISO = new Date(NOW - 1000).toISOString(); // 1s ago — within window
const STALE_ISO = new Date(NOW - WARM_FRESHNESS_WINDOW_MS - 60_000).toISOString(); // past window

/** Build an awaiting-you rollup row carrying the issue uuid the selector reads. */
function awaitingRow(agentId, issueUuid) {
  return {
    agentId,
    blockerChain: {
      needsYou: true,
      terminalKind: 'AWAITING_HUMAN',
      leafIssueUuid: issueUuid,
      targetIssueUuid: issueUuid,
    },
  };
}

/** A non-awaiting-you row (excluded by the selector). */
function workingRow(agentId, issueUuid) {
  return {
    agentId,
    blockerChain: {
      needsYou: false,
      terminalKind: 'AWAITING_AGENT',
      leafIssueUuid: issueUuid,
      targetIssueUuid: issueUuid,
    },
  };
}

/**
 * Fake ctx for the bounded warm. `freshByScope` maps a scope_id (issue uuid) to
 * `true` (a FRESH cached TL;DR) or absent (no cache row -> stale). `killSwitch`
 * engaged -> the governor's isEngaged short-circuits false for every wake.
 * `wakeCount` is the scripted trailing-60s count the governor compares to the
 * ceiling (default below the 6 ceiling, so warms are allowed).
 */
function makeCtx({ freshByScope = {}, killSwitch = false, wakeCount = 0 } = {}) {
  const requestWakeups = [];
  const ledgerAppends = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        // getTldrByScope — the PER-ROW tldrs cache staleness source (A2). Script
        // freshness by scope_id (the issue uuid, params[1]).
        if (/tldr_cache/i.test(sql)) {
          const scopeId = params?.[1];
          return freshByScope[scopeId]
            ? [{ generated_at: FRESH_ISO }]
            : [{ generated_at: STALE_ISO }];
        }
        // wake-governor isEngaged — version-scoped kill-switch read.
        if (/wake_kill_switch/i.test(sql)) {
          return killSwitch ? [{ engaged: true }] : [];
        }
        // wake-governor countTrailingWakes — trailing-60s wake count.
        if (/count\(\*\)\s+AS n/i.test(sql) || /wake_ledger/i.test(sql)) {
          return [{ n: wakeCount }];
        }
        return [];
      },
      async execute(sql) {
        if (/wake_ledger/i.test(sql)) ledgerAppends.push(sql);
        return { rowCount: 1 };
      },
    },
    issues: {
      async requestWakeup(issueId, companyId) {
        requestWakeups.push({ issueId, companyId });
        return { queued: true };
      },
    },
  };
  return { ctx, requestWakeups, ledgerAppends };
}

test.afterEach(() => {
  delete process.env.CLARITY_WARM_MAX_ROWS;
});

test('W-3 CAP: >5 stale awaiting-you rows -> at most N=5 compiles attempted', async () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(awaitingRow(`a${i}`, `stale-${i}`));
  const { ctx } = makeCtx({ wakeCount: 0 }); // all stale, governor allows
  const compiled = [];
  const warmed = await runBoundedWarm(
    ctx,
    'co-1',
    rows,
    async (issueId) => { compiled.push(issueId); },
    NOW,
  );
  assert.equal(DEFAULT_WARM_MAX_ROWS, 5, 'default cap is 5');
  assert.equal(compiled.length, 5, 'at most 5 of the 8 stale rows are compiled');
  assert.equal(warmed, 5, 'returns the attempted-warm count');
});

test('W-3 SKIP-FRESH: fresh tldrs-cache hits are not compiled; only stale rows count toward the cap', async () => {
  // 3 fresh + 4 stale awaiting-you rows. Only the 4 stale should compile (under
  // the cap of 5), and NONE of the fresh.
  const rows = [
    awaitingRow('f1', 'fresh-1'),
    awaitingRow('s1', 'stale-1'),
    awaitingRow('f2', 'fresh-2'),
    awaitingRow('s2', 'stale-2'),
    awaitingRow('f3', 'fresh-3'),
    awaitingRow('s3', 'stale-3'),
    awaitingRow('s4', 'stale-4'),
  ];
  const { ctx } = makeCtx({
    freshByScope: { 'fresh-1': true, 'fresh-2': true, 'fresh-3': true },
  });
  const compiled = [];
  await runBoundedWarm(ctx, 'co-1', rows, async (id) => { compiled.push(id); }, NOW);
  assert.deepEqual(
    compiled.sort(),
    ['stale-1', 'stale-2', 'stale-3', 'stale-4'],
    'only the four stale rows compile; the three fresh rows are skipped',
  );
});

test('W-3 GOVERNOR: kill-switch engaged -> checkAndRecordWake false -> ZERO compiles (each warm gated)', async () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(awaitingRow(`a${i}`, `stale-${i}`));
  const { ctx } = makeCtx({ killSwitch: true }); // governor returns false for all
  const compiled = [];
  const warmed = await runBoundedWarm(ctx, 'co-1', rows, async (id) => { compiled.push(id); }, NOW);
  assert.equal(compiled.length, 0, 'every warm is suppressed when the governor returns false');
  assert.equal(warmed, 0);
});

test('W-3 ENV-TUNABLE: CLARITY_WARM_MAX_ROWS overrides the cap', async () => {
  process.env.CLARITY_WARM_MAX_ROWS = '2';
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(awaitingRow(`a${i}`, `stale-${i}`));
  const { ctx } = makeCtx({});
  const compiled = [];
  await runBoundedWarm(ctx, 'co-1', rows, async (id) => { compiled.push(id); }, NOW);
  assert.equal(compiled.length, 2, 'the env override caps the warm at 2');
});

test('W-3 NO-WAKE: the warm never calls requestWakeup (it creates op-issues for the agent to pull)', async () => {
  const rows = [awaitingRow('a1', 'stale-1'), awaitingRow('a2', 'stale-2')];
  const { ctx, requestWakeups } = makeCtx({});
  // The injected warmCompile is what would create the op-issue; the warm path
  // itself must never reach ctx.issues.requestWakeup (D-05 removed it).
  await runBoundedWarm(ctx, 'co-1', rows, async () => {}, NOW);
  assert.equal(requestWakeups.length, 0, 'no requestWakeup — native heartbeat pull is the only dispatch');
});

test('W-3 SELECTOR: non-awaiting-you rows are excluded from the warm', async () => {
  const rows = [
    awaitingRow('a1', 'stale-1'),
    workingRow('w1', 'working-1'), // excluded — needsYou false
    awaitingRow('a2', 'stale-2'),
  ];
  const { ctx } = makeCtx({});
  const compiled = [];
  await runBoundedWarm(ctx, 'co-1', rows, async (id) => { compiled.push(id); }, NOW);
  assert.deepEqual(
    compiled.sort(),
    ['stale-1', 'stale-2'],
    'only the two awaiting-you rows are warmed; the working row is not a candidate',
  );
});
