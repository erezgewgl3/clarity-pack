// src/worker/handlers/active-viewer-ping.ts
//
// Plan 02-04 Task 2 — situation.active-viewer-ping action. Called every
// poll tick by the Situation Room UI to register the tab as an active
// viewer. The 60s job (situation-snapshot.ts) only fires when at least
// one row has last_seen_at within the last 90 seconds (ROOM-05 gate).
//
// Wrapped with opt-in-guard — opted-out users can't keep the snapshot
// engine warm.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';

export type ActiveViewerPingCtx = OptInGuardActionCtx;

export function registerActiveViewerPing(ctx: ActiveViewerPingCtx): void {
  wrapActionHandler(ctx, 'situation.active-viewer-ping', async (params) => {
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const tabId =
      typeof params?.tabId === 'string' && params.tabId ? params.tabId : null;
    if (!userId) {
      throw new Error('active-viewer-ping: userId required');
    }
    if (!tabId) {
      throw new Error('active-viewer-ping: tabId required');
    }
    await ctx.db.execute(
      "INSERT INTO plugin_clarity_pack_cdd6bda4bd.active_viewers (user_id, surface, tab_id) VALUES ($1, 'situation-room', $2) ON CONFLICT (user_id, surface, tab_id) DO UPDATE SET last_seen_at = now()",
      [userId, tabId],
    );
    return { ok: true };
  });
}
