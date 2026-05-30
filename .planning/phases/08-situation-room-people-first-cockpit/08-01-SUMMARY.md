---
phase: 08-situation-room-people-first-cockpit
plan: 01
subsystem: worker
tags: [situation-room, employees-rollup, classifier, no-uuid-leak, blocker-chain, room-13, room-14, room-15, room-16, room-17]
requires:
  - src/shared/blocker-chain.ts (flattenBlockerChain + pickTopChains)
  - src/worker/agents/compile-tldr.ts (polishTldr)
  - src/worker/handlers/org-blocked-backlog.ts (buildEdges BFS, now exported)
provides:
  - "situation.snapshot now returns employees: SituationEmployeeRow[] + needsYou alongside org_blocked_backlog"
  - "src/shared/scrub-human-action.ts (single-source-of-truth NO_UUID_LEAK guard)"
  - "src/worker/situation/classify-employee-state.ts (pure 5-state classifier)"
  - "src/worker/situation/build-employees-rollup.ts (per-agent rollup builder + needsYou)"
affects:
  - src/worker/handlers/situation-room.ts (handler return shape widened)
  - src/worker/handlers/org-blocked-backlog.ts (scrubHumanAction import + buildEdges export)
tech-stack:
  added: []  # NO new runtime dependency (LOCKED)
  patterns:
    - "Pure injectable-nowMs classifier for deterministic boundary testing"
    - "Promise.all per-agent compute with per-row degrade-safe try/catch (Pitfall 4)"
    - "Transient __targetsViewer/__activityMs row fields stripped before public return"
    - "B1 namespace correctness: ownerAgentId (AGENT uuid) vs terminal.userId (USER uuid)"
    - "M2 leaf-identifier fallback chain — never a uuid-suffix display string"
key-files:
  created:
    - src/shared/scrub-human-action.ts
    - src/worker/situation/classify-employee-state.ts
    - src/worker/situation/build-employees-rollup.ts
    - test/shared/scrub-human-action.test.mjs
    - test/worker/situation/classify-employee-state.test.mjs
    - test/worker/situation/build-employees-rollup.test.mjs
  modified:
    - src/worker/handlers/situation-room.ts
    - src/worker/handlers/org-blocked-backlog.ts
    - test/worker/situation-room-handler.test.mjs
decisions:
  - "Open Q#1: extracted scrubHumanAction to src/shared/ (more disciplined than export-from-current)"
  - "Open Q#2: idle/stale activity signal = focus issue lastActivityAt, else lastHeartbeatAt"
  - "Open Q#3: doneTodayCount = 0 for v1.2.0 (field present for forward-compat)"
  - "Open Q#4: focus pick = status priority blocked>in_review>in_progress, tie-break lastActivityAt DESC"
  - "M1: in_progress with stale heartbeat classifies as 'stale' (heartbeat freshness wins)"
metrics:
  duration_min: 16
  tasks: 3
  files_created: 6
  files_modified: 3
  tests_added: 36
  completed: 2026-05-30
---

# Phase 8 Plan 01: Situation Room people-first worker tier Summary

Extended `situation.snapshot` to return a per-employee row strip (`employees: SituationEmployeeRow[]`) plus a pre-computed `needsYou` banner payload alongside the existing ROOM-12 `org_blocked_backlog`, built from a pure deterministic 5-state classifier and a per-agent rollup that reuses the polish + blocker-chain + NO_UUID_LEAK pipelines byte-identical.

## What shipped

**Task 1 — `scrubHumanAction` extraction (`a9c7322`).** Moved `scrubHumanAction` + `UUID_RE`/`UUID_RE_G`/`UNOWNED_SENTINEL` verbatim out of `org-blocked-backlog.ts` into a new `src/shared/scrub-human-action.ts` single source of truth. `org-blocked-backlog.ts` now imports it (byte-identical behavior). 6 dedicated unit tests pin NO_UUID_LEAK across all four terminal kinds; the Plan 07-03 ROOM-12 regression suite (20 tests) stays green.

**Task 2 — pure 5-state classifier (`afed95c`).** `src/worker/situation/classify-employee-state.ts` exports `classifyEmployeeState` (running/reviewing/blocked/idle/stale + unknown). Heartbeat freshness (5min window) is the SOLE running signal — an `in_progress` issue with a stale heartbeat classifies as `'stale'` (M1), never `'running'`. Pure: nowMs injected, no SDK, no wall-clock read. 10 boundary tests at the 5min/24h thresholds.

**Task 3 — per-employee rollup + handler wiring (`d89a460`).** `src/worker/situation/build-employees-rollup.ts` exports `buildEmployeesRollup` returning `{ employees, needsYou }`. Per agent (parallel `Promise.all`, per-row degrade-safe try/catch): open-issue fetch + client-side OPEN_STATUSES filter, focus pick, `classifyEmployeeState`, `polishTldr`-polished focusLine (≤80 truncation, null for idle/stale), and — when blocked — the reused `buildEdges` → `flattenBlockerChain` → `pickTopChains` → `scrubHumanAction` chain. Sorted blocked→stale→idle→reviewing→running (oldest-first / most-recent-first within bucket). `needsYou.count` keys on `terminal.userId === viewerUserId` (mirrors org-backlog semantic); `topAction` names the oldest blocker. Wired into `situation.snapshot` with `employees` + `needsYou` in BOTH return paths. 18 builder tests + 2 handler integration tests.

## Key decisions

- **B1 namespace correctness:** `blockerChain.ownerAgentId = focusIssue.assigneeAgentId` (AGENT uuid), never `terminal.userId` (USER uuid). The latter is used only for the `needsYou` viewer-match. Test 16 enforces with distinct AGENT vs USER uuid fixtures.
- **M2 leaf fallback:** `leafIssueId` = leaf identifier → `focusIssue.identifier` → `null`; never a `#<8hex>` uuid-suffix string. Test 17 enforces (leaf `issues.get` throws → falls back to root identifier).
- **buildEdges reuse:** exported the existing BFS from `org-blocked-backlog.ts` rather than copy-pasting (Don't-Hand-Roll / anti-pattern guard).

## Invariants held

- `src/worker/jobs/situation-snapshot.ts` (scope-dead recompute job): zero git diff added lines (Pitfall 2).
- `migrations/`: zero new files (Phase 8 LOCKED — no new schema).
- `package.json` `dependencies`: byte-identical (LOCKED — no new runtime dependency).
- NO_UUID_LEAK: every produced `blockerChain.humanAction` contains zero hex UUIDs (Test 13 + 6 scrub tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan-referenced test paths corrected**
- **Found during:** Tasks 1 and 3.
- **Issue:** The plan referenced `test/worker/handlers/org-blocked-backlog.test.mjs` and `test/worker/handlers/situation-room.test.mjs`. The actual files live at `test/worker/org-blocked-backlog.test.mjs` and `test/worker/situation-room-handler.test.mjs`.
- **Fix:** Targeted the real existing files; added the new shared-module tests at `test/shared/scrub-human-action.test.mjs` and the classifier/rollup tests under `test/worker/situation/`.
- **Files modified:** test paths only.

**2. [Rule 3 - Blocking] `SituationRoomCtx` widened (not left unchanged)**
- **Found during:** Task 3.
- **Issue:** The plan said "DO NOT widen SituationRoomCtx — the existing widening already covers agents.list + issues.get". The committed type only had `issues: Pick<…,'list'|'relations'>` and `agents?: Pick<…,'get'>` — it did NOT cover `agents.list` or `issues.get`, which the rollup needs.
- **Fix:** Widened to `issues: Pick<…,'list'|'get'|'relations'>` and `agents?: Pick<…,'list'|'get'>`. Runtime host ctx already carries the full SDK clients; this is a type-level correction only. Typecheck clean.
- **Files modified:** `src/worker/handlers/situation-room.ts`.

**3. [Rule 3 - Blocking] `flattenBlockerChain` single-object signature**
- **Found during:** Task 3.
- **Issue:** Some plan prose implied positional args `flattenBlockerChain(rootIssueId, edges, ...)`. The real export takes one `BlockerChainInput` object `{ startId, edges, nodeMeta, viewerUserId }`.
- **Fix:** Called it with the object form (matching the existing org-backlog call site).

## Deferred Issues

**Pre-existing unrelated test failure (NOT caused by Plan 08-01):**
`situation.artifacts: per-agent arrays sorted DESC by createdAt` (`test/worker/handlers/situation-artifacts.test.mjs:392`) fails (`arr.length === 5` assertion). Proven independent: it reproduces identically with the pre-08-01 handler files checked out at `d526987`, and `situation-artifacts.test.mjs` imports nothing Plan 08-01 created or modified. Logged to `deferred-items.md`; out of scope per deviation-rules SCOPE BOUNDARY. Full suite: 2326 tests, 2323 pass, 1 fail (this pre-existing one).

## Verification

- `node --test` (new + modified suites): 65 pass, 0 fail.
- `npx tsc --noEmit`: exit 0.
- `node scripts/build-worker.mjs`: clean (`dist/worker.js 2.5mb`).
- `git diff src/worker/jobs/situation-snapshot.ts`: empty.
- `git diff migrations/` + `git diff package.json`: empty.

## Commits

- `a9c7322` refactor(08-01): extract scrubHumanAction to src/shared/scrub-human-action.ts
- `afed95c` feat(08-01): add pure 5-state employee classifier (ROOM-14)
- `d89a460` feat(08-01): per-employee rollup + needsYou; wire into situation.snapshot (ROOM-13/15/16/17)

## Self-Check: PASSED

All 6 created source/test files exist on disk; all 3 task commits (`a9c7322`, `afed95c`, `d89a460`) are present in git history.
