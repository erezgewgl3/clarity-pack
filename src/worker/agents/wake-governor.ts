// src/worker/agents/wake-governor.ts
//
// Phase 16.1 Plan 16.1-02 Task 1 (D-06/D-07/D-08) — the throughput wake-governor.
// A check-before-wake service: every legitimate wake origin (the heartbeat/cron
// pull path, wired in Plan 04 — NOT this file) calls checkAndRecordWake BEFORE it
// wakes an agent. The governor bounds wakes by trailing-60s throughput against an
// env ceiling and engages a durable, restart-survivable kill-switch on overflow.
//
// THIS FILE ONLY GATES — it never wakes. It does NOT touch ctx.agents.* /
// reconcile / runHeartbeat / requestWakeup. The caller performs the legitimate
// pull only when checkAndRecordWake returns true. (LOOP-01 static-gate friendly.)
//
// GOVERNANCE PARITY (coexistence #4), mirroring circuit-breaker.ts:
//   - engage automatically once at threshold,
//   - NEVER auto-clear (clearing the kill-switch is an explicit operator gesture
//     via wake-kill-switch-repo.clear — there is no resume/clear path here),
//   - fail-open: the kill-switch durable read fails open inside the repo, so a
//     transient DB error never wedges legitimate dispatch (T-161-10 accept). The
//     ledger count remains the hard cap.
//
// THE CEILING (D-07). Read from process.env.CLARITY_WAKE_CEILING_PER_MIN, coerced
// via Number, with the literal safe out-of-box default 6/min. A wake whose
// trailing-60s count EXCEEDS the ceiling is suppressed (returns false) and trips
// the kill-switch; everything at or under the ceiling is allowed (returns true).
//
// DURABLE BACKSTOP (D-08). The kill-switch lives in Postgres
// (wake_kill_switch), so an already-tripped switch stays tripped across a worker
// restart — the in-memory-only guards that failed in the 2026-06-04 storm are not
// relied on here. An optional in-memory fast counter could layer over the durable
// read, but the durable read is the authoritative restart backstop; this file
// keeps the durable read as the sole source for simplicity and correctness.

import {
  appendWake,
  countTrailingWakes,
  pruneOldWakes,
} from '../db/wake-ledger-repo.ts';
import { engage, isEngaged } from '../db/wake-kill-switch-repo.ts';

/**
 * The safe out-of-box ceiling (wakes per minute) per D-07. Used when
 * CLARITY_WAKE_CEILING_PER_MIN is absent or not a finite positive number.
 */
export const DEFAULT_WAKE_CEILING_PER_MIN = 6;

/** The trailing window the rate is measured over (seconds). */
const RATE_WINDOW_SECONDS = 60;

/**
 * The prune window (seconds). Window plus slack so the ledger self-drains while
 * the rate read (RATE_WINDOW_SECONDS) still sees the full trailing minute.
 */
const PRUNE_WINDOW_SECONDS = 120;

/**
 * The narrow ctx slice this service needs — a db with query+execute (the shape
 * the wake-ledger + wake-kill-switch repos require) plus an optional logger.
 * Pick-style so .mjs tests can hand a plain object without the full host ctx.
 */
export type WakeGovernorCtx = {
  db: {
    query<T>(sql: string, params: unknown[]): Promise<T[]>;
    execute(sql: string, params: unknown[]): Promise<unknown>;
  };
  logger?: {
    info?: (msg: string, meta?: unknown) => void;
    warn?: (msg: string, meta?: unknown) => void;
    error?: (msg: string, meta?: unknown) => void;
  };
};

/**
 * Read the wake ceiling from the environment (D-07). Coerce via Number; fall back
 * to DEFAULT_WAKE_CEILING_PER_MIN when absent, NaN, or non-positive — a malformed
 * override must never silently disable the cap.
 */
function readCeiling(): number {
  const raw = process.env.CLARITY_WAKE_CEILING_PER_MIN;
  if (raw === undefined || raw === '') return DEFAULT_WAKE_CEILING_PER_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WAKE_CEILING_PER_MIN;
  return n;
}

/**
 * Check-before-wake throughput gate. Returns true when the caller may proceed to
 * wake an agent, false when the wake is suppressed.
 *
 * Flow:
 *   1. If the durable kill-switch isEngaged → log + return false (restart-durable
 *      backstop; an already-tripped switch stays tripped, D-08). No ledger append.
 *   2. appendWake + pruneOldWakes (self-drain).
 *   3. rate = countTrailingWakes(60). If rate > ceiling → engage the kill-switch,
 *      log warn, return false (suppress). Else return true (allow).
 *
 * The governor never calls ctx.agents.* — it only gates. The caller (Plan 04's
 * heartbeat/cron) performs the legitimate pull when this returns true.
 */
export async function checkAndRecordWake(
  ctx: WakeGovernorCtx,
  companyId: string,
): Promise<boolean> {
  const ceiling = readCeiling();

  // 1. Already-tripped switch suppresses immediately — the durable, restart-safe
  //    backstop. No ledger work, no re-exceed required.
  if (await isEngaged(ctx, companyId)) {
    ctx.logger?.info?.('wake-governor: wake suppressed — kill-switch engaged', {
      companyId,
    });
    return false;
  }

  // 2. Record this wake then self-drain the sliding window.
  await appendWake(ctx, companyId);
  await pruneOldWakes(ctx, PRUNE_WINDOW_SECONDS);

  // 3. The trailing-60s row count IS the current rate.
  const rate = await countTrailingWakes(ctx, companyId, RATE_WINDOW_SECONDS);
  if (rate > ceiling) {
    const reason = `wake rate ${rate}/min exceeded ceiling ${ceiling}/min`;
    await engage(ctx, companyId, reason);
    ctx.logger?.warn?.('wake-governor: kill-switch engaged — wake suppressed', {
      companyId,
      rate,
      ceiling,
    });
    return false;
  }

  return true;
}
