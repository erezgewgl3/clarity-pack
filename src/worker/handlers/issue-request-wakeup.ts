// src/worker/handlers/issue-request-wakeup.ts
//
// Plan 09-02 (R4) — `issues.requestWakeup` action: the "Wake" write path for a
// blocked-but-OWNED Situation Room row.
//
// The blocked-owned row surfaces [Open chat: <owner>] + [Wake] + [Open]. The
// SPEC (R4) names Wake as `requestWakeup`. Phase 8 had no Wake affordance at
// all; this handler makes the cockpit's Wake button a real action rather than a
// dead/no-op button (R4 — no dead buttons).
//
// It nudges the owner agent's focus issue so the host re-wakes it now instead
// of waiting for the next heartbeat tick. ctx.issues.requestWakeup is the same
// primitive chat-send.ts + agent-task-delivery.ts already use; the capability
// `issues.wakeup` is already declared in the manifest (no new capability, no
// version bump).
//
// SIGNATURE — `issueId` (the focus / leaf issue to wake) + `companyId` are
// required. The handler passes a fixed reason + an idempotencyKey derived from
// the issue id so repeated clicks coalesce.
//
// FAILURE CONTRACT — THROW, do not return {error}. requestWakeup is unreliable
// on paperclipai@2026.525.0 (30s timeout / 404 on some shapes — see chat-send
// notes). The UI caller treats a thrown/rejected action as the graceful-degrade
// path (toast: "wake requested — verify on the agent page"); a returned {error}
// would resolve the promise and falsely show success. On the happy path it
// resolves { ok, issueId }.
//
// Opt-in gated via wrapActionHandler — an opted-out / userId-less caller gets
// { error: 'OPT_IN_REQUIRED' } before this body runs.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type IssueRequestWakeupCtx = OptInGuardActionCtx & {
  issues: Pick<PluginIssuesClient, 'requestWakeup'>;
  logger?: PluginLogger;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`issues.requestWakeup: ${key} required`);
}

export function registerIssueRequestWakeup(ctx: IssueRequestWakeupCtx): void {
  wrapActionHandler(ctx, 'issues.requestWakeup', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const issueId = reqStr(params, 'issueId');

    try {
      await ctx.issues.requestWakeup(issueId, companyId, {
        reason: 'situation-room: operator wake',
        idempotencyKey: `situation-wake-${issueId}`,
      });
      return { ok: true as const, issueId };
    } catch (e) {
      // Re-throw so the UI caller's catch fires its graceful-degrade copy.
      ctx.logger?.warn?.('issues.requestWakeup: wake failed', {
        issueId,
        err: (e as Error).message,
      });
      throw e;
    }
  });
}
