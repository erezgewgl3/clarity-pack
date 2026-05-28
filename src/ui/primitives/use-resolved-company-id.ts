// src/ui/primitives/use-resolved-company-id.ts
//
// Plan 02-03c Task 2 — useResolvedCompanyId() hook + URL-parse helper.
//
// Background: Plan 02-03b drill caught useHostContext().companyId returning
// null for detail-tab slots while IssueDetail.tsx's issue query is in flight.
// Empirical evidence: 02-03c-HOST-CONTEXT.md Section 1 — IssueDetail.tsx
// passes {companyId: issue.companyId} to the slot, which is undefined while
// `issue` is undefined. companyPrefix is NEVER passed (always null in the
// slot context). The only viable fallback is URL parsing because App.tsx
// wraps every authenticated page under <Route path=":companyPrefix">.
//
// Resolver chain:
//   1. useHostContext().companyId — when non-null, return immediately.
//   2. Parse useHostLocation().pathname — first non-empty segment is the
//      companyPrefix (e.g. "/COU/issues/COU-4" → "COU").
//   3. Call companies.resolve-prefix worker handler — translates prefix → UUID.
//   4. If anything fails, return {companyId: null, error: 'no-company-context'}.
//
// React hook-rules: usePluginData must be called unconditionally. We always
// call it with the derived prefix (or empty string). When the prefix is
// empty, the worker handler throws "companyPrefix required" and the bridge
// surfaces it as an error — the hook downgrades that to a clean error state.

import { useMemo } from 'react';
import {
  useHostContext,
  useHostLocation,
  usePluginData,
} from '@paperclipai/plugin-sdk/ui/hooks';

// 07-01 — every arm now carries `displayName: string | null`. The chat surface
// renders it (or the URL prefix) instead of the hardcoded literal "BEAAA".
//   - Path 1 (host-context short-circuit) + loading + error → URL prefix (the
//     resolve-prefix handler never runs on these paths, per 07-CONTEXT line 41).
//   - Path 5 (resolver landed) → data.displayName (companies.resolve-prefix
//     already returns it), falling back to the URL prefix.
// NEVER a literal company name.
export type ResolvedCompanyId =
  | { companyId: string; loading: false; error: null; displayName: string | null }
  | { companyId: null; loading: true; error: null; displayName: string | null }
  | { companyId: null; loading: false; error: 'no-company-context'; displayName: string | null };

type ResolvePrefixResult = { companyId: string; displayName: string };

/**
 * Extract the company URL prefix from a pathname.
 *
 * Paperclip's App.tsx route tree wraps every authenticated page under
 * `<Route path=":companyPrefix">` (App.tsx:1845). For Reader/Situation
 * Room/Bulletin/Chat surfaces, the pathname always begins with `/<prefix>/...`.
 *
 * Returns null when the pathname has no first segment (e.g. root `/`,
 * empty string, or whitespace-only). Returned prefix is whitespace-trimmed
 * to match the worker handler's contract.
 */
export function extractCompanyPrefixFromPathname(pathname: string | null | undefined): string | null {
  if (typeof pathname !== 'string') return null;
  const segments = pathname.split('/').map((s) => s.trim()).filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  return first;
}

export function useResolvedCompanyId(): ResolvedCompanyId {
  const { companyId: hostCompanyId } = useHostContext();
  const { pathname } = useHostLocation();
  const derivedPrefix = useMemo(() => extractCompanyPrefixFromPathname(pathname) ?? '', [pathname]);

  // Only fire the worker resolver when we actually need it (host context
  // missing AND we have a prefix to resolve). We still call usePluginData
  // unconditionally to comply with React's rules-of-hooks; passing an empty
  // params object keeps the bridge from issuing useless requests.
  const shouldResolve = !hostCompanyId && derivedPrefix.length > 0;
  const { data, loading, error } = usePluginData<ResolvePrefixResult>(
    'companies.resolve-prefix',
    shouldResolve ? { companyPrefix: derivedPrefix } : {},
  );

  // 07-01 — the URL prefix is the fallback display name on every path where the
  // resolve-prefix handler's displayName is unavailable (host-context
  // short-circuit, loading, error). NEVER a literal.
  const urlPrefix = derivedPrefix || null;

  // Path 1 — host context already has a UUID. Short-circuit (resolve-prefix
  // never runs here, so displayName falls back to the URL prefix).
  if (hostCompanyId) {
    return { companyId: hostCompanyId, loading: false, error: null, displayName: urlPrefix };
  }

  // Path 2 — no prefix available (root URL, settingsPage on a company-less
  // route, etc.). Surface the error immediately; UI must render a placeholder.
  if (!derivedPrefix) {
    return { companyId: null, loading: false, error: 'no-company-context', displayName: null };
  }

  // Path 3 — resolver in flight.
  if (loading) {
    return { companyId: null, loading: true, error: null, displayName: urlPrefix };
  }

  // Path 4 — resolver failed.
  if (error || !data?.companyId) {
    return { companyId: null, loading: false, error: 'no-company-context', displayName: urlPrefix };
  }

  // Path 5 — resolver landed (companies.resolve-prefix returns displayName).
  return {
    companyId: data.companyId,
    loading: false,
    error: null,
    displayName: data.displayName ?? urlPrefix,
  };
}
