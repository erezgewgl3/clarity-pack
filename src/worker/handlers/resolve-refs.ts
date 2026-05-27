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
//
// Plan 05-05 Task 2 (D-08 + D-09) — payload extended with:
//   - descriptionExcerpt: first line of body, truncated to 120 chars with
//     ellipsis; null when _viewer_can_read is false (PRIM-02 viewer gate
//     inherited). Server-side truncation = central byte budget; ~120 bytes
//     per ref.
//   - ownerName: resolved via ctx.agents.get(ownerUserId, companyId) when
//     present; null on degrade. NEVER falls back to the UUID (NO_UUID_LEAK,
//     mirrors the chat-open-for-issue.ts D9 pattern).
//
// PRIM-01 single-round-trip contract preserved: ONE ctx.http.fetch call per
// handler invocation. The ctx.agents.get calls are POST-fetch enrichment
// inside the same handler call, batched across distinct owner UUIDs (dedup
// before iteration so N refs with M ≤ N distinct owners yield M agents.get
// calls, not M*N).

import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';

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

/** Plan 05-05 D-09 — first-line description excerpt cap. Worker-side
 *  truncation keeps the per-render byte budget bounded centrally. */
const DESC_EXCERPT_MAX = 120;

function truncateExcerpt(body: string | undefined, max = EXCERPT_MAX): string {
  if (!body) return '';
  if (body.length <= max) return body;
  // Truncate at the nearest word boundary <= max - 1 (room for the ellipsis).
  const slice = body.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

/** Plan 05-05 D-09 — first-line-only excerpt: split on \n, take index 0,
 *  trim, apply 120-char cap with ellipsis. No word-boundary preference —
 *  the line is short enough that mid-word truncation is acceptable. */
export function firstLineExcerpt(body: string | undefined): string | null {
  if (!body) return null;
  const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;
  if (firstLine.length <= DESC_EXCERPT_MAX) return firstLine;
  return firstLine.slice(0, DESC_EXCERPT_MAX - 1) + '…';
}

// Plan 02-04 Task 1 — Ctx composed from OptInGuardDataCtx (real SDK shape).
// `host` is intentionally NOT typed here: PluginContext has no `host` field
// (02-03b-API-SHAPES.md §5). Callers must pass `companyId` in the params;
// the legacy `ctx.host?.currentCompanyId` access path is preserved at
// runtime ONLY for back-compat (it always resolves to undefined and falls
// through to the params-path or the unknown-fallback below).
//
// Plan 05-05 Task 2 (D-09) — adds the agents client so the handler can
// resolve owner display names server-side (NO_UUID_LEAK). Older fixtures
// that constructed a ResolveRefsCtx without `agents` still type-check
// because we narrow at runtime via `typeof ctx.agents?.get === 'function'`
// and degrade to ownerName: null when absent.
export type ResolveRefsCtx = OptInGuardDataCtx & {
  // Legacy optional host (always undefined under SDK 2026.512.0). Kept for
  // test fixtures that still set it; new callers should use params.companyId.
  host?: { currentCompanyId?: string };
  http: {
    fetch(url: string, init?: { method?: string }): Promise<{
      json(): Promise<RawHostIssue[]>;
    }>;
  };
  agents?: Pick<PluginAgentsClient, 'get'>;
  logger?: PluginLogger;
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
      // a confusing 500 on the bridge. Plan 05-05 — peek fields are null on
      // this unknown-fallback path.
      return ids.map((id: string) => ({
        id,
        title: 'unknown',
        status: 'unknown' as const,
        ownerUserId: null,
        excerpt: null,
        url: '',
        descriptionExcerpt: null,
        ownerName: null,
      }));
    }
    return await resolveRefs(ids, async (uniqueIds: string[]) => {
      // 2026-05-27 BEAAA hotfix — paperclipai@2026.525.0 added URL-shape
      // validation to ctx.http.fetch: relative paths now throw
      // "Invalid URL: /api/companies/..." JsonRpcCallError. The earlier
      // implementation relied on the host wrapper resolving relative paths
      // against its own base URL; that contract is gone in 2026.525.0.
      // Fix: prepend the absolute base URL from PAPERCLIP_API_URL env (set
      // by the host on worker spawn), falling back to localhost:3100 (the
      // documented default).
      const apiBase = (
        (typeof process !== 'undefined' && process.env?.PAPERCLIP_API_URL) ||
        'http://localhost:3100'
      ).replace(/\/+$/, '');
      const url = `${apiBase}/api/companies/${encodeURIComponent(companyId)}/issues?ids=${uniqueIds
        .map(encodeURIComponent)
        .join(',')}`;
      const resp = await ctx.http.fetch(url, { method: 'GET' });
      const issues = (await resp.json()) as RawHostIssue[];

      // Plan 05-05 D-09 — POST-fetch enrichment. PRIM-01 single-round-trip
      // preserved: the ONE ctx.http.fetch call above is the only host
      // round-trip; the ctx.agents.get calls below are local enrichment
      // inside the same handler invocation. Dedupe owner UUIDs across the
      // batch so a quadratic agents.get storm cannot fire — N refs with M
      // distinct owners → M agents.get calls (not M*N).
      const ownerNamesByUuid = new Map<string, string | null>();
      if (typeof ctx.agents?.get === 'function') {
        const distinctOwners = Array.from(
          new Set(
            issues
              .map((i) => (typeof i.assignee_user_id === 'string' && i.assignee_user_id ? i.assignee_user_id : null))
              .filter((u): u is string => u !== null),
          ),
        );
        for (const ownerUuid of distinctOwners) {
          try {
            const agent = await ctx.agents.get(ownerUuid, companyId);
            if (agent && typeof (agent as { name?: unknown }).name === 'string') {
              const candidate = (agent as { name: string }).name.trim();
              ownerNamesByUuid.set(ownerUuid, candidate || null);
            } else {
              ownerNamesByUuid.set(ownerUuid, null);
            }
          } catch (e) {
            // Plan 05-05 D-09 — degrade silently to null on agents.get throw.
            // NEVER fall back to the UUID; the UI's NO_UUID_LEAK guarantee
            // depends on this.
            ctx.logger?.warn?.('resolve-refs: agents.get failed', {
              companyId,
              ownerUuid,
              err: (e as Error).message,
            });
            ownerNamesByUuid.set(ownerUuid, null);
          }
        }
      }

      return issues.map((i) => ({
        id: i.key,
        title: i.title,
        status: i.status,
        ownerUserId: i.assignee_user_id,
        bodyExcerptForViewer: i._viewer_can_read === false ? null : truncateExcerpt(i.body),
        url: `/issues/${i.key}`,
        // Plan 05-05 D-09 — first-line description excerpt, viewer-gated by
        // the SAME _viewer_can_read field the legacy excerpt honours.
        descriptionExcerpt: i._viewer_can_read === false ? null : firstLineExcerpt(i.body),
        // Plan 05-05 D-09 — server-resolved owner display name. Null when
        // ownerUserId is null OR when ctx.agents.get degraded above.
        ownerName: i.assignee_user_id
          ? (ownerNamesByUuid.get(i.assignee_user_id) ?? null)
          : null,
      }));
    });
  });
}
