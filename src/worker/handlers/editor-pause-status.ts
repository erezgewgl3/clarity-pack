// src/worker/handlers/editor-pause-status.ts
//
// Plan 02-03 Task 2 — registers the 'editor.pause-status' data handler.
// PauseBanner consumes this to decide whether to render the D-07 footer.
//
// Returns {paused, lastFailureAt, reason}. The "paused" flag combines two
// signals: (a) the Editor-Agent's current Paperclip status (via the resolved
// agentId — Phase 3 will deepen this with ctx.agents.get); (b) the most-
// recent row in editor_agent_failures has consecutive >= MAX_CONSECUTIVE_FAILURES.
// Either reads `true` → banner appears.
//
// For 02-03 we read only signal (b) — the durable audit table — which is what
// the operator can actually see in their classic admin panel. Signal (a) hooks
// in cleanly once the SDK's ctx.agents.get / managed.get path is verified
// against the Linux re-spike (deferred from Plan 02-01 Check B).

import { MAX_CONSECUTIVE_FAILURES } from '../agents/circuit-breaker.ts';
import { EDITOR_AGENT_KEY } from '../agents/editor.ts';

export type EditorPauseStatus = {
  paused: boolean;
  lastFailureAt: string | null;
  reason: string | null;
};

export type EditorPauseStatusCtx = {
  data: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
  db: {
    query(sql: string, params: unknown[]): Promise<{ rows: Array<{ failed_at: string; reason: string; consecutive: number }> }>;
  };
};

export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  ctx.data.register('editor.pause-status', async () => {
    try {
      const result = await ctx.db.query(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      const last = result.rows[0];
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
