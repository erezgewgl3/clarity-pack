// src/worker/handlers/bulletin-action-decline.ts
//
// Plan 03-03 — BULL-03 Decline action handler. Mirror of
// bulletin-action-approve.ts under handler key 'bulletin.action.decline'.
//
// SDK NOTE (deviation_protocol #1, RESOLVED): see bulletin-action-approve.ts.
// PluginIssuesClient.update has signature `update(issueId, patch, companyId)`
// and the patch carries no `resolution` field. The plan text assumed
// `{resolution:'declined'}`. The host has no distinct "declined" issue status;
// a declined decision still closes the blocked issue — it moves to status
// 'done' (the human has acted; the blocker is resolved one way or the other).
// Both Approve and Decline therefore set status 'done'; the semantic
// distinction (approved vs declined) is the caller's intent recorded in the
// action key, not a host field. Plan 03-04 may add a clarity-namespace audit
// row if a persisted approved/declined distinction is required.
//
// Wrapped with opt-in-guard. T-03-16 ownership re-verify before mutate.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type BulletinActionDeclineCtx = OptInGuardActionCtx & {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export function registerBulletinActionDecline(ctx: BulletinActionDeclineCtx): void {
  wrapActionHandler(ctx, 'bulletin.action.decline', async (params) => {
    const issueId =
      typeof params?.issueId === 'string' && params.issueId ? params.issueId : null;
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!issueId) throw new Error('bulletin.action.decline: issueId required');
    if (!companyId) throw new Error('bulletin.action.decline: companyId required');
    if (!userId) throw new Error('bulletin.action.decline: userId required');

    // T-03-16 — re-verify the viewer owns the issue before mutating.
    let issue: { assigneeUserId?: string | null } | null;
    try {
      issue = (await ctx.issues.get(issueId, companyId)) as {
        assigneeUserId?: string | null;
      } | null;
    } catch (e) {
      ctx.logger?.warn?.('bulletin.action.decline: issues.get failed', {
        issueId,
        err: (e as Error).message,
      });
      return { error: 'NOT_FOUND' };
    }
    if (!issue || issue.assigneeUserId !== userId) {
      return { error: 'NOT_OWNED' };
    }

    try {
      await ctx.issues.update(
        issueId,
        { status: 'done' } as Parameters<PluginIssuesClient['update']>[1],
        companyId,
      );
    } catch (e) {
      ctx.logger?.warn?.('bulletin.action.decline: issues.update failed', {
        issueId,
        err: (e as Error).message,
      });
      return { error: 'UPDATE_FAILED' };
    }

    return { ok: true };
  });
}
