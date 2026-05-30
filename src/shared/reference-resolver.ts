// src/shared/reference-resolver.ts
//
// Plan 02-02 Task 1 — PRIM-01 (single round-trip for N refs) + PRIM-02
// (viewer-permission excerpt forwarding). Pure function over a fetcher; the
// worker handler in src/worker/handlers/resolve-refs.ts supplies the fetcher
// closed over ctx.http.fetch.

import type { RefCardData } from './types.ts';

export type RefResolverFetcher = (ids: string[]) => Promise<
  Array<{
    id: string;
    title: string;
    status: RefCardData['status'];
    ownerUserId: string | null;
    bodyExcerptForViewer: string | null; // null means viewer can't see this ref
    url: string;
    // Plan 05-05 Task 2 (D-09) — peek-card fields. Optional so legacy fetchers
    // still type-check; the worker handler always populates them.
    descriptionExcerpt?: string | null;
    ownerName?: string | null;
    // Plan 250530 v1.1.5 — opt-in chip-render gate (resolve-refs sets it for
    // clarity-pack internal operation issues). Forwarded verbatim to RefCardData.
    hiddenAsRef?: boolean;
  }>
>;

export async function resolveRefs(
  ids: string[],
  fetcher: RefResolverFetcher,
): Promise<RefCardData[]> {
  if (ids.length === 0) return [];
  // Dedupe BEFORE the fetch so PRIM-01 holds: one round-trip per unique-id set.
  const unique = Array.from(new Set(ids));
  const fetched = await fetcher(unique);
  const byId = new Map(fetched.map((r) => [r.id, r]));
  // Preserve input order (including duplicates) — callers may pass duplicates
  // intentionally to render the same ref-chip in two places.
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r) {
      // Missing ID — return an unknown placeholder rather than throwing.
      // Refs may be deleted between when they were stored and when they
      // were resolved; the surface should render "unknown" not crash.
      return {
        id,
        title: 'unknown',
        status: 'unknown' as const,
        ownerUserId: null,
        excerpt: null,
        url: '',
        // Plan 05-05 Task 2 (D-09) — peek fields stay null on the unknown
        // placeholder. UI peek section conditionally renders on presence.
        descriptionExcerpt: null,
        ownerName: null,
      };
    }
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      ownerUserId: r.ownerUserId,
      excerpt: r.bodyExcerptForViewer, // PRIM-02: null = permission denied
      url: r.url,
      // Plan 05-05 Task 2 (D-09) — forward the new peek-card fields. The
      // fetcher (resolve-refs.ts handler) is the source of truth; if it
      // didn't populate them they propagate as undefined which the UI
      // consumer tolerates.
      descriptionExcerpt: r.descriptionExcerpt ?? null,
      ownerName: r.ownerName ?? null,
      // Plan 250530 v1.1.5 — forward the chip-render gate.
      hiddenAsRef: r.hiddenAsRef ?? false,
    };
  });
}
