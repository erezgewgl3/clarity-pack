---
phase: 15-cockpit-ia-redesign
plan: 01
subsystem: situation-room-worker
tags: [pulse, vital-signs, aggregation, worker, additive-payload, no-migration]
requires:
  - "src/worker/situation/build-employees-rollup.ts (SituationEmployeeRow + NeedsYou verdict shapes)"
  - "src/shared/types.ts (BlockerChainResult.tier + Terminal kinds — read-only)"
provides:
  - "buildPulseSummary(employees, needsYou) -> PulseSummary (pure aggregation)"
  - "situation.snapshot now returns an additive `pulse` field"
affects:
  - "Plan 15-02 <PulseHeader> consumes snapshot.pulse as a dumb renderer"
tech-stack:
  added: []
  patterns:
    - "Worker computes, view renders (Phase 11 D-01) — counts stay worker-side (SC3)"
    - "Verdict-gated aggregation, never string-match (Phase 11/12)"
    - "Deterministic all-zero degrade floor (SC4)"
key-files:
  created:
    - "src/worker/situation/build-pulse-summary.ts"
    - "test/worker/situation/build-pulse-summary.test.mjs"
  modified:
    - "src/worker/handlers/situation-room.ts"
decisions:
  - "Pulse counts computed in the WORKER (D-01) — keeps all verdict-derived numbers on one side of the bridge; view stays a dumb renderer (SC3)."
  - "in-motion denominator = in-motion-tier chains + chainless working-group rows, guarded against double-count."
  - "Additive payload only — no migration, no situation_snapshots write (domain 'No migration')."
metrics:
  duration: ~20m
  completed: 2026-06-03
  tasks: 2
  files: 3
---

# Phase 15 Plan 01: Pulse Vital-Sign Aggregation Summary

Worker-side `pulse` summary added to `situation.snapshot`: four integer vital-sign counts (needYou / inMotion / stuck / selfClearing) aggregated purely over the EXISTING per-row engine verdicts + the already-computed `needsYou.count` — no new fetch, no migration, no engine edit.

## What Shipped

- **`src/worker/situation/build-pulse-summary.ts`** — pure `buildPulseSummary(employees, needsYou)` + `PulseSummary` type. Counts per the LOCKED 15-CONTEXT D-01 definitions:
  - `needYou` = `needsYou.count` verbatim (Phase-12 per-leaf-deduped count; NOT re-counted from rows).
  - `inMotion` = rows with `blockerChain.tier === 'in-motion'` PLUS chainless rows with `group === 'working'` — the group branch is guarded to `blockerChain == null` so an in-motion chain whose group is `working` is counted exactly once (no double-count).
  - `stuck` = rows with `blockerChain.terminalKind === 'AWAITING_AGENT_STUCK'` (tier `watch`).
  - `selfClearing` = rows with `blockerChain.terminalKind === 'SELF_RESOLVING'`.
  - Empty input → `{needYou:0,inMotion:0,stuck:0,selfClearing:0}` (SC4 floor; never throws).
  - Pure: zero `ctx.`/`await`/`fetch` (asserted by a source-grep test).
- **`src/worker/handlers/situation-room.ts`** — imports `buildPulseSummary`; computes `const pulse = buildPulseSummary(employeesWithCards, needsYou)` after the rollup + action-cards step; returns an **additive** `pulse` field alongside `org_blocked_backlog`, `situation_employees`, `needsYou`, `taken_at`. No field removed, no DDL, no `situation_snapshots` write.
- **`test/worker/situation/build-pulse-summary.test.mjs`** — 7 tests: each count over a representative verdict set, the in-motion no-double-count case, the all-four-at-once case, the empty→all-zero floor, and a source-grep purity assertion.

## Verification

| Command | Result |
|---|---|
| `node --test test/worker/situation/build-pulse-summary.test.mjs` | PASS — `tests 7 / pass 7 / fail 0` |
| `node scripts/build-worker.mjs` | PASS — `dist\worker.js 2.5mb / Done` |
| `npx tsc --noEmit` | PASS — exit 0 (no new errors) |
| `node --test test/shared/blocker-chain.test.mjs` (engine purity guard) | PASS — `tests 21 / pass 21 / fail 0` |
| `ls migrations/ \| wc -l` | 15 (unchanged — no migration) |
| `grep -c 'pulse\|Pulse' situation-room.ts` | 11 (>= 2: import + compute + return) |
| `git diff --stat package.json` | empty (T-15-SC: no dependency additions) |
| purity grep `grep -v '^//' build-pulse-summary.ts \| grep -c 'ctx.\|await\|fetch'` | 0 |

## Deviations from Plan

None — plan executed exactly as written. (One in-source doc-comment word "fetches" was reworded to "does host I/O" so the literal `grep -v '^//' ... | grep -c fetch` acceptance check returns 0; the function never had any fetch/await/ctx call.)

## Confirmation against output spec

- **(a)** The four counts aggregate the EXISTING per-row verdicts (`blockerChain.tier` / `.terminalKind` / `group`) + the already-resolved `needsYou.count` — with **no new fetch, no await, no ctx call** (source-grep = 0; purity test green).
- **(b)** The snapshot gains an **additive** `pulse` field — no existing field changed, **no migration** (migrations dir still 15), **no engine edit** (`blocker-chain.ts` untouched; determinism + AI-token guard still 21/21).
- **(c)** Empty input → all-zero floor `{needYou:0,inMotion:0,stuck:0,selfClearing:0}` (SC4); a degraded empty rollup still carries a real all-zero pulse.

## Commits

- `41fa022` feat(15-01): buildPulseSummary pure vital-sign aggregation
- `0e76e20` feat(15-01): wire additive pulse field into situation.snapshot return

## Self-Check: PASSED

All created/modified files exist on disk; both commit hashes present in git history.
