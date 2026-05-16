// src/worker/handlers/bulletin-by-cycle.ts
//
// Plan 03-03 — BULL-03 `bulletin.byCycle` data handler. Mirrors the shape of
// src/worker/handlers/situation-room.ts.
//
// The handler reads a bulletins row, parses `bulletins.draft_json` into a
// typed BulletinDraft (W3/W4 structured-data contract — there is NO markdown
// re-parser; the UI's <Masthead>/<DepartmentSection>/<StandingNumbersPanel>
// receive draft fields as typed props straight from draft_json). It
// composite-fetches the canonical issue body via ctx.issues.get for
// completeness (a fallback display surface, not re-parsed). The Action Inbox
// is computed LIVE (viewer-scoped, T-03-15) so it reflects current issue state
// rather than the draft snapshot.
//
// Wrapped with opt-in-guard — opted-out callers get {error:'OPT_IN_REQUIRED'}.
// companyId + userId come from params (the UI threads them via
// useResolvedCompanyId + useResolvedUserId).

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  getBulletinByCycle,
  listErrataByCycle,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';
import { queryActionInbox, type ActionInboxCtx } from '../bulletin/action-inbox-query.ts';
import type { PluginIssuesClient } from '@paperclipai/plugin-sdk';
import type { BulletinDraft, ErratumEntry } from '../../shared/types.ts';
import type { ErratumRow } from '../db/bulletins-repo.ts';

export type BulletinByCycleCtx = OptInGuardDataCtx &
  BulletinsRepoCtx &
  ActionInboxCtx & {
    issues: PluginIssuesClient;
  };

function mapErratum(row: ErratumRow): ErratumEntry {
  return {
    id: row.id,
    bulletinCycleNumber: row.bulletin_cycle_number,
    addedAt: row.added_at,
    addedByUserId: row.added_by_user_id,
    bodyMd: row.body_md,
    appliedToIssueCommentId: row.applied_to_issue_comment_id,
  };
}

export function registerBulletinByCycle(ctx: BulletinByCycleCtx): void {
  wrapDataHandler(ctx, 'bulletin.byCycle', async (params) => {
    const rawCycle = params?.cycle;
    const cycle: number | 'latest' =
      typeof rawCycle === 'number' ? rawCycle : 'latest';
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;

    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!userId) {
      // Defensive: the opt-in-guard already rejects a missing userId, but if a
      // future exemption changes that, fail loud rather than serve an
      // unscoped Action Inbox.
      return { error: 'USER_ID_REQUIRED' };
    }

    const row = await getBulletinByCycle(ctx, companyId, cycle);
    if (!row || !row.published_issue_id) {
      return { kind: 'not-yet-published' as const };
    }

    // W3/W4 — the verified BulletinDraft was persisted into draft_json by
    // Plan 03-02's publishBulletin. Parse it directly into typed fields.
    const draft = (row.draft_json ?? {}) as Partial<BulletinDraft>;

    // Composite-fetch the canonical markdown body from public.issues (D-16).
    let body: string | null = null;
    try {
      const issue = await ctx.issues.get(row.published_issue_id, companyId);
      body =
        (issue as { description?: string } | null)?.description ?? null;
    } catch (e) {
      ctx.logger?.warn?.('bulletin.byCycle: issues.get failed', {
        companyId,
        err: (e as Error).message,
      });
      body = null;
    }

    // Action Inbox is viewer-scoped — computed live, not from draft_json.
    const actionInbox = await queryActionInbox(ctx, {
      companyId,
      viewerUserId: userId,
    });

    // Errata for this cycle (Plan 03-04 surfaces the UI; the read path is
    // already final here).
    let errata: ErratumEntry[] = [];
    try {
      errata = (await listErrataByCycle(ctx, companyId, row.cycle_number)).map(mapErratum);
    } catch {
      errata = [];
    }

    return {
      kind: 'published' as const,
      cycleNumber: row.cycle_number,
      body,
      publishedIssueId: row.published_issue_id,
      publishedAt: row.published_at,
      masthead: draft.masthead ?? null,
      departments: draft.departments ?? [],
      standingNumbers: draft.standingNumbers ?? [],
      lineageThreads: draft.lineageThreads ?? [],
      actionInbox,
      errata,
    };
  });
}
