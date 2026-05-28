// src/worker/handlers/sdk-ref-fetch.ts
//
// Plan 07-01 — shared SDK-based ref resolver used by BOTH worker resolution
// paths (the issue.reader inline fetcher AND the standalone resolve-refs
// handler). It replaces the SSRF-blocked HTTP batch path that Paperclip
// 2026.525.0 rejects (private-IP block + ignored batch filter + stale
// snake_case field mapping where the host key was null so the resolver's byId
// map never matched → chips rendered "BEAAA-NNN · unknown").
//
// Strategy (LOCKED in 07-CONTEXT.md):
//   1. Resolve each unique requested identifier via per-ref
//      `ctx.issues.get(identifier, companyId)` in parallel (`Promise.all`).
//   2. For any identifier `get` returns null for, lazily call
//      `ctx.issues.list({ companyId })` ONCE (cached for this invocation), build
//      an `identifier → Issue` map, and resolve the nulls from it client-side.
//      The SDK `list` has no ids[]/identifier filter, so we match `.identifier`.
//   3. The fallback de-risks the unverified "does host `issues.get` accept a
//      human identifier vs only a UUID" question — the live worker log during
//      the drill is the runtime probe for which path fired.
//
// Each resolved Issue is paired with the REQUESTED identifier so the calling
// fetcher can echo `id = the requested identifier` (the pure
// `resolveRefs()` helper keys its byId map on that). Unresolvable identifiers
// are simply omitted — the pure resolver emits its `unknown` placeholder.

import type { Issue, PluginIssuesClient } from '@paperclipai/plugin-sdk';

/** The subset of the SDK issues client this resolver needs. */
export type SdkRefIssuesClient = Pick<PluginIssuesClient, 'get' | 'list'>;

/** A requested ref identifier paired with the host Issue it resolved to. */
export type ResolvedRef = { requestedId: string; issue: Issue };

/**
 * Resolve `uniqueIds` (deduped requested identifiers) to host Issues via the
 * SDK: per-ref `get` in parallel, then ONE cached `list`-and-match fallback for
 * the nulls. Returns only the resolved pairs (unresolvable ids are omitted).
 *
 * Throws only if `Promise.all(get)` rejects (a get implementation throwing) —
 * the callers wrap this so a resolution failure degrades to an empty refCards
 * list / the `unknown` placeholder rather than blanking the surface.
 */
export async function resolveRefsViaSdk(
  issues: SdkRefIssuesClient,
  uniqueIds: string[],
  companyId: string,
): Promise<ResolvedRef[]> {
  // 1. Per-ref get in parallel. Pair each result with the id we asked for so we
  //    can echo the REQUESTED identifier (not issue.identifier, not issue.id).
  const getResults = await Promise.all(
    uniqueIds.map(async (requestedId) => ({
      requestedId,
      issue: await issues.get(requestedId, companyId),
    })),
  );

  const resolved: ResolvedRef[] = [];
  const nulls: string[] = [];
  for (const { requestedId, issue } of getResults) {
    if (issue) resolved.push({ requestedId, issue });
    else nulls.push(requestedId);
  }

  // 2. list-and-match fallback — only when at least one get returned null.
  //    Cached per-invocation (NOT module scope — freshness over reuse).
  if (nulls.length > 0) {
    let listed: Issue[] = [];
    try {
      listed = await issues.list({ companyId });
    } catch {
      // The fallback is best-effort; an unresolvable id falls through to the
      // pure resolver's `unknown` placeholder.
      listed = [];
    }
    if (listed.length > 0) {
      const byIdentifier = new Map<string, Issue>();
      for (const i of listed) {
        const ident = i.identifier ?? null;
        if (ident && !byIdentifier.has(ident)) byIdentifier.set(ident, i);
      }
      for (const requestedId of nulls) {
        const match = byIdentifier.get(requestedId);
        if (match) resolved.push({ requestedId, issue: match });
      }
    }
  }

  return resolved;
}
