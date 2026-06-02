---
phase: 12-needs-you-triage
plan: 03
subsystem: situation-room + reader (assign-affordance gating)
tags: [NY-03, D-09, assign-gating, no-uuid-leak, three-surface-consistency]
requires:
  - "12-01: classifyVerdict AWAITING_AGENT_STUCK → actionAffordance 'assign'"
provides:
  - "OrgBlockedRow.actionAffordance (worker emit + UI mirror type)"
  - "OwnerPickerPopover gated to actionAffordance === 'assign' on the org-blocked backlog"
  - "Reader live-blocker-panel 'assign' affordance wired to a live navigate (no dead button)"
affects:
  - "Situation Room org-blocked backlog expander"
  - "Reader-view live blocker panel"
  - "Situation Room employee-row (verified, no behavior change)"
tech-stack:
  added: []
  patterns:
    - "single-verdict gating: every assign control reads actionAffordance === 'assign', never a terminal.kind list or ownerName string-match"
key-files:
  created: []
  modified:
    - src/worker/handlers/org-blocked-backlog.ts
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
    - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/situation-room/employee-row.tsx
    - test/worker/org-blocked-backlog.test.mjs
decisions:
  - "Reader 'assign' affordance routes to /<prefix>/issues/<identifier> (openIssue) — the honest assign effect on a surface where OwnerPickerPopover is not mounted."
metrics:
  duration: ~25m
  completed: 2026-06-02
---

# Phase 12 Plan 03: Needs-You Triage — Assign-Affordance Gating Summary

Closed the D-09 gap so the "Assign owner" affordance appears on EXACTLY the rows the engine verdict marks `actionAffordance === 'assign'` (UNOWNED + AWAITING_AGENT_STUCK after 12-01) across all three surfaces, gating off the single engine verdict — never a terminal.kind list or an ownerName string-match — and making the Reader 'assign' a live navigate instead of a dead button.

## What Changed Per Surface

### Worker + UI type (Task 1)
- `src/worker/handlers/org-blocked-backlog.ts`: added `actionAffordance: BlockerChainResult['actionAffordance']` to `OrgBlockedRow`; the `rows.push({...})` emit sets `actionAffordance: chain.actionAffordance` (the verdict was already computed on the chain by `classifyVerdict` inside `flattenBlockerChain` / `unclassifiedChain` — no new compute, no new fetch).
- `src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts`: mirrored the same field, typed off the shared `BlockerChainResult['actionAffordance']` union (so a 6th affordance is a compile error in BOTH worker emit and UI mirror).

### Org-blocked backlog expander (Task 2)
- `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx`: the `<OwnerPickerPopover>` (which dispatches `situation.assignOwner`, a real mutation — T-12-08) now renders ONLY inside a `row.actionAffordance === 'assign'` guard. Previously it mounted UNCONDITIONALLY on every orphan row, exposing an inappropriate assign on AWAITING_HUMAN / in-motion / external rows. `[Open ↗]` still renders for all rows.

### Reader live blocker panel (Task 2)
- `src/ui/surfaces/reader/live-blocker-panel.tsx`: the onAction switch `case 'assign'` now resolves to `openIssue` (navigate to `/<prefix>/issues/<issueId>` per the paperclip-issue-url-pattern) instead of `null`. The 'assign' label (`primaryActionLabel` → 'Assign owner ▾') already shows only for the assign affordance; it never falls through to reply/nudge. No dead button, no leaking Send/Reply (T-12-11). Only 'none' renders no button.

### Situation Room employee-row (Task 2 — VERIFIED, no behavior change)
- `src/ui/surfaces/situation-room/employee-row.tsx`: confirmed `showAssign = chain?.actionAffordance === 'assign'` already gates the OwnerPickerPopover correctly — it now covers stuck-agent rows (post-12-01) and still never AWAITING_HUMAN. Updated the comment to cite D-05/D-09 (assign now also fires for stuck agents). No logic change.

## Commands Run

| Command | Result |
|---------|--------|
| `node --test test/worker/org-blocked-backlog.test.mjs` (Task 1 RED) | 4 new assertions FAILED (`actionAffordance` undefined) — RED confirmed |
| `node --test test/worker/org-blocked-backlog.test.mjs` (Task 1 GREEN) | `tests 27 / pass 27 / fail 0` |
| `node scripts/build-worker.mjs && node scripts/build-ui.mjs && tsc --project tsconfig.manifest.json` (Task 2) | `dist/worker.js 2.5mb` · `dist/ui/index.js 722.9kb` — clean (pnpm not on PATH; ran the three `npm run build` steps directly) |
| `npx tsc --noEmit` (full typecheck) | EXIT: 0 (no errors — actionAffordance flows through worker + UI types) |

### Grep verification
- `actionAffordance === 'assign'` wraps the OwnerPickerPopover in `blocked-backlog-expander.tsx` (line 101). ✓
- `live-blocker-panel.tsx` onAction `case 'assign'` → `onAction = openIssue` (line 244), not null. ✓
- No `ownerName ===`, `terminalKind ===`, or `terminal.kind ===` gates an assign control across the three UI files (no matches). ✓

## Assign-Gating Enforcement — Confirmed on All Three Surfaces

| Surface | Gate | Status |
|---------|------|--------|
| Situation Room employee-row | `chain?.actionAffordance === 'assign'` | Verified (already correct; covers stuck post-12-01) |
| Reader live blocker panel | `case 'assign'` label gated by `primaryActionLabel`; onAction → live navigate | Wired (no dead button) |
| Org-blocked backlog expander | `row.actionAffordance === 'assign'` wraps OwnerPickerPopover | Gated (was unconditional) |

All three read the SINGLE engine `actionAffordance` (D-09 — agree by construction). NO_UUID_LEAK preserved: owner/agent/issue UUIDs stay dispatch args (leafIssueId/leafIssueUuid/targetAgentUuid/targetIssueUuid); rendered text is the scrubbed humanAction / awaitedPartyLabel / human identifier.

## Commits

- `229d3f7` feat(12-03): carry engine actionAffordance onto OrgBlockedRow (worker + UI type)
- `b67d291` feat(12-03): gate assign affordance on all three surfaces off actionAffordance === 'assign'

## Deviations from Plan

None — plan executed exactly as written. employee-row required only verification + a comment update (as the plan specified).

## Deferred / Out-of-Scope Issues

Full-suite run shows 8 failures (`tests 2369 / pass 2359 / fail 8`), ALL outside this plan's scope (logged in `deferred-items.md`):
- 7 REQUIREMENTS.md traceability tests (CHAT-01..11, CTT-01..08) — pre-existing Phase 4/4.1 doc-state failures, already logged by Plan 12-01.
- 1 `build-employees-rollup.test.mjs` leverage-sort test — OWNED by Plan 12-02 (NY-02), running in parallel with un-committed mid-flight working-tree changes to `build-employees-rollup.ts`/`leverage.ts` (which this plan is explicitly forbidden from touching). Goes green when 12-02 lands.

Plan 12-03's own scope is fully green: `org-blocked-backlog.test.mjs` 27/27, build, and typecheck all pass.

## Self-Check: PASSED
- Modified files exist: all 6 present.
- Commits exist: 229d3f7, b67d291 found in `git log`.
