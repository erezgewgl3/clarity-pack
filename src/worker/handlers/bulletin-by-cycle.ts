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
import type { Company, PluginIssuesClient } from '@paperclipai/plugin-sdk';
import type { BulletinDraft, ErratumEntry } from '../../shared/types.ts';
import type { ErratumRow } from '../db/bulletins-repo.ts';
// View-driven rework (2026-05-28) — the scheduled compile-bulletin job's
// invocation scope is dead on paperclipai@2026.525.0 (PR #6547), so it can never
// CONSUME a ready compile result. byCycle runs in a valid HTTP-request scope and
// is polled by the open Bulletin page, so it advances any pending compile here
// (RESUME → publish). A force START is kicked off by the compileNow action.
import {
  resumePendingCompile,
  resolveBulletinTz,
  type CompileBulletinCtx,
} from '../jobs/compile-bulletin.ts';
// Plan 07-05 (Phase 7 ITEM 5) — read-time lineage FILTER + GLOSS + enrichment.
// The filter (routine + dups dropped) and the per-thread gloss run HERE in the
// valid request scope (NOT the scope-dead compile-bulletin job), mirroring the
// existing resume step above. Each survivor is enriched with identifier +
// ownerAgentId from ctx.issues.get (NO_UUID_LEAK — the UUID is the chat-link
// target only, never rendered as text).
import { filterLineageThreads } from '../bulletin/lineage-filter.ts';
import { driveBulletinGlossStep, type BulletinGlossCtx } from '../bulletin/bulletin-gloss.ts';
import type { LineageThread } from '../../shared/types.ts';

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

    // View-driven compile advance (cycle 'latest' only — the live view).
    // RESUME-ONLY: if a pending compile exists (started by the compileNow
    // action), poll + publish in THIS valid request scope; otherwise a
    // cheap no-op (no START, no bootstrap side effects). Best-effort — never
    // fail the read on a compile hiccup. (The scheduled job's scope is dead —
    // PR #6547, so it can't consume the result; the open page does it here.)
    if (cycle === 'latest') {
      try {
        const driveCtx = ctx as unknown as CompileBulletinCtx;
        await resumePendingCompile(driveCtx, { id: companyId } as Company, {
          now: new Date(),
          bulletinTz: await resolveBulletinTz(driveCtx),
          force: false,
        });
      } catch (e) {
        ctx.logger?.warn?.('bulletin.byCycle: compile-advance step failed', {
          companyId,
          err: (e as Error).message,
        });
      }
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

    // Plan 07-05 — read-time lineage FILTER + enrichment + GLOSS (all
    // best-effort; a hiccup NEVER fails the bulletin read).
    //   1. FILTER — drop routine/scheduled + exact-dup threads (D-I5-01).
    //   2. ENRICH — resolve each survivor's human identifier + ownerAgentId from
    //      ctx.issues.get (deduped, parallel; a thrown/absent get → nulls). The
    //      UUID is carried ONLY as ownerAgentId (the chat-link target) — the
    //      open-issue link uses the human identifier (NO_UUID_LEAK).
    //   3. GLOSS — compile a one-line plain-English gloss per survivor in THIS
    //      valid request scope (the gloss step is paused-aware + never throws).
    const driveCtx = ctx as unknown as CompileBulletinCtx;
    let lineageThreads: LineageThread[] = filterLineageThreads(
      (draft.lineageThreads ?? []) as LineageThread[],
    );

    // Enrich (dedupe distinct entityIds; resolve in parallel; degrade to null).
    try {
      const distinctEntityIds = [
        ...new Set(lineageThreads.map((t) => t.entityId).filter((id): id is string => !!id)),
      ];
      const enrichMap = new Map<string, { identifier: string | null; ownerAgentId: string | null }>();
      await Promise.all(
        distinctEntityIds.map(async (entityId) => {
          try {
            const issue = (await ctx.issues.get(entityId, companyId)) as {
              identifier?: string | null;
              assigneeAgentId?: string | null;
              assigneeUserId?: string | null;
            } | null;
            enrichMap.set(entityId, {
              identifier: issue?.identifier ?? null,
              ownerAgentId: issue?.assigneeAgentId ?? issue?.assigneeUserId ?? null,
            });
          } catch {
            enrichMap.set(entityId, { identifier: null, ownerAgentId: null });
          }
        }),
      );
      lineageThreads = lineageThreads.map((t) => {
        const e = enrichMap.get(t.entityId) ?? { identifier: null, ownerAgentId: null };
        return { ...t, identifier: e.identifier, ownerAgentId: e.ownerAgentId };
      });
    } catch (e) {
      ctx.logger?.warn?.('bulletin.byCycle: lineage enrichment failed', {
        companyId,
        err: (e as Error).message,
      });
    }

    // Gloss (view-driven, valid scope). A throw/paused/unavailable → gloss:null.
    try {
      const glossed = await driveBulletinGlossStep(driveCtx as unknown as BulletinGlossCtx, {
        companyId,
        cycleNumber: row.cycle_number,
        threads: lineageThreads,
      });
      lineageThreads = glossed.threads;
    } catch (e) {
      ctx.logger?.warn?.('bulletin.byCycle: gloss step failed — rendering without glosses', {
        companyId,
        err: (e as Error).message,
      });
      lineageThreads = lineageThreads.map((t) => ({ ...t, gloss: null }));
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
      lineageThreads,
      actionInbox,
      errata,
    };
  });
}
