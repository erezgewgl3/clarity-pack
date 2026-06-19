---
phase: quick-260619-eyw
plan: 01
subsystem: worker/agents (wake governance)
tags: [wake-storm, requestWakeup, idempotency, kill-switch, version-bump]
requires:
  - "startAgentTask returning { operationIssueId, reused }"
  - "checkAndRecordWake governor (Phase 16.1 LOOP-07)"
provides:
  - "creation-time wake gated on !reused — one distinct compile = exactly one wake"
  - "plugin version 1.8.9 (auto-clears CounterMoves' stale version-scoped kill-switch on deploy)"
affects:
  - "Editor-Agent TL;DR / bulletin dispatch (no longer self-trips the 6/min governor ceiling)"
tech-stack:
  added: []
  patterns:
    - "gate a governed side-effect on the idempotency reuse flag, not the create call site"
key-files:
  created: []
  modified:
    - src/worker/agents/agent-task-delivery.ts
    - test/worker/agents/agent-task-delivery.test.mjs
    - package.json
    - src/manifest.ts
decisions:
  - "Wrap the ENTIRE governed-wake block in `if (!reused)`; keep recordOwnOperationIssue UNCONDITIONAL."
  - "wake-governor.ts + wake-kill-switch-repo.ts untouched — remove the storm SOURCE, keep the safety cap."
metrics:
  duration: ~10m
  completed: 2026-06-19
---

# Quick 260619-eyw: Gate creation-time requestWakeup on reuse Summary

Gated `startAgentTask`'s creation-time `ctx.issues.requestWakeup` on `!reused`, severing the Reader-repoll wake-storm at its source, and bumped the plugin 1.8.8 → 1.8.9 so the version-scoped durable kill-switch auto-clears CounterMoves' stale engaged row on deploy.

## What shipped

- **Task 1 (TDD):** New reuse-branch test `startAgentTask: storm-source fix — a REUSE-poll … fires ZERO requestWakeup` asserts `requestWakeup.length === 0`, `create.length === 0`, `reused === true`, and that `provenanceWrites.length === 1` (provenance still fires on reuse). Confirmed RED first (`1 !== 0`), then GREEN by wrapping the whole governed-wake block in `if (!reused) { … }`. The three existing LOOP-07 create-branch tests (`existing: []` → `reused === false`) still assert `requestWakeup.length === 1` and pass.
- **Task 2:** Version bump 1.8.8 → 1.8.9 in BOTH `package.json` and `src/manifest.ts` (host reads `dist/manifest.js` built from `src/manifest.ts`). `npm run typecheck` exits 0. Load-bearing: `wake-kill-switch-repo.isEngaged` is version-scoped to `manifest.version`, so the bump makes CounterMoves' stale engaged kill-switch row (stamped 1.8.8) invisible to 1.8.9.

## Root cause (2026-06-19 storm diagnosis)

The Reader polls a "Compiling…" TL;DR ~every 5s. Each poll → `startAgentTask`, which fired the governed wake on BOTH the create AND the reuse branch (~12 wakes/min for one stuck compile). wake-governor's ceiling is 6/min; over it the durable kill-switch auto-engages (never auto-clears) → every editor wake suppressed → op falls to Paperclip's recovery sweep (`status_only`, write-blocked) → the wrong agent (CTO/CEO) runs the TL;DR, the editor never runs (zero tokens). Gating on `!reused` makes one distinct compile = exactly one wake; the 6/min ceiling now caps DISTINCT issues, not poll cadence.

## Verification

- `npm test`: full `node --test "test/**/*.test.mjs"` suite — **2960 pass, 0 fail, 2 skipped** (pre-existing skips).
- `npm run typecheck`: exits 0.
- `git diff --stat HEAD~2 HEAD`: only the four declared files touched. `wake-governor.ts` and `wake-kill-switch-repo.ts` unchanged.
- Six coexistence guarantees untouched (no schema change, no UI replacement, surgical worker edit only).

## Deviations from Plan

None — plan executed exactly as written (TDD RED → GREEN, version bump, typecheck, atomic commits).

## Known Stubs

None.

## Commits

- `ca6a0b0` fix(wake): gate creation-time requestWakeup on !reused — sever Reader-repoll wake-storm source
- `e6812d8` chore(version): bump 1.8.8 -> 1.8.9 (both version sources)

## Next step (NOT part of this plan)

Deploy 1.8.9 to BEAAA + CounterMoves and live-verify (one stuck compile = one wake; stale kill-switch row auto-cleared). Operator/orchestrator-driven.

## Self-Check: PASSED

- FOUND: src/worker/agents/agent-task-delivery.ts (contains `if (!reused)` gate)
- FOUND: test/worker/agents/agent-task-delivery.test.mjs (contains reuse no-wake test)
- FOUND: package.json (version 1.8.9)
- FOUND: src/manifest.ts (version 1.8.9)
- FOUND commit: ca6a0b0
- FOUND commit: e6812d8
