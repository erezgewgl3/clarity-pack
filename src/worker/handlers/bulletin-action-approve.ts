// src/worker/handlers/bulletin-action-approve.ts
//
// Plan 03-03 — BULL-03 Approve action handler. Mirrors the shape of
// src/worker/handlers/active-viewer-ping.ts.
//
// The Approve button on a "Requires Your Decision" card invokes this handler
// with {issueId, companyId, userId}. Before mutating, the handler re-fetches
// the issue via ctx.issues.get and confirms `assigneeUserId === userId`
// (T-03-16 — never trust the UI-supplied issueId; a tampered request that
// approves someone else's issue is rejected with {error:'NOT_OWNED'}).
//
// SDK NOTE (deviation_protocol #1, RESOLVED): @paperclipai/plugin-sdk@2026.512.0
// PluginIssuesClient.update has signature `update(issueId, patch, companyId)`
// and the patch type only accepts Pick<Issue, "title"|"description"|"status"|
// "priority"|...> — there is NO `resolution` field. The plan text assumed
// `{resolution:'approved'}`. The host's status enum is the available
// resolution mechanism: an approved decision moves the blocked issue to
// status 'done'. We use `update(issueId, {status:'done'}, companyId)`. This
// is the documented working contract; Plan 03-04 may layer a clarity-namespace
// audit row if a richer approved/declined distinction is needed.
//
// Wrapped with opt-in-guard.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type BulletinActionApproveCtx = OptInGuardActionCtx & {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export function registerBulletinActionApprove(ctx: BulletinActionApproveCtx): void {
  wrapActionHandler(ctx, 'bulletin.action.approve', async (params) => {
    const issueId =
      typeof params?.issueId === 'string' && params.issueId ? params.issueId : null;
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!issueId) throw new Error('bulletin.action.approve: issueId required');
    if (!companyId) throw new Error('bulletin.action.approve: companyId required');
    if (!userId) throw new Error('bulletin.action.approve: userId required');

    // T-03-16 — re-verify the viewer owns the issue before mutating.
    let issue: { assigneeUserId?: string | null } | null;
    try {
      issue = (await ctx.issues.get(issueId, companyId)) as {
        assigneeUserId?: string | null;
      } | null;
    } catch (e) {
      ctx.logger?.warn?.('bulletin.action.approve: issues.get failed', {
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
      ctx.logger?.warn?.('bulletin.action.approve: issues.update failed', {
        issueId,
        err: (e as Error).message,
      });
      return { error: 'UPDATE_FAILED' };
    }

    return { ok: true };
  });
}
