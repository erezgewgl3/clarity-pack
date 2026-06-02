---
phase: 11-honest-blocker-taxonomy-engine
plan: 04
subsystem: ui-blocker-surfaces
tags: [blocker-chain, verdict, NO_UUID_LEAK, big-bang, SC5, compile-gate, UI]
requires:
  - "Plan 11-01 8-variant Terminal union + enriched BlockerChainResult verdict (needsYou/tier/actionAffordance/awaitedPartyLabel/targetAgentUuid/targetIssueUuid) + exported classifyVerdict()"
  - "Plan 11-02 buildEdges nodeMeta {assigneeAgentId, agentState} + resolveAgentState liveness + honest UNCLASSIFIED degrade"
  - "Plan 11-03 build-employees-rollup verdict-driven row (needsYou/tier/actionAffordance/awaitedPartyLabel/*Uuid) + UNCLASSIFIED-on-throw + humanize-snapshot.ts deleted"
provides:
  - "employee-row.tsx gates the assign cluster on verdict.actionAffordance==='assign' (showAssign), never ownerName==='Unassigned'; blockerChain row type widened to carry the verdict; renders scrubbed awaitedPartyLabel only (SC3/SC5/D-13/D-14)"
  - "needs-you-banner.tsx partitions unowned/owned off actionAffordance==='assign'; UNASSIGNED sentinel removed; chase-owner label reads awaitedPartyLabel (D-14)"
  - "live-blocker-panel.tsx renders an honest non-blank line for all 8 kinds via blockerLine(); primary action gated on actionAffordance (reply/nudge/assign/open/none), not kind===HUMAN_ACTION_ON; ON YOU banner gated on needsYou; UNCLASSIFIED → honest open-to-investigate line + no assign (SC1/SC3/D-12)"
  - "org-blocked-backlog-banner-types terminalKind widened to shared Terminal['kind'] 8-kind union (SC1)"
  - "big-bang complete (D-06): repo-wide `tsc --noEmit` reports ZERO error TS; the last red site (live-blocker-panel.tsx) is migrated"
  - "NO_UUID_LEAK render-scan over all 3 blocker surfaces (D-15/Pitfall 5); ON YOU CSS highlight re-keyed off the renamed kinds"
affects: []
tech-stack:
  added: []
  patterns:
    - "Single source of truth: every blocker surface reads the engine verdict, zero view-layer ownership re-derivation (SC5)"
    - "Affordance-gated render: the assign control is gated STRICTLY on actionAffordance==='assign'; a misgate is an honesty defect (SC3)"
    - "Exhaustive switch + const _exhaustive: never in the UI too — blockerLine()/primaryActionLabel() make a 9th kind / 6th affordance a compile error (D-14)"
    - "Split identity rendered-vs-mutation: awaitedPartyLabel is the only displayed awaited-party string; targetAgentUuid/targetIssueUuid stay mutation-only (NO_UUID_LEAK/D-15)"
key-files:
  created: []
  modified:
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/situation-room/needs-you-banner.tsx
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
    - src/ui/primitives/theme.css
    - test/ui/reader-view.test.mjs
    - test/ui/surfaces/situation-room/employee-row-actions.test.mjs
    - test/shared/scrub-human-action.test.mjs
    - test/worker/issue-reader-integration.test.mjs
decisions:
  - "employee-row UI blockerChain type widened to mirror the worker rollup row shape (needsYou/tier/actionAffordance/awaitedPartyLabel/*Uuid/degradeReason) so the row reads the verdict with no re-derivation — the structural-mirror idiom the file already uses for SituationEmployeeRow"
  - "The 'ON YOU' header on the Reader panel is gated on data.needsYou (a person must act) rather than a single kind, so AWAITING_HUMAN and UNOWNED both light it honestly"
  - "Stale-contract worker/shared tests (scrub-human-action, issue-reader-integration EXTERNAL-on-throw) were aligned to the honest contract Plans 11-01/11-02 mandated — not code deviations; the full-green gate is the first place these orphaned tests ran"
  - "The dead data-terminal-kind='HUMAN_ACTION_ON' CSS selector was re-keyed (Rule 1) — a visual regression directly caused by the kind rename, fixed within this plan's render surface"
metrics:
  duration: "~30 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 9
  commits: 6
---

# Phase 11 Plan 04: UI Blocker-Surface Verdict Migration — Big-Bang Close Summary

The last consumers of the legacy `ownerName === 'Unassigned'` / `kind === 'HUMAN_ACTION_ON'` string-matches are gone. All three blocker surfaces — the Situation Room employee row, the needs-you banner, and the Reader live blocker panel — now render straight from the engine verdict (`needsYou` / `tier` / `actionAffordance` / `awaitedPartyLabel`) with zero view-layer ownership re-derivation (SC5/D-13/D-14). The assign affordance is gated STRICTLY to `actionAffordance === 'assign'` (genuinely-unowned only), so an AWAITING_HUMAN or UNCLASSIFIED row never surfaces a false "assign owner" (SC3). The Reader panel renders an honest non-blank line for all 8 kinds — the four new kinds (AWAITING_AGENT_WORKING/STUCK, UNOWNED, UNCLASSIFIED) included — and an UNCLASSIFIED row shows the honest "Can't determine blocker — open to investigate" line with an open affordance and no assign button (D-12). The split-identity UUIDs stay mutation-only (a cross-surface render-scan asserts zero raw UUIDs in any JSX text node — NO_UUID_LEAK/D-15). The big-bang is complete (D-06): `tsc --noEmit` is GREEN repo-wide.

## What Shipped

- **Situation Room assign/chat gated on the verdict (Task 1, SC3/SC5/D-13/D-14).** `employee-row.tsx`: the `UNASSIGNED` sentinel + `isUnowned = chain.ownerName === UNASSIGNED` are replaced by `showAssign = chain?.actionAffordance === 'assign'`; the assign cluster (OwnerPickerPopover + Open-leaf) renders only when `showAssign`, the owned branch (chat/Wake) renders otherwise. The `blockerChain` row TYPE was widened to mirror the worker rollup's verdict-carrying shape (`needsYou`/`tier`/`actionAffordance`/`awaitedPartyLabel`/`targetAgentUuid`/`targetIssueUuid`/`degradeReason`). Every rendered awaited-party string switched from `ownerName` to the scrubbed `awaitedPartyLabel`; `ownerAgentId` stays a mutation-only deep-link arg. `needs-you-banner.tsx`: the unowned/owned partition reads `actionAffordance === 'assign'` (D-14), the `UNASSIGNED` constant is removed, and the chase-owner label reads `awaitedPartyLabel`.
- **Reader panel renders all 8 kinds off the verdict (Task 2, SC1/SC3/D-12).** `live-blocker-panel.tsx`: a new `blockerLine()` exhaustive switch maps every one of the 8 kinds to an honest non-blank line (the 4 new kinds are not blank; UNCLASSIFIED → "Can't determine blocker — open to investigate"). `primaryActionLabel()` now maps the verdict's `actionAffordance` (reply/nudge/assign/open/none) to a label or null — the `kind === 'HUMAN_ACTION_ON'` gate is gone. The "ON YOU" header is gated on `data.needsYou`. Both helpers carry a `const _exhaustive: never` guard. `org-blocked-backlog-banner-types.ts`: `OrgBlockedRow.terminalKind` widened from bare `string` to the shared `Terminal['kind']` 8-kind union. `index.tsx` already threads `critical_path` / `org_blocked_backlog` with no re-derivation in the page body — verified, no change needed.
- **Full-repo green gate + render-scan (Task 3, D-06/SC4/D-15).** `tsc --noEmit` reports ZERO `error TS` repo-wide — the big-bang compile-gate is satisfied. The full `npm test` suite's only remaining failures are 7 pre-existing REQUIREMENTS.md traceability tests (Phase 4 CHAT / Phase 4.1 CTT — unrelated to TAX; logged to `deferred-items.md`) plus an intermittently-flaky chat watchdog timing test (passes 2/2 in isolation). The SC4 purity guards (engine determinism 100× + AI-token grep guard) stay green. A new cross-surface NO_UUID_LEAK render-scan asserts no `target*Uuid` appears in a JSX text node or template interpolation across all three blocker surfaces (Pitfall 5/D-15).

## Verification

- `npx tsc --noEmit` → **0** `error TS` lines repo-wide (D-06 big-bang compile-gate satisfied; the prior-wave's last red site `live-blocker-panel.tsx` is migrated).
- `node --test test/ui/reader-view.test.mjs` → 26 pass / 0 fail (incl. new: verdict-gated action, 8-kind render, UNCLASSIFIED open+no-assign, no-UUID-render).
- `node --test test/ui/surfaces/situation-room/employee-row-actions.test.mjs` → 17 pass / 0 fail (incl. verdict-driven `showAssign` gate + cross-surface NO_UUID_LEAK render-scan).
- `node --test test/shared/scrub-human-action.test.mjs` → 7 pass / 0 fail (migrated off `UNOWNED_SENTINEL`/`HUMAN_ACTION_ON`; +case for the 4 new kinds).
- `node --test test/worker/issue-reader-integration.test.mjs` → 15 pass / 0 fail (root-throw → UNCLASSIFIED honest degrade).
- `node --test test/shared/blocker-chain.test.mjs` → 15 pass / 0 fail (SC4 determinism + AI-token grep guard green — engine untouched).
- Full suite: `npm test` → 2326 tests, 2319 pass, 7 fail — all 7 pre-existing REQUIREMENTS.md traceability failures (CHAT/CTT, unrelated to Phase 11); logged to `deferred-items.md`.
- Source scans: `grep "ownerName === 'Unassigned'"` in `src/` → NONE live; `grep HUMAN_ACTION_ON` in `src/` → comments + (re-keyed) CSS comment only, zero live logic; `grep -E "openai|anthropic|claude_local|llm|gpt|completion" src/shared/blocker-chain.ts` → NONE.

## must_haves coverage

- All three surfaces render off the verdict, zero view-layer ownership re-derivation (SC5/D-06/D-13/D-14) — **met** (employee-row/banner/panel all read `actionAffordance`/`needsYou`/`awaitedPartyLabel`; `ownerName === 'Unassigned'` absent from `src/`).
- Assign affordance appears only for `actionAffordance === 'assign'`; never on AWAITING_HUMAN / UNCLASSIFIED (SC3) — **met** (`showAssign` gate; UNCLASSIFIED → 'open'; behavior tests pin it).
- UNCLASSIFIED shows honest "can't determine — open" line with open affordance + no assign (SC3/TAX-03/D-12) — **met** (`blockerLine()` UNCLASSIFIED case + reader-view test).
- All 8 terminal kinds render a non-blank line; the 4 new kinds are not blank (SC1) — **met** (`blockerLine()` exhaustive switch; reader-view 8-kind test).
- No `targetAgentUuid`/`targetIssueUuid` rendered as text; only `awaitedPartyLabel` shown (NO_UUID_LEAK/D-15) — **met** (cross-surface render-scan + reader-view UUID test).

## Deviations from Plan

**1. [Rule 1 - Bug] Dead `data-terminal-kind='HUMAN_ACTION_ON'` CSS selector lost the ON YOU panel highlight.**
- **Found during:** Task 3 (big-bang completeness scan).
- **Issue:** `theme.css` keyed the Reader panel's awaiting-you border/background on `data-terminal-kind='HUMAN_ACTION_ON'`. After the Plan 11-01 rename the panel stamps `AWAITING_HUMAN`, so the rule never matched — the ON YOU panel silently lost its highlight. This is a visual regression directly caused by the taxonomy rename within this plan's render surface.
- **Fix:** Re-keyed the selector to `AWAITING_HUMAN` + `UNOWNED` (both genuinely put a blocker on the operator).
- **Files modified:** `src/ui/primitives/theme.css`.
- **Commit:** `17a8f39`.

**2. [Test alignment] Stale-contract worker/shared tests aligned to the honest contract (not code deviations).**
- **Found during:** Task 3 full-green gate — these tests are orphaned from Plans 11-01/11-02 and ran for the first time post-migration here.
- `test/shared/scrub-human-action.test.mjs` imported the removed `UNOWNED_SENTINEL` and used the renamed `HUMAN_ACTION_ON` kind — migrated to the first-class `UNOWNED` (no userId) + `AWAITING_HUMAN`, plus a case for the 4 new kinds (incl. UNCLASSIFIED no-assign, D-12). Commit `c518ce3`.
- `test/worker/issue-reader-integration.test.mjs` asserted a root `relations.get` throw → `EXTERNAL`; Plan 11-02 (D-10) changed this to the honest `UNCLASSIFIED` degrade. Updated the assertion; the genuinely-empty-graph → EXTERNAL case stays. Commit `c518ce3`.
- `test/ui/surfaces/situation-room/employee-row-actions.test.mjs` asserted `/isUnowned/`; updated to the verdict-driven `showAssign` / `actionAffordance === 'assign'` gate + a new cross-surface render-scan. Commit `c518ce3`.

## Known Stubs

None. Every surface is wired to the live verdict; no placeholder/empty-data flow was introduced.

## Threat surface

No new security-relevant surface beyond the plan's threat register. T-11-11 (Information Disclosure / UUID render leak) mitigated: a cross-surface render-scan over employee-row / needs-you-banner / live-blocker-panel asserts zero `target*Uuid` in any JSX text node or template interpolation; only `awaitedPartyLabel` + `terminal.label` (scrubbed) render. T-11-12 (false-assign honesty defect) mitigated: the assign cluster is gated strictly on `actionAffordance === 'assign'`; AWAITING_HUMAN and UNCLASSIFIED render no assign control (behavior + source tests). T-11-13 (engine purity regression via UI work) mitigated: no engine file was touched; the determinism + AI-token grep guard stay green (15/15). T-11-SC (package installs) — accept: no installs this phase, first-party src/test edits only.

## Out-of-Scope (logged, NOT fixed)

7 pre-existing REQUIREMENTS.md traceability failures (Phase 4 CHAT-01..11 / Phase 4.1 CTT-01..08) and 1 flaky chat watchdog timing test — none touch Phase 11 files or the blocker taxonomy. Full detail in `.planning/phases/11-honest-blocker-taxonomy-engine/deferred-items.md`.

## Live-drill reminder (RESEARCH A1)

Per Plans 11-01/11-02: confirm `assigneeAgentId` (and the heartbeat signals feeding `resolveAgentState`) actually ride on a real BEAAA `relations.get` blocker node during the phase drill. A runtime miss is conservative (D-04 ⇒ stuck) and does not crash — the fields are read defensively — but TAX-01 agent-liveness coverage degrades if absent.

## Commits

- `7ec60f8` feat(11-04): gate Situation Room assign/chat affordances on the engine verdict
- `156a967` feat(11-04): render all 8 kinds in the Reader panel off the engine verdict
- `c518ce3` test(11-04): full-repo green gate — align stale-contract tests + add NO_UUID_LEAK render-scan
- `17a8f39` fix(11-04): restore ON YOU panel highlight after the HUMAN_ACTION_ON rename
- `e165d94` docs(11-04): log out-of-scope pre-existing test failures (traceability + flaky watchdog)

## Self-Check: PASSED

All 9 modified files present on disk; all 5 task/fix/doc commits present in git history (verified below).
