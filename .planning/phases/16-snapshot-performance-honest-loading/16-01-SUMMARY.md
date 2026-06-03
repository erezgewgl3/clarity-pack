---
phase: 16-snapshot-performance-honest-loading
plan: 01
subsystem: worker-snapshot-perf
tags: [bounded-concurrency, deadline-floor, degrade-safe, wave-0, schema-verify, timeoutMs-decision, snap-02, no-new-dep]
requires:
  - "16-RESEARCH.md: canonical mapBounded + withDeadline shapes (Code Examples 311-338); OQ#1/OQ#2"
  - "16-PATTERNS.md: map-bounded.ts role-match (no in-repo pool); standing-numbers SQL template"
  - "03-10-SCHEMA-FINDINGS.md §2: live-introspected public.issues snake_case columns"
  - "@paperclipai/plugin-sdk@2026.512.0: PluginIssueRelationsClient.get signature + worker-rpc-host callHost"
provides:
  - "src/worker/util/map-bounded.ts: mapBounded<T,R>(items,limit,fn) order-preserving bounded pool + withDeadline<T>(p,ms,onTimeout) timeout/reject floor — the two exports Wave B (16-03) imports"
  - "16-SCHEMA-VERIFY.md: locked public.issues column set (10 names) + public.agents working set (8 names, LIVE-CHECK-REQUIRED) + the timeoutMs decision (USE withDeadline)"
  - "Resolved OQ#1: per-call timeoutMs is NOT reachable via ctx.issues.relations.get -> Wave B floors with withDeadline"
  - "Resolved OQ#2: public.issues columns confirmed from 03-10; public.agents flagged for the 16-04 live \\d back-fill"
affects:
  - "Wave A (16-02) writes the blocked-issue/roster SQL against the locked column set"
  - "Wave B (16-03) imports mapBounded + withDeadline to cap + floor the irreducible relations.get fan-out"
  - "16-04 BEAAA bookended drill must run \\d public.agents and back-fill last_heartbeat_at + assignee_user_id"
tech-stack:
  added: []
  patterns:
    - "hand-rolled bounded-concurrency Promise pool (fixed min(limit,n) workers off a shared cursor; results by index = order preserved) — NO p-limit, no new dep (bundle-size CI ceiling)"
    - "Promise.race-style deadline floor that ALSO floors on rejection (a thrown relations.get never escapes; floors to the deterministic UNCLASSIFIED row)"
    - "evidence-first Wave-0 unknown resolution: read the typed SDK signature + the runtime wrapper to PROVE timeoutMs is unreachable, not assume it"
    - "node:test with native .ts type-stripping (Node 24) — controllable deferred() levers to observe the concurrency ceiling deterministically"
key-files:
  created:
    - src/worker/util/map-bounded.ts
    - test/worker/util/map-bounded.test.mjs
    - .planning/phases/16-snapshot-performance-honest-loading/16-SCHEMA-VERIFY.md
  modified: []
decisions:
  - "timeoutMs decision = USE withDeadline. Proven NOT reachable: PluginIssueRelationsClient.get(issueId, companyId) (types.d.ts:914) takes exactly two params with no options/timeout arg, and the runtime wrapper (worker-rpc-host.js:684-686) calls callHost with only (method, params) — the third timeoutMs is omitted, so it defaults to DEFAULT_RPC_TIMEOUT_MS=30_000 (worker-rpc-host.js:46,163). Wave B floors each walk with withDeadline (~1.5-2s, planner-discretion) inside mapBounded(4-6)."
  - "public.issues columns CONFIRMED from 03-10-SCHEMA-FINDINGS.md §2 (10 names: id, identifier, title, status, assignee_agent_id, assignee_user_id, updated_at, company_id, hidden_at, origin_kind). assignee_user_id flagged: 03-10 enumerated created_by_user_id but not assignee_user_id explicitly — back-fill in the 16-04 \\d window. Reuse EXCLUDE_OPERATION_ISSUES_SQL verbatim so the Editor-Agent's own op/bulletin issues never surface as an agent focus."
  - "public.agents marked LIVE-CHECK-REQUIRED in full (8-name working set). 03-10 line 74 explicitly never introspected public.agents and warns 'do not guess'. last_heartbeat_at is the highest-risk name (a drift silently nulls liveness -> every agent reads stuck/D-04). 16-04 MUST run \\d public.agents and back-fill. Working posture: ?? null + per-query try/catch floor; do NOT block the phase on the live check."
  - "No dependency added; no src/ file modified by Task 1 (evidence-only). Task 2 adds exactly two exports and zero deps. Canonical RESEARCH shapes copied verbatim, adapted only to the repo .ts ESM import/export style."
metrics:
  duration: ~12m
  completed: 2026-06-03
  tasks: 2
  files: 3
  commits: 3
---

# Phase 16 Plan 01: Bounded Pool + Deadline Floor & Wave-0 Verification Summary

The only genuinely-new primitive in Phase 16 — a hand-rolled, dependency-free bounded-concurrency pool (`mapBounded`) plus a deadline floor (`withDeadline`) — is shipped and fully tested, and the two Wave-0 unknowns the SQL/bounding waves depend on are resolved and recorded in `16-SCHEMA-VERIFY.md`. Wave A (16-02) can now write its raw SQL against a locked `public.issues` column set, and Wave B (16-03) knows it must floor the irreducible `relations.get` fan-out with `withDeadline` (the SDK's per-call `timeoutMs` override is provably unreachable) run inside `mapBounded`. This is foundation-only: it contributes the SNAP-02 degrade-safety primitive; the actual cold-time win lands in 16-02/16-03/16-04.

## What shipped

**Task 1 — Wave-0 verification (`16-SCHEMA-VERIFY.md`, commit `356bc00`).** An evidence-only doc with the two required H2 sections:
- **`## Columns`** — `public.issues` locked from the live-introspected `03-10-SCHEMA-FINDINGS.md §2` (10 snake_case names + the `EXCLUDE_OPERATION_ISSUES_SQL` reuse); `public.agents` recorded as an 8-name working set, every name `LIVE-CHECK-REQUIRED` because the table was never introspected (03-10 line 74 explicitly says "do not guess"), with `last_heartbeat_at` flagged highest-risk for the 16-04 `\d public.agents` back-fill.
- **`## timeoutMs decision`** — `USE withDeadline`, with three pieces of file:line SDK evidence proving the per-call `timeoutMs` cannot thread through `ctx.issues.relations.get`.

**Task 2 — `src/worker/util/map-bounded.ts` (+ test), TDD RED `fb663db` → GREEN `3e2d377`.** Two exports, copied verbatim from the canonical RESEARCH shapes and adapted only to the repo's `.ts` ESM style:
- `mapBounded<T,R>(items, limit, fn)` — a fixed pool of `min(limit, items.length)` workers pulling from a shared cursor, writing results into a pre-sized array by index so **input order is preserved** regardless of completion order; empty input resolves to `[]` without calling `fn`. Caps in-flight host Postgres load (T-16-01).
- `withDeadline<T>(p, ms, onTimeout)` — floors a hung promise to `onTimeout()` on a `setTimeout`, AND floors to `onTimeout()` on **rejection** (a thrown `relations.get` never escapes), clearing the timer on settle so `onTimeout` never fires after `p` wins (T-16-02).

## How it was verified

- `node --test test/worker/util/map-bounded.test.mjs` — **8/8 green**. The concurrency-ceiling test asserts the observed max-in-flight **equals** `min(limit, items.length)` (proves the pool parallelizes up to the ceiling, not merely `<=`); order-preservation is asserted under deliberately out-of-order completion; the `withDeadline` reject path is asserted to yield `onTimeout()` and **never throw**; the timer-cleared path proves `onTimeout` does not fire after a win.
- `grep -v '^//' src/worker/util/map-bounded.ts | grep -c "p-limit"` → **0**; exactly two `export`s (`mapBounded`, `withDeadline`), no others.
- `tsc --noEmit` → **exit 0** (no new dependency, no regression).
- Task 1 automated grep gate (file exists + `^## Columns` + `^## timeoutMs decision` + `public.agents`) → **PASS**.

## Deviations from Plan

None — plan executed exactly as written. The RESEARCH-recommended fallback (`withDeadline` over the SDK override) became the locked decision because the SDK surface was proven unreachable; that is the plan's own OQ#1 branch, not a deviation.

## Authentication Gates

None.

## Known Stubs

None. Both files are complete: `map-bounded.ts` is fully implemented and tested; `16-SCHEMA-VERIFY.md` records confirmed facts plus explicitly-flagged `LIVE-CHECK-REQUIRED` items that are the documented input to the 16-04 bookended BEAAA drill (not stubs — they are the honest, defensive-`?? null` working set the research mandated, with the live-truth gate scheduled).

## Threat Model Compliance

- **T-16-01 (DoS, unbounded relations.get fan-out)** — `mapBounded` ships with a concurrency-ceiling test proving the cap holds (max-in-flight === `min(limit, n)`). Wave B wires it.
- **T-16-02 (DoS, single hung relations.get → 502)** — `withDeadline` ships with both the timeout-floor and the reject-floor tests proving neither path hangs. Wave B wires it.
- **T-16-SC (Tampering, package installs)** — no package installed (hand-rolled pool, no p-limit); `grep -c "p-limit"` → 0. No legitimacy checkpoint needed.

## Handoff to Wave A/B

- 16-02 (Wave A): write the blocked-issue + roster SELECTs against the `16-SCHEMA-VERIFY.md` locked column set, parameterized `$1`/`$2` only, `WHERE company_id = $1`, `?? null` per field, per-query try/catch floor, and the verbatim `EXCLUDE_OPERATION_ISSUES_SQL`.
- 16-03 (Wave B): `import { mapBounded, withDeadline } from '../util/map-bounded.ts'`; run each `relations.get`/`buildEdges` walk through `mapBounded(items, 4-6, …)` wrapped in `withDeadline(walk, ~1500-2000ms, () => unclassifiedChain(startId, 'relations-walk-timeout'))`.
- 16-04 (BEAAA bookended drill): run `\d public.issues` + `\d public.agents`, confirm/back-fill `assignee_user_id` and `last_heartbeat_at` (highest-risk), record the live `\d` output back into `16-SCHEMA-VERIFY.md`.

## Self-Check: PASSED

- `src/worker/util/map-bounded.ts` — FOUND
- `test/worker/util/map-bounded.test.mjs` — FOUND
- `.planning/phases/16-snapshot-performance-honest-loading/16-SCHEMA-VERIFY.md` — FOUND
- commit `356bc00` (schema-verify) — FOUND
- commit `fb663db` (RED test) — FOUND
- commit `3e2d377` (GREEN impl) — FOUND
