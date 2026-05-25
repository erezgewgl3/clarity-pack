---
phase: 05-distribution-polish
plan: 06
subsystem: clarity-pack-phase-4.1-polish
tags:
  - phase-05
  - chat-surface
  - polish
  - pin-unpin
  - toast
  - flash-highlight
  - sticky
  - optimistic-todo
  - d-11
  - d-12
dependency_graph:
  requires:
    - "04.1-05"  # chat.topic.archive toggle shape (D-11 mirrors)
    - "04.1-09"  # toast primitive (showToast) + .clarity-toast block
    - "04.1-10"  # inline ▶ Resume heartbeat affordance (item d target)
    - "04.1-11"  # bulletin cadence fix; surfaced LIVE-floating drill observation
    - "04.2-04"  # .flash-highlight keyframe (D-12 reuse) + chat.roster dedup pattern (Shape B parallel usePluginData)
    - "05-05"    # AgentPauseBanner already mounted in context-rail.tsx region (wave 2 — depends_on)
  provides:
    - "PromoteActions silent-toggle toast UX (D-11)"
    - "Right-rail Pinned-messages chip block (D-12)"
    - "Inline-task-card optimistic Todo render (item g)"
    - "Clarity-pack toast disambiguation (--you stripe + ↗ glyph, item f)"
    - "LIVE indicator sticky-context restore + Playwright deterministic convergence gate (item e)"
  affects:
    - "src/ui/surfaces/chat/message-thread.tsx"
    - "src/ui/surfaces/chat/context-rail.tsx"
    - "src/ui/surfaces/chat/true-task/inline-task-card.tsx"
    - "src/ui/styles/chat.css"
tech-stack:
  added: []  # NO new runtime deps. The new chat-live-sticky.test.mjs uses
              # the existing devDep `playwright@1.55.1` (landed in Plan 05-04).
  patterns:
    - "Silent-toggle + clarity-pack toast (mirrors Plan 04.1-05 chat.topic.archive)"
    - "Right-rail parallel chat.messages fetch via usePluginData (matches Plan 04.2-04 chat.roster dedup)"
    - "Reuse-not-duplicate CSS keyframe (Plan 04.2-04 scroll-and-flash keyframe owns the animation)"
    - "Optimistic-status coercion scoped to a consumer (presentational primitive unchanged for other callers)"
    - "Playwright headless convergence-gate test (deterministic computed-style + bounding-rect probe)"
key-files:
  created:
    - "test/ui/chat-pin-toggle-toast.test.mjs"
    - "test/ui/chat-pinned-chip-flash.test.mjs"
    - "test/ui/chat-css-live-sticky.test.mjs"
    - "test/ui/chat-live-sticky.test.mjs"
    - "test/ui/chat-toast-stripe.test.mjs"
  modified:
    - "src/ui/surfaces/chat/message-thread.tsx"
    - "src/ui/surfaces/chat/context-rail.tsx"
    - "src/ui/surfaces/chat/true-task/inline-task-card.tsx"
    - "src/ui/styles/chat.css"
    - "test/ui/chat-context-rail.test.mjs"
    - "test/ui/chat-inline-task-card.test.mjs"
    - "test/ui/chat-message-thread.test.mjs"
decisions:
  - "D-11 satisfied — Pin/Unpin success path swaps inline setFeedback for showToast({ message: 'Message pinned' | 'Message unpinned' }). Mirrors chat.topic.archive toggle. NO modal, NO confirmation prompt. Error path keeps loud inline setFeedback."
  - "D-12 satisfied — Right-rail <h3>Pinned</h3> chip block scrolls + flashes via the EXISTING Plan 04.2-04 .flash-highlight keyframe at chat.css 2367-2380 (NO duplicate keyframe)."
  - "Item (c) — message-thread.tsx scrollIntoView dep array extended with pendingTaskCard?.issueId."
  - "Item (d) — pause-toast copy = 'Use ▶ Resume heartbeat below to restart' (was 'Resume from the agent page.')."
  - "Item (e) — LIVE sticky-context BREAKER found ON THE STICKY ELEMENT ITSELF, not on an ancestor. Selector [data-clarity-surface=\"chat\"] .auto-refresh; property margin; value -24px -22px 6px. The -24px top margin pulled the static-flow position 24px above the .messages padding-box top edge, so the sticky element kept its -24px offset on scroll. FIX: margin: 0 -22px 6px (drop the negative top, keep horizontal full-bleed) + .messages padding-top: 0 (was 24px) so the indicator naturally sits at the content edge."
  - "Item (f) — .clarity-toast border-left: 3px solid var(--you) + new .clarity-toast::before { content: '↗ '; color: var(--you); }. No new color token (reuses --you)."
  - "Item (g) — InlineTaskCard coerces status null/undefined to 'todo' (was 'pending' for the a11y label and unchanged passthrough to the pill — which rendered the muted '· — ·' loader). statusLabel default also flipped 'pending' → 'todo'. Coercion is SCOPED to InlineTaskCard — ChatTaskStatusPill's null/undefined branch is unchanged, so any other call site that genuinely wants '· — ·' still gets it."
  - "Plan 05-10 owns the v1.0.0 final flip — package.json and src/manifest.ts UNCHANGED at 1.0.0-rc.7 by this plan. Phase-wide rc.7 → 1.0.0 bump is centralized to avoid rc.N collision."
metrics:
  duration_seconds: 1380
  duration_human: "~23 min sequential executor on master"
  completed_at: "2026-05-25T19:31:00Z"
  tasks_completed: 3
  commits: 3
  test_delta_baseline: 1493  # post-Plan 05-05
  test_delta_after: 1524     # net +31 tests added by this plan
  failed_tests: 0
  skipped_tests: 2  # pre-existing
---

# Phase 05 Plan 06: Phase 4.1 surface polish bundle (7 drill-deferred items) Summary

Seven drill-deferred chat-surface polish fixes — accumulated during the 0.8.3 / 0.8.4 / 1.0.0-rc.7 drills (project memory `phase-4.2-deferred-from-4.1`) — shipped as 3 atomic commits + 5 new test files + 3 updated tests on `master` (sequential executor). All seven items are pure surface-layer changes; no schema, no new worker handler, no new dependency. The single load-bearing infrastructure finding was the LIVE indicator's `position: sticky` drift (item e), which the Playwright headless convergence-gate test pinned to a precise -24px top-margin breaker on the sticky element itself (not an ancestor) — fixed and named in a code comment so future drills don't need to re-audit.

## Commits

| Commit    | Task | Items   | Subject |
| --------- | ---- | ------- | ------- |
| `ec94b92` | 1    | a + b   | feat(05-06): Pin/Unpin silent-toast + Pinned-chip flash (D-11+D-12) |
| `0cc7869` | 2    | c + d + g | feat(05-06): auto-scroll after Create-Task + pause-toast copy + optimistic Todo |
| `a655111` | 3    | e + f   | fix(05-06): LIVE sticky restore (item e) + clarity-toast --you stripe + ↗ glyph |

## Item-to-commit lineage

| Item | Description | Commit |
| ---- | ----------- | ------ |
| (a)  | D-11 Pin/Unpin silent toggle + clarity-pack toast | `ec94b92` |
| (b)  | D-12 Right-rail Pinned-messages chip flash-highlight | `ec94b92` |
| (c)  | Auto-scroll thread after Create-Task lands | `0cc7869` |
| (d)  | Pause-toast copy correction — directs at inline ▶ Resume | `0cc7869` |
| (g)  | InlineTaskCard optimistic Todo (was muted `· — ·` loader) | `0cc7869` |
| (e)  | LIVE indicator sticky restore (named breaker + Playwright convergence gate) | `a655111` |
| (f)  | Clarity-pack toast --you left-edge stripe + ↗ leading glyph | `a655111` |

## Item (e) audited breaker — for future drill verification

The plan-text mandated naming the breaker by selector + property + value so future drills can re-verify the fix without re-running the audit:

| Field | Value |
| ----- | ----- |
| Selector | `[data-clarity-surface="chat"] .auto-refresh` |
| Property | `margin` |
| Value (broken) | `-24px -22px 6px` (rc.7 working tree, chat.css:493) |
| Value (fixed) | `0 -22px 6px` (this plan) |
| Effect | The -24px top margin pulled the static-flow position 24px above the `.messages` padding-box top edge. When `top: 0` resolved, the sticky element kept its -24px offset on scroll — reading as "floating mid-thread" 24px below the `.messages` top rather than pinned. |
| Companion fix | `.messages` `padding-top: 0` (was `24px`) so the indicator naturally sits at the content edge without needing the negative top margin. |
| Evidence | Playwright deterministic test measured `elTop=25 / containerTop=1 / drift=24` after a 200px scroll — exactly the -24px offset. Post-fix: `position === 'sticky'`, drift `0px` after scroll, ancestor-chain audit reports zero runtime breakers. |

The ancestor-chain audit confirmed NO classic sticky-context breaker (overflow: hidden / transform / filter / contain / will-change: transform) exists on `.thread`, `.clarity-chat-shell`, or the surface root `[data-clarity-surface="chat"]`. The breaker was on the sticky element itself, which is the failure mode the source-grep tests (Plan 04.1-11 era) would not have caught — the convergence gate via Playwright DID catch it.

## Convergence-gate test for item (e)

`test/ui/chat-live-sticky.test.mjs` (NEW) exists and passes. It:

1. Mounts a synthetic harness mirroring the actual chat surface ancestor chain ([data-clarity-surface="chat"] → .clarity-chat-shell → main.thread → .messages → .auto-refresh) into Chromium via Playwright headless.
2. Asserts `window.getComputedStyle(.auto-refresh).position === 'sticky'`.
3. Scrolls `.messages` by 200px and asserts the element's `getBoundingClientRect().top` stays within 3px of the container's top edge — proving the sticky engagement is real, not just a stylesheet declaration.
4. Separately walks the ancestor chain at runtime and asserts no ancestor declares a breaker.

`SKIP_VISUAL=1` skips the suite (mirrors `test/visual/sketch-regression.test.mjs`'s pattern) for contributors without a working Chromium install. CI runs the test by default. Average runtime: ~1.2s per probe pair.

## Test suite delta

| Metric | Before | After | Delta |
| ------ | ------ | ----- | ----- |
| Pass count | 1493 | 1522 | +29 |
| Fail | 0 | 0 | 0 |
| Pre-existing skip | 2 | 2 | unchanged |
| **Total tests** | **1493** | **1524** | **+31** |

New test files (5):
- `test/ui/chat-pin-toggle-toast.test.mjs` (6 tests)
- `test/ui/chat-pinned-chip-flash.test.mjs` (7 tests)
- `test/ui/chat-css-live-sticky.test.mjs` (7 tests)
- `test/ui/chat-live-sticky.test.mjs` (2 tests — Playwright)
- `test/ui/chat-toast-stripe.test.mjs` (5 tests)

Updated test files (3):
- `test/ui/chat-context-rail.test.mjs` — pinned new pause-toast copy + absence regression guard for the old string.
- `test/ui/chat-inline-task-card.test.mjs` — pinned optimistic Todo coercion + statusLabel 'pending' → 'todo' + regression guard that ChatTaskStatusPill's null branch is unchanged.
- `test/ui/chat-message-thread.test.mjs` — pinned `pendingTaskCard?.issueId` in the scrollIntoView dep array.

## Quality gates

| Gate | Result |
| ---- | ------ |
| `npx tsc --noEmit` | Clean |
| `node scripts/check-css-scope.mjs` | 118 selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/check-a11y.mjs` | 66 files / 0 violations |
| `node scripts/check-ui-bundle-size.mjs` | 622,697 bytes / 665,600 byte ceiling (no SheetJS sentinels) |
| `node scripts/coexistence-checks/run-all.mjs` | 10/10 PASS |
| `node --test "test/**/*.test.mjs"` | 1522 pass / 0 fail / 2 pre-existing skip |

## Version trail — UNCHANGED

`package.json` and `src/manifest.ts` both still read `1.0.0-rc.7`. **The phase-wide rc.7 → 1.0.0 bump is owned EXCLUSIVELY by Plan 05-10 (v1.0.0 final closure).** This plan does NOT pack a new tarball, run an operator drill, or write any VERIFICATION.md/ROADMAP traceability flips — all carried forward to 05-10.

The version-invariance verify gate executed cleanly:
```
$ node -e "const pkg = require('./package.json'); ..."
OK: rc.7 invariant preserved - Plan 05-10 owns the v1.0.0 final flip.
```

## CTT-07 invariant — preserved

`src/worker/handlers/chat-pin.ts` is UNCHANGED by this plan (pure UI-tier polish bundle). The CTT-07 grep gate (`grep -nE "ctx\.issues\.update\(" src/worker/handlers/chat-pin.ts | wc -l == 0`) holds. No `ctx.issues.update` call site introduced or regressed; coexistence-checks/run-all.mjs 09-true-task.mjs (CTT-07 enforcement check) PASS.

## Deviations from Plan

None — plan executed exactly as written.

The one notable judgment call: **Plan 05-06 item (e) "named breaker" turned out to be on the sticky element itself (negative top margin), not on an ancestor as the plan-text initially hypothesized (`overflow-x: auto` on `.thread`)**. The audit started at the planned hypothesis (`.thread` ancestor) and traced upward via Playwright headless — confirming `.thread` is clean. The Playwright bounding-rect probe surfaced the actual breaker (elTop=25 vs containerTop=1, drift=24, precisely the -24px margin offset). The plan explicitly anticipated this case ("If no breaker is found in chat.css, the breaker is in the JSX tree's inline style or in clarity-surface-root.tsx — fix at the source") — the convergence gate replacing audit-only acceptance was load-bearing. Documented in the chat.css fix comment + this SUMMARY.

## Known stubs

None.

## Threat flags

None — all seven items are pure UI-tier polish without introducing new endpoints, auth surfaces, file access, or schema. The threat register from PLAN.md (T-05-06-01..06-SC) holds verbatim. T-05-06-SC (Package Legitimacy Gate) is non-applicable since this plan introduces ZERO new dependencies.

## Self-Check: PASSED

Created files exist:
- `.planning/phases/05-distribution-polish/05-06-SUMMARY.md` (this file) — FOUND
- `test/ui/chat-pin-toggle-toast.test.mjs` — FOUND
- `test/ui/chat-pinned-chip-flash.test.mjs` — FOUND
- `test/ui/chat-css-live-sticky.test.mjs` — FOUND
- `test/ui/chat-live-sticky.test.mjs` — FOUND
- `test/ui/chat-toast-stripe.test.mjs` — FOUND

Commits exist:
- `ec94b92` — FOUND
- `0cc7869` — FOUND
- `a655111` — FOUND

## Carry-forward

Plan 05-10 (v1.0.0 final closure) consumes:
- The phase-wide rc.7 → 1.0.0 version bump.
- The npm pack + sha256 capture for the v1.0.0 tarball.
- The Countermoves canonical ALL-paths operator drill.
- The VERIFICATION.md write + ROADMAP/REQUIREMENTS final flip.

This plan ships code-complete-pending-drill — the seven items go live on Countermoves when 05-10 lands.
