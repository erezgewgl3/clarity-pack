---
phase: 19-action-cards-async-re-architecture-last-flag-gated
plan: 02
subsystem: worker / action-cards request-path removal (CARD-01)
tags: [card-01, read-cached-only, bounded-warm, static-gate, non-notifying-op-issue, degrade-safe]
requires:
  - "19-01: isActionCardsEnabled / action-cards-flag-repo.ts (runtime kill-switch)"
  - "src/worker/db/action-cards-repo.ts (getActionCardBySource clone template)"
  - "src/worker/agents/agent-task-delivery.ts startAgentTask (16.1 governed plugin_operation op-issue path)"
  - "editor.ts DEFAULT_WARM_MAX_ROWS = 5 (bounded-warm cadence)"
provides:
  - "getActionCardsBySources — batch newest-per-source cached read (DISTINCT ON + text[] ANY bind)"
  - "read-cached-only situation.snapshot handler (driveActionCardsStep DELETED from the request path)"
  - "SWR serve-path flag strip (panic-OFF floors a fresh cached slice instantly)"
  - "ACTION_CARDS_WARM_MAX_ROWS = 5 bounded-warm cap on driveActionCardsStep"
  - "no-on-request-compile.static.test.mjs — CARD-01 anti-regression gate"
  - "storm-safety CARD-01 burst: bounded wakes + provenance suppression + non-notifying mark-done"
affects:
  - "src/worker/handlers/situation-room.ts (snapshot read path + SWR serve path)"
  - "src/worker/agents/action-cards.ts (bounded-warm cap, rowToCard export, isActionCardLive, A1 doc)"
  - "src/worker/db/action-cards-repo.ts (getActionCardsBySources)"
tech-stack:
  added: []
  patterns:
    - "read-cached-only request handler (ZERO AI work on the HTTP path)"
    - "newest-per-source batch read (DISTINCT ON (source) ORDER BY source, generated_at DESC)"
    - "text[] ANY($2::text[]) parameterized bind via toPgTextArrayLiteral (A2 probe verified)"
    - "SWR serve-path flag strip (degrade-to-OFF panic floor with no redeploy)"
    - "bounded-warm cap (<=5 stale rows/heartbeat) reused from 16.1 cadence"
    - "comment-aware static anti-regression gate (strip comments, scan code for forbidden token)"
key-files:
  created:
    - test/worker/db/action-cards-repo-batch.test.mjs
    - test/worker/handlers/no-on-request-compile.static.test.mjs
  modified:
    - src/worker/db/action-cards-repo.ts
    - src/worker/handlers/situation-room.ts
    - src/worker/agents/action-cards.ts
    - test/loop/storm-safety.test.mjs
decisions:
  - "D-04: situation.snapshot is now READ-CACHED-ONLY — the on-request driveActionCardsStep compile block is DELETED, not gated. Cards come only from getActionCardsBySources (flag-gated)."
  - "Liveness arm split: added isActionCardLive (age-only) for the read path rather than reusing isActionCardFresh (hash+age), because the read path recomputes no per-row content hash — using isActionCardFresh would floor every card. Same ACTION_CARD_STALE_MS constant, single-sourced."
  - "D-06 bounded-warm: ACTION_CARDS_WARM_MAX_ROWS = 5 re-DECLARED in action-cards.ts (not imported from editor.ts) to avoid a value read across the editor.ts <-> action-cards.ts circular-import temporal dead zone; both are 5 by design."
  - "A1/D-07: the mark-done writes are NON-NOTIFYING BY CONSTRUCTION (status-only ctx.issues.update on a surfaceVisibility:'plugin_operation' op-issue) — no code change; the storm-safety burst asserts the status-only + plugin_operation properties as a standing CI guard. Live empirical confirm deferred to 19-05 Step-1 (A1 is partly empirical)."
metrics:
  duration: "~30 min"
  completed: "2026-06-15"
  tasks: 3
  files_changed: 6
requirements: [CARD-01]
---

# Phase 19 Plan 02: Read-cached-only snapshot + CARD-01 request-path removal Summary

Took ALL action-card AI work OFF the HTTP request path — the heart of CARD-01 and the
direct fix for the BEAAA-2092 502 + notification storm. The `situation.snapshot` DATA handler
is now **read-cached-only**: the on-request `driveActionCardsStep` compile block is DELETED and
replaced with a flag-gated batch `getActionCardsBySources` read behind a liveness arm. A panic-OFF
flip now floors the room instantly even against a FRESH cached slice (SWR serve-path strip), the
remaining heartbeat compile is bounded to <=5 stale rows, a comment-aware static gate forbids any
future on-request compile, and the mark-done op-issue write is proven non-notifying + governed in CI.

## What Was Built

### Task 1 — Batch newest-per-source cached read `getActionCardsBySources` (commit 63d150d)
- **`src/worker/db/action-cards-repo.ts`** — cloned `getActionCardBySource` into a batch read:
  `SELECT DISTINCT ON (source_issue_id) <cols> ... WHERE company_id = $1 AND source_issue_id = ANY($2::text[]) ORDER BY source_issue_id, generated_at DESC`. Binds the id array as a Postgres array-LITERAL scalar via `toPgTextArrayLiteral` (the SAME `$N::text[]` discipline `upsertActionCard` uses), early-returns `{}` for empty input, and builds a `Record<source_issue_id, ActionCardRow>` keeping the first (newest, DESC) row per source.
- **`test/worker/db/action-cards-repo-batch.test.mjs`** — 4 assertions: empty-input-no-query, the **A2 binding probe** (records SQL+params, asserts `= ANY($2::text[])` + `DISTINCT ON` + `ORDER BY source_issue_id, generated_at DESC` and that `$2` is the exact `toPgTextArrayLiteral` scalar — never a native array), newest-per-source mapping with absent ids missing, and a duplicate-row-robustness guard. The probe confirmed `ANY($2::text[])` binds cleanly through the host bridge — **no per-id fallback loop needed**; the documented contract (a `Record`) holds regardless.

### Task 2 — Read-cached-only attach + SWR serve-path flag strip + bounded-warm cap (commit a2178c2)
- **`situation-room.ts`** — DELETED the on-request compile block (the `needsYouRows` map, the `try`, and the `if (isActionCardsEnabled && needsYouRows.length>0) driveActionCardsStep(...)` call). Removed the `driveActionCardsStep` / `ActionCardsCtx` / `ActionCardSourceRow` imports; added `getActionCardsBySources` + `rowToCard` + `isActionCardLive`. The replacement: when the flag is ON, collect the needs-you leaf UUIDs, batch-read their newest cards, and keep only the **live** ones (`isActionCardLive` age arm — a long-idle stale card floors out). The `:621-627` per-row attach is unchanged. Degrade-safe: any throw or OFF → `cardsBySource = {}` → deterministic floor.
- **SWR serve-path flag strip** — in the SERVE-LAST-GOOD branch, added a flag read (degrade-to-OFF on a read failure); when OFF, the served `situation_employees` are mapped to `actionCard: null` **before** computing needsYou/pulse and returning. This is the literal "flip ONE row, room back to floor with no deploy latency" guarantee — a FRESH cached slice with cards baked in still floors on a panic-OFF.
- **`action-cards.ts`** — added `ACTION_CARDS_WARM_MAX_ROWS = 5` and capped `compileRows` to a `compileSlice` of at most 5 rows per heartbeat (the rest compile on later heartbeats, degrade-safe). Threaded `compileSlice` through the read-back, prompt, and finalize sites. Exported `rowToCard`; added the age-only `isActionCardLive` helper.

### Task 3 — Static no-on-request-compile gate + non-notifying op-issue verification (commit a2e5f27)
- **`test/worker/handlers/no-on-request-compile.static.test.mjs`** — recursively scans every `.ts` under `src/worker/handlers/`, strips comments, and fails the build if any handler's CODE references `driveActionCardsStep` (CARD-01 anti-regression). A second self-test proves the gate is comment-aware (docstring mention allowed, a real call fails) so the strip can't silently break.
- **`test/loop/storm-safety.test.mjs`** — extended `makeStormCtx` with an `action_cards_flag` query branch, an `action_cards` branch, op-issue `surfaceVisibility` tracking on create, and a `markDoneWrites` tracker on `issues.update`. Added the **CARD-01 burst test**: 12 action-card op-issues authored across a simulated restart through the **REAL** `startAgentTask` governed path, asserting (a) actual wakes capped at the governor ceiling (<=6) + kill-switch engaged, (b) every op-issue recorded in `own_operation_issues` (provenance suppression — can't re-enter ingress), (c) every mark-done is a status-only patch on a `plugin_operation` op-issue (non-notifying, A1/D-07), and (d) no second op-issue path.
- **`action-cards.ts`** — documented the A1 non-notifying-by-construction conclusion at the mark-done site (no code change — the op-issue is already `plugin_operation`; the CI burst is the standing guard).

## Verification

- `node --test test/worker/db/action-cards-repo-batch.test.mjs test/worker/handlers/no-on-request-compile.static.test.mjs test/loop/storm-safety.test.mjs test/worker/agents/action-cards.test.mjs` — **29/29 pass**.
- Regression sweep `node --test test/shared/blocker-chain.test.mjs test/loop/no-wake-from-ingress.test.mjs test/worker/agents/bounded-warm.test.mjs test/worker/agents/agent-task-delivery.test.mjs` — **51/51 pass**.
- `npx tsc --noEmit -p tsconfig.json` — **exit 0** (clean).
- `src/shared/blocker-chain.ts` untouched (determinism floor preserved).
- The only `driveActionCardsStep` reference under `src/worker/handlers/` is a single COMMENT (situation-room.ts:594) documenting the deletion — the comment-aware static gate passes.

## Deviations from Plan

### Auto-added correctness helper (Rule 2)

**1. [Rule 2 - Correctness] Added `isActionCardLive` (age-only liveness) instead of reusing `isActionCardFresh`**
- **Found during:** Task 2
- **Issue:** The plan said "applying the liveness arm (`isActionCardFresh` age <= ACTION_CARD_STALE_MS)". But `isActionCardFresh(card, recomputedHash, nowMs)` gates on BOTH a content-hash match AND age. The read-cached-only handler recomputes NO per-row content hash (it no longer compiles), so passing it any value would fail the hash arm and floor EVERY card — defeating the purpose.
- **Fix:** Added a dedicated `isActionCardLive(card, nowMs)` age-only predicate in `action-cards.ts`, sharing the same `ACTION_CARD_STALE_MS` constant (single-sourced). This implements the RESEARCH Pattern 2 intent (floor a long-idle stale card) correctly on the read path.
- **Files modified:** `src/worker/agents/action-cards.ts`, `src/worker/handlers/situation-room.ts`
- **Commit:** a2178c2

### Bounded-warm constant re-declared, not imported (binding choice the plan permitted)

The plan offered "import or re-declare the constant consistently with editor.ts:440". Chose **re-declare** (`ACTION_CARDS_WARM_MAX_ROWS = 5` in action-cards.ts) because `editor.ts` already imports `driveActionCardsStep` from `action-cards.ts` — importing `DEFAULT_WARM_MAX_ROWS` back would read a value across the circular import's temporal dead zone at module eval. Documented inline; both are 5 by design.

## Known Stubs

None. The read path is fully wired (flag-gated batch read + liveness + attach + SWR strip); the heartbeat compile is bounded and rides the existing governed non-notifying op-issue path. No UI-facing placeholders introduced.

## Notes for Downstream Plans

- **19-03/19-04 (surface attaches, D-09):** the read-cached-only contract + `getActionCardsBySources` + `rowToCard` + `isActionCardLive` are the read primitives to reuse for the Reader / Bulletin / Chat attaches. Each must apply the SAME liveness arm and the NO_UUID_LEAK `rescrubPersisted` scrub on display strings.
- **19-05 (operator flip + A1 live confirm):** the SWR serve-path strip means a panic-OFF flip via `setActionCardsEnabled` floors the room with no redeploy. The A1 non-notifying claim is asserted in CI here; the **live empirical confirmation** (no "Someone updated" notification fires during the Step-1 quiet window) is owed in 19-05 Step-1.
- **Deploy (D-12):** the v1.7.5 -> v1.8.0 two-source bump is NOT done here (no behavior change at default OFF — the request path simply no longer compiles).

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes. The batch read is parameterized (T-19-06 mitigated via `toPgTextArrayLiteral` + `ANY($2::text[])`, A2-probe verified); the request-path compile removal mitigates T-19-04; the storm burst proves T-19-05 (self-trigger) and T-19-07 (mark-done notification) by construction.

## Self-Check: PASSED

- src/worker/db/action-cards-repo.ts (getActionCardsBySources) — FOUND
- test/worker/db/action-cards-repo-batch.test.mjs — FOUND
- test/worker/handlers/no-on-request-compile.static.test.mjs — FOUND
- commit 63d150d — FOUND
- commit a2178c2 — FOUND
- commit a2e5f27 — FOUND
