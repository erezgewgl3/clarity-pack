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
      };
    }
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      ownerUserId: r.ownerUserId,
      excerpt: r.bodyExcerptForViewer, // PRIM-02: null = permission denied
      url: r.url,
    };
  });
}
