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

// HOTFIX v1.4.3 (incident 2026-06-03) — the fake-issue-ID lookup flood.
//
// The OLD strategy did a per-ref `issues.get(token)` for EVERY requested token,
// then a list-fallback for the nulls. The Reader/Editor ref extractor uses a
// broad `\b[A-Z][A-Z0-9]{1,7}-\d+\b` pattern that matches plain prose tokens
// (TIER-2, DRAFT-2, PHASE-1, ADR-0017, AG-1, DAY-80, SHA-256). Every one of
// those hit the host as `GET /issues/<token>` → 404. On BEAAA: ~4,192 wasted
// 404 DB lookups (~21% of all host requests), continuous.
//
// The fix: derive the set of REAL issue prefixes for the company from a single
// `issues.list` (cached, short-TTL), and only `get` a token whose prefix is one
// of them. An unknown-prefix token costs ZERO host calls and falls through to
// the pure resolver's `unknown` placeholder — identical UX to the prior 404.
// Instance-agnostic: the prefix set is DERIVED, never hardcoded.

/** Extract the `<PREFIX>` of a canonical `<PREFIX>-<digits>` identifier, else null. */
function prefixOf(identifier: string | null | undefined): string | null {
  if (typeof identifier !== 'string') return null;
  const m = /^([A-Z][A-Z0-9]{1,7})-\d+$/.exec(identifier.trim());
  return m ? m[1] : null;
}

/** Per-company cache of the real issue-prefix set. Prefixes are stable, so a
 *  generous TTL is safe and keeps the gate cheap across rapid Reader polls. */
const PREFIX_CACHE_TTL_MS = 5 * 60 * 1000;
const prefixCache = new Map<string, { prefixes: Set<string>; expiresAt: number }>();

/** Test-only: reset the module prefix cache between cases. */
export function __resetRefPrefixCache(): void {
  prefixCache.clear();
}

/**
 * Resolve the set of real issue prefixes for a company (cache-or-list). An
 * empty/failed list is NOT cached (so a transient failure cannot poison the
 * gate and block resolution); the caller treats an empty set as "unknown — fall
 * back to legacy resolve-everything for this batch only".
 */
async function getValidPrefixes(
  issues: SdkRefIssuesClient,
  companyId: string,
  nowMs: number,
): Promise<Set<string>> {
  const cached = prefixCache.get(companyId);
  if (cached && cached.expiresAt > nowMs) return cached.prefixes;
  let listed: Issue[] = [];
  try {
    listed = await issues.list({ companyId });
  } catch {
    listed = [];
  }
  const prefixes = new Set<string>();
  for (const i of listed) {
    const p = prefixOf(i.identifier ?? null);
    if (p) prefixes.add(p);
  }
  if (prefixes.size > 0) {
    prefixCache.set(companyId, { prefixes, expiresAt: nowMs + PREFIX_CACHE_TTL_MS });
  }
  return prefixes;
}

/**
 * Resolve `uniqueIds` (deduped requested identifiers) to host Issues via the
 * SDK. v1.4.3: PREFIX-GATED — only tokens whose prefix is a real company prefix
 * are fetched via per-ref `get` (in parallel); unknown-prefix tokens get zero
 * host calls. A list-and-match fallback covers valid-prefix tokens missing from
 * the (possibly paginated) list page. Returns only the resolved pairs.
 *
 * Throws only if `Promise.all(get)` rejects — callers wrap this so a resolution
 * failure degrades to the `unknown` placeholder rather than blanking the surface.
 */
export async function resolveRefsViaSdk(
  issues: SdkRefIssuesClient,
  uniqueIds: string[],
  companyId: string,
): Promise<ResolvedRef[]> {
  if (uniqueIds.length === 0) return [];

  const nowMs = Date.now();
  const validPrefixes = await getValidPrefixes(issues, companyId, nowMs);

  // Gate: only attempt to resolve tokens whose prefix actually exists on this
  // instance. If we could not derive ANY prefixes (empty/failed list), fall back
  // to legacy resolve-everything for THIS batch only (bounded by uniqueIds.length;
  // self-heals on the next populated list) rather than silently disabling refs.
  const idsToResolve =
    validPrefixes.size === 0
      ? uniqueIds
      : uniqueIds.filter((id) => {
          const p = prefixOf(id);
          return p !== null && validPrefixes.has(p);
        });

  if (idsToResolve.length === 0) return [];

  // 1. Per-ref get in parallel (now only for plausible refs). Pair each result
  //    with the requested id so the caller can echo the REQUESTED identifier.
  const getResults = await Promise.all(
    idsToResolve.map(async (requestedId) => ({
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

  // 2. list-and-match fallback — only when a valid-prefix get returned null
  //    (pagination/get-shape gap). Best-effort; an unresolvable id falls through
  //    to the pure resolver's `unknown` placeholder.
  if (nulls.length > 0) {
    let listed: Issue[] = [];
    try {
      listed = await issues.list({ companyId });
    } catch {
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
