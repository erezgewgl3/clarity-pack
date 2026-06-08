// src/worker/db/wake-kill-switch-repo.ts
//
// Phase 16.1 Plan 16.1-01 Task 3 (D-08) — the durable, version-scoped,
// operator-clear-only wake kill-switch repo. Repo skeleton mirrors
// reply-resume-repo.ts (db: PluginDatabaseClient; query = SELECT-only,
// execute = namespace DML returning rowCount only). Durable-state + version-scope
// + fail-open semantics mirror circuit-breaker.ts:isCircuitOpenDurable.
//
// WHY VERSION-SCOPED. The kill-switch persists across a worker restart (the
// failure mode the in-memory guards had). But a row tripped by a PRE-FIX build
// must not leave a CORRECTED build dead-on-arrival. So isEngaged filters
// plugin_version = manifest.version: a fixed build ignores a stale-version
// engaged row (Open Question #3 = YES). manifest.version is the single source of
// truth (same import as circuit-breaker.ts:24,38) so the scope tracks a manifest
// bump automatically.
//
// GOVERNANCE PARITY (coexistence #4). engage() sets the switch; there is NO
// auto-clear path callable from worker dispatch — clearing is an explicit
// operator gesture only (clear()), the same discipline as circuit-breaker
// recordSuccess never auto-resuming the agent.
//
// FAIL-OPEN. isEngaged wraps its durable read in try/catch returning false: a
// transient DB error never wedges dispatch (T-161-05 accept). The throughput
// ledger remains the hard cap.
//
// All SQL is parameterized — no string interpolation of identifiers
// (T-161-01 mitigation).

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

import manifest from '../../manifest.ts';

/**
 * The current Clarity Pack plugin version — the version-scope source for the
 * durable kill-switch read/write. Sourced from the manifest (same single source
 * of truth as circuit-breaker.ts) so the scope tracks a manifest version bump
 * automatically; no second source to drift.
 */
export const CLARITY_PACK_VERSION: string = manifest.version;

export type WakeKillSwitchRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * Durable, version-scoped read. Returns true only when an engaged row exists for
 * this company AND its plugin_version matches the current build — a pre-fix
 * tripped row (different version) reads as NOT engaged so a corrected build is
 * not DOA (Open Q #3 = YES). Fails open (returns false) on any query error: the
 * durable read is a backstop, never a wedge (T-161-05).
 */
export async function isEngaged(
  ctx: WakeKillSwitchRepoCtx,
  companyId: string,
): Promise<boolean> {
  try {
    const rows = await ctx.db.query<{ engaged: boolean }>(
      `SELECT engaged
       FROM plugin_clarity_pack_cdd6bda4bd.wake_kill_switch
       WHERE company_id = $1 AND plugin_version = $2
       LIMIT 1`,
      [companyId, CLARITY_PACK_VERSION],
    );
    return !!rows[0]?.engaged;
  } catch {
    return false; // fail-open — durable read is a backstop, never a wedge
  }
}

/**
 * Engage the kill-switch for a company. Atomic upsert against UNIQUE(company_id):
 * a first trip inserts, a re-trip refreshes engaged_at/reason/plugin_version.
 * Stamps the current plugin_version so isEngaged's version-scope sees it.
 * Returns void (execute returns rowCount only).
 */
export async function engage(
  ctx: WakeKillSwitchRepoCtx,
  companyId: string,
  reason: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.wake_kill_switch
       (company_id, engaged, engaged_at, reason, plugin_version)
     VALUES ($1, true, now(), $2, $3)
     ON CONFLICT (company_id) DO UPDATE
       SET engaged = true, engaged_at = now(), reason = $2, plugin_version = $3`,
    [companyId, reason, CLARITY_PACK_VERSION],
  );
}

/**
 * Operator-only reset. Sets engaged = false for the company. This is the ONLY
 * path that clears the switch — there is intentionally no auto-clear callable
 * from worker dispatch (governance parity with circuit-breaker recordSuccess,
 * which never auto-resumes). Returns void.
 */
export async function clear(
  ctx: WakeKillSwitchRepoCtx,
  companyId: string,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.wake_kill_switch
       SET engaged = false
     WHERE company_id = $1`,
    [companyId],
  );
}
