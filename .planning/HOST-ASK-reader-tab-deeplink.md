# Host feature ask — honor a detailTab deep-link so "Open ↗" can land on a plugin tab

**To:** the Paperclip (`paperclipai/paperclip`) host team
**From:** Clarity Pack plugin (`clarity-pack`, plugin id `a763176a-2f4d-4986-b190-b5151e42cc00` on BEAAA)
**Date:** 2026-06-15
**Status:** blocked-in-plugin — this is NOT fixable inside a plugin; it needs a host change.

---

## One-line ask

Let a link to an issue request that a specific **`detailTab` slot** be the active
tab on arrival — either by honoring `?tab=<slotId>` / `#tab=<slotId>` on the
issue-detail URL, or by adding a `defaultTab` hint to the `detailTab` slot
registration. Today an issue link always lands on the host's default tab, so a
plugin's Reader tab is always one extra click away.

## Why this matters (the user-visible rabbit hole)

Clarity Pack's whole value proposition is **zero rabbit-holes**: an operator
should never have to click through layers to see what an agent is doing. Clarity
contributes a **`detailTab`** slot (id `clarity-reader`, "Reader view") that
resolves every cross-reference inline, previews the deliverable in place, and
flattens the blocker chain to a single named human action.

But every "Open ↗" affordance across Clarity's surfaces (Situation Room rows,
Bulletin lineage, inline refs) navigates to `/<companyPrefix>/issues/<identifier>`
— and the host opens that issue on **its default tab** (e.g. Chat), not the
Reader. So the very feature that exists to *end* the click-chase requires one
more click to reach. We cannot close this from inside the plugin.

## What we verified (live probe evidence)

Probe: `scripts/probes/reader-tab-deeplink.mjs` (committed). Re-run **live on
BEAAA v1.7.1, 2026-06-15**, through the operator browser, on issue BEAAA-972:

| URL form | Result |
|---|---|
| `/<prefix>/issues/<id>` (no carrier) | host default tab = Chat; Clarity Reader **not** active |
| `/<prefix>/issues/<id>?tab=clarity-reader` | Reader **not** auto-selected (carrier ignored) |
| `/<prefix>/issues/<id>#tab=clarity-reader` | Reader **not** auto-selected (carrier ignored) |

**Verdict: `TIER1_HONORED=false`.** The host honors neither carrier.

## Why a plugin cannot work around it

The host mounts a `detailTab`'s component (`ReaderView`) **only once that tab is
already the active tab**. A plugin slot therefore cannot self-select its own tab
from inside its own render — by the time Clarity's code runs, the host has
already chosen the active tab. There is no client-side escape hatch; this is
closed **by construction** without a host change.

## Proposed host options (any one unblocks us)

1. **Honor a URL carrier** — when the issue-detail URL carries
   `?tab=<slotId>` (or `#tab=<slotId>`), select that registered tab if the
   slotId matches a registered `detailTab`; otherwise fall back to the default.
   - Pros: zero plugin-manifest change; works for any plugin; shareable/bookmarkable.
   - This is our preferred option.
2. **`defaultTab` / `preferredTab` hint on detailTab registration** — let a
   `detailTab` slot (or a per-navigation intent) declare it should be the active
   tab when the issue opens via a plugin-originated navigation.
   - Pros: explicit; no URL surface. Cons: coarser (per-slot, not per-link).
3. **A host navigation API** — e.g. `ctx`/host-router `navigateToIssue(id, { tab })`
   that the plugin UI can call so the host selects the tab. Cons: most work for you.

## Acceptance from our side

If the host honors `?tab=<slotId>`/`#tab=<slotId>`, the fix in Clarity is a
**one-line** change: `src/ui/primitives/reader-href.ts` `buildReaderHref()`
appends the carrier (it is already the single chokepoint all five Open↗ sites
funnel through; the Tier decision lives only there). No other plugin change is
needed.

## Scope / non-asks

- We are **not** asking to replace or reorder the host's default tab.
- We are **not** asking for write access to host tab state — just a
  read-once selection hint at navigation time.
- Single-tenant, self-hosted BEAAA install; no multi-tenant concern.

## References

- Probe + verbatim verdict: `scripts/probes/reader-tab-deeplink.mjs`
- The one-line plugin chokepoint: `src/ui/primitives/reader-href.ts`
- Slot registration: `src/manifest.ts` (`detailTab` id `clarity-reader`)
- Project value contract: CLAUDE.md "Core Value: Zero rabbit-holes"
