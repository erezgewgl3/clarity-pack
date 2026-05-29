// src/ui/surfaces/reader/reader-render-state.ts
//
// Scroll-stability fix (2026-05-29). `usePluginData` NULLS its `data` and sets
// `loading=true` for the in-flight window of EVERY refresh() — not just the
// initial load (SDK PluginDataResult contract: `data` is "null while loading or
// on error"; `loading` is "true while the initial request OR a refresh is in
// flight"). The Reader's TL;DR compile poll calls refresh() every few seconds,
// so a render gate of `if (loading || !data) return <Loading/>` unmounted the
// whole populated Reader on every poll tick — the tall page collapsed to a
// one-line placeholder and the operator's scroll snapped back to the top. Once
// the TL;DR cached, the poll stopped firing and scroll behaved.
//
// This pure selector keeps rendering the last-good payload while a refresh is in
// flight, so the tree is never unmounted and scroll is preserved. A fresh good
// payload always wins; only a genuine initial load (no fresh data AND no cached
// payload) returns null so the caller shows the loading placeholder. The caller
// keys the cache to the current issue so navigation never shows stale content.

/**
 * Choose the payload the Reader should render this tick.
 *
 * @param rawData  The latest `usePluginData` result: a good payload, a
 *                 `{ error }` short-circuit, or `null` (initial load / mid-refresh).
 * @param cachedLastGood  The last good payload observed for THIS issue, or null.
 * @returns The payload to render, or `null` to show the loading placeholder.
 */
export function resolveReaderData<T>(
  rawData: T | { error: string } | null | undefined,
  cachedLastGood: T | null,
): T | null {
  if (rawData != null && typeof rawData === 'object' && !('error' in rawData)) {
    return rawData as T;
  }
  // No usable fresh payload (null during a refresh, or an error response):
  // keep the last good payload so a background poll never unmounts the Reader.
  return cachedLastGood;
}
