// src/worker/handlers/situation-room.ts
//
// Plan 02-04 Task 2 — situation.snapshot data handler. Returns the most-
// recent materialized snapshot row for the caller's company. The 60s job
// (situation-snapshot.ts) writes; this handler reads.
//
// Wrapped with opt-in-guard so opted-out callers receive
// {error:'OPT_IN_REQUIRED'} (OPTIN-04). companyId comes from params (the
// UI passes via useHostContext or useResolvedCompanyId).
//
// Plan 07-03 Task 2 (Phase 7 ITEM 4) — the situation.snapshot DATA HANDLER is
// a VALID HTTP-request scope (unlike the scope-dead recompute-situation job,
// whose host calls fail every tick on paperclipai@2026.525.0 PR #6547). So the
// ORG-LEVEL blocked-issue backlog is computed HERE, FRESH, on every call and
// ATTACHED to whatever the handler returns (<compute_vs_cache_note>):
//   - if a snapshot row exists → spread it + add org_blocked_backlog;
//   - if NO row exists (the common case — the job is dead) → return a fresh
//     { org_blocked_backlog, taken_at } so the banner renders even with an
//     empty/stale grid.
// The compute is degrade-safe (a thrown builder → an empty backlog, the rest
// of the handler is intact) and viewer-scoped (need_you_count keys on
// params.userId). The opt-in-guard wrap is unchanged.

import type {
  PluginAgentsClient,
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  buildOrgBlockedBacklog,
  type OrgBlockedBacklog,
  type OrgBlockedBacklogCtx,
} from './org-blocked-backlog.ts';

// Plan 07-03 Task 2 — widen the ctx with the SDK clients the org-blocked-
// backlog builder needs (mirror ResolveRefsCtx in resolve-refs.ts:76-83, but
// with 'list' | 'relations' for issues). `agents` stays optional so older
// fixtures without it still type-check; the builder narrows at runtime via
// `typeof ctx.agents?.get === 'function'` and degrades ownerName to null.
export type SituationRoomCtx = OptInGuardDataCtx & {
  issues: Pick<PluginIssuesClient, 'list' | 'relations'>;
  agents?: Pick<PluginAgentsClient, 'get'>;
  logger?: PluginLogger;
};

type SnapshotRow = {
  id: number;
  taken_at: string;
  computed_for_company_id: string;
  payload: unknown;
  content_hash: string;
};

/** The empty backlog shape — used when the builder throws so the rest of the
 *  handler still renders. */
const EMPTY_BACKLOG: OrgBlockedBacklog = {
  rows: [],
  total: 0,
  blocked_count: 0,
  need_you_count: 0,
  overflow: false,
};

export function registerSituationRoomHandlers(ctx: SituationRoomCtx): void {
  wrapDataHandler(ctx, 'situation.snapshot', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) {
      // Fail loud — the UI must thread companyId via useResolvedCompanyId
      // (same pattern as Reader). An empty companyId would silently match no
      // rows; we'd rather surface the bug.
      throw new Error('situation.snapshot: companyId required');
    }

    // Plan 07-03 Task 2 — viewer is the UI-supplied userId (index.tsx:214) so
    // need_you_count is scoped to THIS operator.
    const viewerUserId =
      typeof params?.userId === 'string' && params.userId ? params.userId : '';

    // Compute the org-level blocked backlog FRESH (valid scope). Degrade-safe:
    // a thrown builder leaves the rest of the handler intact.
    let org_blocked_backlog: OrgBlockedBacklog;
    try {
      org_blocked_backlog = await buildOrgBlockedBacklog(
        { issues: ctx.issues, agents: ctx.agents, logger: ctx.logger } as unknown as OrgBlockedBacklogCtx,
        companyId,
        viewerUserId,
      );
    } catch (e) {
      ctx.logger?.warn?.('situation.snapshot: org-blocked-backlog compute failed', {
        companyId,
        err: (e as Error).message,
      });
      org_blocked_backlog = { ...EMPTY_BACKLOG };
    }

    const rows = await ctx.db.query<SnapshotRow>(
      'SELECT id, taken_at, computed_for_company_id, payload, content_hash FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1',
      [companyId],
    );
    const row = rows[0];
    if (!row) {
      // <compute_vs_cache_note> — the dead-job path. No materialized row, but
      // the backlog still rides so the banner renders. Do NOT `return null`
      // (that would swallow the freshly computed backlog).
      return { org_blocked_backlog, taken_at: new Date().toISOString() };
    }
    const payload = row.payload as Record<string, unknown>;
    return { ...payload, org_blocked_backlog, taken_at: row.taken_at };
  });
}
