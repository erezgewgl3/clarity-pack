---
phase: 16-snapshot-performance-honest-loading
plan: 03
subsystem: worker-snapshot-perf
requirements: [SNAP-02]
tags: [wave-b, degrade-safe, dos-resistant, bounded-concurrency, per-walk-deadline, unclassified-floor, snap-02]
requires:
  - "16-01-SUMMARY.md / 16-SCHEMA-VERIFY.md: mapBounded(items,limit,fn) + withDeadline(p,ms,onTimeout) from src/worker/util/map-bounded.ts; OQ#1 decision = relations.get has NO per-call timeoutMs, so use withDeadline"
  - "16-02-SUMMARY.md: the shared edgeGraph (buildEdges walked once per distinct blocked-issue id) threaded into both builders; the rollup's remaining per-agent fan-out; org-blocked-backlog.ts unclassifiedChain floor + memo-sentinel pattern"
provides:
  - "src/worker/handlers/situation-room.ts: the shared edge-graph build runs buildEdges through mapBounded(EDGE_WALK_LIMIT=5) with each walk wrapped in withDeadline(PER_WALK_DEADLINE_MS=2000) → floors a hung/slow walk to the 'relations-walk-timeout' UNCLASSIFIED sentinel; an injectable overall SNAPSHOT_BUDGET_MS (prod ~8000ms) so leftover startIds floor instead of blocking the response"
  - "src/worker/situation/build-employees-rollup.ts: the unbounded Promise.all(agents.map(...)) fan-out replaced by mapBounded(agents, ROLLUP_AGENT_LIMIT=5) — same ceiling as the edge-graph build, completing the T-16-01 DoS cap across BOTH builders; the per-row try/catch → degradeSafeRow floor and the deterministic sort are unchanged"
  - "src/worker/handlers/org-blocked-backlog.ts: the generic memo-sentinel branch now documents both 'relations-walk-failed' (throw) and the new 'relations-walk-timeout' (deadline) reasons, both flooring via unclassifiedChain verbatim"
  - "test/worker/situation/snapshot-degrade.test.mjs: hung / thrown / slow-but-eventually-resolving relations.get all floor to UNCLASSIFIED, snapshot returns a 200-shaped payload with every other row intact, the concurrency ceiling (≤5 in flight) holds, and the budget-exhaustion path runs sub-second via the ~200ms test override"
affects:
  - "16-04 (Wave C + phase close): the live BEAAA bookended drill confirms the before/after vs the recorded SNAP-03 baseline (cold 25.7s, 6/6 snapshot calls 200, no 502). Tuning constants to validate live and adjust if needed: EDGE_WALK_LIMIT/ROLLUP_AGENT_LIMIT=5, PER_WALK_DEADLINE_MS=2000, SNAPSHOT_BUDGET_MS≈8000 (env override CLARITY_SNAPSHOT_BUDGET_MS)"
tech-stack:
  added: []
  patterns:
    - "bounded-concurrency + per-call deadline as a combined DoS-cap AND degrade-safety control on an irreducible RPC fan-out: mapBounded(LIMIT) caps in-flight host load; withDeadline(~2s) floors a single hung walk to the deterministic UNCLASSIFIED line within budget rather than waiting the 30s host default → 502"
    - "injectable budget constant for test isolation: SNAPSHOT_BUDGET_MS has a production default (~8000ms) but is overridable per call + via the CLARITY_SNAPSHOT_BUDGET_MS env override the degrade test sets to ~200ms, so the budget-exhaustion path runs deterministically in well under a second instead of burning ~8 real seconds"
    - "timeout floor reuses the EXISTING unclassifiedChain shape with a new degradeReason ('relations-walk-timeout') alongside the existing 'relations-walk-failed' — an honest self-naming floor row, NOT an invented blocker (T-16-07 accept)"
    - "mapBounded preserves input order so the deterministic post-fan-out sort in build-employees-rollup is unaffected by the switch from Promise.all"
key-files:
  created:
    - test/worker/situation/snapshot-degrade.test.mjs
  modified:
    - src/worker/handlers/situation-room.ts
    - src/worker/handlers/org-blocked-backlog.ts
    - src/worker/situation/build-employees-rollup.ts
decisions:
  - "Per 16-SCHEMA-VERIFY OQ#1: ctx.issues.relations.get has no per-call timeoutMs (typed sig get(issueId, companyId); runtime omits a timeout arg → 30s default), so each buildEdges walk is wrapped in withDeadline(PER_WALK_DEADLINE_MS=2000) rather than threading a timeout into the RPC. On timeout the UNCLASSIFIED sentinel is stored in the shared edgeGraph memo keyed by startId, so BOTH builders floor that one row via unclassifiedChain(startId,'relations-walk-timeout')."
  - "Concurrency ceiling LIMIT=5 chosen (RESEARCH A3 range 4-6, planner discretion) and applied IDENTICALLY to the shared edge-graph build (EDGE_WALK_LIMIT) and the rollup per-agent fan-out (ROLLUP_AGENT_LIMIT) so the two builders share one in-flight host-load budget. Recorded for 16-04 live tuning."
  - "The overall SNAPSHOT_BUDGET_MS is INJECTABLE (production ~8000ms, well under the 30s host timeout) via an optional per-call param AND a CLARITY_SNAPSHOT_BUDGET_MS env override; any startId not yet computed when the budget is exhausted floors to UNCLASSIFIED rather than blocking the response. The degrade test sets the env override to ~200ms so it settles sub-second."
  - "Deterministic-floor shapes and the determinism path are UNCHANGED — no edit to blocker-chain.ts / build-pulse-summary.ts / leverage.ts / agent-liveness.ts / classify-employee-state.ts / scrub-human-action.ts; no background loop / cron added (degrade-safe, NO-AI-in-determinism, instance-agnostic invariants held)."
metrics:
  duration: ~12m (executor interrupted by a transient socket drop AFTER both task commits landed; SUMMARY + tracking closed out by the orchestrator)
  completed: 2026-06-03
  tasks: 2
  files: 4
  commits: 2
self_check: PASSED
---

# Phase 16 Plan 03: Wave B — degrade-safe, DoS-resistant snapshot Summary

Wave B makes `situation.snapshot` honestly degrade-safe and DoS-resistant. The
irreducible per-issue `relations.get` edges (which 16-02 could not SQL-ify — there
is no relations table in `coreReadTables`) are the last unbounded host load and the
last 30s-timeout-then-502 hazard. This plan caps and deadline-floors them.

## What landed

**Task 1 (`16a38b5`) — bound + deadline-floor the shared edge-graph build.**
`situation-room.ts` now runs the shared `buildEdges` fan-out (from 16-02) through
`mapBounded(distinctStartIds, EDGE_WALK_LIMIT=5, …)` so the host Postgres is never
stampeded (T-16-01), and wraps each walk in `withDeadline(PER_WALK_DEADLINE_MS=2000,
…)` so a hung/slow walk floors that ONE `startId` to the `'relations-walk-timeout'`
UNCLASSIFIED sentinel within ~2s — never the 30s host default → 502 (T-16-02). An
injectable overall `SNAPSHOT_BUDGET_MS` (production ~8000ms; per-call param +
`CLARITY_SNAPSHOT_BUDGET_MS` env override for test isolation) floors any startId not
yet computed when the budget is exhausted rather than blocking the response.
`org-blocked-backlog.ts` documents the generic memo-sentinel branch covering both
`'relations-walk-failed'` and the new `'relations-walk-timeout'` reasons.

**Task 2 (`7f54a41`) — bound the rollup per-agent fan-out.**
`build-employees-rollup.ts` replaces the unbounded `Promise.all(agents.map(...))`
with `mapBounded(agents, ROLLUP_AGENT_LIMIT=5, …)` — the SAME ceiling as the
edge-graph build — completing the T-16-01 DoS mitigation across both builders. The
per-row `try/catch → degradeSafeRow` floor and the deterministic sort are unchanged
(`mapBounded` preserves input order).

## Verification

- `test/worker/situation/snapshot-degrade.test.mjs` — 6/6: a hung walk floors to
  `'relations-walk-timeout'` within budget, a thrown walk floors to
  `'relations-walk-failed'`, a slow-but-resolving walk settles, the snapshot returns
  a 200-shaped payload with every other row intact, the concurrency ceiling (≤5)
  holds, and the budget-exhaustion case runs sub-second under the ~200ms override.
- `test/worker/situation/build-employees-rollup.test.mjs` — 28/28 (bounded fan-out).
- Orchestrator close-out re-verification: `tsc --noEmit` exit 0; the degrade +
  prefetch suites pass together (14/14).

## Deviations

None. Plan executed as written. (Process note: the executor's connection dropped on
a transient socket error immediately AFTER both atomic task commits landed but
BEFORE it wrote this SUMMARY / updated tracking; the orchestrator verified the two
commits are sound — `tsc` clean, 14/14 situation tests green — and closed out the
paperwork. No code was changed during close-out.)

## For 16-04 (Wave C + live BEAAA proof)

SNAP-02 is satisfied at the code level. 16-04 confirms the live before/after against
the recorded SNAP-03 baseline (cold 25.7s, 6/6 snapshot calls 200, no 502) and may
tune these constants live: `EDGE_WALK_LIMIT`/`ROLLUP_AGENT_LIMIT=5`,
`PER_WALK_DEADLINE_MS=2000`, `SNAPSHOT_BUDGET_MS≈8000` (env override
`CLARITY_SNAPSHOT_BUDGET_MS`).
