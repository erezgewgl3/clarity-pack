// src/worker/handlers/resolve-refs.ts
//
// Plan 02-02 Task 1 — worker handler that exposes resolveRefs (PRIM-01) over
// the plugin bridge. UI calls usePluginData('resolve-refs', { ids: [...] });
// this handler invokes the pure resolver from src/shared/reference-resolver.ts.
//
// 07-01 — resolution rewritten to the SDK (mirrors issue-reader.ts; shared
// resolver in sdk-ref-fetch.ts). The old SSRF-blocked HTTP batch path is GONE:
// Paperclip 2026.525.0 blocks private-IP fetches, ignored the batch filter, and
// the stale snake_case field mapping read a null host key so the resolver byId
// map never matched → chips rendered "BEAAA-NNN · unknown". Now: resolve each
// unique ref via per-ref `ctx.issues.get(identifier, companyId)` in parallel,
// with ONE cached `ctx.issues.list({companyId})`-and-match-on-`.identifier`
// fallback for nulls. The fetcher echoes `id = the requested identifier` so
// byId.get(ref) hits. PRIM-01 is now "one fetcher invocation at the resolveRefs
// boundary" — per-ref `get` is N parallel calls inside that single invocation.
//
// Plan 05-05 Task 2 (D-08 + D-09) — payload extended with:
//   - descriptionExcerpt: first line of i.description, truncated to 120 chars
//     with ellipsis. Server-side truncation = central byte budget.
//   - ownerName: resolved via ctx.agents.get(assigneeUserId, companyId) when
//     present; null on degrade. NEVER falls back to the UUID (NO_UUID_LEAK,
//     mirrors the chat-open-for-issue.ts D9 pattern).
//
// The ctx.agents.get calls are POST-resolution enrichment inside the same
// handler call, batched across distinct owner UUIDs (dedup before iteration so
// N refs with M ≤ N distinct owners yield M agents.get calls, not M*N).

import type { PluginAgentsClient, PluginLogger, PluginIssuesClient } from '@paperclipai/plugin-sdk';

import type { RefCardData } from '../../shared/types.ts';
import { resolveRefs } from '../../shared/reference-resolver.ts';
import { resolveRefsViaSdk } from './sdk-ref-fetch.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

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
// `host` is intentionally NOT typed for resolution: PluginContext has no `host`
// field (02-03b-API-SHAPES.md §5). Callers must pass `companyId` in the params;
// the legacy `ctx.host?.currentCompanyId` access path is preserved at runtime
// ONLY for back-compat (it always resolves to undefined and falls through to
// the params-path or the unknown-fallback below).
//
// 07-01 — resolution moved to the SDK. The `http` member is REMOVED from the
// type so the dead HTTP batch fetch path is un-typeable; `issues` (get + list)
// is added. Plan 05-05 Task 2 (D-09) `agents` client stays so the handler can
// resolve owner display names server-side (NO_UUID_LEAK). Older fixtures that
// constructed a ResolveRefsCtx without `agents` still type-check because we
// narrow at runtime via `typeof ctx.agents?.get === 'function'` and degrade to
// ownerName: null when absent.
export type ResolveRefsCtx = OptInGuardDataCtx & {
  // Legacy optional host (always undefined under SDK 2026.512.0). Kept for
  // test fixtures that still set it; new callers should use params.companyId.
  host?: { currentCompanyId?: string };
  issues: Pick<PluginIssuesClient, 'get' | 'list'>;
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
      // Caller must provide companyId (params, or legacy host context). Without
      // it there is no scoped resolution. Returning the empty-input shape avoids
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
      // 07-01 — resolve via the shared SDK resolver: per-ref
      // ctx.issues.get(identifier, companyId) in parallel + a cached
      // ctx.issues.list({companyId})-and-match-on-.identifier fallback. The
      // SSRF-blocked HTTP batch path is gone. Each resolved Issue is paired with
      // the REQUESTED identifier so the row's `id` echoes it (byId.get hits).
      // An unresolvable id is simply omitted → reference-resolver emits its
      // `unknown` placeholder (we do NOT synthesize a fake row).
      const resolved = await resolveRefsViaSdk(ctx.issues, uniqueIds, companyId);

      // Plan 05-05 D-09 — POST-resolution enrichment. PRIM-01 preserved: the
      // single resolveRefsViaSdk call above is the resolution boundary; the
      // ctx.agents.get calls below are local enrichment inside the same handler
      // invocation. Dedupe owner UUIDs so a quadratic agents.get storm cannot
      // fire — N refs with M distinct owners → M agents.get calls (not M*N).
      // The owner UUID is read from the REAL camelCase field i.assigneeUserId.
      const ownerNamesByUuid = new Map<string, string | null>();
      if (typeof ctx.agents?.get === 'function') {
        const distinctOwners = Array.from(
          new Set(
            resolved
              .map(({ issue: i }) =>
                typeof i.assigneeUserId === 'string' && i.assigneeUserId ? i.assigneeUserId : null,
              )
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

      return resolved.map(({ requestedId, issue: i }) => {
        const ownerUserId = i.assigneeUserId ?? null;
        // 07-01 — the SDK Issue has no viewer-readable flag. A non-null
        // ctx.issues.get result is treated as readable-by-caller (the SDK
        // proxies the caller's auth context). The live drill confirms whether
        // `get` enforces viewer perms server-side (07-CONTEXT open item); if it
        // does NOT, a follow-up gates excerpts. The excerpt reads i.description.
        return {
          id: requestedId,
          title: i.title,
          status: i.status as RefCardData['status'],
          ownerUserId,
          bodyExcerptForViewer: truncateExcerpt(i.description ?? undefined) || null,
          url: `/issues/${requestedId}`,
          // Plan 05-05 D-09 — first-line description excerpt.
          descriptionExcerpt: firstLineExcerpt(i.description ?? undefined),
          // Plan 05-05 D-09 — server-resolved owner display name. Null when
          // ownerUserId is null OR when ctx.agents.get degraded above.
          ownerName: ownerUserId ? (ownerNamesByUuid.get(ownerUserId) ?? null) : null,
        };
      });
    });
  });
}
