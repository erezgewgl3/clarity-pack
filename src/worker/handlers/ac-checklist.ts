// src/worker/handlers/ac-checklist.ts
//
// Plan 02-03b Task 2 — read userId from PARAMS (UI passes from useHostContext),
// not from a fictional ctx.host.currentUserId. SDK 2026.512.0 PluginContext
// has no `host` field; userId is a UI-side concept and must be marshalled
// across the bridge explicitly.
//
// READER-07 manual AC checklist. Toggles ac_checklist_items.checked + records
// who/when. SQL targets the baked plugin namespace (Finding #4).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';

// Composed from OptInGuardActionCtx — no narrow local Ctx shape (02-04
// blocking anti-pattern guard).
export type AcChecklistCtx = OptInGuardActionCtx;

export function registerAcChecklist(ctx: AcChecklistCtx): void {
  wrapActionHandler(ctx, 'ac-toggle', async (params) => {
    const id = Number(params.id);
    const checked = Boolean(params.checked);
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, error: 'invalid_id' };
    }
    const checkedBy = typeof params.userId === 'string' && params.userId ? params.userId : null;
    const checkedAt = checked ? new Date().toISOString() : null;
    await ctx.db.execute(
      'UPDATE plugin_clarity_pack_cdd6bda4bd.ac_checklist_items SET checked = $1, checked_by = $2, checked_at = $3 WHERE id = $4',
      [checked, checkedBy, checkedAt, id],
    );
    return { ok: true };
  });
}
