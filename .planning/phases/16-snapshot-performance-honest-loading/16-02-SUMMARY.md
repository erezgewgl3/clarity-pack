---
phase: 16-snapshot-performance-honest-loading
plan: 02
subsystem: worker-snapshot-perf
tags: [wave-a, sql-prefetch, shared-edge-graph, n+1-collapse, stage-timing, no-uuid-leak, viewer-scope, snap-01, snap-02, degrade-safe]
requires:
  - "16-01-SUMMARY.md / 16-SCHEMA-VERIFY.md: locked public.issues column set (10 names) + public.agents working set (8 names, LIVE-CHECK-REQUIRED); EXCLUDE_OPERATION_ISSUES_SQL verbatim"
  - "16-PATTERNS.md: standing-numbers.ts ctx.db.query SQL template (lines 65-115); the exported buildEdges to share (org-blocked-backlog.ts:270-355); situation-room.ts orchestration section (203-243)"
  - "@paperclipai/plugin-sdk@2026.512.0: PluginDatabaseClient.query (SELECT-only); public.issues/public.agents in coreReadTables"
provides:
  - "src/worker/handlers/situation-room.ts: buildSnapshotPrefetch — TWO parameterized ctx.db.query SELECTs (public.issues OPEN-superset + public.agents roster), a nameByUuid Map built ONCE, a shared edgeGraph (buildEdges walked once per distinct blocked-issue id), threaded into both builders; per-stage snap.stage timing"
  - "SnapshotPrefetch ctx fields (blockedIssues, nameByUuid, edgeGraph) on OrgBlockedBacklogCtx + rollup-specific (roster, issuesByAgentId, issuesById) on EmployeesRollupCtx — all OPTIONAL with RPC fallback (degrade-safe)"
  - "test/worker/situation/snapshot-prefetch.test.mjs: round-trip-count + memoized-BFS + viewer-scope + stage-timing + degrade assertions (8 tests)"
affects:
  - "Wave B (16-03) bounds the rollup's remaining per-agent Promise.all fan-out + floors the irreducible relations.get walks with mapBounded + withDeadline; the shared edgeGraph is the walk-set it caps"
  - "16-04 BEAAA bookended drill confirms/back-fills assignee_user_id + last_heartbeat_at (highest-risk) against the live \\d and records the real cold-time delta"
tech-stack:
  added: []
  patterns:
    - "ctx.db.query SQL-prefetch supplanting an N+1 RPC list/get fan-out (mirrors standing-numbers.ts) — one public.issues SELECT over the OPEN status superset serves BOTH the org-backlog blocked list AND the rollup per-agent focus; one public.agents SELECT serves roster + every uuid→name resolution"
    - "snake_case→camelCase row mapping at the prefetch boundary (mapIssueRow/mapAgentRow) so the two builders' existing camelCase-reading logic is untouched"
    - "shared blocker-BFS memo keyed by startId over the union {blocked roots} ∪ {blocked agent focus} (= the blocked-id set, since every rollup focus that drives a chain is itself a blocked issue); a thrown walk stored as an UNCLASSIFIED sentinel, never a dropped issue"
    - "optional-prefetch-field degrade pattern: a builder reads the prefetch when the field is present, falls back to its original RPC path when absent — old fixtures + a failed prefetch both keep working with zero behavior change"
    - "per-stage const t0=Date.now() … ctx.logger.info('snap.stage',{stage,ms,companyId}) wall-clock instrumentation"
key-files:
  created:
    - test/worker/situation/snapshot-prefetch.test.mjs
    - .planning/phases/16-snapshot-performance-honest-loading/deferred-items.md
  modified:
    - src/worker/handlers/situation-room.ts
    - src/worker/handlers/org-blocked-backlog.ts
    - src/worker/situation/build-employees-rollup.ts
    - test/worker/situation-room-handler.test.mjs
decisions:
  - "One public.issues SELECT projects the OPEN status superset (in_progress|in_review|blocked) so a SINGLE issues read serves both the org-backlog blocked list and the rollup per-agent focus — honoring the plan's exactly-TWO-prefetch-SELECTs contract (one issues, one agents). EXCLUDE_OPERATION_ISSUES_SQL is applied on this SELECT so the Editor-Agent's own clarity-pack operation/bulletin issues never surface as an agent focus (OQ#2)."
  - "The shared edge-graph union is keyed by every distinct BLOCKED-issue id. A rollup focus issue that drives a chain is by construction status='blocked' and assignee_agent_id-owned, hence already in the blocked set — so the blocked-id set IS the union {blocked roots} ∪ {blocked agent focus}. This makes the memo provably cover both consumers with one walk per startId (proven by a relations.get spy: a startId in both sets walks exactly once)."
  - "The rollup shallow-copies nodeMeta out of the shared memo before injecting the focus-root meta (build-employees-rollup.ts root-meta block) so it never mutates the shared graph the org-backlog reads. Edges are immutable and shared by reference; nodeMeta is per-consumer."
  - "When the prefetch SUCCEEDS but returns empty rows, the builders read empty (the SQL is the source of truth) — they fall back to RPC ONLY when a prefetch field is ABSENT (a null bundle from a thrown SELECT). The existing situation-room-handler fixtures were updated to feed issues/agents through db.query (the new source of truth); all assertions are unchanged."
  - "name resolution moved from per-uuid ctx.agents.get to the nameByUuid Map built once from the agents SELECT. A uuid not on the roster is simply absent → the consumers read null (existing NO_UUID_LEAK posture), never the raw UUID (T-16-06)."
metrics:
  duration: ~40m
  completed: 2026-06-03
  tasks: 3
  files: 6
  commits: 3
---

# Phase 16 Plan 02: Wave A — N+1 RPC collapse via shared SQL prefetch + shared edge graph Summary

The single biggest cold-time lever in Phase 16 is shipped: the `situation.snapshot`
handler now serves the blocked-issue list, the agent roster, every per-agent focus
issue, and every uuid→name resolution from **two `ctx.db.query` SELECTs** instead of
the prior N+1 fan-out (one blocked-list RPC + one `issues.list` per agent + a
per-uuid `agents.get` + a roster `agents.list`, all duplicated across two builders),
and computes the blocker BFS **once** over the union of `{blocked roots} ∪ {blocked
agent focus}` — shared by both builders rather than walked twice. Per-stage
`snap.stage` timing makes the reduction measurable in worker logs. Every public SELECT
is company-scoped `WHERE company_id = $1`, parameterized, and prefix-literal-free.

## What shipped

**Task 1+2 — shared prefetch + org-backlog consumption (`feat` commit `dc225c0`, RED test `3d0704b`).**
- `situation-room.ts` gains `buildSnapshotPrefetch()`: two static-module-string SELECTs
  (`PREFETCH_ISSUES_SQL` over the OPEN status superset + `EXCLUDE_OPERATION_ISSUES_SQL`;
  `PREFETCH_AGENTS_SQL` roster), `$1`=companyId the sole bound param. It maps the
  snake_case rows to the camelCase shapes the builders read (`mapIssueRow`/`mapAgentRow`),
  builds `nameByUuid` once, and walks `buildEdges` once per distinct blocked-issue id
  into a shared `edgeGraph` memo (a thrown walk → an `{unclassified, degradeReason}`
  sentinel). The handler threads `{blockedIssues, nameByUuid, edgeGraph}` into both
  builders and wraps prefetch / org-backlog / rollup each in `snap.stage` timing.
- `org-blocked-backlog.ts` consumes `ctx.blockedIssues` (replacing `ctx.issues.list`),
  `ctx.nameByUuid` (replacing the per-uuid `ctx.agents.get` loop), and `ctx.edgeGraph`
  (replacing its own `buildEdges` walk). A memo'd UNCLASSIFIED sentinel emits the
  existing `unclassifiedChain(...)` floor — surfaced, not dropped. Every field is
  optional → RPC fallback preserved.

**Task 3 — rollup consumption (`feat` commit `f66c901`).**
- `build-employees-rollup.ts` reads the roster from `ctx.roster`, per-agent focus from
  `ctx.issuesByAgentId.get(agentId)`, edges from the shared `ctx.edgeGraph` (a memo'd
  sentinel re-throws into the existing per-row inline UNCLASSIFIED block), names from
  `ctx.nameByUuid`, and the multi-hop leaf from `ctx.issuesById` (RPC fallback only for a
  leaf not in the prefetch). The `nodeMeta` is shallow-copied from the memo before the
  root-meta injection so the shared graph is never mutated. The deterministic sort, the
  inline UNCLASSIFIED block, and `degradeSafeRow` are unchanged. The per-agent
  `Promise.all` fan-out is intentionally left for Wave B (16-03) to bound.

## How it was verified

- **All four affected suites green: 79/79** (`snapshot-prefetch` 8 new + `org-blocked-backlog`
  33 + `build-employees-rollup` 28 + `situation-room-handler` 10).
- `tsc --noEmit` → **exit 0**.
- **Round-trip count, measured on a 30-agent / 20-blocked fixture (2-node chains):**
  - `agents.get` calls: **0** (was up to N per distinct owner uuid).
  - `issues.list` calls: **0** (was 1 blocked-list + 30 per-agent = 31).
  - `relations.get` walks: **40** — the irreducible BFS (20 roots + 20 blockers), computed
    **once** and shared; WITHOUT the shared memo the org-backlog + rollup would each walk
    → ~80. The memoized-BFS test proves a startId in both sets walks exactly once.
  - `ctx.db.query` prefetch SELECTs: **2** (one `public.issues`, one `public.agents`),
    plus the unrelated opt-in prefs lookup.
  - Net RPC before ≈ 1 + 31 + (≤30) + 1 ≈ **62+** round-trips → after = **2 SQL reads +
    40 shared relations.get walks** (the relations table is not in coreReadTables, so the
    walks are irreducible; Wave B bounds/floors them).
- **Per-stage timing (same fixture, unit-test clock):** `prefetch` ≈ 30 ms, `org-backlog`
  ≈ 31 ms, `employees-rollup` ≈ 37 ms — logged as `snap.stage {stage, ms, companyId}`.
  (Wall-clock against the in-memory fake; the real cold-time delta on BEAAA is the 16-04
  bookended-drill measurement.)
- **Acceptance greps:** `grep -v '^//' situation-room.ts | grep -Ec "'BEAAA-|'COU-|\${"` → **0**
  (no prefix literal, no interpolation in any SQL). The handler carries two `company_id = $1`
  placeholders. The two `${...}` hits in `build-employees-rollup.ts` are pre-existing
  display-string template literals (focusLine truncation + the UNCLASSIFIED label) — NOT
  SQL; that file writes no SQL.

## Deviations from Plan

### Auto-fixed / aligned

**1. [Rule 3 - Blocking] Existing situation-room-handler fixtures fed data through the RPC stubs, not `db.query`.**
- **Found during:** Task 1 GREEN — three existing handler tests failed because they
  seeded `blockedIssues`/`roster`/`issuesByAgent` through `ctx.issues.list` / `ctx.agents.list`,
  but the prefetch now reads from `ctx.db.query`. With the prefetch succeeding-but-empty,
  the builders correctly read empty (SQL is the new source of truth).
- **Fix:** Added `snakeIssueRows()` / `snakeAgentRows()` helpers to `makeCtx` so `db.query`
  serves the SAME fixtures through the snake_case `public.issues` / `public.agents` projection
  (folding `agentsByUuid` name fixtures into the agents SELECT, since name resolution moved
  there). All original assertions are unchanged — the tests verify identical handler behavior,
  now through the SQL path.
- **Files modified:** `test/worker/situation-room-handler.test.mjs`
- **Commit:** `dc225c0`

This is the plan's own "the prefetch supplants the RPC list/get fan-out" contract, not a
scope expansion.

## Authentication Gates

None.

## Known Stubs

None. Both builders read the prefetch with a real RPC fallback; the `last_heartbeat_at` and
`assignee_user_id` columns carry the `?? null` defensive posture and are flagged in
`16-SCHEMA-VERIFY.md` for the 16-04 live `\d` back-fill (documented working-set inputs, not
stubs).

## Deferred Issues (out of scope)

`deferred-items.md` records the pre-existing full-suite failures observed during this plan
(7 REQUIREMENTS.md doc-traceability rows for CHAT/CTT requirements + 1 timing-flaky chat
watchdog test). Baseline (16-02 stashed) shows **15** full-suite failures; the 16-02 tree
shows **8** — a strict subset, so this plan introduces **zero** new failures. None touch the
situation-room / snapshot / prefetch path; not fixed here per the SCOPE BOUNDARY rule.

## Threat Model Compliance

- **T-16-03 (Info disclosure — viewer-scoped needsYou from shared rows):** the prefetch caches
  only viewer-invariant company rows; `needsYou`/`need_you_count` stay keyed on `params.userId`.
  A test asserts two userIds over IDENTICAL cached rows yield `need_you_count` 1 vs 0 (no
  cross-viewer bleed).
- **T-16-04 (cross-company leak):** every prefetch SELECT filters `WHERE company_id = $1`; an
  acceptance grep confirms no prefix literal.
- **T-16-05 (SQL injection):** the SQL strings are static module constants; `$1`/`[companyId]`
  is the sole bound param; grep asserts no `${` interpolation in any SQL string.
- **T-16-06 (raw UUID as a name):** a `nameByUuid` miss yields `null` (existing NO_UUID_LEAK
  posture), never the raw UUID — asserted by the owner-name test.
- **T-16-SC (package installs):** no package installed (read-path SQL only).

## Handoff to Wave B (16-03)

- The shared `edgeGraph` is the exact walk-set Wave B must cap + floor: run the per-startId
  `buildEdges` walks through `mapBounded(items, 4-6, …)` wrapped in
  `withDeadline(walk, ~1500-2000ms, () => <UNCLASSIFIED sentinel>)`. The sentinel shape the
  consumers already honor is `{ unclassified: true, degradeReason }` (use
  `'relations-walk-timeout'` for the deadline path); the builders already floor it to the
  existing UNCLASSIFIED row.
- The rollup's `await Promise.all(agents.map(...))` fan-out is still unbounded — Wave B swaps
  it for `mapBounded(agents, LIMIT, ...)`.
- 16-04 confirms `assignee_user_id` + `last_heartbeat_at` against the live `\d` and records the
  real cold-time delta (this plan's measurement is against an in-memory fake).

## Self-Check: PASSED

- `src/worker/handlers/situation-room.ts` — FOUND
- `src/worker/handlers/org-blocked-backlog.ts` — FOUND
- `src/worker/situation/build-employees-rollup.ts` — FOUND
- `test/worker/situation/snapshot-prefetch.test.mjs` — FOUND
- commit `3d0704b` (RED test) — FOUND
- commit `dc225c0` (Task 1+2 GREEN) — FOUND
- commit `f66c901` (Task 3 GREEN) — FOUND
