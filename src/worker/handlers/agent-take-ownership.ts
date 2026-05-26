// src/worker/handlers/agent-take-ownership.ts
//
// Phase 6.1 ROOM-09 -- agent.takeOwnership action handler.
//
// Closes the rc.8 Phase B Playwright drill finding: Situation Room Critical
// Path rows render impotent "Agent has no owner assigned" terminals because
// the chain leaf agents come back with `userId === '__unowned__'`. The fix
// is at the leaf, NOT in the chain walk (src/shared/blocker-chain.ts ships
// byte-identical). This handler persists an operator-claimed agent owner
// into the plugin-namespace clarity_agent_owners side table; the snapshot
// recompute job's lookup-map build consults that table FIRST.
//
// Pattern source: src/worker/handlers/chat-promote.ts (T-04-16 viewer-
// authority re-check pattern from Plan 04-04). The handler re-verifies the
// caller server-side BEFORE the write:
//   1. opt-in-guard wrap rejects opted-out callers with OPT_IN_REQUIRED.
//   2. T-06.1-01: handler refuses any request where ownerUserId !== userId.
//      No "claim on behalf of" path in v1.0; viewer can only claim FOR
//      themselves.
//   3. T-06.1-02: ctx.agents.get(agentId, companyId) is the company-scoped
//      viewer-authority gate. The host returns null when the agent does
//      not exist in the caller's company -- treat as NOT_FOUND.
//
// CTT-07 invariant BY CONSTRUCTION: this handler NEVER mutates the host
// issue surface. Every write targets plugin_clarity_pack_cdd6bda4bd via
// ctx.db.execute through the typed repo. The invariant is pinned at two
// levels (defense-in-depth):
//   - Runtime spy (Test 10 in agent-take-ownership.test.mjs) asserts
//     ctx._issueUpdateCalls.length === 0 across every code path.
//   - Source-grep companion test (test/ctt07/agent-take-ownership-no-
//     issue-update.test.mjs) scans this file's source for the literal
//     call site -- comments are stripped before scanning so an
//     explanatory mention does not trip the gate.
//
// Action-handler convention (mirrors chat-promote.ts + chat-topic-archive.ts):
//   - missing required string param  -> THROW with "<key> required"
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapActionHandler -- T-04-15)
//   - ownerUserId !== userId         -> RETURN { error: 'OWNER_MISMATCH' }
//   - ctx.agents.get null            -> RETURN { error: 'NOT_FOUND' }
//   - ctx.agents.get throws          -> RETURN { error: 'OWNERSHIP_FAILED' }
//   - repo failure                   -> RETURN { error: 'OWNERSHIP_FAILED' }
//   - success                        -> RETURN { ok, agentId, ownerUserId, setAt }
//
// Return shape carries the surviving set_at so the UI can render an
// optimistic "claimed at <time>" toast without a second round-trip.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  upsertClarityAgentOwner,
  type ClarityAgentOwnersRepoCtx,
} from '../db/clarity-agent-owners-repo.ts';

export type AgentTakeOwnershipCtx = OptInGuardActionCtx &
  ClarityAgentOwnersRepoCtx & {
    agents: PluginAgentsClient;
    logger?: PluginLogger;
  };

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`agent.takeOwnership: ${key} required`);
}

export function registerAgentTakeOwnership(ctx: AgentTakeOwnershipCtx): void {
  wrapActionHandler(ctx, 'agent.takeOwnership', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const agentId = reqStr(params, 'agentId');
    const ownerUserId = reqStr(params, 'ownerUserId');
    const userId = reqStr(params, 'userId');

    // D-09 / T-06.1-01 -- viewer-authority: the ownerUserId param MUST
    // equal the request's userId. No "claim on behalf of" path in v1.0.
    if (ownerUserId !== userId) {
      return { error: 'OWNER_MISMATCH' as const };
    }

    // T-04-16 / T-06.1-02 -- verify the agent exists in the caller's
    // company. PluginAgentsClient.get(agentId, companyId) returns null
    // when the agentId is not in this company (or does not exist).
    let agent;
    try {
      agent = await ctx.agents.get(agentId, companyId);
    } catch (e) {
      ctx.logger?.warn?.('agent.takeOwnership: agents.get failed', {
        agentId,
        err: (e as Error).message,
      });
      return { error: 'OWNERSHIP_FAILED' as const };
    }
    if (!agent) {
      return { error: 'NOT_FOUND' as const };
    }

    // D-01 flat upsert. ON CONFLICT (agent_id) DO UPDATE -- last write
    // wins. The read-back from upsertClarityAgentOwner returns the
    // surviving row so the toast can render the canonical set_at.
    try {
      const row = await upsertClarityAgentOwner(ctx, {
        agent_id: agentId,
        owner_user_id: ownerUserId,
        company_id: companyId,
        set_at: new Date().toISOString(),
      });
      return {
        ok: true as const,
        agentId,
        ownerUserId,
        setAt: row.set_at,
      };
    } catch (e) {
      ctx.logger?.warn?.('agent.takeOwnership: upsert failed', {
        agentId,
        err: (e as Error).message,
      });
      return { error: 'OWNERSHIP_FAILED' as const };
    }
  });
}
