# Phase 5: Distribution & Polish — Discussion Log (Power Mode)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in `05-CONTEXT.md` — this log preserves the analysis context.

**Date:** 2026-05-25
**Phase:** 05-distribution-polish
**Mode:** power (file-based JSON state + HTML companion)
**Questions:** 23 across 7 sections (one per remaining plan: 05-04..05-10)
**Answered:** 23 / 23 (100%)
**Chat-more overrides:** 0
**Deviations from recommended:** 4
**Session duration:** offline answering window (HTML generated 16:30 UTC, finalized 17:00 UTC)

## Section Coverage

| Section | Plan | Questions | Answered | Deviations |
|---------|------|-----------|----------|------------|
| Plan 05-04 | Previewers + Visual-regression | 5 | 5 | 0 |
| Plan 05-05 | Zero-rabbit-holes finishers | 5 | 5 | 2 (Q-07, Q-09) |
| Plan 05-06 | Phase 4.1 surface polish | 2 | 2 | 0 |
| Plan 05-07 | Phase 4.2 polish | 2 | 2 | 0 |
| Plan 05-08 | Phase 4.1 power features | 6 | 6 | 1 (Q-19) |
| Plan 05-09 | Tooling + infra | 2 | 2 | 0 |
| Plan 05-10 | v1.0.0 final closure | 1 | 1 | 1 (Q-23 — STRONG) |

## Questions and Answers

### Plan 05-04 — Full-fidelity previewers + Visual-regression baseline

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-01 | xlsx → grid renderer | (a) SheetJS in UI / (b) @e965/xlsx in UI / (c) Server-side via worker [REC] / (d) Defer xlsx | **c** | ✓ |
| Q-02 | pdf → embed renderer | (a) Native `<embed>` [REC] / (b) pdfjs-dist / (c) `<iframe>` | **a** | ✓ |
| Q-03 | md → rendered renderer | (a) marked + DOMPurify / (b) react-markdown [REC] / (c) markdown-it | **b** | ✓ |
| Q-04 | Visual-regression infra | (a) Playwright static-sketch [REC] / (b) Live-host Playwright / (c) Storybook+Chromatic / (d) Skip | **a** | ✓ |
| Q-05 | Visual-regression CI cadence | (a) Every PR [REC] / (b) Nightly+push to master / (c) On-demand only | **a** | ✓ |

### Plan 05-05 — Zero-rabbit-holes finishers

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-06 | Paused-agent banner placement | (a) Chat header / (b) Reader / (c) Both [REC] / (d) Situation Room | **c** | ✓ |
| Q-07 | Paused-agent banner copy variants | (a) Single copy [REC] / (b) Three distinct per cause / (c) Single + "Why?" link | **b** | ✗ DEVIATION |
| Q-08 | Ref-chip peek trigger | (a) Hover-only; click navigates [REC] / (b) Click peek / (c) Hover peek + Cmd-click | **a** | ✓ |
| Q-09 | Ref-chip peek content | (a) Title+status+owner [REC] / (b) +last activity +health / (c) +description first line | **c** | ✗ DEVIATION |
| Q-10 | GAP-PICKER-ROW-DISPATCH fix | (a) Extend buildTopicDeepLink [REC] / (b) Lenient dispatch / (c) Both | **a** | ✓ |

### Plan 05-06 — Phase 4.1 surface polish bundle

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-11 | Pin/Unpin confirmation pattern | (a) Silent + toast [REC] / (b) Silent no toast / (c) Modal on unpin | **a** | ✓ |
| Q-12 | Pinned-chip flash duration | (a) 1.5s [REC] / (b) 1s / (c) 2s | **a** | ✓ |

### Plan 05-07 — Phase 4.2 polish bundle

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-13 | D8 Browser-Back behavior | (a) Preserve hash [REC] / (b) Detect Back + re-fire / (c) Clear hash | **a** | ✓ |
| Q-14 | React-key warnings fix scope | (a) Fix all 5 in plan [REC] / (b) Pareto fix hot paths / (c) Defer to v1.0.1 | **a** | ✓ |

### Plan 05-08 — Phase 4.1 power features

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-15 | Archive full-view surface | (a) Route /<prefix>/clarity-pack/archive [REC] / (b) Modal / (c) Side panel | **a** | ✓ |
| Q-16 | Bulk-unarchive confirmation | (a) Silent + count toast [REC] / (b) Confirm when N>5 / (c) Always confirm | **a** | ✓ |
| Q-17 | Cold-task-from-global button location | (a) Top-right header bar [REC] / (b) FAB bottom-right / (c) Cmd-N shortcut only | **a** | ✓ |
| Q-18 | Diagnostics memory scope | (a) Per topic [REC] / (b) Per session / (c) Per user | **a** | ✓ |
| Q-19 | Composer shortcuts overlay trigger + surface | (a) Global `?` → modal [REC] / (b) Composer `?` → inline popover / (c) Visible `?` icon | **b** | ✗ DEVIATION |
| Q-20 | Storage-pin semantics | (a) Exempt from archive [REC] / (b) Pin to top / (c) Both | **a** | ✓ |

### Plan 05-09 — Tooling + infra cleanup

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-21 | VPS scripts sync mechanism | (a) Documented `git pull` [REC] / (b) Auto-sync hook / (c) Separate npm package | **a** | ✓ |
| Q-22 | Windows max-path fix | (a) Move fixture out of worktreed tree [REC] / (b) .gitattributes / (c) Document fallback only | **a** | ✓ |

### Plan 05-10 — v1.0.0 final closure

| Q | Title | Options | Answer | Match Recommended? |
|---|-------|---------|--------|---------------------|
| Q-23 | Rollback rehearsal scope | (a) Full round-trip 1.0.0→rc.7→1.0.0 [REC] / (b) One-way / (c) Skip rehearsal | **c** | ✗ STRONG DEVIATION |

## Deviation Notes

### Q-07 — Three distinct pause-cause copies (Plan 05-05)
**Recommended:** Single copy `'Agent <name> paused — ▶ Resume heartbeat'`.
**Chosen:** Three distinct copies per cause (operator-pause / budget-exhausted / codex-adapter-error).
**Operator signal:** Wants precise diagnostic information at the surface where the action lands.
**Plan implication:** Worker handler returns pause reason as discriminated union; UI dispatches copy on cause. ~3 strings + a union type. Acceptable cost for the diagnostic clarity.

### Q-09 — Ref-chip peek includes description first line (Plan 05-05)
**Recommended:** Title + status + owner (3 fields).
**Chosen:** Title + status + owner + first line of description (≤120 chars truncated).
**Operator signal:** Peek must be useful enough to ACTUALLY avoid the navigation, not just tease it.
**Plan implication:** `resolve-refs` worker handler extends payload with `description_excerpt: string | null`. Worker-side truncation. ~120 bytes per ref; acceptable budget impact.

### Q-19 — Composer-scoped `?` popover (Plan 05-08)
**Recommended:** Global `?` key on clarity-pack surfaces → modal cheatsheet.
**Chosen:** `?` key in composer only → inline popover.
**Operator signal:** Wants the discoverability surface co-located with the action context. Global modals interrupt; inline popovers stay in flow.
**Plan implication:** Popover anchors to composer; keypress logic must not interfere with literal `?` typing. Planner experiments with detection. Trade-off: less discoverable for a brand-new operator (acceptable — v1 audience = Eric).

### Q-23 — Skip rollback rehearsal entirely (Plan 05-10) — STRONG DEVIATION
**Recommended:** Full round-trip `1.0.0 → uninstall → rc.7 → uninstall → re-install 1.0.0` with COEXIST #6 row-count check at each step.
**Chosen:** Skip rollback rehearsal entirely. Phase 1 bookend snapshot/restore loop is the SOLE recovery path for v1.0.0 ship.
**Operator signal:** Speed > redundant verification given the bookend loop has PASSED multiple drills already.
**Plan implication:** Plan 05-10 closure drill scope reduces by ~10 min. Forward install `1.0.0-rc.7 → 1.0.0` IS still part of the drill; reverse rehearsal is dropped.
**Risk surfaced:** If any v1.0.0 install/uninstall drill ever exposes a recovery gap, rehearsal should be re-added as default for v1.1+.
**Memory file:** This call MUST be captured in MemPalace `clarity_pack/decisions/phase-5-discuss-power-mode-2026-05-25` so future ships don't accidentally re-add rehearsal as default.

## Methodology

1. Initialized via `gsd-sdk query init.phase-op 5` — confirmed phase 5 exists, 4 plans already shipped, 7 plans pending design lock.
2. Read ROADMAP.md §Phase 5 (lines 163-188) — 10 plan stubs with locked scope.
3. Read STATE.md — phase progress (3/10 complete) + next-action pointing to this command.
4. Read PROJECT.md — re-confirmed coexistence guarantees + v1 audience.
5. Read Phase 4.2 CONTEXT.md — pattern reference for CONTEXT.md structure.
6. Scouted source surfaces (Reader, primitives, worker handlers, chat archive panel, ref-chip, deliverable-preview, pause-banner, deep-link.mjs) to ground gray-area context in real code.
7. Identified 23 questions across 7 sections (one per remaining plan); each question carries concrete context citing file paths and prior decisions.
8. Generated `05-QUESTIONS.json` + `05-QUESTIONS.html` (self-contained, FS Access API with download fallback, click-anywhere-collapsible sections, green-on-answered highlighting, orange-on-chat-more border).
9. Operator answered offline, uploaded answered JSON.
10. Finalized: wrote `05-CONTEXT.md` (23 decisions + canonical refs + code context + deferred ideas) + this discussion log.

## Files
- `.planning/phases/05-distribution-polish/05-QUESTIONS.json` — answered state (preserved)
- `.planning/phases/05-distribution-polish/05-QUESTIONS.html` — companion UI (preserved, can be deleted post-finalize)
- `.planning/phases/05-distribution-polish/05-CONTEXT.md` — canonical decision record
- `.planning/phases/05-distribution-polish/05-DISCUSSION-LOG.md` — this file
