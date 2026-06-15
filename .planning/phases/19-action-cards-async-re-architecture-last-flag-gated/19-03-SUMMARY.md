---
phase: 19-action-cards-async-re-architecture-last-flag-gated
plan: 03
subsystem: surfaces / four-surface action-card parity (CARD-02 / D-09)
tags: [card-02, d-09, four-surface, read-cached-only, no-uuid-leak, degrade-safe, flag-gated]
requires:
  - "19-01: isActionCardsEnabled / action-cards-flag-repo.ts (runtime kill-switch)"
  - "19-02: getActionCardsBySources (batch newest-per-source read) + rowToCard + isActionCardLive (read-path liveness arm)"
  - "src/ui/surfaces/situation-room/employee-row.tsx:374-404 (the card ?? deterministic-floor render analog)"
provides:
  - "BlockerChainResult.actionCard — DISPLAY-only Reader card mirror (no sourceIssueUuid)"
  - "ActionInboxCard.actionCard + ChatActiveTask.actionCard — DISPLAY-only Bulletin/Chat card mirrors"
  - "rowToCardDisplay / ActionCardDisplay — the single shared DISPLAY-only projection (drops sourceIssueUuid + generatedAt)"
  - "attachReaderActionCard — flag-gated read-only Reader card attach"
  - "flag-gated read-only card attaches in bulletin.byCycle + chat.taskOwned"
  - "no-uuid-leak-surfaces.test.mjs — the standing NO_UUID_LEAK + flag-OFF-floor render-scan across the 3 new surfaces"
affects:
  - "src/worker/handlers/flatten-blocker-chain.ts (Reader read path + card attach)"
  - "src/worker/handlers/bulletin-by-cycle.ts (Action Inbox card attach)"
  - "src/worker/handlers/chat-active-tasks.ts (active-task card attach)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (card-or-floor render)"
  - "src/ui/surfaces/bulletin/action-inbox.tsx (card-or-floor render)"
  - "src/ui/surfaces/chat/context-rail.tsx (You-owe card-or-floor render)"
  - "src/worker/agents/action-cards.ts (rowToCardDisplay export)"
tech-stack:
  added: []
  patterns:
    - "read-cached-only surface attach (flag-gated batch read + age-only liveness arm, ZERO AI work on the request path)"
    - "card ?? deterministic-floor render (mirrors employee-row.tsx:374-404 on all 4 surfaces)"
    - "DISPLAY-only card projection (rowToCardDisplay drops sourceIssueUuid — single-source NO_UUID_LEAK omission)"
    - "read-time rescrubPersisted over every card display string (second scrub layer)"
    - "consolidated source-grep + behavioral render-scan guard across multiple surfaces (data-driven SURFACES table)"
key-files:
  created:
    - test/ui/surfaces/reader-action-card.test.mjs
    - test/ui/surfaces/bulletin-action-card.test.mjs
    - test/ui/surfaces/chat-action-card.test.mjs
    - test/ui/surfaces/no-uuid-leak-surfaces.test.mjs
  modified:
    - src/shared/types.ts
    - src/worker/agents/action-cards.ts
    - src/worker/handlers/flatten-blocker-chain.ts
    - src/worker/handlers/bulletin-by-cycle.ts
    - src/worker/handlers/chat-active-tasks.ts
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/bulletin/action-inbox.tsx
    - src/ui/surfaces/chat/active-tasks-owned.tsx
    - src/ui/surfaces/chat/context-rail.tsx
decisions:
  - "D-09: brought the Reader, Bulletin, and Chat needs-you surfaces to four-surface parity with the SR. Each reads the cached card read-only via getActionCardsBySources, flag-gated by isActionCardsEnabled, liveness-armed by isActionCardLive (age-only — the read path recomputes no hash), and floors to its EXISTING deterministic line when stale/absent/OFF."
  - "Added rowToCardDisplay (+ ActionCardDisplay type) as the SINGLE DISPLAY-only projection (drops sourceIssueUuid + generatedAt). Bulletin/Chat use it directly; the Reader builds the same display object inline (its attach helper carries the omission explicitly). One place owns the NO_UUID_LEAK omission."
  - "Chat needs-you slot = the 'You owe' block in context-rail.tsx (the plan's named Chat render file). It renders the named-action prose of the FIRST active task carrying a fresh card; absent any fresh card it floors to the existing 'No outstanding decisions' line. The card data is threaded via the existing activeTasks prop (chat.taskOwned) — no new fetch."
  - "Per-surface card attach added at each handler's existing result-build site, NOT a new compile (CARD-01 invariant preserved — the 19-02 no-on-request-compile static gate still passes, 2/2)."
metrics:
  duration: "~50 min"
  completed: "2026-06-15"
  tasks: 3
  files_changed: 13
requirements: [CARD-02]
---

# Phase 19 Plan 19-03: Four-surface action-card parity (CARD-02 / D-09) Summary

Delivered CARD-02's operator-chosen wider scope (D-09): the Editor named-action prose now
renders on needs-you rows across **all four surfaces** — Situation Room (already shipped),
Reader, Bulletin, and Chat — when the runtime flag is ON and a FRESH cached card exists, and
**each surface floors to its existing deterministic line** when the card is stale/absent or the
flag is OFF. Every new render path attaches the card **read-only** via the 19-02 batch read
(`getActionCardsBySources`), gated by `isActionCardsEnabled`, behind the age-only `isActionCardLive`
liveness arm — **ZERO AI work on any request path** (the CARD-01 invariant extends here; the
19-02 static gate still passes). A single consolidated render-scan guards NO_UUID_LEAK + the
flag-OFF floor across the three new surfaces.

## What Was Built

### Task 1 — Reader four-surface attach + render + tests (commit bba6bb0)
- **`src/shared/types.ts`** — `BlockerChainResult` gains a DISPLAY-only `actionCard` mirror
  (namedAction / awaitedParty / estBucket / actionKind / decisionOptions). The worker
  ActionCard's mutation-only `sourceIssueUuid` is OMITTED by construction (NO_UUID_LEAK, D-10).
- **`src/worker/handlers/flatten-blocker-chain.ts`** — added `attachReaderActionCard`: flag-gated
  (`isActionCardsEnabled`, degrade-to-OFF), batch read over the chain leaf (`result.targetIssueUuid`)
  via `getActionCardsBySources`, `isActionCardLive` age arm, mapped via `rowToCard` then projected
  to display fields only. Called after `scrubResultLabel`; the blocker-free literal path attaches
  nothing (a blocker-free row never needs you). NEVER compiles.
- **`src/ui/surfaces/reader/live-blocker-panel.tsx`** — on the non-reply branch, when a fresh
  `data.actionCard` is present render `rescrubPersisted(card.namedAction)` + the
  `waiting on <party> · <estimate>` line in place of `blockerLine(data)`; else the existing
  `blockerLine(data)` floor. Added a local `estBucketLabel` mirroring the SR helper exactly.
- **`test/ui/surfaces/reader-action-card.test.mjs`** — 12 assertions (worker read-only attach,
  flag-gate, liveness, rowToCard, UI card-or-floor, rescrub, NO_UUID_LEAK behavioral).

### Task 2 — Bulletin + Chat attach + render + tests (commit 7ad2830)
- **`src/worker/agents/action-cards.ts`** — added `rowToCardDisplay` (+ `ActionCardDisplay` type):
  the single DISPLAY-only projection of a cached row (drops `sourceIssueUuid` + `generatedAt`).
- **`src/shared/types.ts`** — `ActionInboxCard` gains the DISPLAY-only `actionCard` mirror.
- **`src/worker/handlers/bulletin-by-cycle.ts`** — after `queryActionInbox`, flag-gated read-only
  batch attach per inbox item (item `issueId` IS the action_cards `source_issue_id` leaf),
  `isActionCardLive` arm, `rowToCardDisplay`. Degrade-safe; never compiles.
- **`src/worker/handlers/chat-active-tasks.ts`** — `ActiveTaskEntry` gains `actionCard?`; same
  flag-gated read-only batch attach per active task. Degrade-safe; never compiles.
- **`src/ui/surfaces/bulletin/action-inbox.tsx`** — fresh card → named-action prose + await/est line;
  else the existing `card.summary` floor. Added `rescrubPersisted` import + local `estBucketLabel`.
- **`src/ui/surfaces/chat/active-tasks-owned.tsx`** — `ChatActiveTask` gains the DISPLAY-only
  `actionCard` mirror.
- **`src/ui/surfaces/chat/context-rail.tsx`** — the "You owe" needs-you slot renders the
  named-action prose of the first active task carrying a fresh card; else the existing
  "No outstanding decisions" line. Added `rescrubPersisted` import + local `estBucketLabel`.
- **`test/ui/surfaces/bulletin-action-card.test.mjs` + `chat-action-card.test.mjs`** — 9 assertions
  each (read-only attach, card-or-floor, NO_UUID_LEAK).

### Task 3 — Consolidated NO_UUID_LEAK + flag-OFF-floor render-scan (commit c9ee89a)
- **`test/ui/surfaces/no-uuid-leak-surfaces.test.mjs`** — the SINGLE standing guard extending the
  SR `employee-row-no-uuid-leak` pattern (same uuid + anchored partial-hex + sourceIssueUuid regex
  set) to Reader / Bulletin / Chat via a data-driven `SURFACES` table. Per surface:
  NO_UUID_LEAK (no `sourceIssueUuid` access/interpolation, no `agent#<hex>` partial hash, no
  `dangerouslySetInnerHTML`) + CARD-03 flag-OFF floor (card render gated on presence; deterministic
  floor token preserved) + a behavioral display-render scan. Plus a coverage assertion so a future
  surface rename/deletion fails the guard rather than silently skipping. 25/25 pass.

## Verification

- `node --test test/ui/surfaces/reader-action-card.test.mjs test/ui/surfaces/bulletin-action-card.test.mjs test/ui/surfaces/chat-action-card.test.mjs test/ui/surfaces/no-uuid-leak-surfaces.test.mjs test/worker/handlers/no-on-request-compile.static.test.mjs` — **57/57 pass**.
- Regression sweep `node --test test/ui/surfaces/situation-room/employee-row-action-card.test.mjs test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs test/shared/blocker-chain.test.mjs test/worker/agents/action-cards.test.mjs` — **63/63 pass**.
- `npx tsc --noEmit -p tsconfig.json` — **exit 0** (clean).
- `src/shared/blocker-chain.ts` UNTOUCHED (`git diff --stat HEAD~2` empty) — determinism floor preserved.
- The 19-02 no-on-request-compile static gate — **2/2 pass** (all 3 new handlers read-only; no `driveActionCardsStep`).

## Deviations from Plan

### Auto-added shared helper (Rule 2 — correctness / NO_UUID_LEAK single-sourcing)

**1. [Rule 2 - Correctness] Added `rowToCardDisplay` (+ `ActionCardDisplay`) as the single DISPLAY-only projection**
- **Found during:** Task 2
- **Issue:** The plan had each surface mirror the employee-row render, but `rowToCard` returns the
  FULL `ActionCard` including the mutation-only `sourceIssueUuid`. Threading the full card to three
  new UI payloads would put the dispatch UUID one careless render away from the DOM on three paths.
- **Fix:** Added `rowToCardDisplay` (drops `sourceIssueUuid` + `generatedAt`) so the omission lives
  in ONE place; Bulletin/Chat attaches carry that shape. The Reader attach carries the same display
  object explicitly inline (its helper documents the omission). This strengthens D-10 by construction.
- **Files modified:** `src/worker/agents/action-cards.ts` (+ the three handler/type sites)
- **Commit:** 7ad2830

### Chat needs-you slot binding (binding choice within the plan's named file)

The plan named `context-rail.tsx` as the Chat render file. The "You owe" block is the only
needs-you slot there; today it is a static empty stub. Bound the card render to it, sourcing the
card from the existing `activeTasks` prop (`chat.taskOwned`) — no new fetch. Floors to the existing
"No outstanding decisions" line. This honors the named file and the "render on the needs-you row"
intent without inventing a new fetch path.

## Known Stubs

None. All three surfaces are fully wired (flag-gated batch read + liveness + display-only attach +
card-or-floor render). At default OFF every surface renders its deterministic floor exactly as
before this plan (the four new payload fields are simply null/absent) — behaviorally INERT until
the operator flips the flag ON (19-05).

## Notes for Downstream Plans

- **19-04 / 19-05:** the four-surface render is live in code at OFF. The two-step enablement (D-08)
  flips the flag ON via the 19-05 RPC; when ON+fresh, the named-action prose appears on all four
  surfaces' needs-you rows. The SWR serve-path strip (19-02) still floors the SR instantly on a
  panic-OFF; the Reader/Bulletin/Chat reads are live per-request, so they floor on the very next
  poll after an OFF flip.
- **Deploy (D-12):** the v1.7.5 → v1.8.0 two-source bump is NOT done here (no behavior change at
  default OFF — the new fields are null until the flag is ON).
- **UI bundle:** the additions are three small render branches + two local `estBucketLabel` helpers
  + one `rescrubPersisted` import per surface — a minor delta; no new dependency. A precise byte
  delta was not measured this plan (no build run); note it at the phase deploy/build step if the
  ceiling matters.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes. T-19-08
(card-render information disclosure) is mitigated on all 3 new surfaces (rowToCardDisplay omission +
rescrubPersisted + the standing render-scan); T-19-09 (on-request compile re-introduction) is
mitigated by the read-only attaches + the 19-02 static gate covering the 3 handlers.

## Self-Check: PASSED

- src/worker/handlers/flatten-blocker-chain.ts (attachReaderActionCard) — FOUND
- src/ui/surfaces/reader/live-blocker-panel.tsx (card-or-floor render) — FOUND
- src/ui/surfaces/bulletin/action-inbox.tsx (card-or-floor render) — FOUND
- src/ui/surfaces/chat/context-rail.tsx (You-owe card-or-floor render) — FOUND
- test/ui/surfaces/reader-action-card.test.mjs — FOUND
- test/ui/surfaces/bulletin-action-card.test.mjs — FOUND
- test/ui/surfaces/chat-action-card.test.mjs — FOUND
- test/ui/surfaces/no-uuid-leak-surfaces.test.mjs — FOUND
- commit bba6bb0 — FOUND
- commit 7ad2830 — FOUND
- commit c9ee89a — FOUND
