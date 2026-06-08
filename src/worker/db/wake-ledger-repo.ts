// src/worker/db/wake-ledger-repo.ts
//
// Phase 16.1 Plan 16.1-01 Task 2 (D-06) — the sliding-window wake ledger repo.
// Same ctx contract as reply-resume-repo.ts (query = SELECT-only single
// statement; execute = namespace DML, returns rowCount only, NEVER rows).
//
// One row per recorded wake. The trailing-windowSeconds row count for a company
// IS the current wake rate — that is the durable source the throughput governor
// reads (D-06). The ledger self-drains: pruneOldWakes runs alongside each append,
// so with a ceiling of a handful of wakes per minute the table stays a few dozen
// rows at most. No cron, no index (a seq scan over a tiny self-pruned table is
// fine; a standalone CREATE INDEX would violate the host migration validator
// anyway).
//
// All SQL is parameterized — the window is passed as a value and cast to an
// interval via `($N || ' seconds')::interval`; NO string interpolation of
// identifiers or intervals (T-161-01 mitigation).

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type WakeLedgerRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * Append one wake row for a company. `woke_at` is omitted so the column DEFAULT
 * now() stamps it. Returns void (execute returns rowCount only).
 */
export async function appendWake(
  ctx: WakeLedgerRepoCtx,
  companyId: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.wake_ledger (company_id)
     VALUES ($1)`,
    [companyId],
  );
}

/**
 * Count the wakes recorded for a company within the trailing `windowSeconds`.
 * This count IS the current wake rate the governor compares against the ceiling.
 * count(*) returns as a string from the host driver, so coerce with Number()
 * and default 0 when no row comes back.
 */
export async function countTrailingWakes(
  ctx: WakeLedgerRepoCtx,
  companyId: string,
  windowSeconds: number,
): Promise<number> {
  const rows = await ctx.db.query<{ n: string | number }>(
    `SELECT count(*) AS n
     FROM plugin_clarity_pack_cdd6bda4bd.wake_ledger
     WHERE company_id = $1 AND woke_at > now() - ($2 || ' seconds')::interval`,
    [companyId, windowSeconds],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Delete every wake row older than the trailing `windowSeconds` (across all
 * companies — the ledger is self-draining). Called beside each append so the
 * table never grows unbounded (T-161-02 mitigation). Returns void.
 */
export async function pruneOldWakes(
  ctx: WakeLedgerRepoCtx,
  windowSeconds: number,
): Promise<void> {
  await ctx.db.execute(
    `DELETE FROM plugin_clarity_pack_cdd6bda4bd.wake_ledger
     WHERE woke_at < now() - ($1 || ' seconds')::interval`,
    [windowSeconds],
  );
}
