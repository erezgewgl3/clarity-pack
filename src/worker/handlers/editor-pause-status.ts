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
//
// Plan 05-05 Task 1 (D-06 + D-07) — payload extended into a cause-discriminated
// shape:
//   { paused: false }
//   { paused: true, cause: 'operator' | 'budget' | 'adapter', agentName, [detail],
//     lastFailureAt, reason }
//
// New fields (cause / agentName / detail) drive the new generic
// AgentPauseBanner mounted on Reader top-of-tab AND chat header.
// LEGACY fields (lastFailureAt / reason) STAY when paused so the editor-only
// `pause-banner.tsx` keeps rendering its locked "Editorial Desk paused — last
// compile failed at <HH:MM>. Resume in agent panel." (locked by
// reader-view.test.mjs). One worker call serves both consumers (PRIM-01 spirit).
//
// Cause derivation:
//   - reason text contains 'budget'             → 'budget'
//   - reason text contains 'codex' or 'adapter' → 'adapter' (+ detail HH:MM)
//   - otherwise                                  → 'operator' (default — operator clicked Pause)
//
// agentName resolution mirrors the chat-open-for-issue.ts pattern (Plan 04.2-06
// D9): try ctx.agents.get + extract .name + null on degrade. NEVER falls back
// to the UUID. When companyId is missing in params, agentName is null and the
// UI surfaces the friendly literal 'this employee'.

import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';

import { MAX_CONSECUTIVE_FAILURES } from '../agents/circuit-breaker.ts';
import { EDITOR_AGENT_KEY } from '../agents/editor.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

/** Plan 05-05 D-07 — pause cause variants the UI dispatches copy on. */
export type EditorPauseCause = 'operator' | 'budget' | 'adapter';

/** Plan 05-05 D-07 — discriminated payload returned to the UI. Legacy fields
 *  (lastFailureAt + reason) are still present when paused so the editor-only
 *  `pause-banner.tsx` keeps its locked render. */
export type EditorPauseStatus =
  | { paused: false; lastFailureAt: null; reason: null }
  | {
      paused: true;
      cause: EditorPauseCause;
      agentName: string | null;
      detail?: string;
      // Plan 05-05 — legacy fields preserved (editor-only banner consumes these).
      lastFailureAt: string | null;
      reason: string | null;
    };

// Composed from OptInGuardDataCtx — no narrow local Ctx shape.
// Plan 05-05 — adds the agents client so the handler can resolve agentName
// server-side (Plan 04.2-06 D9 pattern). Older callers that constructed an
// EditorPauseStatusCtx without `agents` still type-check because we narrow at
// runtime via `typeof ctx.agents?.get === 'function'`.
export type EditorPauseStatusCtx = OptInGuardDataCtx & {
  agents?: Pick<PluginAgentsClient, 'get'>;
  logger?: PluginLogger;
};

type FailureRow = { failed_at: string; reason: string; consecutive: number };

function formatHHMM(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Plan 05-05 D-07 — pure helper. Substring scan on the reason text decides
 *  the cause variant. Default is 'operator' (operator clicked Pause). */
export function deriveCause(reason: string | null): EditorPauseCause {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('budget')) return 'budget';
  if (r.includes('codex') || r.includes('adapter')) return 'adapter';
  return 'operator';
}

export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  wrapDataHandler(ctx, 'editor.pause-status', async (params) => {
    // Plan 05-05 — companyId is now consumed (the new agentName resolver
    // needs it). When absent the handler falls back to agentName: null and
    // the UI surfaces the friendly literal 'this employee'.
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;

    try {
      const rows = await ctx.db.query<FailureRow>(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      const last = rows[0];
      if (!last) {
        const empty: EditorPauseStatus = {
          paused: false,
          lastFailureAt: null,
          reason: null,
        };
        return empty;
      }
      const paused = last.consecutive >= MAX_CONSECUTIVE_FAILURES;
      if (!paused) {
        const status: EditorPauseStatus = {
          paused: false,
          lastFailureAt: null,
          reason: null,
        };
        return status;
      }

      // Plan 05-05 D-07 — derive cause from reason text.
      const cause = deriveCause(last.reason);

      // Plan 05-05 D-07 + Plan 04.2-06 D9 NO_UUID_LEAK pattern — resolve the
      // agent display name server-side. Degrades to null on every failure
      // path; UI fallback is 'this employee', never the UUID.
      let agentName: string | null = null;
      if (companyId && typeof ctx.agents?.get === 'function') {
        try {
          const agent = await ctx.agents.get(EDITOR_AGENT_KEY, companyId);
          if (agent && typeof (agent as { name?: unknown }).name === 'string') {
            const candidate = (agent as { name: string }).name.trim();
            if (candidate) agentName = candidate;
          }
        } catch (e) {
          ctx.logger?.warn?.('editor.pause-status: agents.get failed', {
            err: (e as Error).message,
          });
        }
      }

      const status: EditorPauseStatus = {
        paused: true,
        cause,
        agentName,
        // Legacy back-compat fields — editor-only banner reads these.
        lastFailureAt: last.failed_at,
        reason: last.reason,
        // Adapter variant carries detail HH:MM (the time of the most recent
        // adapter failure). For operator/budget it stays unset.
        ...(cause === 'adapter' ? { detail: formatHHMM(last.failed_at) } : {}),
      };
      return status;
    } catch {
      const empty: EditorPauseStatus = {
        paused: false,
        lastFailureAt: null,
        reason: null,
      };
      return empty;
    }
  });
}
