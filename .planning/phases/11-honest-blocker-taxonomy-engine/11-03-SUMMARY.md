---
phase: 11-honest-blocker-taxonomy-engine
plan: 03
subsystem: worker-rollup-consumer
tags: [blocker-chain, verdict, NO_UUID_LEAK, UNCLASSIFIED, SC5, compile-gate]
requires:
  - "Plan 11-01 8-variant Terminal union + enriched BlockerChainResult verdict (needsYou/tier/actionAffordance/awaitedPartyLabel/targetAgentUuid/targetIssueUuid)"
  - "Plan 11-01 exported classifyVerdict(terminal) never-guard"
  - "Plan 11-02 buildEdges nodeMeta {assigneeAgentId, agentState} + resolveAgentState liveness"
  - "Plan 11-02 flattenBlockerChain returning verdict-enriched BlockerChainResult"
provides:
  - "build-employees-rollup.ts re-triages Needs-you off the engine verdict (needsYou + actionAffordance==='assign'), never an ownerName string-match (SC5/D-13/D-14)"
  - "rollup blockerChain row carries the verdict (needsYou/tier/actionAffordance) + split identity (awaitedPartyLabel rendered; targetAgentUuid/targetIssueUuid mutation-only) (D-15)"
  - "rollup chain-build throw ⇒ honest UNCLASSIFIED verdict row (open affordance, never a false assign), not blockerChain=null (D-09/TAX-03)"
  - "humanize-snapshot.ts DELETED (the last unmigrated exhaustive switch); union stays compile-protected by classifyVerdict()"
  - "worker tier typechecks clean repo-wide (only the expected UI live-blocker-panel.tsx errors remain → Plan 11-04)"
affects:
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (still fails tsc — Plan 11-04: kind string-match → verdict.actionAffordance; the ONLY remaining migration site)"
tech-stack:
  added: []
  patterns:
    - "Single source of truth: needs-you membership reads the engine verdict, no view-layer re-derivation (SC5)"
    - "Split identity: awaitedPartyLabel rendered (scrubbed), *Uuid mutation-only — mirrors the leafIssueUuid precedent (NO_UUID_LEAK, D-15)"
    - "Honest degrade over silent null: a thrown chain-build emits UNCLASSIFIED, never blockerChain=null (TAX-03/D-09)"
    - "Delete-the-dead-exhaustiveness-site: a zero-caller exhaustive switch is removed, not migrated, when another never-guard already protects the union"
key-files:
  created: []
  modified:
    - src/worker/situation/build-employees-rollup.ts
    - test/worker/situation/build-employees-rollup.test.mjs
    - test/worker/situation/build-employees-rollup-needsyou.test.mjs
  deleted:
    - src/worker/jobs/humanize-snapshot.ts
    - test/worker/humanize-snapshot.test.mjs
    - test/worker/06.1-06-humanize-viewer-userid.test.mjs
decisions:
  - "Task 2 chose DELETE over MIGRATE: humanize-snapshot.ts had zero src/ imports and zero register wiring (no src/worker/worker.ts exists; only two TEST files imported it). classifyVerdict()'s never-guard in blocker-chain.ts keeps the 8-kind union compile-protected, so deleting the dead exhaustiveness site is the cleanest close."
  - "Deleted the two dedicated humanize tests alongside the source — they exercised only the dead helper using the legacy HUMAN_ACTION_ON/__unowned__ kinds; nothing else imported it."
  - "Rollup awaitedPartyLabel = the SCRUBBED humanAction (not the raw verdict label) so the rendered display string is guaranteed UUID-free; the *Uuid fields carry the raw mutation ids."
metrics:
  duration: "~18 minutes"
  completed: 2026-06-02
  tasks: 2
  files: 6
  commits: 3
---

# Phase 11 Plan 03: Worker Rollup Verdict Migration + Compile-Gate Close Summary

The last worker-tier consumer now reads the honest taxonomy verdict instead of re-deriving ownership from a display string, and the final unmigrated exhaustive switch is gone. `build-employees-rollup.ts` re-triages its Needs-you bucket off `blockerChain.needsYou` + `actionAffordance === 'assign'` (the genuinely-unowned path) rather than the legacy `ownerName === 'Unassigned'` string-match (SC5 — single source of truth). The row carries the engine verdict and the split-identity ids (the scrubbed `awaitedPartyLabel` is the only rendered string; `targetAgentUuid`/`targetIssueUuid` are mutation-only, NEVER rendered — D-15/Pitfall 5). A chain-build throw now emits an honest `UNCLASSIFIED` verdict row (open affordance, never a false "assign owner") instead of a silent `blockerChain = null` (TAX-03/D-09). And `humanize-snapshot.ts` — a dead job with zero src callers whose exhaustive switch was the last `HUMAN_ACTION_ON`/`__unowned__` migration site — was deleted; the union stays compile-protected by `classifyVerdict()`'s `never`-guard. The worker tier now typechecks clean repo-wide; only the UI `live-blocker-panel.tsx` errors remain, owned by Plan 11-04.

## What Shipped

- **Verdict-driven Needs-you re-triage (Task 1, D-13/D-14, SC5).** The `unowned` filter that fed the R5 un-frozen needs-you count now keys on `r.blockerChain.needsYou === true && r.blockerChain.actionAffordance === 'assign'` — the structured engine verdict for a genuinely-UNOWNED chain — instead of `r.blockerChain.ownerName === 'Unassigned'`. The viewer-targeted set (`__targetsViewer`) still keys on `terminal.kind === 'AWAITING_HUMAN' && terminal.userId === viewerUserId` (V4 viewer-scoping preserved). The dead `UNOWNED_SENTINEL` import is gone; `HUMAN_ACTION_ON` reads are renamed to `AWAITING_HUMAN`.
- **Verdict + split-identity passthrough on the row (Task 1, D-15).** The `blockerChain` row object grew `needsYou`, `tier`, `actionAffordance`, `awaitedPartyLabel`, `targetAgentUuid`, `targetIssueUuid`, and optional `degradeReason`. `awaitedPartyLabel` is set to the SCRUBBED `humanAction` (guaranteed UUID-free); `targetAgentUuid` is the verdict's `targetAgentUuid` (an `AWAITING_AGENT_*` agentId, mutation-only); `targetIssueUuid` is the resolved leaf UUID — mirroring the proven `leafIssueUuid` split-identity precedent so no raw UUID enters a rendered field.
- **Honest UNCLASSIFIED on chain-build throw (Task 1, D-09/TAX-03).** The chain-build `try/catch` no longer sets `blockerChain = null`. It builds an `UNCLASSIFIED` terminal, runs it through `classifyVerdict()` (⇒ tier `watch`, affordance `open`, `needsYou` false) and `scrubHumanAction()`, and emits a verdict row with a `degradeReason`. The blocked row stays visible and never surfaces a false "assign owner".
- **Three new rollup tests (Task 1).** (1) verdict re-triage — a genuinely-unowned blocker carries `needsYou:true`/`tier:'needs-you'`/`actionAffordance:'assign'` and is counted; (2) chain-build throw — a root `relations.get` throw yields an `UNCLASSIFIED` row (`affordance:'open'`, `needsYou:false`, a `degradeReason`), not `null`, and does not inflate the count; (3) split identity — an `AWAITING_AGENT_STUCK` leaf renders a UUID-free `awaitedPartyLabel`/`humanAction` while `targetAgentUuid`/`targetIssueUuid` carry the raw UUIDs. The needsyou suite's re-triage assertion was repointed from `ownerName` to the verdict.
- **humanize-snapshot.ts DELETED (Task 2, D-11, SC1).** Import-check: `grep` for any `import` of `humanize-snapshot` in `src/` returned ZERO; `src/worker/` has no top-level `worker.ts` and no `register*` wiring invokes it; the only importers were two test files that tested the dead helper directly. Per the plan's DECISION (zero imports AND zero register wiring ⇒ delete), the source and its two dedicated tests were removed. `classifyVerdict()` in `blocker-chain.ts` (Plan 11-01) provides the surviving exhaustive `never`-guard, so the 8-kind union stays compile-protected.

## Verification

- `node --test test/worker/situation/build-employees-rollup.test.mjs test/worker/situation/build-employees-rollup-needsyou.test.mjs` → 29 pass / 0 fail (was 26; +3 new 11-03 cases).
- `npx tsc --noEmit` → zero `error TS` lines outside `src/ui/surfaces/reader/live-blocker-panel.tsx` (worker tier clean). The 4 remaining errors are all in `live-blocker-panel.tsx` (`HUMAN_ACTION_ON`-no-overlap) — the by-design Plan 11-04 UI migration site (RESEARCH Pitfall 1, inherited from 11-01/11-02).
- Source assertions: `grep -c "ownerName === 'Unassigned'\|UNOWNED_SENTINEL" src/worker/situation/build-employees-rollup.ts` == 0; `grep -c "needsYou\|tier"` == 20 (≥1); `grep -rc "__unowned__" src/worker/jobs/` == 0.
- Regression sweep: `node --test test/shared/blocker-chain.test.mjs test/worker/org-blocked-backlog.test.mjs test/worker/handlers/flatten-blocker-chain-parity.test.mjs test/worker/situation/agent-liveness.test.mjs` → 50 pass / 0 fail (engine determinism + AI-token guard + need_you parity + liveness all green after the deletion).

## must_haves coverage

- build-employees-rollup re-triages Needs-you off verdict.needsYou / actionAffordance, never ownerName==='Unassigned' (SC5, D-13/D-14) — **met** (filter swap; verdict assertion test; source grep == 0).
- The rollup carries the verdict's split identity — human awaitedPartyLabel rendered, targetAgentUuid/targetIssueUuid mutation-only (NO_UUID_LEAK, D-15) — **met** (row shape + render-scan/source-scan test).
- A chain-build throw emits an UNCLASSIFIED verdict (honest fallback line), not a silent null (SC3, TAX-03, D-09) — **met** (root-throw test asserts the UNCLASSIFIED row + degradeReason + open affordance + count not inflated).
- Every exhaustive switch over Terminal handles all 8 kinds so the typecheck compile-gate is satisfied (SC1) — **met** (humanize-snapshot.ts's switch deleted; classifyVerdict() never-guard survives; worker tier tsc clean).

## Deviations from Plan

**1. [Test alignment] Deleted the two dedicated humanize test files alongside the source.**
- **Found during:** Task 2.
- **Issue:** The plan's DECISION mandated deleting `humanize-snapshot.ts`. Its only importers were `test/worker/humanize-snapshot.test.mjs` and `test/worker/06.1-06-humanize-viewer-userid.test.mjs` — both exercise only the deleted helper, using the legacy `HUMAN_ACTION_ON`/`__unowned__` kinds. Leaving them would fail on a missing import.
- **Fix:** Removed both test files in the same commit as the source (they have no value once the helper is gone; the NO_UUID_LEAK contract they guarded is now enforced by `scrub-human-action.ts` + its engine tests). Not a code deviation — the plan's delete path implies removing the orphaned tests.
- **Files modified:** deleted `test/worker/humanize-snapshot.test.mjs`, `test/worker/06.1-06-humanize-viewer-userid.test.mjs`.
- **Commit:** `c2e0482`.

**Process note (not a plan deviation):** the Task 2 commit was first created with an over-broad `git add -A` that swept in pre-existing untracked working-tree artifacts (screenshots, `.codex/`, `.planning/jarvis/`). It was immediately `git reset --soft` + re-staged to contain ONLY the 3 intended deletions before any narration; the final `c2e0482` is clean (3 files changed, 557 deletions). No artifacts leaked into history.

## Threat surface

No new security-relevant surface beyond the plan's threat register. T-11-08 (split-identity disclosure) mitigated: `awaitedPartyLabel` is the SCRUBBED `humanAction` (a render-scan test pins zero raw UUIDs) while `targetAgentUuid`/`targetIssueUuid` carry the UUIDs as mutation-only fields (source-scan test). T-11-09 (chain-build throw honesty) mitigated: a throw yields `UNCLASSIFIED` (`open` affordance, `needsYou:false`), never `null` and never a false `assign` (test asserts the count is not inflated). T-11-10 (Needs-you viewer scoping) mitigated: the viewer-targeted set still keys on the UI-supplied `viewerUserId`; the verdict swap narrows (not widens) by counting only genuinely-unowned `assign` rows + viewer-targeted rows. No package installs (T-11-SC accept).

## Notes for Plan 11-04 (UI — the LAST migration site)

The only remaining `tsc` errors are in `src/ui/surfaces/reader/live-blocker-panel.tsx` (lines 34/81/91): `terminal.kind === 'HUMAN_ACTION_ON'` no-overlap. Plan 11-04 migrates the UI to gate affordances on `verdict.actionAffordance` / `verdict.tier` and render the 4 new kinds (`AWAITING_AGENT_WORKING/STUCK`, `UNOWNED`, `UNCLASSIFIED`). After 11-04 the full repo typechecks clean. The worker half of the big-bang (SC5 worker side) is complete with this plan.

## Commits

- `a107547` feat(11-03): migrate rollup to engine verdict + split-identity + UNCLASSIFIED-on-throw
- `eb6e472` test(11-03): assert engine verdict (not ownerName) in needsyou re-triage (D-13/D-14)
- `c2e0482` refactor(11-03): delete dead humanize-snapshot.ts + its tests (exhaustive-switch compile gate)

## Self-Check: PASSED

All 3 modified files present on disk; all 3 deleted files confirmed gone; all 3 task commits present in git history; SUMMARY present.
