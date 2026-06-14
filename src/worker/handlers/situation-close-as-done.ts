// src/worker/handlers/situation-close-as-done.ts
//
// Plan 18-03 Task 3 (LEG-03) — situation.closeAsDone: the close mutation behind
// the confirm-gated "Looks done — close it?" affordance. When the AI TL;DR reads
// "done" but the deterministic engine still classifies the item blocked
// (needsYou), the operator may EXPLICITLY confirm "Close as done" — and ONLY then
// does this handler flip the issue's status to 'done' via ctx.issues.update.
//
// CONFIRM-GATED BY CONSTRUCTION (T-18.03-STATE): the UI never dispatches this
// action without the operator's explicit "Close as done" selection (no mount /
// effect auto-close path). This handler is the worker side of that contract; it
// performs exactly one ctx.issues.update({status:'done'}) and nothing else.
//
// STRUCTURAL MIRROR — situation-assign-owner.ts (wrapActionHandler, reqStr, the
// operator-attributed actor, the single ctx.issues.update call, the human key
// logged/echoed only). It REUSES the same privilege boundary the SR assign-owner
// path established (A7): the already-declared issues.update capability, the
// operator userId as the audit actor, the UUID as the mutation id (NEVER the
// human display key — the v1.3.0 BEAAA-43 ASSIGN_FAILED lesson).
//
// NO_UUID_LEAK (T-18.03-I): the close-target issue UUID (leafIssueUuid) is the
// MUTATION id; the human leafIssueId is the only echoed identifier. The host
// validates the UUID server-side on ctx.issues.update.
//
// CLAUDE.md HARD RULE — a core-issue mutation MUST go through the typed
// ctx.issues.* client with actor attribution. NEVER ctx.db (plugin-namespace
// only). Exactly one ctx.issues.update call site; zero ctx.db calls.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type {
  PluginIssuesClient,
  PluginIssueMutationActor,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type SituationCloseAsDoneCtx = OptInGuardActionCtx & {
  issues: Pick<PluginIssuesClient, 'update'>;
  logger?: PluginLogger;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`situation.closeAsDone: ${key} required`);
}

export function registerSituationCloseAsDone(ctx: SituationCloseAsDoneCtx): void {
  wrapActionHandler(ctx, 'situation.closeAsDone', async (params) => {
    const companyId = reqStr(params, 'companyId');
    // Human display key (BEAAA-43) — logged + echoed, NEVER the mutation id.
    const leafIssueId = reqStr(params, 'leafIssueId');
    // The issue UUID — the MUTATION id passed to ctx.issues.update. REQUIRED: the
    // affordance always dispatches it; a missing key is a programming error.
    const leafIssueUuid = reqStr(params, 'leafIssueUuid');
    const userId = reqStr(params, 'userId');

    // ACTOR — carries the operator userId so the audit trail attributes the close
    // to the human (T-09-02 parity).
    const actor: PluginIssueMutationActor = { actorUserId: userId };

    try {
      // Flip to the canonical terminal status via the issue UUID (mirrors the
      // bulletin-action + assign-owner UUID-first-arg pattern).
      await ctx.issues.update(
        leafIssueUuid,
        { status: 'done' } as Parameters<PluginIssuesClient['update']>[1],
        companyId,
        actor,
      );
    } catch (e) {
      // Log the HUMAN key for operator-readable diagnostics (never the UUID).
      ctx.logger?.warn?.('situation.closeAsDone: issues.update failed', {
        leafIssueId,
        err: (e as Error).message,
      });
      return { error: 'CLOSE_FAILED' as const };
    }

    // Echo the HUMAN key for the UI toast — the mutation id (UUID) is never
    // surfaced to the operator.
    return { ok: true as const, leafIssueId };
  });
}
