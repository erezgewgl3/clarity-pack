// src/worker/handlers/editor-pause-status.ts
//
// Plan 02-03b Task 2 — fix the {rows}-unwrap bug. The SDK's
// PluginDatabaseClient.query<T>(...) returns T[] DIRECTLY, not {rows: T[]}.
// The Plan 02-03 draft was modeled on the node-postgres shape and
// silently returned "paused: false" because result.rows[0] was undefined
// on every call.
//
// PauseBanner consumes this to decide whether to render the D-07 footer.
// Returns {paused, lastFailureAt, reason}. "paused" is true when the most-
// recent editor_agent_failures row's `consecutive` >= MAX_CONSECUTIVE_FAILURES.

import { MAX_CONSECUTIVE_FAILURES } from '../agents/circuit-breaker.ts';
import { EDITOR_AGENT_KEY } from '../agents/editor.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

export type EditorPauseStatus = {
  paused: boolean;
  lastFailureAt: string | null;
  reason: string | null;
};

// Composed from OptInGuardDataCtx — no narrow local Ctx shape.
export type EditorPauseStatusCtx = OptInGuardDataCtx;

type FailureRow = { failed_at: string; reason: string; consecutive: number };

export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  wrapDataHandler(ctx, 'editor.pause-status', async () => {
    try {
      const rows = await ctx.db.query<FailureRow>(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      const last = rows[0];
      if (!last) {
        const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
        return empty;
      }
      const paused = last.consecutive >= MAX_CONSECUTIVE_FAILURES;
      const status: EditorPauseStatus = {
        paused,
        lastFailureAt: paused ? last.failed_at : null,
        reason: paused ? last.reason : null,
      };
      return status;
    } catch {
      const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
      return empty;
    }
  });
}
