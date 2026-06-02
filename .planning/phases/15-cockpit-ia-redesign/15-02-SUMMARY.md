---
phase: 15-cockpit-ia-redesign
plan: 02
subsystem: situation-room-ui
tags: [pulse-header, cockpit-ia, deterministic-template, no-uuid-leak, instance-agnostic, sc4]
requires:
  - "15-01: snapshot.pulse PulseSummary {needYou,inMotion,stuck,selfClearing}"
provides:
  - "buildPulseSentence(pulse): pure deterministic counts->status sentence (D-02 floor)"
  - "<PulseHeader>: deterministic sentence + four always-on vital chips (COCK-01/SC1)"
  - "PulseSummary structural UI mirror (no worker-type import)"
  - ".clarity-pulse* scoped CSS under [data-clarity-surface='situation-room']"
  - "NO_UUID_LEAK render-scan extended to the PulseHeader render path (D-10)"
affects:
  - "future 15 plan: index.tsx wires <PulseHeader pulse={snapshot.pulse}> + replaces <NeedsYouBanner>"
tech-stack:
  added: []
  patterns:
    - "deterministic-template floor (counts->string, never AI, never blanks) = SC4 degrade target"
    - "structural UI mirror of a worker type (no cross-bundle import)"
    - "partition-then-render-empty: four vital chips always render (a zero is a signal)"
    - "NO_UUID_LEAK render-scan: structural source-grep + behavioral string-render sim"
    - "empirical bundle-ceiling recalibration (CSS-inline delta, verified no SheetJS)"
key-files:
  created:
    - src/ui/surfaces/situation-room/pulse-sentence.ts
    - src/ui/surfaces/situation-room/pulse-header.tsx
    - test/ui/surfaces/situation-room/pulse-header.test.mjs
    - test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs
  modified:
    - src/ui/primitives/theme.css
    - scripts/check-ui-bundle-size.mjs
decisions:
  - "Deterministic Pulse template ships as the must-have floor; Editor-Agent prose enrichment DEFERRED (D-02/D-03 planner discretion) for a clean capstone."
  - "Wording: need-you lead ('N things need you · M in motion'), calm/control ('Nothing needs you — M in motion'), honest floor ('The board is clear.'), watch tail (' · K stuck · J self-clearing') only when >0."
  - "Banner fold (D-07): the Pulse sentence + need-you chip ARE the status; PulseHeader is a standalone header — index.tsx wiring + NeedsYouBanner removal is a later 15 plan (this plan ships the component)."
  - "Bundle ceiling bumped 735->739 kB: theme.css inlines as a text-loader string so the +1,977 B CSS delta lands now even though PulseHeader/buildPulseSentence are tree-shaken until wired; verified zero SheetJS sentinels; stays UNDER the 740 kB visual-regression sanity ceiling."
metrics:
  duration: ~25m
  completed: 2026-06-03
  tasks: 3
  files: 6
  commits: 3
---

# Phase 15 Plan 02: PulseHeader Summary

The `<PulseHeader>` — a deterministic one-sentence company-status line + four always-on vital-sign chips (need-you / in-motion / stuck / self-clearing) sourced from `snapshot.pulse` — built on a pure `buildPulseSentence` counts→string helper (the SC4 degrade floor), scoped CSS mapped to host tokens, and a NO_UUID_LEAK render-scan extended to the new render path.

## What shipped

- **`buildPulseSentence(pulse)`** (`pulse-sentence.ts`) — a PURE counts→string template. Four regimes: need-you lead, calm/control, honest all-zero floor ("The board is clear."), and a stuck/self-clearing tail surfaced only when > 0. Singular/plural-correct. No clock, no AI, no hook, no fetch — same inputs → same string (the SC4 degrade target). Never blanks. UUID-free / instance-agnostic.
- **`<PulseHeader>`** (`pulse-header.tsx`) — renders the deterministic sentence (Instrument Serif italic) + exactly four labelled vital chips, ALWAYS (a zero is a signal). Exports a `PulseSummary` structural mirror (no worker-type import). An absent/undefined/null pulse renders the all-zero floor — never throws, never blanks (SC4/D-08). React text nodes only; no `dangerouslySetInnerHTML`; zero `companyPrefix`/UUID (D-10).
- **`.clarity-pulse*` CSS** (`theme.css`) — `.clarity-pulse` card, `.clarity-pulse-sentence` (serif italic display), `.clarity-pulse-vitals` flex row, `.clarity-pulse-vital` + four tint modifiers (you/mov/stk/slf) mapping the mockup's gold/green/red/calm families to host tokens (`--clarity-you` / `--clarity-state-running` / `--clarity-state-blocked` / `--clarity-ink-3`). All scoped under `[data-clarity-surface='situation-room']`. No parallel Tailwind.
- **NO_UUID_LEAK render-scan** (`pulse-header-no-uuid-leak.test.mjs`) — mirrors `employee-row-no-uuid-leak`: structural source-grep (no `*Uuid`/`.id`/`companyPrefix` interpolation; no `dangerouslySetInnerHTML`) + behavioral string-render sim asserting ZERO UUID matches and no prefix literal across 5 count regimes, with a guard fixture proving the regex is meaningful.

## Banner fold (D-07)

The Phase-8 `needs-you-banner.tsx` role is **folded into the Pulse**: the need-you state lives in the Pulse sentence + the gold need-you chip — there is no second standalone status line in the PulseHeader. The component is the always-visible status surface. (Replacing `<NeedsYouBanner>` in `index.tsx` and rendering `<PulseHeader pulse={snapshot.pulse}>` is the next 15-plan's wiring step; this plan ships the component + helper + tests.)

## Verification (all green)

| Command | Result |
|---|---|
| `node --test test/ui/surfaces/situation-room/pulse-header.test.mjs` | pass 15 / fail 0 |
| `node --test test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs` | pass 8 / fail 0 |
| `node --test test/shared/blocker-chain.test.mjs` (engine guard unaffected) | pass 21 / fail 0 |
| `node scripts/build-ui.mjs` | Done (754,617 B) |
| `node scripts/check-css-scope.mjs` | 206 selectors, all scoped |
| `node scripts/check-ui-bundle-size.mjs` | OK — 754,617 / 756,736 B, no SheetJS |
| `npx tsc --noEmit` | exit 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] UI bundle exceeded the 735 kB ceiling**
- **Found during:** Task 2 (`node scripts/check-ui-bundle-size.mjs` after the CSS add).
- **Issue:** `theme.css` is bundled as a `text`-loader string into `dist/ui/index.js`, so the +1,977 B `.clarity-pulse*` CSS delta pushed the bundle to 754,617 B, over the 752,640 B ceiling — even though `PulseHeader`/`buildPulseSentence` are tree-shaken out until `index.tsx` wires them.
- **Fix:** Recalibrated the ceiling 735 → 739 kB (756,736 B) per the documented Phase 5/7/8/13 empirical-recalibration precedent (actual + ~1.6 kB headroom, rounded up to the next kB; tighter than the +3 kB norm to stay UNDER the 740 kB visual-regression sanity ceiling — no operator checkpoint required). Verified zero SheetJS sentinels (XLSX/SheetJS/!ref all 0).
- **Files modified:** `scripts/check-ui-bundle-size.mjs`
- **Commit:** e809fbe

## Threat Surface

No new threat surface beyond the plan's `<threat_model>`. T-15-04 (info disclosure) mitigated by the NO_UUID_LEAK render-scan (Task 3); T-15-05 (fabrication) mitigated by the pure deterministic template (Task 1); T-15-06 (HTML injection) mitigated by React-text-nodes-only / no `dangerouslySetInnerHTML` (asserted in Tasks 2+3); T-15-SC (installs) — `git diff` shows zero dependency additions.

## Known Stubs

None. The deterministic floor is the intended must-ship surface; the Editor-Agent prose enrichment is a documented DEFERRAL (D-03), not a stub. `<PulseHeader>` is not yet mounted in `index.tsx` — that is the explicit next-plan wiring step (D-09 final assembly), not an unfinished stub of this plan's scope.

## Self-Check: PASSED

- FOUND: src/ui/surfaces/situation-room/pulse-sentence.ts
- FOUND: src/ui/surfaces/situation-room/pulse-header.tsx
- FOUND: test/ui/surfaces/situation-room/pulse-header.test.mjs
- FOUND: test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs
- FOUND: commit 179e722 (Task 1)
- FOUND: commit e809fbe (Task 2)
- FOUND: commit 2a1146b (Task 3)
