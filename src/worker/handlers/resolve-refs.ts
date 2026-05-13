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

export type ResolveRefsCtx = {
  data: {
    register(
      key: string,
      handler: (params: { ids: string[] }) => Promise<RefCardData[]>,
    ): void;
  };
  host?: { currentCompanyId?: string };
  http: {
    fetch(url: string, init?: { method?: string }): Promise<{
      json(): Promise<RawHostIssue[]>;
    }>;
  };
};

export function registerResolveRefs(ctx: ResolveRefsCtx): void {
  ctx.data.register('resolve-refs', async ({ ids }) => {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const companyId = ctx.host?.currentCompanyId;
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
