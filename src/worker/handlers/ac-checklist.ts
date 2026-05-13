// src/worker/handlers/ac-checklist.ts
//
// Plan 02-03 Task 2 — registers the 'ac-toggle' action handler for the manual
// AC checklist (READER-07). Toggles ac_checklist_items.checked + records
// who/when. SQL targets the baked plugin namespace (Finding #4).

export type AcChecklistCtx = {
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void; error?(...a: unknown[]): void };
  host?: { currentUserId?: string };
  actions: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
  db: {
    execute(sql: string, params: unknown[]): Promise<unknown>;
  };
};

export function registerAcChecklist(ctx: AcChecklistCtx): void {
  ctx.actions.register('ac-toggle', async (params) => {
    const id = Number(params.id);
    const checked = Boolean(params.checked);
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, error: 'invalid_id' };
    }
    const checkedBy = ctx.host?.currentUserId ?? null;
    const checkedAt = checked ? new Date().toISOString() : null;
    await ctx.db.execute(
      'UPDATE plugin_clarity_pack_cdd6bda4bd.ac_checklist_items SET checked = $1, checked_by = $2, checked_at = $3 WHERE id = $4',
      [checked, checkedBy, checkedAt, id],
    );
    return { ok: true };
  });
}
