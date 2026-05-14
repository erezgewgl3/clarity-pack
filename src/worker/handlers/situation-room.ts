// src/worker/handlers/situation-room.ts
//
// Plan 02-04 Task 2 — situation.snapshot data handler. Returns the most-
// recent materialized snapshot row for the caller's company. The 60s job
// (situation-snapshot.ts) writes; this handler reads.
//
// Wrapped with opt-in-guard so opted-out callers receive
// {error:'OPT_IN_REQUIRED'} (OPTIN-04). companyId comes from params (the
// UI passes via useHostContext or useResolvedCompanyId).

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

export type SituationRoomCtx = OptInGuardDataCtx;

type SnapshotRow = {
  id: number;
  taken_at: string;
  computed_for_company_id: string;
  payload: unknown;
  content_hash: string;
};

export function registerSituationRoomHandlers(ctx: SituationRoomCtx): void {
  wrapDataHandler(ctx, 'situation.snapshot', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) {
      // Fail loud — the UI must thread companyId via useResolvedCompanyId
      // (same pattern as Reader). An empty companyId would silently match no
      // rows; we'd rather surface the bug.
      throw new Error('situation.snapshot: companyId required');
    }
    const rows = await ctx.db.query<SnapshotRow>(
      'SELECT id, taken_at, computed_for_company_id, payload, content_hash FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1',
      [companyId],
    );
    const row = rows[0];
    if (!row) return null;
    const payload = row.payload as Record<string, unknown>;
    return { ...payload, taken_at: row.taken_at };
  });
}
