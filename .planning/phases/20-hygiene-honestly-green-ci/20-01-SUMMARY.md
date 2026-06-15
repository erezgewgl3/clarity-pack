---
phase: 20-hygiene-honestly-green-ci
plan: 01
subsystem: test-debt resolution — honestly-green CI (prefetch count, watchdog flake, safety-CLI deps)
tags: [hyg-03, d-04, d-05, d-06, test-only, no-wall-clock, devdeps, honestly-green, no-src-change]
requires:
  - "19-01: src/worker/db/action-cards-flag-repo.ts (isActionCardsEnabled — the action_cards_flag namespace SELECT the prefetch test must account for)"
  - "17 (commit 0e055c7): the snapshot-prefetch suite + the clarity_human_waits prefetch posture the action_cards_flag fix mirrors"
  - "04.1-04: chat-messages U7 watchdog test + the void ensureTopicWakeable fire-and-forget at chat-messages.ts:216"
  - "scripts/safety/lib/{snapshot,restore,gate,paperclip-cli}.mjs (top-level tar/cross-spawn imports + dynamic pglite import — the module-load chain that failed)"
provides:
  - "test/worker/situation/snapshot-prefetch.test.mjs — exact (==2) round-trip contract with a dedicated action_cards_flag spy + a one-read N+1 trip-wire"
  - "test/worker/chat/chat-messages.test.mjs — condition-based (barrier) U7 watchdog test, zero wall-clock"
  - "package.json + pnpm-lock.yaml — tar@^7, @electric-sql/pglite@^0.3, cross-spawn@^7 devDeps that make the 7 safety-CLI harness tests loadable + green"
affects:
  - "the full `node --test` sweep — three known debts removed (no silent red, no loosened assertion)"
tech-stack:
  added:
    - "tar@7.5.16 (devDep — was undeclared; top-level import in snapshot/restore libs)"
    - "@electric-sql/pglite@0.3.16 (devDep — was undeclared; 0.3 family because 0.2.x dumpDataDir('gzip') throws `dumpTar` undefined on Node 24)"
    - "cross-spawn@7.0.6 (devDep — DISCOVERED third undeclared import, top-level in 4 safety libs, failed module-load before tar)"
  patterns:
    - "namespace-read exclusion from the public.* prefetch round-trip count (action_cards_flag mirrors clarity_user_prefs / situation_snapshots / clarity_human_waits) + a dedicated spy for an exact one-read N+1 trip-wire"
    - "condition-based fire-and-forget proof via an observable deferred-promise barrier (handler resolves while the watchdog get is still pending) replacing a wall-clock `elapsed < 85` threshold"
key-files:
  created:
    - .planning/phases/20-hygiene-honestly-green-ci/20-01-SUMMARY.md
  modified:
    - test/worker/situation/snapshot-prefetch.test.mjs
    - test/worker/chat/chat-messages.test.mjs
    - package.json
    - pnpm-lock.yaml
decisions:
  - "DISCOVERED THIRD DEP (Rule 3): the plan named tar + @electric-sql/pglite, but cross-spawn is ALSO undeclared and absent — imported top-level in snapshot.mjs:19 (before tar:24), gate.mjs:25, paperclip-cli.mjs:12, restore.mjs:21. It failed module-load FIRST. The plan's intent (make the lib imports resolve) requires all three; cross-spawn@^7 added."
  - "PGLITE VERSION BUMP (plan discretion — 'verify exact published versions… the versions the imports need'): with @electric-sql/pglite@^0.2 (resolved 0.2.17) the deps RESOLVE and 4/7 files pass, but restore/snapshot/snapshot-pglite fail at runtime — 0.2.x's dumpDataDir('gzip') throws `Cannot read properties of undefined (reading 'dumpTar')` on Node 24. Bumped to ^0.3 (resolved 0.3.16); the 0.3 family's gzip dump works on Node 24 → all three pass. Chose genuine pass over an it.skip (the cheap honest fix the plan prefers)."
  - "NO SKIP INTRODUCED: with all three deps present + pglite ^0.3, all 7 safety-CLI files are green-by-PASS (fail 0). The single `skipped 1` in the run is a PRE-EXISTING platform-conditional test — restore-tar-cve.test.mjs R7 `t.skip('platform cannot create symlinks (Windows without admin/dev mode)')` — which runs on Linux CI. Non-empty reason, surfaced in the summary. I added no skips and loosened no assertions."
  - "PREFETCH EXACTNESS (D-05): kept dbQuerySql.length === 2 EXACT (not <=N); added a dedicated spies.actionCardsFlagSql with an exactly-ONE assertion so a future per-row N+1 of the flag read is still caught."
  - "NO SRC CHANGE (D-07): blocker-chain.ts untouched; no production file changed. The only edits are the two test files, package.json, pnpm-lock.yaml. tsc --noEmit clean (exit 0). package version unchanged (1.8.0). pnpm install --frozen-lockfile succeeds."
metrics:
  duration: "~25 min"
  completed: "2026-06-15"
  tasks: 3
  files_changed: 4
requirements: [HYG-03]
---

# Phase 20 Plan 01: Hygiene — honestly-green CI test-debt Summary

Resolved the three test-debts that kept the full `node --test` sweep from being
honestly green — **without touching a single production file**. A green check now
means each test actually ran and passed (or is explicitly, visibly skipped with a
reason): the Phase-17/19 snapshot-prefetch count drift is exact and documented,
the U7 chat-watchdog flake is condition-based instead of wall-clock, and the 7
safety-CLI harness tests load + pass because their three undeclared devDeps are
now declared.

## What shipped

**Task 1 — snapshot-prefetch count drift (D-05).** The "exactly TWO db.query"
assertion was failing 3 ≠ 2 because the Phase-19 `isActionCardsEnabled` namespace
SELECT (`plugin_clarity_pack_cdd6bda4bd.action_cards_flag WHERE company_id = $1
LIMIT 1`) fell through into the public.* round-trip spy. The fix adds a dedicated
`action_cards_flag` branch in `makeCtx`'s `ctx.db.query` — matching the existing
posture for `clarity_user_prefs` / `situation_snapshots` / `clarity_human_waits`
— recording it on its own `spies.actionCardsFlagSql` and returning `[]`
(degrade-to-OFF default). The public assertion stays **exact** (`=== 2`, not
`<=N`), a comment names the third read as the Phase-19 (CARD-03) flag SELECT
served from exactly one of two mutually-exclusive snapshot paths
(situation-room.ts:603 sync recompute OR :709 SWR serve), and a new assertion
pins **exactly one** flag read per snapshot so a future per-row N+1 is still
caught. All 8 subtests green; no src/ change.

**Task 2 — U7 watchdog flake (HYG-03 / D-04).** The old test asserted
`elapsed < 85` ms — under CI load the single awaited 50 ms stuck-read could cross
85 ms even when the watchdog get was correctly not awaited → false failure. The
rewrite proves fire-and-forget by **observable barrier, not clock**: `makeCtx`
gains a `getBarrier` option that gates **only the first** `ctx.issues.get` (the
`void ensureTopicWakeable` watchdog get at chat-messages.ts:216); the awaited
stuck-read (the second get, :249) proceeds immediately. The test asserts the
handler **resolves while the barrier is still unresolved** (positive proof of
non-await), then releases the barrier and drains with the existing
`setImmediate` tick pattern so node --test sees no dangling promise. No
`Date.now()`, no `elapsed`, no sleep threshold in executable code. All 32
subtests green; no src/ change.

**Task 3 — 7 safety-CLI harness tests (D-06).** Root cause was a **module-load
failure from undeclared devDeps**: `scripts/safety/lib/snapshot.mjs` (and
restore/gate/paperclip-cli) do top-level `import * as tar from 'tar'`,
`import crossSpawn from 'cross-spawn'`, plus a dynamic `@electric-sql/pglite`
import — none declared, none in node_modules. Declared all three
(`tar@^7`, `@electric-sql/pglite@^0.3`, `cross-spawn@^7`), ran `pnpm install`,
re-ran. The injection points (`_spawn`, `_pglite`, `startStubServer`,
`_paperclipCli`) mean these never spawn real pg_dump or hit a real DB, so once the
imports resolve they genuinely pass.

## The 7 safety-CLI tests — green-by-pass vs green-by-skip

All 7 ended **green-by-PASS** (`fail 0` across all files, 57 tests / 56 pass / 1
skipped). I introduced **zero** skips and loosened **zero** assertions.

| File | Result |
|------|--------|
| gate.test.mjs | green-by-pass (21/21) |
| restore.test.mjs | green-by-pass (7/7) |
| restore-tar-cve.test.mjs | green-by-pass (3 pass + 1 PRE-EXISTING platform skip) |
| snapshot.test.mjs | green-by-pass (6/6) |
| snapshot-pglite.test.mjs | green-by-pass (8/8) |
| snapshot-postgres-mock.test.mjs | green-by-pass (2/2) |
| verify.test.mjs | green-by-pass (9/9) |

The single `skipped 1` is **pre-existing and platform-conditional**:
restore-tar-cve R7 `t.skip('platform cannot create symlinks (Windows without
admin/dev mode)')` — a CVE in-tree-symlink extraction test that runs on Linux CI.
Non-empty reason, surfaced in the run summary, not introduced by this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] cross-spawn was a discovered third undeclared devDep**
- **Found during:** Task 3
- **Issue:** The plan named `tar` + `@electric-sql/pglite`. But `cross-spawn` is
  also undeclared and absent — imported top-level in snapshot.mjs:19 (before tar
  at :24), gate.mjs:25, paperclip-cli.mjs:12, restore.mjs:21 — so it failed
  module-load FIRST (`Cannot find package 'cross-spawn'`).
- **Fix:** Added `cross-spawn@^7` (resolved 7.0.6) alongside the two named deps.
  This is squarely within the plan's intent ("Declare the missing devDeps so the
  top-level imports stop throwing").
- **Files modified:** package.json, pnpm-lock.yaml
- **Commit:** abbd37f

**2. [Rule 3 - Blocking] pglite ^0.2 resolves but throws at runtime on Node 24**
- **Found during:** Task 3
- **Issue:** With `@electric-sql/pglite@^0.2` (resolved 0.2.17) the deps resolve
  and gate/restore-tar-cve/snapshot-postgres-mock/verify pass, but
  restore/snapshot/snapshot-pglite fail in `dumpDataDir('gzip')` with
  `TypeError: Cannot read properties of undefined (reading 'dumpTar')` — a
  0.2.x-on-Node-24 incompatibility.
- **Fix:** Bumped the devDep to `^0.3` (resolved 0.3.16); the 0.3 family's gzip
  dump works on Node 24 → all three pass. The plan explicitly allowed this
  ("verify exact published versions… the versions the imports need" / "if any
  still fail after deps are present"); chose a genuine pass over an `it.skip`.
- **Files modified:** package.json, pnpm-lock.yaml
- **Commit:** abbd37f

## Finding for Plan 20-02 (CI glob wiring) — safety suite needs serial execution

The 7 safety-CLI tests are `fail 0` when each file runs in its own `node --test`
invocation, and `fail 0` deterministically when all 7 run together with
`--test-concurrency=1` (verified across repeated runs). But when all 7 run in **one
default (parallel) `node --test` invocation**, a flaky `fail 1` appears
(observed on `verify.test.mjs` V3) — the PGlite/WASM-backed snapshot / restore /
snapshot-pglite files contend for shared temp + WASM resources when node --test
schedules files concurrently, starving the stub-HTTP-server verify test.

Two facts make this a 20-02 concern, not a 20-01 blocker:
1. The current default `test` script glob is `test/**/*.test.mjs` — it does **not**
   match `scripts/safety/test/*` at all, so the safety suite is presently excluded
   from the default sweep (precisely the gap 20-02 closes: "widen the CI test glob
   to recurse so the safety-CLI suite actually runs").
2. The fix is a CI-runner concern (run the safety suite with `--test-concurrency=1`,
   or as its own serial step), not a test-file or lib change — which D-07 forbids
   here anyway.

**Action for 20-02:** when wiring the safety-CLI suite into CI, run it with
`--test-concurrency=1` (or as a dedicated serial step) so the WASM contention
cannot produce a flaky red. Per-file and serial execution are honestly green today.

## Carried invariants (D-07)

- **blocker-chain.ts untouched** — verified via `git diff --name-only` (no match).
- **No src/ file changed** — the cumulative diff is exactly: the two test files,
  package.json, pnpm-lock.yaml.
- **No new feature behavior** — test/config/deps only.
- **tsc --noEmit clean** (exit 0). **package version unchanged** (1.8.0).
  **`pnpm install --frozen-lockfile` succeeds.**

## Verification

- `node --test test/worker/situation/snapshot-prefetch.test.mjs` → 8/8 pass, exact `=== 2` contract + one-read flag trip-wire.
- `node --test test/worker/chat/chat-messages.test.mjs` → 32/32 pass, U7 condition-based (grep shows no executable wall-clock threshold).
- 7 safety-CLI tests → 57 tests / 56 pass / 1 pre-existing platform skip / **fail 0**.
- `git diff --name-only 2e00eac^ HEAD` → only the 2 test files + package.json + pnpm-lock.yaml. No src/. blocker-chain.ts untouched.
- `npx tsc --noEmit` → exit 0.

## Commits

- `2e00eac` test(20-01): fix snapshot-prefetch count drift exactly (D-05)
- `76bfe81` test(20-01): make U7 watchdog test condition-based not wall-clock (HYG-03/D-04)
- `abbd37f` chore(20-01): declare safety-CLI harness devDeps — honestly green (D-06)

## Self-Check: PASSED

- SUMMARY.md present at `.planning/phases/20-hygiene-honestly-green-ci/20-01-SUMMARY.md`.
- All three task commits exist in git history (2e00eac, 76bfe81, abbd37f).
