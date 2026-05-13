// src/worker/handlers/editor-pause-status.ts
//
// Plan 02-03 — registers the 'editor.pause-status' data handler. PauseBanner
// (Task 2) consumes the result; the data handler returns {paused, lastFailureAt,
// reason}. Task 1 ships a minimal stub so worker.ts registration is clean;
// Task 2 fills in the real ctx.agents.get + editor_agent_failures query.

export type EditorPauseStatus = {
  paused: boolean;
  lastFailureAt: string | null;
  reason: string | null;
};

export type EditorPauseStatusCtx = {
  data: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
};

/**
 * Register the editor.pause-status data handler. Task-1-minimal — always
 * returns {paused: false, lastFailureAt: null, reason: null}. Task 2 wires
 * the real status query.
 */
export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  ctx.data.register('editor.pause-status', async () => {
    const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
    return empty;
  });
}
