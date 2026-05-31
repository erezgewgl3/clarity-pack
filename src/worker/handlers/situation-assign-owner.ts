// src/worker/handlers/situation-assign-owner.ts
//
// Plan 09-01 Task 2 (R3 / R4) — situation.assignOwner: the FIRST plugin
// core-issue mutation. The operator assigns an owner to an unowned blocking
// issue directly from a Situation Room row, mutating the REAL Paperclip issue
// via ctx.issues.update (NOT the plugin-namespace side table that
// agent.takeOwnership writes — this is a genuine public.issues assignee write).
//
// AUTHORITY GATE — mirrors agent-take-ownership.ts byte-for-byte in structure:
//   - opt-in-guard wrap rejects opted-out callers with OPT_IN_REQUIRED.
//   - reqStr throws "situation.assignOwner: <key> required" on a missing param.
//   - the AGENT-assign branch calls ctx.agents.get(assigneeAgentId, companyId)
//     as the company-scope viewer-authority gate (host returns null for an
//     agentId outside the caller's company → NOT_FOUND). This rejects a
//     cross-company assigneeAgentId (T-09-01).
//
// ACTOR ATTRIBUTION (T-09-02) — the 4th arg of ctx.issues.update carries the
// operator userId (PluginIssueMutationActor.actorUserId) so the Paperclip
// audit trail attributes the reassignment to the HUMAN operator, never the
// plugin worker. Asserted by the success-path tests.
//
// BRANCHES (exactly one required):
//   - assigneeAgentId present  → ctx.issues.update(leafIssueId,{assigneeAgentId},companyId,actor)
//   - takeItMyself === true    → ctx.issues.update(leafIssueId,{assigneeUserId:userId},companyId,actor)
//                                (D-02 — the SINGLE assigneeUserId path)
//   - neither / both           → { error: 'BAD_REQUEST' }
//
// CLAUDE.md HARD RULE — a core-issue mutation MUST go through the typed
// ctx.issues.* client with actor attribution. NEVER ctx.db (plugin-namespace
// only; cannot touch public.issues). There is exactly one ctx.issues.update
// call site in this file and zero ctx.db calls.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type {
  PluginAgentsClient,
  PluginIssuesClient,
  PluginIssueMutationActor,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type SituationAssignOwnerCtx = OptInGuardActionCtx & {
  issues: Pick<PluginIssuesClient, 'update'>;
  agents: Pick<PluginAgentsClient, 'get'>;
  logger?: PluginLogger;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`situation.assignOwner: ${key} required`);
}

export function registerSituationAssignOwner(ctx: SituationAssignOwnerCtx): void {
  wrapActionHandler(ctx, 'situation.assignOwner', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const leafIssueId = reqStr(params, 'leafIssueId');
    const userId = reqStr(params, 'userId');

    // Branch selection — exactly one of {assigneeAgentId, takeItMyself}.
    const assigneeAgentId =
      typeof params?.assigneeAgentId === 'string' && params.assigneeAgentId
        ? params.assigneeAgentId
        : null;
    const takeItMyself = params?.takeItMyself === true;
    if ((assigneeAgentId == null && !takeItMyself) || (assigneeAgentId != null && takeItMyself)) {
      // Neither selected, or both selected → ambiguous request.
      return { error: 'BAD_REQUEST' as const };
    }

    // ACTOR — carries the operator userId so the audit trail attributes the
    // reassignment to the human (T-09-02). Constructed once; used as the 4th
    // arg of the single ctx.issues.update call below.
    const actor: PluginIssueMutationActor = { actorUserId: userId };

    // Build the patch + the assignedTo echo (returned so the UI toasts without
    // a second round-trip).
    let patch: { assigneeAgentId?: string; assigneeUserId?: string };
    let assignedTo: string;

    if (assigneeAgentId != null) {
      // AGENT-assign — company-scope viewer-authority gate. The host returns
      // null when the agentId is not in the caller's company (or doesn't
      // exist) → NOT_FOUND (rejects a cross-company assigneeAgentId, T-09-01).
      let agent;
      try {
        agent = await ctx.agents.get(assigneeAgentId, companyId);
      } catch (e) {
        ctx.logger?.warn?.('situation.assignOwner: agents.get failed', {
          assigneeAgentId,
          err: (e as Error).message,
        });
        return { error: 'ASSIGN_FAILED' as const };
      }
      if (!agent) {
        return { error: 'NOT_FOUND' as const };
      }
      patch = { assigneeAgentId };
      assignedTo = assigneeAgentId;
    } else {
      // SELF-assign (D-02) — the SINGLE assigneeUserId path. Assigns the leaf
      // to the operator. No agents.get (no agent to verify).
      patch = { assigneeUserId: userId };
      assignedTo = userId;
    }

    try {
      await ctx.issues.update(
        leafIssueId,
        patch as Parameters<PluginIssuesClient['update']>[1],
        companyId,
        actor,
      );
    } catch (e) {
      ctx.logger?.warn?.('situation.assignOwner: issues.update failed', {
        leafIssueId,
        err: (e as Error).message,
      });
      return { error: 'ASSIGN_FAILED' as const };
    }

    return { ok: true as const, leafIssueId, assignedTo };
  });
}
