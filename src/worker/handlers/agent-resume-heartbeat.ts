// src/worker/handlers/agent-resume-heartbeat.ts
//
// Quick task 260528-mn0 (2026-05-28) — `agents.resumeHeartbeat` action.
//
// Two UI surfaces already call usePluginAction('agents.resumeHeartbeat') but
// the worker never registered the key, so the host returned 502 on every
// click:
//   - src/ui/primitives/agent-pause-banner.tsx (Reader top + chat header) —
//     the ▶ Resume heartbeat button on the paused-agent banner. Targets the
//     Editor-Agent; passes { userId, companyId } (no agentId).
//   - src/ui/surfaces/chat/context-rail.tsx — the Quick Action ▶ Resume row for
//     the chatted employee. Passes { agentId, companyId, userId }.
//
// This handler serves both: an explicit `agentId` param wins (the chat row's
// employee agent); with no agentId it resolves the Editor-Agent UUID via
// ctx.agents.managed.reconcile(EDITOR_AGENT_KEY) — the exact reconcile→resume
// path compile-bulletin.ts proves live on BEAAA. It then calls
// ctx.agents.resume(uuid, companyId) (host capability `agents.resume`, already
// declared in the manifest — no new capability or version bump).
//
// FAILURE CONTRACT — THROW, do not return {error}. Both callers branch on a
// thrown/rejected action (their catch fires the graceful-degrade copy that
// points the operator at the native Agents panel); a returned {error} object
// resolves the promise and they would falsely show success. So every failure
// path (reconcile fail / unresolved id / resume throw) re-throws. Success
// resolves { ok, agentId } so callers can optimistically confirm.
//
// Opt-in gated via wrapActionHandler like every other action: an opted-out (or
// userId-less) caller gets { error: 'OPT_IN_REQUIRED' } before this body runs.
// The banner now passes userId so opted-in operators pass the gate.
//
// Governance parity (coexistence #4): resume is an explicit operator gesture
// invoked through the host's standard ctx.agents.resume primitive — the host
// enforces the rules (resume throws on a terminated / pending_approval agent).
// No plugin-private mechanism, no auto-resume.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';

import { EDITOR_AGENT_KEY } from '../agents/editor.ts';

export type AgentResumeHeartbeatCtx = OptInGuardActionCtx & {
  agents: Pick<PluginAgentsClient, 'resume' | 'managed'>;
  logger?: PluginLogger;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`agents.resumeHeartbeat: ${key} required`);
}

export function registerAgentResumeHeartbeat(ctx: AgentResumeHeartbeatCtx): void {
  wrapActionHandler(ctx, 'agents.resumeHeartbeat', async (params) => {
    const companyId = reqStr(params, 'companyId');

    // Explicit agentId wins (chat Quick Action targets the chatted employee).
    // No agentId → the pause-banner caller, which targets the Editor-Agent.
    const explicitAgentId =
      typeof params?.agentId === 'string' && params.agentId ? params.agentId : null;

    try {
      let agentId = explicitAgentId;
      if (!agentId) {
        const resolution = await ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId);
        agentId = resolution?.agentId ?? null;
      }
      if (!agentId) {
        throw new Error('agents.resumeHeartbeat: could not resolve agent id');
      }
      await ctx.agents.resume(agentId, companyId);
      return { ok: true as const, agentId };
    } catch (e) {
      // Re-throw so the UI callers' catch fires their graceful-degrade copy.
      ctx.logger?.warn?.('agents.resumeHeartbeat: resume failed', {
        err: (e as Error).message,
      });
      throw e;
    }
  });
}
