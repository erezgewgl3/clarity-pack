---
phase: 18-no-rabbit-holes-plain-english
plan: 01
subsystem: legibility-open-routing
tags: [leg-01, open-routing, reader-href, single-source, render-scan, tier-2-fallback, deferred-probe, instance-agnostic, no-uuid-leak]
requires:
  - "extractCompanyPrefixFromPathname (use-resolved-company-id.ts:57-63 — the host-context prefix derivation each site already uses)"
  - "the five existing Open↗ issue-open sites and their host-derived companyPrefix"
  - "18-01 Task 1 probe artifact (scripts/probes/reader-tab-deeplink.mjs — the Tier-1/Tier-2 decision input)"
provides:
  - "buildReaderHref(companyPrefix, identifier) — the SINGLE-source Open↗ target builder; the Tier-1/Tier-2 decision is now a one-line change in one file"
  - "all five Open↗ issue-opens funnel through buildReaderHref (no surface inlines /issues/${ anymore)"
  - "render-scan invariant: no Open↗ surface inlines the issue path; chat deep-links (buildChatDeepLink) preserved (landmine #8)"
  - "probe verdict recorded = TIER1_HONORED=DEFERRED (Tier-2 ships; re-probe after the UI restore in 18-04)"
affects:
  - src/ui/primitives/reader-href.ts (new)
  - src/ui/surfaces/reader/live-blocker-panel.tsx (openIssue → buildReaderHref)
  - src/ui/surfaces/situation-room/employee-row.tsx (openIssue only → buildReaderHref; chat deep-links untouched)
  - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx (openIssue → buildReaderHref)
  - src/ui/surfaces/bulletin/lineage-footer.tsx (openIssue → buildReaderHref; openChatWithOwner untouched)
  - src/ui/surfaces/_shared/reply-in-place.tsx (unreachable-branch Open↗ → buildReaderHref)
  - scripts/probes/reader-tab-deeplink.mjs (verdict line PENDING_LIVE_PROBE → DEFERRED)
  - "downstream 18-04 (clean reinstall deploy restores the UI; re-run the deep-link probe → possible one-line Tier-1 upgrade)"
tech-stack:
  added: []
  patterns:
    - "single-source nav-target builder: the Tier-1 (host deep-link) vs Tier-2 (locked SPEC fallback) decision is isolated to ONE return line so the upgrade never touches a surface"
    - "instance-agnostic by construction: companyPrefix is an argument (no instance literal); the control against cross-tenant prefix leakage (threat T-18.01-I)"
    - "render-scan funnel guard (source-grep, no jsdom): assert every Open↗ surface calls buildReaderHref AND inlines no /issues/${ — the proof the funnel is complete"
    - "honest deferral: when the live probe cannot run (UI down), ship the always-correct fallback NOW and record the deferred Tier-1 upgrade rather than fabricating a verdict"
key-files:
  created:
    - src/ui/primitives/reader-href.ts
    - test/ui/primitives/reader-href.test.mjs
  modified:
    - scripts/probes/reader-tab-deeplink.mjs
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
    - src/ui/surfaces/bulletin/lineage-footer.tsx
    - src/ui/surfaces/_shared/reply-in-place.tsx
    - test/ui/surfaces/_shared/reply-in-place.test.mjs
    - test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs
decisions:
  - "Ship Tier-2 (locked SPEC fallback, D-02) now; defer Tier-1 deep-link probe to post-UI-restore (18-04). Verdict = TIER1_HONORED=DEFERRED, NOT probe-false."
  - "buildReaderHref takes companyPrefix as an argument — never a hardcoded instance prefix (instance-agnostic, anti-cross-tenant-leak)."
  - "Re-point ONLY the issue-open path in employee-row (openIssue :242); openChatWithOwner/assignWork keep buildChatDeepLink (landmine #8)."
metrics:
  duration: ~25m
  completed: 2026-06-14
requirements: [LEG-01]
---

# Phase 18 Plan 01: LEG-01 Open↗ Single-Source Routing Summary

Every "Open ↗" issue-open across the four Clarity surfaces now funnels through one pure `buildReaderHref(companyPrefix, identifier)` helper, so the Tier-1 (host honors a `?tab=`/`#tab=` Reader deep-link) vs Tier-2 (locked SPEC fallback to the bare issue page) decision is a one-line change in one file — and the live deep-link probe's verdict is honestly recorded as DEFERRED because the entire Clarity UI was down on live BEAAA at execution time.

## What shipped

- **`src/ui/primitives/reader-href.ts`** — pure `buildReaderHref(companyPrefix, identifier)` in the same helper family as `extractCompanyPrefixFromPathname` (no I/O, no hooks, type-stripping-safe). Returns the **Tier-2 locked fallback** `/${companyPrefix}/issues/${identifier}` (D-02) — no tab carrier appended, because the probe verdict is DEFERRED. `companyPrefix` is an argument; the file contains no instance literal.
- **Five Open↗ sites re-pointed** to `navigate(buildReaderHref(companyPrefix, id))`:
  - `reader/live-blocker-panel.tsx` (`nav.navigate`, openIssue :223, `!companyPrefix` guard kept)
  - `situation-room/employee-row.tsx` (the single `openIssue` callback :242 feeding both buttons — **only** the issue-open; `openChatWithOwner`/`assignWork` keep `buildChatDeepLink`)
  - `situation-room/blocked-backlog-expander.tsx` (openIssue :60)
  - `bulletin/lineage-footer.tsx` (openIssue :46; `openChatWithOwner` untouched)
  - `_shared/reply-in-place.tsx` (unreachable-branch Open↗; uses the `navigate`/`companyPrefix` props)
- **`test/ui/primitives/reader-href.test.mjs`** — unit (Tier-2 string, no tab carrier, no prefix literal, pure) + render-scan funnel guard (every surface calls `buildReaderHref`, none inlines `/issues/${`) + landmine #8 chat-deep-link preservation. 11/11 green.

## Probe verdict — TIER2 (DEFERRED), and why (the honest record)

The Task-1 live deep-link probe (`scripts/probes/reader-tab-deeplink.mjs`) **could not be run**. This is **NOT a probe-false result** — there was no working Reader tab to probe at all:

- **Live finding (2026-06-14):** the **entire Clarity Pack UI was rendering BLANK** on live BEAAA v1.6.0. Every surface (Reader, Situation Room) showed only the host's empty slot frame.
- **Root cause (live diagnosis):** the plugin UI bundle **404s** (`index.js?v=2026-06-11T07:…` → 404) and **NO clarity-pack plugin files exist on the real data volume** (`/mnt/paperclipdata/dot-paperclip`), while the host still serves **cached `ui-contributions` metadata (304)**. This is a broken/partial install — consistent with the fail2ban-interrupted v1.6.0 deploy (registration persisted, the files did not).
- **Decision:** ship the locked **Tier-2 fallback now (D-02)** — it is always correct regardless of host tab-deep-link feasibility — and **defer the Tier-1 deep-link probe** to after the **Phase 18 clean reinstall deploy (18-04)** restores the UI. The probe artifact stays in the repo, verdict line updated `PENDING_LIVE_PROBE → DEFERRED`, so the Tier-1 upgrade is a one-line change to `buildReaderHref`'s return once a working Reader exists to probe.

## Acceptance-risk — ACKNOWLEDGED (not silently absorbed)

With Tier-2 shipping, the classic issue page **may be the terminal landing**, because Clarity cannot force-select a host-owned tab from inside `ReaderView` (the detailTab mount model, 18-RESEARCH finding C). LEG-01's "lands on the Reader, not the classic wall" criterion (SPEC line 28) is only physically satisfiable with a host feature (host honors `?tab=`/`#tab=`, OR a host detailTab `defaultTab` hint — neither confirmed, and unprobeable while the UI was down). This risk is recorded here and in the probe artifact's OPERATOR-OUTPUT.

## Follow-up: Tier-1-after-restore

After **18-04** restores the live UI: re-run `node scripts/probes/reader-tab-deeplink.mjs` per its operator walkthrough against a working Reader on BEAAA. If a carrier wins (`?tab=`/`#tab=`), the only change is one line in `src/ui/primitives/reader-href.ts` (append the winning carrier) and re-running the green render-scan — no surface edit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated two reply-in-place surface tests that encoded the OLD inline Open↗ pattern**
- **Found during:** Task 3 (re-running `test/ui/surfaces/**/*.test.mjs` after the re-point).
- **Issue:** `reply-in-place.test.mjs` and `reply-in-place-no-uuid-leak.test.mjs` asserted the literal `navigate(`/${companyPrefix}/issues/${leafIssueId}`)` template — the exact inline pattern this plan replaces. They would (correctly) fail against the buildReaderHref funnel.
- **Fix:** updated both assertions to match `navigate(buildReaderHref(companyPrefix, leafIssueId))` while preserving the load-bearing guarantee they protect (the Open↗ target carries the HUMAN `leafIssueId`, never `leafIssueUuid`/`mutationIssueUuid`); added a `doesNotMatch(/\/issues\/\${leafIssueId}/)` no-inline guard.
- **Files modified:** test/ui/surfaces/_shared/reply-in-place.test.mjs, test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs
- **Commit:** 7092513

## Verification

- `node --test test/ui/primitives/reader-href.test.mjs` → 11/11 pass (unit + render-scan + landmine #8).
- `node --test "test/ui/surfaces/**/*.test.mjs" "test/ui/primitives/reader-href.test.mjs"` → **283/283 pass** (no regression; the two updated reply-in-place tests green).
- grep confirms: 5 sites call `buildReaderHref(`; 0 inline `/issues/${` for issue-opens; `employee-row` + `lineage-footer` still call `buildChatDeepLink` (chat deep-links untouched).
- `tsc --noEmit` not runnable (TypeScript not installed locally — project uses node --test type-stripping; runtime import resolution in the green suite is the effective gate, matching established project convention).
- Live Open↗ drill from each surface is deferred to 18-04's bookended BEAAA drill (carries the UI restore that also unblocks the Tier-1 re-probe).

## Known Stubs

None. `buildReaderHref` is fully wired into all five sites; the only deferred work is the Tier-1 probe upgrade (a one-line change gated on the 18-04 UI restore), explicitly tracked above — not a stub.

## Self-Check: PASSED

- FOUND: src/ui/primitives/reader-href.ts
- FOUND: test/ui/primitives/reader-href.test.mjs
- FOUND: .planning/phases/18-no-rabbit-holes-plain-english/18-01-SUMMARY.md
- FOUND commits: 7ca5b1f (Task 1), b11826b (Task 2), 7092513 (Task 3)
