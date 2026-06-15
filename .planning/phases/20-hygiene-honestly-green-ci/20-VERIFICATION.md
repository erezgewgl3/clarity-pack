---
phase: 20-hygiene-honestly-green-ci
verified: 2026-06-15T15:52:00Z
status: human_needed
score: 5/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm automated DO backups are ON for the AriClaw droplet"
    expected: "DigitalOcean dashboard → Droplets → AriClaw → Backups tab shows automated daily backups enabled"
    why_human: "Claude has no DigitalOcean control-panel access; this is the only remaining arm of HYG-04"
---

# Phase 20: Hygiene & Honestly-Green CI — Verification Report

**Phase Goal:** Make CI honestly green and the deploy bookend confirmed — the SC5 full surface × terminal-kind matrix runs in CI, the known test-debt (chat-watchdog flake + env-dependent safety-CLI failures + Phase-17 snapshot-prefetch drift) is resolved, the version label refreshed, and automated DO backups confirmed ON.
**Verified:** 2026-06-15T15:52:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The CI runner glob (`.github/workflows/scaffold-check.yml`) runs the recursive `test/**/*.test.mjs` glob so the SC5 matrix and ~126 previously-skipped nested tests actually execute | VERIFIED | `scaffold-check.yml` line 74: `node --test "test/**/*.test.mjs"`. Comment explicitly states old single-level glob silently SKIPPED ~126 nested tests. Commit `e64a6f1`. |
| 2 | The safety-CLI suite runs in CI as a separate serial segment (`--test-concurrency=1`) to prevent PGlite/WASM contention flake | VERIFIED | `scaffold-check.yml` lines 83-84: dedicated step `node --test --test-concurrency=1 "scripts/safety/test/**/*.test.mjs"` with inline rationale comment. |
| 3 | `topic-watchdog.test.mjs` U7 is condition/barrier-based — no wall-clock `Date.now()` elapsed threshold — and passes deterministically | VERIFIED | `chat-messages.test.mjs` line 467-514: U7 test uses a `Promise` barrier (`getBarrier`) gating only the FIRST `ctx.issues.get`; asserts `barrierReleased === false` when the handler resolves. Zero executable `elapsed` lines in the file (programmatic check: "CLEAN"). Commit `76bfe81`. |
| 4 | `snapshot-prefetch.test.mjs` keeps the `=== 2` exact assertion (not loosened to `<= N`) AND adds a dedicated one-read trip-wire for `action_cards_flag` | VERIFIED | File line 178: `assert.equal(bag.spies.dbQuerySql.length, 2, 'exactly two prefetch SELECTs')` — exact, not loosened. Lines 197-203: `assert.equal(bag.spies.actionCardsFlagSql.length, 1, 'exactly one action_cards_flag enablement SELECT per snapshot (no per-row N+1)')`. Commit `2e00eac`. |
| 5 | Three undeclared devDeps (`tar@^7`, `@electric-sql/pglite@^0.3`, `cross-spawn@^7`) are declared, making all 7 safety-CLI harness tests loadable and green-by-pass (fail 0) | VERIFIED | `package.json` devDependencies: `"@electric-sql/pglite": "^0.3"`, `"cross-spawn": "^7"`, `"tar": "^7"` all present. Commit `abbd37f`. |
| 6 | Version label is 1.8.0 in BOTH sources; DO-backup confirmation is an open operator action (intentional rider) | VERIFIED (code arm) / HUMAN NEEDED (DO-backup arm) | `package.json` line 4: `"version": "1.8.0"`. `src/manifest.ts` line 702: `version: '1.8.0'`. Both sources agree. DO-backup confirmation requires operator access to DigitalOcean dashboard — explicitly batched as end-of-milestone operator action per D-02 / Plan 20-03. |

**Score:** 5/6 truths verified (6th truth is split: code arm VERIFIED, live-operator arm is the open rider)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/scaffold-check.yml` | Recursive `test/**` glob + serial safety-CLI segment | VERIFIED | Both CI steps present with correct glob patterns and `--test-concurrency=1` on safety suite. Only file changed by Plan 20-02. |
| `test/worker/situation/snapshot-prefetch.test.mjs` | Exact `=== 2` assertion + dedicated `actionCardsFlagSql` spy with `=== 1` | VERIFIED | 8 tests; action_cards_flag branch at line 135; exact count assertions at lines 178 and 198-203. |
| `test/worker/chat/chat-messages.test.mjs` | U7 rewritten as barrier-based, no `Date.now()` in executable code | VERIFIED | `getBarrier` option in `makeCtx`; U7 test at line 467 uses deferred-promise barrier; no executable `elapsed` or `Date.now()` threshold. |
| `package.json` | `tar@^7`, `@electric-sql/pglite@^0.3`, `cross-spawn@^7` in devDependencies | VERIFIED | All three present in devDependencies. Version 1.8.0 confirmed. |
| `test/worker/blocked-no-edge-verdict-consistency.test.mjs` | SC5 4×8 matrix (4 surfaces × 8 terminal kinds) | VERIFIED | `FOUR_SURFACES = ['reader', 'sr', 'bulletin', 'chat']` and `EIGHT_KINDS = [8 entries]`. Loop at line 430 generates 8 parametric tests under `SC5 matrix — 4 surfaces × kind=...`. Matched by `test/**/*.test.mjs` glob. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| CI glob `test/**/*.test.mjs` | `test/worker/blocked-no-edge-verdict-consistency.test.mjs` | Node `**` expansion | VERIFIED | SC5 matrix file lives under `test/worker/`, unambiguously matched by the recursive glob. |
| CI glob `scripts/safety/test/**/*.test.mjs` | 7 safety-CLI test files | Separate serial CI step | VERIFIED | `scripts/safety/test/` contains gate/restore/restore-tar-cve/snapshot/snapshot-pglite/snapshot-postgres-mock/verify test files; dedicated step in `scaffold-check.yml`. |
| `makeCtx.getBarrier` | U7 `WATCHDOG-FIRE-AND-FORGET` test | First-get conditional `await getBarrier` | VERIFIED | `chat-messages.test.mjs` line 88: `if (getBarrier && getCalls.length === 1) { await getBarrier; }` — gates only the fire-and-forget first get. |
| `package.json` version | `src/manifest.ts` version | Two-source version contract | VERIFIED | Both 1.8.0; `blocker-chain.ts` last touched at Phase 17 (`d4cad98`) — untouched in Phase 20. |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase touches only tests, CI config, and devDependencies. No dynamic-data rendering components were added or modified. `blocker-chain.ts` is byte-unchanged.

---

### Behavioral Spot-Checks

| Behavior | Check | Status |
|----------|-------|--------|
| SC5 matrix is a real executable test, not a stub | `EIGHT_KINDS` array has 8 entries; `for (const kind of EIGHT_KINDS)` loop generates 8 tests via `test(...)` | PASS |
| U7 watchdog test has no executable wall-clock path | Grep for non-comment `elapsed` lines in `chat-messages.test.mjs` returns CLEAN | PASS |
| snapshot-prefetch assertion is exact `=== 2` not `<= N` | Line 178: `assert.equal(bag.spies.dbQuerySql.length, 2, ...)` uses strict equality | PASS |
| Three devDeps present in package.json | `tar@^7`, `@electric-sql/pglite@^0.3`, `cross-spawn@^7` all found | PASS |
| Two-source version agreement | `package.json` 1.8.0 + `src/manifest.ts` 1.8.0 | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files declared in Phase 20 plans or summaries. The phase produces no runnable entry points; test execution requires `node --test` against the full suite which cannot be run in the verifier process under the time constraint.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HYG-01 | Plan 20-02 | SC5 full-matrix runs in CI | SATISFIED | Recursive glob in `scaffold-check.yml`; SC5 matrix file matched; commit `e64a6f1`. |
| HYG-02 | Pre-phase (D-01) | 7 CHAT/CTT traceability failures resolved | SATISFIED (pre-existing) | `test/phases/04-traceability.test.mjs` line 31 and `04.1-traceability.test.mjs` line 33 both point to `.planning/milestones/v1.0.0-REQUIREMENTS.md` (the CHAT-01..11 / CTT-01..08 rows). REQUIREMENTS.md marks HYG-02 `[x]`. D-01 explicitly says "do NOT redo". |
| HYG-03 | Plan 20-01 | Chat-watchdog U7 timing flake stabilized | SATISFIED | Barrier-based U7 rewrite in `chat-messages.test.mjs`; commit `76bfe81`. |
| HYG-04 (code arm) | Plan 20-03 / D-02 | Version label 1.8.0 in both sources | SATISFIED | `package.json` + `src/manifest.ts` both 1.8.0. |
| HYG-04 (live arm) | Plan 20-03 | DO automated daily backups confirmed ON | PENDING HUMAN | Operator-gated: requires reading DigitalOcean dashboard. Explicitly batched per D-02 and Plan 20-03. REQUIREMENTS.md correctly shows HYG-04 as `[ ]` (pending). |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | Phase touched only test files, CI config, and package.json. No `TBD`/`FIXME`/`XXX` markers found in modified files. |

Invariant check: `blocker-chain.ts` last commit is `d4cad98` (Phase 17 feat commit) — not touched in Phase 20. No AI-token imports found in `src/shared/blocker-chain.ts`. All Phase 20 commits modify only `test/worker/situation/snapshot-prefetch.test.mjs`, `test/worker/chat/chat-messages.test.mjs`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/scaffold-check.yml`, and planning docs — no production `src/` change.

---

### Human Verification Required

#### 1. DO Automated Backup Confirmation (HYG-04 live arm)

**Test:** Log into DigitalOcean dashboard → Droplets → AriClaw → Backups tab
**Expected:** Automated daily backups are enabled (showing scheduled backup window)
**Why human:** Claude has no DigitalOcean control-panel access. This is the rollback bookend prerequisite for continuous flag-gated BEAAA deploy. It is intentionally batched into the end-of-milestone operator window alongside Phase 19's live ON-flip, per D-02 and Plan 20-03.

---

### Gaps Summary

No code gaps. The single open item is the DO-backup live confirmation — an operator action deliberately deferred to the end-of-milestone window. This is a known rider, not a gap introduced by Phase 20. All test-debt items are resolved in code: snapshot-prefetch count assertion is exact, U7 watchdog is condition-based, safety-CLI devDeps are declared and green-by-pass, CI glob is recursive, and SC5 matrix runs continuously as a standing guard.

**Verdict: passed-with-rider.** The phase goal is achieved in code. The single open operator action (DO-backup confirmation) was never autonomous work — it was batched by design.

---

_Verified: 2026-06-15T15:52:00Z_
_Verifier: Claude (gsd-verifier)_
