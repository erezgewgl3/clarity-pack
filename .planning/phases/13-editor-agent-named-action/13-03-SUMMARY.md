---
phase: 13-editor-agent-named-action
plan: 03
subsystem: ui/situation-room
tags: [editor-agent, action-cards, situation-room, needs-you-row, no-uuid-leak, degrade]
requires:
  - "13-02: situation.snapshot per-row actionCard (ActionCard|null), degrade-safe"
  - "13-01: ActionCard type (display fields + sourceIssueUuid key)"
  - "src/ui/surfaces/situation-room/employee-row.tsx: the Phase 8/9 needs-you row + blockerChain mirror"
provides:
  - "Inline render of the cached named-action sentence + party + estimate on the needs-you row"
  - "Deterministic degrade to the existing chain line when the card is null/absent (D-12)"
  - "UI actionCard display-field mirror (sourceIssueUuid omitted by construction)"
  - "estBucketLabel pure helper (D-09 bucket -> display words)"
  - "NO_UUID_LEAK render-scan extended to the action-card render path"
affects:
  - "src/ui/surfaces/situation-room/employee-row.tsx (render + mirror)"
  - "src/ui/primitives/theme.css (typographic emphasis for the inline sentence)"
tech-stack:
  added: []
  patterns: ["structural UI mirror (no worker-type import)", "split-identity NO_UUID_LEAK by construction (field omission)", "graceful degrade to deterministic engine line", "source-grep + behavioral render-scan tests"]
key-files:
  created:
    - test/ui/surfaces/situation-room/employee-row-action-card.test.mjs
    - test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs
  modified:
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/primitives/theme.css
decisions:
  - "UI mirror carries DISPLAY fields only (namedAction, awaitedParty, estBucket, actionKind, decisionOptions); sourceIssueUuid OMITTED by construction so the dispatch UUID has no render path (NO_UUID_LEAK is structural, not just tested)"
  - "estBucket mirror typed as the three literals | (string & {}) so a worker-side garbage bucket degrades to omit-estimate via estBucketLabel rather than a type error"
  - "card render is a self-contained IIFE branch inside the existing needs_you block; null card falls through to the EXACT existing deterministic line verbatim (D-12)"
  - "decisionOptions carried in the mirror (data) but NOT rendered as chips this phase (chips are Phase 14)"
  - "theme.css adds .clarity-employee-named-action / .clarity-employee-await typographic emphasis only — NOT a rich card layout (that is Phase 15)"
metrics:
  duration: ~25m
  completed: 2026-06-02
requirements: [ACT-01, ACT-02, ACT-03]
---

# Phase 13 Plan 03: Render Named-Action Card on the Needs-you Row Summary

The cached Editor-Agent named-action sentence + awaited party + coarse estimate now render inline on the existing Situation Room needs-you employee row, degrading to the deterministic engine line whenever a fresh card is absent — making SC1 ("each human-actionable row SHOWS a grounded named action") literally true this phase, with NO chips/Pulse/tiers added (those are Phases 14/15).

## What shipped

- **`src/ui/surfaces/situation-room/employee-row.tsx`**
  - Added an optional `actionCard?` field to the `SituationEmployeeRow` structural mirror, declared inline as the **display fields only** (`namedAction`, `awaitedParty`, `estBucket`, `actionKind`, `decisionOptions`). The worker `ActionCard.sourceIssueUuid` is **intentionally omitted** — there is no field on the UI row for the dispatch UUID, so it cannot be threaded into a render (NO_UUID_LEAK by construction, D-10/D-14). No worker/shared type import.
  - Added a pure helper `estBucketLabel(bucket)` mapping `quick → "quick decision"`, `focused → "~30-min review"`, `deep → "deep work"`, and **anything else → null** (omit the estimate; never a fabricated number — D-09 anti-false-precision).
  - In the `row.group === 'needs_you' && chain` branch: when `row.actionCard` is present, the row renders the Editorial `namedAction` sentence + a quieter `waiting on <party> · <estimate-words>` line; when it is `null`/absent, the row falls through to the **EXACT existing deterministic line verbatim** (`waiting on <awaitedPartyLabel>` / `<leafIssueId> has no owner`) — never blank, never an estimate (D-12 / ACT-02). `decisionOptions` is not rendered as chips.
- **`src/ui/primitives/theme.css`** — `.clarity-employee-named-action` (emphasis) + `.clarity-employee-await` (muted secondary) scoped under `[data-clarity-surface='situation-room']`. Typographic only; no rich-card layout.
- **`test/ui/surfaces/situation-room/employee-row-action-card.test.mjs`** (TDD, RED→GREEN) — mirror shape, sourceIssueUuid omission, estBucketLabel mapping + null-default, fresh-card render, deterministic degrade, and the scope-hold asserts (no chips/Pulse/tier/reply, no dangerouslySetInnerHTML).
- **`test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs`** — extends the NO_UUID_LEAK render-scan: structural (sourceIssueUuid not on the mirror / never accessed) + behavioral (a card whose worker sourceIssueUuid is a real UUID renders zero uuid-regex matches; a scrub-miss in a display string documents the worker (13-02 D-10) as the scrub point while the dispatch UUID stays unleakable).

## Verification (commands run)

- `node scripts/build-ui.mjs` → **PASS** (`dist\ui\index.js 724.8kb · Done`).
- `node --test employee-row-action-card.test.mjs employee-row-strip.test.mjs employee-row-actions.test.mjs` → **43/43 pass** (Task 1 verify).
- `node --test employee-row-no-uuid-leak.test.mjs` → **5/5 pass** (Task 2 verify).
- Combined row+banner suite (5 files) → **71/71 pass, 0 fail**.
- `npx tsc --noEmit` → **exit 0** (clean).

## Success criteria

- **ACT-01 / SC1** — a needs-you row with a fresh card shows the named action + awaited party + estimate. ✓
- **ACT-02 / SC2** — `actionCard` null/absent → the row degrades to the deterministic engine line; never blank, never a fabricated estimate (both branches tested). ✓
- **ACT-03 (render side)** — no chips for `decisionOptions` this phase; `decisionOptions` present produces no chip element (asserted). ✓
- **NO_UUID_LEAK (D-10)** — render-scan extended; `sourceIssueUuid` omitted from the mirror so it can never reach a rendered text node. ✓
- **Scope held (D-13)** — no Pulse, no tier reorg, no chips, no reply input. ✓

## Deviations from Plan

None — plan executed exactly as written. (TDD flow applied to Task 1 per `tdd="true"`: failing test committed conceptually via the RED run, then GREEN implementation; both Task-1 source + test landed in one feat commit since the component and its test are a single render contract.)

## Commits

- `dcea622` feat(13-03): render named-action card inline on needs-you row with deterministic degrade
- `f5dac84` test(13-03): extend NO_UUID_LEAK render-scan to the action-card path

## Self-Check: PASSED

All created/modified files exist on disk; both per-task commits (`dcea622`, `f5dac84`) are in the git log.
