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
//
// Quick task 260528-mn0 (2026-05-28) — STALE-READ FIX. `paused` used to be a
// pure heuristic: `(latest editor_agent_failures row).consecutive >= MAX`.
// recordSuccess (circuit-breaker.ts) zeroes only the in-memory counter and
// writes NO row, so after a genuine resume + clean compiles the latest failure
// row still carried consecutive>=3 and the banner latched "paused" FOREVER
// (the operator saw a red banner on an active agent). And the agentName lookup
// passed the KEY 'editor-agent' to ctx.agents.get, whose id column is a uuid —
// the host threw `invalid input syntax for type uuid` and agentName degraded to
// null ("this employee"). Both are now fixed by reading the agent's REAL
// status: resolve the UUID via ctx.agents.managed.reconcile(EDITOR_AGENT_KEY)
// (the same path compile-bulletin.ts proved live on BEAAA), then
// ctx.agents.get(uuid, companyId), and set paused from agent.status/pausedAt —
// authoritative and self-clearing on resume. The whole authoritative block is
// wrapped in try/catch; on ANY failure (no companyId, no agents client,
// reconcile/get throws) it FALLS BACK to the old failure-table heuristic so the
// handler is never worse than before. The failure-table read is kept for the
// legacy footer fields (lastFailureAt/reason) + cause derivation + that
// fallback.

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
// Quick task 260528-mn0 — widened to include `managed` so the handler can
// reconcile the Editor-Agent UUID (ctx.agents.managed.reconcile) before the
// company-scoped ctx.agents.get call. Still optional + runtime-narrowed.
export type EditorPauseStatusCtx = OptInGuardDataCtx & {
  agents?: Pick<PluginAgentsClient, 'get' | 'managed'>;
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

    // --- 1. Read the latest failure row. Kept for the legacy footer fields
    //        (lastFailureAt/reason) the editor-only pause-banner.tsx consumes,
    //        for cause derivation, AND as the fallback heuristic when the
    //        authoritative status lookup below cannot resolve. A DB error here
    //        preserves the historical catch behaviour: report not-paused.
    let last: FailureRow | undefined;
    try {
      const rows = await ctx.db.query<FailureRow>(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      last = rows[0];
    } catch {
      const empty: EditorPauseStatus = {
        paused: false,
        lastFailureAt: null,
        reason: null,
      };
      return empty;
    }

    // --- 2. Authoritative status (Quick task 260528-mn0). Resolve the
    //        Editor-Agent UUID via reconcile, then read the agent's REAL status
    //        with the resolved UUID (NOT the key — that was the uuid-cast throw
    //        that nulled agentName). `paused` comes from agent.status/pausedAt,
    //        which self-clears on resume. The whole block is wrapped: on ANY
    //        failure (no companyId, no agents client, reconcile/get throws)
    //        `authoritativePaused` stays null and step 3 falls back to the old
    //        failure-table heuristic — never worse than before.
    let authoritativePaused: boolean | null = null;
    let agentName: string | null = null;
    if (
      companyId &&
      ctx.agents &&
      typeof ctx.agents.get === 'function' &&
      ctx.agents.managed &&
      typeof ctx.agents.managed.reconcile === 'function'
    ) {
      try {
        const resolution = await ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId);
        const agentId = resolution?.agentId ?? null;
        if (agentId) {
          const agent = await ctx.agents.get(agentId, companyId);
          if (agent) {
            // `pausedAt` is not on the SDK-typed Agent (the type comes from
            // @paperclipai/shared, which is not bundled); read it defensively.
            const a = agent as { status?: unknown; pausedAt?: unknown; name?: unknown };
            authoritativePaused = a.status === 'paused' || a.pausedAt != null;
            if (typeof a.name === 'string' && a.name.trim()) {
              agentName = a.name.trim();
            }
          }
        }
      } catch (e) {
        ctx.logger?.warn?.(
          'editor.pause-status: authoritative status lookup failed; falling back to failure-table heuristic',
          { err: (e as Error).message },
        );
        authoritativePaused = null;
      }
    }

    // --- 3. Decide paused. Authoritative wins; otherwise the legacy heuristic
    //        (latest failure row consecutive >= MAX_CONSECUTIVE_FAILURES).
    const paused =
      authoritativePaused != null
        ? authoritativePaused
        : !!last && last.consecutive >= MAX_CONSECUTIVE_FAILURES;

    if (!paused) {
      const status: EditorPauseStatus = {
        paused: false,
        lastFailureAt: null,
        reason: null,
      };
      return status;
    }

    // paused: true — derive cause from the failure reason. When the agent is
    // genuinely paused but has no failure row (operator paused it via the
    // native Agents panel), cause defaults to 'operator' and the legacy fields
    // are null.
    const cause = deriveCause(last?.reason ?? null);
    const status: EditorPauseStatus = {
      paused: true,
      cause,
      agentName,
      // Legacy back-compat fields — editor-only banner reads these.
      lastFailureAt: last ? last.failed_at : null,
      reason: last ? last.reason : null,
      // Adapter variant carries detail HH:MM (the time of the most recent
      // adapter failure). For operator/budget it stays unset.
      ...(cause === 'adapter' ? { detail: formatHHMM(last ? last.failed_at : null) } : {}),
    };
    return status;
  });
}
