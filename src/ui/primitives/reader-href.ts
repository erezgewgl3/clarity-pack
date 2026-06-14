// src/ui/primitives/reader-href.ts
//
// Plan 18-01 Task 2 (LEG-01) — single-source Open↗ target-URL builder.
//
// WHY ONE HELPER:
//   Before this, all five Open↗ issue-open sites inlined `/${companyPrefix}/issues/
//   ${id}`. The Tier-1 (host honors a `?tab=`/`#tab=` deep-link to the Clarity
//   Reader detailTab) vs Tier-2 (locked SPEC fallback to the bare issue page) choice
//   must be a ONE-LINE change in ONE file — not a five-site edit. Every surface now
//   calls buildReaderHref(companyPrefix, identifier); the tier decision lives only in
//   this return statement.
//
// CURRENT TIER (D-02 / 18-01 Task 1 verdict = TIER1_HONORED=DEFERRED → Tier-2):
//   The live deep-link probe (scripts/probes/reader-tab-deeplink.mjs) could NOT be run
//   because the entire Clarity Pack UI was rendering blank on live BEAAA v1.6.0 at
//   execution time (broken/partial install — UI bundle 404, no plugin files on the
//   data volume). So we ship the locked Tier-2 fallback now — it is ALWAYS correct —
//   and defer the Tier-1 deep-link upgrade to after the Phase 18 clean reinstall
//   deploy (18-04) restores the UI and the probe can settle TIER1_HONORED.
//
//   When the probe later proves Tier-1, the ONLY change is this function's return:
//     - TIER1_HONORED=true + QUERY → return `${base}?tab=clarity-reader`
//     - TIER1_HONORED=true + HASH  → return `${base}#tab=clarity-reader`
//   No surface needs touching.
//
// PURE-HELPER FAMILY:
//   Same family as extractCompanyPrefixFromPathname (use-resolved-company-id.ts:57-63):
//   no I/O, no hooks, type-stripping-safe. Takes companyPrefix as an ARGUMENT — it
//   contains NO company-prefix literal (instance-agnostic, the LEG-01 control against
//   cross-tenant prefix leakage; threat T-18.01-I).

/**
 * Build the Open↗ navigation target for an issue.
 *
 * Tier-2 locked fallback (D-02): returns the bare issue route
 * `/${companyPrefix}/issues/${identifier}` — no tab carrier appended, because the
 * live host deep-link probe (18-01 Task 1) is DEFERRED (UI was down at execution
 * time). The host will land on the classic tab; the Reader tab is one click away.
 *
 * `identifier` is the HUMAN issue identifier (e.g. "BEAAA-972"), never the UUID
 * (paperclip-issue-url-pattern memory). `companyPrefix` is derived from the host
 * pathname at every call site via extractCompanyPrefixFromPathname — never hardcoded.
 *
 * @param companyPrefix host-derived company URL prefix (e.g. "COU", "BEAAA")
 * @param identifier    human issue identifier (e.g. "BEAAA-972")
 * @returns same-origin route string consumed by the host router
 */
export function buildReaderHref(companyPrefix: string, identifier: string): string {
  return `/${companyPrefix}/issues/${identifier}`;
}
