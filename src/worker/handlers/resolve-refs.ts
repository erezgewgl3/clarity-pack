// src/worker/handlers/resolve-refs.ts
//
// Plan 02-02 Task 1 — worker handler that exposes resolveRefs (PRIM-01) over
// the plugin bridge. UI calls usePluginData('resolve-refs', { ids: [...] });
// this handler closes over ctx.http.fetch + ctx.host.currentCompanyId and
// invokes the pure resolver from src/shared/reference-resolver.ts. PRIM-01
// (single round-trip) is preserved because the fetcher is called once with
// the deduped id list.
//
// Endpoint: /api/companies/<companyId>/issues?ids=BEAAA-1,BEAAA-2 — per the
// Paperclip API-drift fix recorded in runbook/REHEARSAL.md (Plan 01-04
// anomaly: /api/issues moved to /api/companies/{id}/issues sometime
// 2026-05-08..2026-05-13).

import type { RefCardData } from '../../shared/types.ts';
import { resolveRefs } from '../../shared/reference-resolver.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

// Minimal Paperclip-issue shape we consume; the host returns more fields,
// but only these are load-bearing for RefCardData.
type RawHostIssue = {
  key: string;
  title: string;
  status: RefCardData['status'];
  assignee_user_id: string | null;
  body?: string;
  _viewer_can_read?: boolean;
};

const EXCERPT_MAX = 280;

function truncateExcerpt(body: string | undefined, max = EXCERPT_MAX): string {
  if (!body) return '';
  if (body.length <= max) return body;
  // Truncate at the nearest word boundary <= max - 1 (room for the ellipsis).
  const slice = body.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

// Plan 02-04 Task 1 — Ctx composed from OptInGuardDataCtx (real SDK shape).
// `host` is intentionally NOT typed here: PluginContext has no `host` field
// (02-03b-API-SHAPES.md §5). Callers must pass `companyId` in the params;
// the legacy `ctx.host?.currentCompanyId` access path is preserved at
// runtime ONLY for back-compat (it always resolves to undefined and falls
// through to the params-path or the unknown-fallback below).
export type ResolveRefsCtx = OptInGuardDataCtx & {
  // Legacy optional host (always undefined under SDK 2026.512.0). Kept for
  // test fixtures that still set it; new callers should use params.companyId.
  host?: { currentCompanyId?: string };
  http: {
    fetch(url: string, init?: { method?: string }): Promise<{
      json(): Promise<RawHostIssue[]>;
    }>;
  };
};

export function registerResolveRefs(ctx: ResolveRefsCtx): void {
  wrapDataHandler(ctx, 'resolve-refs', async (params) => {
    const rawIds = (params as { ids?: unknown }).ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) return [];
    const ids = rawIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return [];
    const paramCompanyId = typeof (params as { companyId?: unknown }).companyId === 'string'
      ? ((params as { companyId?: string }).companyId as string)
      : undefined;
    const companyId = paramCompanyId || ctx.host?.currentCompanyId;
    if (!companyId) {
      // Caller must provide currentCompanyId via host context; without it
      // there is no resolvable URL. Returning the empty-input shape avoids
      // a confusing 500 on the bridge.
      return ids.map((id: string) => ({
        id,
        title: 'unknown',
        status: 'unknown' as const,
        ownerUserId: null,
        excerpt: null,
        url: '',
      }));
    }
    return await resolveRefs(ids, async (uniqueIds: string[]) => {
      const url = `/api/companies/${encodeURIComponent(companyId)}/issues?ids=${uniqueIds
        .map(encodeURIComponent)
        .join(',')}`;
      const resp = await ctx.http.fetch(url, { method: 'GET' });
      const issues = (await resp.json()) as RawHostIssue[];
      return issues.map((i) => ({
        id: i.key,
        title: i.title,
        status: i.status,
        ownerUserId: i.assignee_user_id,
        bodyExcerptForViewer: i._viewer_can_read === false ? null : truncateExcerpt(i.body),
        url: `/issues/${i.key}`,
      }));
    });
  });
}
