---
phase: 09-situation-room-actionable-cockpit
plan: 02
subsystem: ui
tags: [situation-room, ui, actionable-cockpit, owner-picker, no-dead-buttons, atomic-deletion]

# Dependency graph
requires:
  - phase: 09-situation-room-actionable-cockpit
    plan: 01
    provides: situation_employees rows with group+isPaused; un-frozen needsYou (unowned topAction); situation.assignOwner action; situation.artifacts left intact for atomic removal here
provides:
  - "Three-group people view (Needs you / Working / Idle, always all three per D-03) fed verbatim by situation_employees+group (R2)"
  - "owner-picker-popover.tsx — chat.roster-sourced (Editor-Agent excluded) + Take it myself (D-02), dispatching situation.assignOwner; force-refetch re-groups the row"
  - "blocked-backlog-expander.tsx — single '+N more blocked issues' expander merging org-backlog + critical-path narrative (R6)"
  - "Per-state action clusters with ZERO dead buttons (R4); banner un-frozen with [Assign first] (R5); Stand-down confirm + Resume (R7 + D-04)"
  - "agents.pauseHeartbeat + issues.requestWakeup worker actions (Stand down / Wake real write paths)"
  - "no-dead-buttons.test.mjs — R9 CI gate enforcing R4"
  - "Dead AgentCard grid + critical-path strip + org-backlog banner + awaiting-you pill + situation.artifacts WORKER handler all removed (R1 + BLOCKER 1 atomic)"
affects: [09-03-deploy-version-bump]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-picker popover reuses the shortcuts-popover outside-click/Esc pattern; options sourced from chat.roster (NOT ctx.agents.list) so the Editor-Agent is never assignable (T-09-11)"
    - "R4 no-dead-buttons enforced by a source-grep CI gate: zero disabled action affordances + zero comment-only no-op onClick; in-flight disabled={busy} on menu items is the only allowed disabled form"
    - "Atomic handler+caller removal (BLOCKER 1): a worker data handler and its sole usePluginData UI caller are deleted in the SAME commit to avoid a wave-gap where the UI calls a removed handler"
    - "Stand down / Wake mirror agents.resumeHeartbeat's THROW-on-failure contract so the UI degrades gracefully (toast: host call pending)"

key-files:
  created:
    - src/ui/surfaces/situation-room/owner-picker-popover.tsx
    - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
    - src/worker/handlers/agent-pause-heartbeat.ts
    - src/worker/handlers/issue-request-wakeup.ts
    - test/ui/surfaces/situation-room/no-dead-buttons.test.mjs
    - test/ui/surfaces/situation-room/employee-row-actions.test.mjs
  modified:
    - src/ui/surfaces/situation-room/index.tsx
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/situation-room/employee-row-strip.tsx
    - src/ui/surfaces/situation-room/needs-you-banner.tsx
    - src/ui/primitives/theme.css
    - src/worker.ts
    - src/manifest.ts
    - scripts/coexistence-checks/11-take-ownership.mjs
    - test/ui/situation-room.test.mjs
    - test/ui/clarity-pack-css-rules.test.mjs
    - test/ui/no-react-key-warnings.test.mjs
    - test/build/runtime-css-injection.test.mjs
    - test/ui/surfaces/situation-room/employee-row-strip.test.mjs
    - test/ui/surfaces/situation-room/needs-you-banner.test.mjs
  deleted:
    - src/ui/surfaces/situation-room/agent-card.tsx
    - src/ui/surfaces/situation-room/artifact-chip-row.tsx
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx
    - src/ui/surfaces/situation-room/critical-path-strip.tsx
    - src/ui/surfaces/situation-room/awaiting-you-pill.tsx
    - src/worker/handlers/situation-artifacts.ts
    - test/ui/agent-card-now-doing-fallback.test.mjs
    - test/ui/surfaces/situation-room/agent-card-open-chat.test.mjs
    - test/ui/surfaces/situation-room/artifact-chip-row.test.mjs
    - test/worker/handlers/situation-artifacts.test.mjs
    - test/ctt07/situation-artifacts-no-issue-update.test.mjs
    - test/ui/surfaces/situation-room/critical-path-affordances.test.mjs
    - test/ui/surfaces/situation-room/employee-row.test.mjs
    - test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs

key-decisions:
  - "Stand down + Wake required NEW worker action handlers (agents.pauseHeartbeat + issues.requestWakeup): no UI-callable pause/wake action existed on this host (chat Pause was visual-only). Capabilities agents.pause + issues.wakeup already declared, so NO new capability and NO version bump. Without them, R4 (no dead buttons) could not be satisfied for the stale/blocked-owned rows."
  - "situation.artifacts handler + its usePluginData UI caller deleted in ONE commit (BLOCKER 1 atomicity) — Task 2 / 621935f."
  - "Three extra dead test files (critical-path-affordances, employee-row, org-blocked-backlog-banner) + COEXIST-11 were updated beyond the plan's explicit file list (WARNING 3): all asserted now-deleted components/handler and would have broken the suite/gate."
  - "Bundle ceiling NOT recalibrated — net deletions dropped the UI bundle to 719.1 kB (736,355 B) vs the 735 kB / 752,640 B ceiling (down from 09-01's 731 kB)."
  - "sparkline.tsx retained (now dead — agent-card was its only importer): the plan did not list it for deletion; kept to avoid scope creep, tracked under Deferred Issues."

requirements-completed: [R1, R2, R4, R5, R6, R7, R9]

# Metrics
duration: 60 min
completed: 2026-05-31
---

# Phase 9 Plan 02: Situation Room actionable cockpit — UI tier Summary

**The Situation Room is now one actionable cockpit: a three-group people view (Needs you / Working / Idle, always all three) fed verbatim by the worker rollup, where every surfaced button performs a real action — the hero `[Assign owner ▾]` popover (chat.roster-sourced, "Take it myself" included) round-trips `situation.assignOwner` and force-refetches so the row visibly re-groups, Wake/Stand-down/Resume are real worker writes, the banner is un-frozen with `[Assign first]`, and the dead AgentCard grid + org-backlog banner + critical-path strip + the `situation.artifacts` worker handler are all gone (BLOCKER 1 removed atomically with its UI caller).**

## Performance
- **Duration:** ~60 min
- **Completed:** 2026-05-31
- **Tasks:** 3
- **Files:** 7 created, 15 modified, 14 deleted (6 source + 8 test)
- **Net:** 35 files changed, +1894 / -4465 lines (deletion-heavy — R1 cleanup)

## Accomplishments
- **R4 — no dead buttons (the operator's headline rule).** `employee-row.tsx` rewritten into per-state action clusters: blocked-unowned → `[Assign owner ▾]` + `[Open <leaf> ↗]`; blocked-owned → `[Open chat: <owner>]` + `[Wake]` + `[Open ↗]`; working → "moving · no action needed" (no buttons); idle → `[Assign work ▾]`; stale → `[Assign work ▾]` + `[Stand down]` (confirm). Every button fires a real worker action / navigation, or is absent — zero `disabled` action affordances, zero no-op onClick. Enforced by the new `no-dead-buttons.test.mjs` CI gate (R9).
- **R3 hero round-trip (UI tier).** `owner-picker-popover.tsx` lists the roster from `usePluginData('chat.roster')` (Editor-Agent excluded server-side, T-09-11 — NOT `ctx.agents.list`), role-ordered verbatim (no smart sort, D-01), plus a `.self` "Take it myself" item (D-02, `takeItMyself`). Selecting dispatches `situation.assignOwner`; on `{ ok }` the parent force-refetches and the row re-groups (the mockup's "jumps into Working" behavior).
- **R2 / D-03 — three groups always.** `employee-row-strip.tsx` rewritten to partition by the worker `group` field (no client re-sort) and render all three sections always; an empty group shows its header + count + "— none —".
- **R5 — un-frozen banner.** `needs-you-banner.tsx` rewritten: urgent+unowned counts unowned blockers and `[Assign first]` scrolls the oldest-unowned row into view and opens its picker (NOT a chat deep-link — WARNING 1); urgent+all-owned keeps the chat deep-link; neutral only at count 0. The old `disabled={!deepLink}` dead-button pattern is gone.
- **R6 — one expander.** `blocked-backlog-expander.tsx` folds the residual org-backlog rows AND the critical-path narrative into a single `+N more blocked issues` drill-down at the end of Needs-you; each orphan row reuses the owner picker.
- **R7 + D-04 — confirm posture + paused.** Assign applies immediately; Stand down opens an inline confirm before dispatching pause. A paused row (`row.isPaused`) stays in Idle with a "paused" marker + one-click `[Resume]` (`agents.resumeHeartbeat`).
- **R1 + BLOCKER 1 — dead surface removed atomically.** Deleted the AgentCard grid, artifact-chip-row, org-blocked-backlog-banner, critical-path-strip, awaiting-you-pill (UI) and the `situation.artifacts` WORKER handler + its `worker.ts` registration + the dead `situationArtifactsWindow` config key — the handler and its `usePluginData('situation.artifacts')` UI caller removed in the SAME commit (621935f), so no wave-gap exists. Dead grid/critical-path/awaiting-you/artifact CSS removed.

## Task Commits
1. **Task 1 — owner-picker + expander + per-state clusters (R4)** — `a480d4c` (feat)
2. **Task 2 — three-group cockpit + un-frozen banner + force-refetch; delete dead grid + situation.artifacts handler ATOMICALLY (R1/R2/R5/R6/BLOCKER 1)** — `621935f` (feat)
3. **Task 3 — grid→group test dispositions + no-dead-buttons R4 gate; full suite green** — `875f230` (test)

## BLOCKER 1 atomicity confirmation
The `situation.artifacts` WORKER handler (`src/worker/handlers/situation-artifacts.ts`), its `worker.ts` import + `registerSituationArtifacts` call, and the `situationArtifactsWindow` manifest config key were deleted in the SAME commit (`621935f`) as the `usePluginData('situation.artifacts')` UI caller in `index.tsx`. There is no wave where the deployed UI calls a removed handler. Verified: zero `usePluginData('situation.artifacts')` callers in `src/`, zero `registerSituationArtifacts` in `src/worker.ts`, handler file absent.

## Test file dispositions (WARNING 3 — verified paths + actual disposition)

**REWRITE (component/handler still exists):**
- `test/ui/situation-room.test.mjs` — grouped render (three sections + counts + "— none —"); no `.clarity-agent-grid` / `AgentCard`; rows under worker group (R2); deleted files asserted gone.
- `test/ui/clarity-pack-css-rules.test.mjs` — audit set swapped to group/popover/expander/button/banner classes; dead grid CSS asserted ABSENT; **bug-fix:** the build-gated dist check now reads `dist/ui/index.js` (CSS is inlined there per DEV-14; no `dist/ui/index.css` sidecar exists — the old reference was a latent skip-gated failure).
- `test/build/runtime-css-injection.test.mjs` — injected-selector set updated to `clarity-group-section`.
- `test/ui/no-react-key-warnings.test.mjs` — FILES set updated to the new map()-bearing components; AgentCard regression replaced with the grouped-strip key check.
- `test/ui/surfaces/situation-room/employee-row-strip.test.mjs` — grouped renderer assertions (R2/D-03/R6).
- `test/ui/surfaces/situation-room/needs-you-banner.test.mjs` — un-frozen banner (R5/WARNING 1); no `disabled`; no standalone org-banner mount.

**DELETE (tests a deleted component/handler):**
- `test/ui/agent-card-now-doing-fallback.test.mjs` (AgentCard)
- `test/ui/surfaces/situation-room/agent-card-open-chat.test.mjs` (AgentCard)
- `test/ui/surfaces/situation-room/artifact-chip-row.test.mjs` (artifact-chip-row)
- `test/worker/handlers/situation-artifacts.test.mjs` (situation.artifacts handler — BLOCKER 1; removes the project's one pre-existing failure)
- `test/ctt07/situation-artifacts-no-issue-update.test.mjs` (situation.artifacts-specific)
- `test/ui/surfaces/situation-room/critical-path-affordances.test.mjs` *(not in plan list — WARNING 3; tests deleted critical-path-strip + take-ownership/convert-to-task CSS)*
- `test/ui/surfaces/situation-room/employee-row.test.mjs` *(not in plan list — WARNING 3; asserted the old disabled/deferred-no-op behavior this plan removed; superseded by employee-row-actions.test.mjs)*
- `test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs` *(not in plan list — WARNING 3; readFileSync of the deleted banner would break collection)*

**NEW:**
- `test/ui/surfaces/situation-room/no-dead-buttons.test.mjs` (R9 gate — R4 enforced in CI)
- `test/ui/surfaces/situation-room/employee-row-actions.test.mjs` (per-state clusters + paused marker/Resume D-04 + Stand-down confirm R7)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added agents.pauseHeartbeat + issues.requestWakeup worker action handlers**
- **Found during:** Task 1 (wiring the stale-row Stand down + blocked-owned Wake buttons).
- **Issue:** R4 requires Stand down → `ctx.agents.pause` and Wake → `requestWakeup`, but NO UI-callable pause/wake action existed on this host (the chat surface's Pause is explicitly visual-only because no `agents.pauseHeartbeat` key was ever bound). Rendering those buttons as no-ops would violate R4.
- **Fix:** Created `src/worker/handlers/agent-pause-heartbeat.ts` (`agents.pauseHeartbeat`) and `src/worker/handlers/issue-request-wakeup.ts` (`issues.requestWakeup`), both opt-in-guard wrapped, THROW-on-failure (mirroring `agents.resumeHeartbeat`), registered in `worker.ts`. Capabilities `agents.pause` + `issues.wakeup` already declared — no new capability, no version bump.
- **Files modified:** the two new handlers + `src/worker.ts`.
- **Verification:** tsc clean; `employee-row-actions.test.mjs` asserts the row dispatches both keys; full suite green.
- **Commit:** `a480d4c` (handlers) + `621935f` (registration).

**2. [Rule 1 - Bug] Deleted 3 additional dead test files + 1 obsolete CSS-build assertion beyond the plan's file list (WARNING 3)**
- **Found during:** Task 3 (full-suite run surfaced 33 failures).
- **Issue:** `critical-path-affordances.test.mjs`, `employee-row.test.mjs`, and `org-blocked-backlog-banner.test.mjs` tested deleted components (the last via `readFileSync`, which throws on collection); the `clarity-pack-css-rules.test.mjs` build-gated test asserted a `dist/ui/index.css` sidecar the build hasn't emitted since DEV-14 (CSS is inlined into `index.js`).
- **Fix:** Deleted the three dead test files (WARNING 3 — note their substitution here); pointed the dist assertion at `dist/ui/index.js`.
- **Verification:** full suite 2311 pass / 0 fail with `RUN_BUILD_TESTS=1`.
- **Commit:** `875f230`.

**3. [Rule 1 - Bug] Updated COEXIST-11 to treat the deleted situation.artifacts handler as the expected state**
- **Found during:** Task 3 (`Coexistence: run-all.mjs exits 0` failed).
- **Issue:** `scripts/coexistence-checks/11-take-ownership.mjs` asserted `src/worker/handlers/situation-artifacts.ts` EXISTS (Phase 6.1 surface-preservation) — now wrong after BLOCKER 1 deletion.
- **Fix:** Removed `situation-artifacts.ts` from the existence list and changed Assertion 3 so absence PASSES (CTT-07 vacuously satisfied — a non-existent handler cannot mutate host state).
- **Verification:** `run-all.mjs` exits 0 (11/11 PASS).
- **Commit:** `875f230`.

---

**Total deviations:** 3 auto-fixed (1 missing-critical, 2 bug). **Impact:** the missing-critical fix is the only behavioral addition — two new worker actions required by R4, both behind already-declared capabilities; the other two are test/gate reconciliations for this plan's deliberate deletions. No scope creep, no version bump.

## Deferred Issues
- **`sparkline.tsx` is now dead code** — its only importer was the deleted `agent-card.tsx`. The plan did not list it for deletion, and `situation-room.test.mjs` + `clarity-pack-css-rules.test.mjs` still assert it exists / has CSS, so it is retained to avoid scope creep. Safe to delete in a future cleanup (Plan 09-03 or a quick task) along with its `.clarity-sparkline` CSS and the two test assertions.

## Known Stubs
None — no `TODO` / `FIXME` / placeholder / empty-data-sink patterns introduced. Every surfaced action button performs a real worker action or navigation (R4 — verified by `no-dead-buttons.test.mjs`).

## Threat Surface
No NEW surface beyond the plan's `<threat_model>`. T-09-05 (info disclosure) mitigated — React text nodes only, no `dangerouslySetInnerHTML` in any new/edited UI file; `ownerAgentId`/`agentId` consumed only as deep-link/dispatch args. T-09-11 (EoP) mitigated — the owner picker sources options from `chat.roster` (Editor-Agent excluded), never `ctx.agents.list`; asserted by `no-dead-buttons.test.mjs`. T-09-06/07 (assign dispatch + force-refetch) accepted as in 09-01 — server-side re-gate is the real boundary. The two new actions (`agents.pauseHeartbeat`, `issues.requestWakeup`) go through typed `ctx.agents.pause` / `ctx.issues.requestWakeup` under already-declared capabilities; the host enforces governance (pause/wake on a real agent/issue).

## Next Phase Readiness
- **For Plan 09-03 (deploy / version bump):** the UI tier is complete and the suite is green. 09-03 bumps `package.json` + `src/manifest.ts` to **1.3.0** (version is unchanged at 1.2.2 here per plan), ships the snapshot-bookended BEAAA reinstall, and runs the live assign-owner / Stand-down / Resume / Wake drill (R8 — the live drill clicks every distinct action type ≥ once). Two new action keys (`agents.pauseHeartbeat`, `issues.requestWakeup`) are now part of the worker surface the drill should exercise.
- **Bundle headroom:** 719.1 kB (736,355 B) of the 752,640 B ceiling — ~16 kB of headroom; no recalibration this plan.

## Self-Check: PASSED
- All 7 created files + this SUMMARY exist on disk (verified below).
- All 3 task commits (`a480d4c`, `621935f`, `875f230`) present in git log.
- All 14 deleted files (6 source + 8 test) confirmed gone.
- Gates re-run green: `tsc --noEmit` clean; `check-css-scope` PASS (189 selectors, all scoped); `check-ui-bundle-size` PASS (736,355 B < 752,640 B, no SheetJS); full suite **2311 pass / 0 fail** with `RUN_BUILD_TESTS=1`; coexistence run-all 11/11 PASS.
- BLOCKER 1 atomicity verified: zero `usePluginData('situation.artifacts')` callers + handler file absent + zero `registerSituationArtifacts` in worker.ts.

---
*Phase: 09-situation-room-actionable-cockpit*
*Completed: 2026-05-31*
