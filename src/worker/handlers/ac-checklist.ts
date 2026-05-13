// src/worker/handlers/ac-checklist.ts
//
// Plan 02-03 — registers the 'ac-toggle' action handler for the manual AC
// checklist (READER-07). Task 1 ships a minimal stub; Task 2 fills in the
// UPDATE-by-id-into-plugin-namespace logic.

export type AcChecklistCtx = {
  actions: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
};

/**
 * Register the ac-toggle action handler. Task-1-minimal — accepts the call
 * and returns {ok: true} without persisting. Task 2 replaces the body with
 * the real ctx.db.execute UPDATE into
 * plugin_clarity_pack_cdd6bda4bd.ac_checklist_items.
 */
export function registerAcChecklist(ctx: AcChecklistCtx): void {
  ctx.actions.register('ac-toggle', async () => ({ ok: true }));
}
