---
phase: 08-situation-room-people-first-cockpit
plan: 02
subsystem: ui
tags: [situation-room, employee-strip, needs-you-banner, cockpit, no-uuid-leak, room-13, room-14, room-15, room-16, room-17, room-18, css-tokens, bundle-ceiling]
requires:
  - src/worker/situation/build-employees-rollup.ts (SituationEmployeeRow + NeedsYou shapes — Plan 08-01)
  - src/ui/surfaces/chat/deep-link.mjs (buildChatDeepLink employee-only carrier)
  - src/ui/primitives/state-pill-format.ts (formatAge)
  - src/ui/primitives/use-resolved-company-id.ts (extractCompanyPrefixFromPathname)
provides:
  - "EmployeeRow + EmployeeRowStrip — per-agent cockpit rows (worker order verbatim)"
  - "NeedsYouBanner — always-visible top urgency/neutral strip (ROOM-18)"
  - "OrgBlockedBacklogBanner now accepts defaultExpanded (Phase 8 collapse override)"
  - "situation.snapshot rollup rides under situation_employees (agent grid byte-identical)"
  - "5 --clarity-state-* CSS tokens + scoped row/strip/banner chrome"
  - "UI bundle ceiling recalibrated 716 -> 729 kB (Phase 5/7 precedent)"
affects:
  - src/ui/surfaces/situation-room/index.tsx (mount order + companyPrefix/navigate + SituationData widen)
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx (defaultExpanded prop)
  - src/worker/handlers/situation-room.ts (rollup key renamed employees -> situation_employees)
  - scripts/check-ui-bundle-size.mjs (ceiling 716 -> 729 kB)
tech-stack:
  added: []  # NO new runtime dependency (LOCKED)
  patterns:
    - "Source-grep UI test idiom with comment-stripping for forbidden-substring asserts"
    - "B1 namespace correctness in UI: AGENT-uuid (blockerChain.ownerAgentId) threaded into buildChatDeepLink, never USER uuid / topAction.agentId"
    - "Distinct payload key (situation_employees) to avoid clobbering agent-grid employees (AgentEmployee[])"
    - "Empirical bundle recalibration: actual + 3 kB rounded up, no synthetic cap, 740 kB sanity ceiling"
key-files:
  created:
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/situation-room/employee-row-strip.tsx
    - src/ui/surfaces/situation-room/needs-you-banner.tsx
    - test/ui/surfaces/situation-room/employee-row.test.mjs
    - test/ui/surfaces/situation-room/employee-row-strip.test.mjs
    - test/ui/surfaces/situation-room/needs-you-banner.test.mjs
  modified:
    - src/ui/surfaces/situation-room/index.tsx
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx
    - src/ui/primitives/theme.css
    - src/worker/handlers/situation-room.ts
    - scripts/check-ui-bundle-size.mjs
    - test/worker/situation-room-handler.test.mjs
    - .planning/phases/08-situation-room-people-first-cockpit/deferred-items.md
decisions:
  - "Rule 1 fix: Plan 08-01 clobbered agent-grid employees (AgentEmployee[]) with the rollup (SituationEmployeeRow[]); resolved by riding the rollup under situation_employees"
  - "B1 namespace correctness held end-to-end at the UI tier (AGENT uuid never crossed with USER uuid)"
  - "idle/stale Assign-work / Stand-down affordance ships as a NO-OP button (write path deferred per CONTEXT.md)"
  - "Bundle ceiling recalibrated 716 -> 729 kB (Case 2: 716<actual<=740); no synthetic 724 kB cap"
  - "UI test comment-stripping helper added so security/discipline comments don't trip forbidden-substring greps"
metrics:
  duration_min: 16
  tasks: 3
  files_created: 6
  files_modified: 7
  tests_added: 46
  completed: 2026-05-30
---

# Phase 8 Plan 02: Situation Room people-first cockpit (UI tier) Summary

Rendered the Phase 8 people-first cockpit UI on top of Plan 08-01's worker rollup: a per-employee row strip (state dot + name + role + state pill + age + worker-polished focus line + inline blocker-chain leaf + open-chat affordance), an always-visible top "needs you" banner, the repositioned ROOM-12 org-backlog banner pinned collapsed below them, 5 new `--clarity-state-*` CSS tokens, and a recalibrated UI bundle ceiling — all while keeping the ROOM-01..08 agent grid byte-identical.

## What shipped

**Task 1 — EmployeeRow + EmployeeRowStrip + 5 CSS state tokens (`b01db72`, RED `4ff8f95`).** `employee-row.tsx` renders the LOCKED row layout: state dot, name, role, state pill, age chip (`formatAge`), the worker-polished focus line (hidden when null for idle/stale), and — when blocked — the inline `└ blocked by <action> (<leaf>)` chain leaf plus an "Open chat with <owner>" button. The button builds its deep link via `buildChatDeepLink({route:'employee-only', companyPrefix, assigneeAgentId: row.blockerChain.ownerAgentId})` — `ownerAgentId` is an AGENT uuid per Plan 08-01's B1 guarantee, consumed ONLY as the deep-link arg, never rendered as text (NO_UUID_LEAK). M2: the leaf segment is conditionally rendered only when `leafIssueId` is non-null. idle/stale rows render amber + an "Assign work" / "Stand down" affordance shipped as a deferred NO-OP. `employee-row-strip.tsx` maps the worker `employees` array VERBATIM (no `.sort()` / `.filter()`) and renders a "No employees in scope" placeholder for the empty case. `theme.css` gained the 5 LOCKED tokens (`running`/`reviewing`/`blocked`/`idle`/`stale`) + `unknown` fallback, plus scoped `.clarity-employee-*` / `.clarity-state-*` chrome. 28 tests.

**Task 2 — NeedsYouBanner + LOCKED mount order; org-backlog pinned collapsed (`440db75`, RED `1eaf0f8`).** `needs-you-banner.tsx` is the always-visible top strip (zero `useState`): urgent (`⚠ N thing(s) need(s) you → <action>` + Open-chat button) when `count>0`, neutral (`✓ 0 need you — N moving · M idle · K stuck`, counts derived from the employees prop) when `count===0`. B1 owner lookup: `employees.find(e => e.agentId === topAction.agentId)` → `ownerRow.blockerChain.ownerAgentId` (AGENT uuid) into `buildChatDeepLink`; button disabled when stale/unresolvable. `index.tsx` mounts the LOCKED order NeedsYouBanner → EmployeeRowStrip → OrgBlockedBacklogBanner(defaultExpanded={false}) above the unchanged header/critical-path/agent-grid, resolves `companyPrefix`+`navigate`, and widens `SituationData`. `org-blocked-backlog-banner.tsx` gained a `defaultExpanded?: boolean` prop where `defaultExpanded === false` wins over `need_you_count > 0`. 21 tests (49 incl. affected suites).

**Task 3 — bundle ceiling recalibration (`679e831`).** Built UI = 742,840 B (+18,282 B vs the prior 716 kB build), zero SheetJS sentinels. Case 2 (716<actual≤740): recalibrated to `ceil((742840+3072)/1024) = 729 kB` (746,496 B, ~3.6 kB headroom). Under the 740 kB sanity ceiling; no synthetic 724 kB cap; SheetJS sentinel array intact; version unchanged at 1.1.11.

## Key decisions

- **[Rule 1] Agent-grid clobber fix (worker).** Plan 08-01 spread its rollup into the `employees` key of `situation.snapshot`, silently overwriting the materialized snapshot's `employees` (`AgentEmployee[]`) that the ROOM-01..08 agent grid consumes (`SituationEmployeeRow` has no `userId`, so the grid would render empty/broken). Fixed by riding the Phase 8 rollup under a distinct `situation_employees` key in BOTH return paths — the agent grid stays byte-identical and the strip/banner read `payload.situation_employees`. 08-01 handler tests updated accordingly.
- **B1 namespace correctness held at the UI tier.** Both `EmployeeRow` (direct) and `NeedsYouBanner` (via owner lookup) thread `blockerChain.ownerAgentId` (AGENT uuid) into `assigneeAgentId`, never `topAction.agentId` (the row's id) and never a USER uuid.
- **idle/stale affordance deferred.** Per CONTEXT.md "Deferred Ideas" tap-to-stand-down, the Assign-work / Stand-down button is a NO-OP for now (affordance present, write path deferred), documented in a code comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Worker rollup clobbered the agent-grid `employees` key**
- **Found during:** Task 2 (wiring `SituationData` revealed a duplicate `employees` property — one `AgentEmployee[]`, one `SituationEmployeeRow[]`).
- **Issue:** `src/worker/handlers/situation-room.ts` returned `{ ...payload, employees, needsYou, taken_at }`, where `employees` (the rollup) overwrote `payload.employees` (the agent-grid `AgentEmployee[]`). The agent grid keys on `emp.userId`, which `SituationEmployeeRow` lacks — the ROOM-01..08 grid would break (violates the must_have "agent grid stays byte-identical").
- **Fix:** Renamed the rollup return key to `situation_employees` in both return paths; the UI reads `payload.situation_employees`; the agent grid's `payload.employees` is preserved untouched. Updated the two affected 08-01 handler tests (`situation.snapshot: no-row path …`, `… rollup builder throwing degrades …`) to assert `situation_employees`.
- **Files modified:** `src/worker/handlers/situation-room.ts`, `test/worker/situation-room-handler.test.mjs`, `src/ui/surfaces/situation-room/index.tsx`.
- **Commit:** `440db75`.

**2. [Rule 3 - Blocking] UI test forbidden-substring asserts tripped on source comments**
- **Found during:** Tasks 1 and 2.
- **Issue:** The source-grep test idiom asserts zero `dangerouslySetInnerHTML` / `.sort(` / `.filter(` / `useState`. The components legitimately mention these words in security/discipline comments, so a raw-source grep produced false positives. (The plan's `grep -v '^#'` gate assumes `#`-prefixed comments; JS uses `//`.)
- **Fix:** Added a `stripComments()` helper in the test files that removes `//` and `/* */` comments before forbidden-substring assertions; assertions now evaluate the CODE, not the prose. The intent (no actual usage) is unchanged and proven.
- **Files modified:** the three new test files.

## Invariants held

- `src/worker/jobs/situation-snapshot.ts` (scope-dead recompute job): zero git diff (Pitfall 2).
- `package.json` `version`: still `1.1.11` (bump deferred to Plan 08-03); `dependencies`: byte-identical (LOCKED — no new runtime dependency).
- ROOM-01..08 agent grid (`AgentEmployee[]`): byte-identical — preserved via the `situation_employees` rename.
- All new CSS scoped under `[data-clarity-surface='situation-room']` (AST gate: 200 selectors, all scoped).
- NO_UUID_LEAK: `ownerAgentId` / `topAction.agentId` consumed only as deep-link arg / lookup key, never rendered as text.
- No synthetic 724 kB cap; SheetJS sentinel array unchanged; bundle under 740 kB sanity ceiling.

## Deferred Issues

**Pre-existing unrelated test failure (NOT caused by Plan 08-02):** `situation.artifacts: per-agent arrays sorted DESC by createdAt` (`test/worker/handlers/situation-artifacts.test.mjs`). Documented in 08-01-SUMMARY as independent (reproduces at `d526987`, imports zero Phase 8 files). Re-confirmed under Plan 08-02 — imports zero 08-02 files. Out of scope per SCOPE BOUNDARY; logged to `deferred-items.md`. Full suite: 2374 tests, 2373 pass, 1 fail (this one).

## Verification

- `node scripts/check-css-scope.mjs`: 200 selectors, all scoped — exit 0.
- `npx tsc --noEmit`: exit 0.
- New/affected suites: `employee-row` + `employee-row-strip` + `needs-you-banner` + `org-blocked-backlog-banner` + `situation-room-handler` all green (132 situation-room UI + 45 worker situation).
- Full suite: 2374 tests, 2373 pass, 1 pre-existing fail (out of scope).
- `node scripts/build-worker.mjs` / `build-ui.mjs` / `tsc --project tsconfig.manifest.json`: all clean.
- `node scripts/check-ui-bundle-size.mjs`: 742,840 B of 746,496 B ceiling; no SheetJS sentinels — exit 0.
- `git diff src/worker/jobs/situation-snapshot.ts` + `git diff package.json`: empty.

## Commits

- `4ff8f95` test(08-02): add failing tests for EmployeeRow + EmployeeRowStrip (RED)
- `b01db72` feat(08-02): EmployeeRow + EmployeeRowStrip + 5 CSS state tokens (GREEN, ROOM-13/16/17)
- `1eaf0f8` test(08-02): add failing tests for NeedsYouBanner + mount order (RED)
- `440db75` feat(08-02): NeedsYouBanner + LOCKED mount order; pin org-backlog collapsed; [Rule 1] worker key fix (GREEN, ROOM-18)
- `679e831` chore(08-02): recalibrate UI bundle ceiling 716 -> 729 kB (Phase 5/7 precedent)

## TDD Gate Compliance

All three tasks followed RED → GREEN. Each behavior-adding task has a preceding `test(...)` commit (`4ff8f95`, `1eaf0f8`) and a following `feat(...)` commit (`b01db72`, `440db75`). Task 3 is a config recalibration (no new behavior) committed as `chore`. No REFACTOR commits were needed.

## Self-Check: PASSED

All 7 created source/test/summary files exist on disk; all 5 plan commits (`4ff8f95`, `b01db72`, `1eaf0f8`, `440db75`, `679e831`) are present in git history.
