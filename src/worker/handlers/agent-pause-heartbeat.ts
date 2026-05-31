// src/worker/handlers/agent-pause-heartbeat.ts
//
// Plan 09-02 (R4 / R7) — `agents.pauseHeartbeat` action: the "Stand down"
// write path for the Situation Room idle/stale rows.
//
// Phase 8 shipped the row's "Stand down" affordance as a NO-OP (no action key
// existed on this host — the chat surface's Pause was visual-only for the same
// reason). R4 forbids dead buttons: a surfaced action MUST perform or be
// absent. The SPEC (R7) requires Stand down to fire ctx.agents.pause behind a
// confirm dialog. This handler is that real write path — the exact mirror of
// agent-resume-heartbeat.ts (same shape, opposite verb), so the cockpit's
// Stand-down → Resume round-trip is symmetric.
//
// SIGNATURE — explicit `agentId` is REQUIRED here (unlike resume, which can
// fall back to the Editor-Agent). The Situation Room only stands down a named
// org-chart agent row; there is no "pause the Editor-Agent" caller. Passing the
// row's agentId keeps the host's company-scope + governance checks in force
// (ctx.agents.pause(agentId, companyId)).
//
// FAILURE CONTRACT — THROW, do not return {error}. The UI caller's catch fires
// the graceful-degrade copy that names the native Agents panel; a returned
// {error} would resolve the promise and falsely show success.
//
// Opt-in gated via wrapActionHandler — an opted-out / userId-less caller gets
// { error: 'OPT_IN_REQUIRED' } before this body runs.
//
// Governance parity (coexistence #4): pause is an explicit operator gesture
// through the host's standard ctx.agents.pause primitive — the host enforces
// the rules. No plugin-private mechanism. The capability `agents.pause` is
// already declared in the manifest (no new capability, no version bump).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type AgentPauseHeartbeatCtx = OptInGuardActionCtx & {
  agents: Pick<PluginAgentsClient, 'pause'>;
  logger?: PluginLogger;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`agents.pauseHeartbeat: ${key} required`);
}

export function registerAgentPauseHeartbeat(ctx: AgentPauseHeartbeatCtx): void {
  wrapActionHandler(ctx, 'agents.pauseHeartbeat', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const agentId = reqStr(params, 'agentId');

    try {
      // ctx.agents.pause takes (agentId, companyId) per the SDK shape
      // (mirrors circuit-breaker.ts:101). The host gates by company scope.
      await ctx.agents.pause(agentId, companyId);
      return { ok: true as const, agentId };
    } catch (e) {
      // Re-throw so the UI caller's catch fires its graceful-degrade copy.
      ctx.logger?.warn?.('agents.pauseHeartbeat: pause failed', {
        agentId,
        err: (e as Error).message,
      });
      throw e;
    }
  });
}
