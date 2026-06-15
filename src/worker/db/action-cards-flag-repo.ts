// src/worker/db/action-cards-flag-repo.ts
//
// Phase 19 Plan 19-01 Task 1 (D-01 / D-02) — the runtime action-cards
// enablement flag repo. This is a near-verbatim clone of
// wake-kill-switch-repo.ts (db: PluginDatabaseClient; query = SELECT-only,
// execute = namespace DML returning rowCount only) with TWO deliberate
// divergences:
//
//   (1) INVERTED POLARITY. The wake kill-switch is permissive-by-default
//       (fail-open: a read error returns false = NOT engaged). This flag is
//       the OPPOSITE — default OFF / safe. isActionCardsEnabled returns true
//       ONLY when a row exists with enabled = true; an absent row reads OFF
//       (D-02 default) and the catch block returns false so an unreadable
//       flag degrades to the deterministic floor (D-02 degrade-safe), never
//       to ON.
//
//   (2) NOT VERSION-SCOPED. wake-kill-switch-repo.ts filters
//       plugin_version = manifest.version so a pre-fix tripped row does not
//       leave a corrected build dead-on-arrival. This flag DROPS that filter:
//       the operator flips ON once, and a later two-source version bump (for
//       example v1.8.1) must NOT silently revert the flag to OFF. The ON state
//       must survive the bump (D-01 / Open Q #1 resolution). There is no
//       plugin_version column on action_cards_flag for the same reason.
//
// All SQL is parameterized — no string interpolation of identifiers
// (T-19-01 / T-161-01 mitigation).

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type ActionCardsFlagRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * Degrade-to-OFF runtime read. Returns true ONLY when a row exists for this
 * company with enabled = true. An absent row reads OFF (D-02 default). The read
 * is NOT version-scoped — the operator's ON state survives a two-source version
 * bump (D-01 divergence vs isEngaged). Fails to OFF (returns false) on any query
 * error: an unreadable flag degrades to the deterministic floor, never to ON
 * (D-02 degrade-safe — the inverted polarity vs wake-kill-switch fail-open).
 */
export async function isActionCardsEnabled(
  ctx: ActionCardsFlagRepoCtx,
  companyId: string,
): Promise<boolean> {
  try {
    const rows = await ctx.db.query<{ enabled: boolean }>(
      `SELECT enabled
       FROM plugin_clarity_pack_cdd6bda4bd.action_cards_flag
       WHERE company_id = $1
       LIMIT 1`,
      [companyId],
    );
    return !!rows[0]?.enabled; // no row => OFF (D-02 default)
  } catch {
    return false; // unreadable => OFF (D-02 degrade-safe; inverted vs isEngaged)
  }
}

/**
 * Flip the action-cards flag for a company. Atomic upsert against
 * UNIQUE(company_id): a first flip inserts, a re-flip refreshes
 * enabled/set_at/set_by. set_at/set_by record the operator gesture (the Step-2
 * ON-flip and the panic-OFF both route through here in Plan 19-05). Returns void
 * (execute returns rowCount only). NOT version-scoped — no plugin_version stamp.
 */
export async function setActionCardsEnabled(
  ctx: ActionCardsFlagRepoCtx,
  companyId: string,
  enabled: boolean,
  setBy: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.action_cards_flag
       (company_id, enabled, set_at, set_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (company_id) DO UPDATE
       SET enabled = $2, set_at = now(), set_by = $3`,
    [companyId, enabled, setBy],
  );
}
