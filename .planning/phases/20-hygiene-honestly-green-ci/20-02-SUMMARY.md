---
phase: 20-hygiene-honestly-green-ci
plan: 02
subsystem: CI — honestly-green test glob (SC5 matrix + nested suites + safety-CLI wired into CI)
tags: [hyg-01, d-03, ci-config, honestly-green, no-silent-skip, no-src-change, serial-safety-suite]
requires:
  - "20-01: the three test-debt fixes (snapshot-prefetch exact count, U7 watchdog condition-based, safety-CLI devDeps tar/pglite/cross-spawn) that make the nested + safety suites loadable + green"
  - "17 (commit 0e055c7 + the SC5 work): test/worker/blocked-no-edge-verdict-consistency.test.mjs — the 4 surfaces × 8 terminal-kind matrix this plan wires into CI"
provides:
  - ".github/workflows/scaffold-check.yml — CI test step now runs the RECURSIVE test/**/*.test.mjs glob (SC5 matrix + all nested worker/ui suites + visual) AND a separate serial scripts/safety/test/** segment (--test-concurrency=1)"
affects:
  - "the meaning of a green scaffold-check check — it now provably runs the SC5 matrix + the ~126 previously-silently-skipped nested tests + the safety-CLI suite"
tech-stack:
  added: []
  patterns:
    - "recursive node --test glob (test/**/*.test.mjs) mirroring package.json `test` script — node expands `**` itself; closes the silent-green gap where single-level globs skipped nested suites"
    - "out-of-tree suite as its own CI segment with --test-concurrency=1 — the safety-CLI PGlite/WASM files contend under parallel scheduling, so they run serially (deterministically green) per Plan 20-01's finding"
key-files:
  created:
    - .planning/phases/20-hygiene-honestly-green-ci/20-02-SUMMARY.md
  modified:
    - .github/workflows/scaffold-check.yml
decisions:
  - "RECURSIVE GLOB, not file-list (D-03): widened the CI test step from the single-level test/{shared,worker,ui}/*.test.mjs to the recursive test/**/*.test.mjs (mirroring package.json's `test` script). Measured during planning: single-level ran ~30 top-level worker files; recursive runs 282 test files — the ~126 nested tests (101 worker/**, 25 ui/**) that were silently skipped now run. The SC5 matrix is top-level under test/worker so it already ran, but the now-fixed watchdog (test/worker/chat/**) + snapshot-prefetch (test/worker/situation/**) tests were nested and invisible to CI until this change."
  - "SAFETY SUITE IS A SEPARATE SERIAL SEGMENT (Plan 20-01 finding): scripts/safety/test/** lives OUTSIDE test/ so test/** does not match it — it needs its own glob segment. It is pinned to --test-concurrency=1 because the PGlite/WASM-backed snapshot/restore/verify files flake to a red ONLY under node --test's default parallel file scheduling (shared temp + WASM contention). Per-file and serial are deterministically green; serial is the honest-green wiring."
  - "VISUAL TEST RUNS FOR REAL IN CI, NOT EXCLUDED: test/visual/sketch-regression.test.mjs is matched by test/** and self-skips only when SKIP_VISUAL=1. CI installs Chromium (--with-deps) in the pre-existing Playwright step and must NOT set SKIP_VISUAL, so the visual test runs as designed. No explicit exclusion needed — the smallest change is to let the recursive glob include it (consistent with package.json's `test` script, which already globs test/**)."
  - "NO SRC CHANGE / blocker-chain.ts UNTOUCHED (D-07): the only file changed by this plan is .github/workflows/scaffold-check.yml. blocker-chain.ts is byte-identical (git diff --stat empty) and contains no AI-token imports. a11y-check.yml + coexistence.yml are unchanged (distinct single-purpose workflows). tsc --noEmit clean (exit 0)."
  - "TASK 2 IS VERIFICATION-ONLY — no commit: Task 2 is an evidence-capture sweep (run the suite CI now runs, confirm honest-green, confirm the matrix executed, confirm invariants). It makes zero code changes, so it produces no commit of its own; its evidence is recorded here."
metrics:
  duration: "~20 min"
  completed: "2026-06-15"
  tasks: 2
  files_changed: 1
requirements: [HYG-01]
---

# Phase 20 Plan 02: Hygiene — honestly-green CI (wire the SC5 matrix + nested + safety suites into CI) Summary

Made the scaffold-check green checkmark **honest**. CI's test step previously
ran only a single-level glob (`test/{shared,worker,ui}/*.test.mjs`) that silently
SKIPPED ~126 nested tests — including the very watchdog + snapshot-prefetch tests
Plan 20-01 just fixed, and never touching the out-of-tree safety-CLI suite at all.
The fix widens the glob to the recursive form (mirroring `package.json`'s `test`
script) so the full nested worker/ui suites run, wires the SC5 full surface ×
terminal-kind matrix into CI as a standing guard, and adds the safety-CLI suite as
its own **serial** segment (`--test-concurrency=1`) so the PGlite/WASM parallel
flake surfaced in Plan 20-01 cannot produce a flaky red. Only one file changed
(the workflow); no production code, no `blocker-chain.ts`.

## What shipped

**Task 1 — widen the CI test glob (HYG-01 / D-03).** In
`.github/workflows/scaffold-check.yml` the single test step became **two**:

1. `full recursive suite … incl. SC5 matrix + visual` →
   `node --test "test/**/*.test.mjs"`. Node expands `**` itself (verified: 282
   files vs ~30 under the old top-level worker glob). This now runs the nested
   `test/worker/**` (101 files) + `test/ui/**` (25 files) suites — including the
   now-fixed `test/worker/chat/chat-messages.test.mjs` (U7 watchdog) and
   `test/worker/situation/snapshot-prefetch.test.mjs` (count drift), both
   invisible to CI before today. The SC5 matrix
   (`test/worker/blocked-no-edge-verdict-consistency.test.mjs`) is top-level
   under `test/worker`, so it was already matched and continues to run as a
   standing guard. `test/visual/sketch-regression.test.mjs` is matched too and
   runs for real (Chromium is installed by the pre-existing Playwright step; CI
   must not set `SKIP_VISUAL`).

2. `safety-CLI suite (serial …)` →
   `node --test --test-concurrency=1 "scripts/safety/test/**/*.test.mjs"`. The
   safety suite lives **outside** `test/` so it needs its own glob segment, and
   it runs **serially** because the PGlite/WASM snapshot/restore/verify files
   flake to a red only under node's default parallel file scheduling (Plan 20-01
   finding). A short inline comment on each step names the HYG-01 honest-green
   intent and the serial-concurrency rationale.

The Playwright Chromium install step and every other step are untouched.
`a11y-check.yml` and `coexistence.yml` are NOT modified (they are distinct
single-purpose workflows with their own node-version / file scope).

**Task 2 — honest-green sweep verification + invariant guard (verification-only,
no code change).** Ran the exact two commands CI now runs and confirmed honest
green end-to-end, confirmed the SC5 matrix actually executes, confirmed
`tsc --noEmit` is clean, and confirmed the `blocker-chain.ts` purity invariant
holds. No new red surfaced.

## Final sweep counts (the two segments CI now runs)

| Segment | Command | tests | pass | **fail** | skipped |
|---|---|---|---|---|---|
| Main recursive suite | `node --test "test/**/*.test.mjs"` (locally `SKIP_VISUAL=1`) | 2937 | 2933 | **0** | 4 |
| Safety-CLI (serial) | `node --test --test-concurrency=1 "scripts/safety/test/**/*.test.mjs"` | 124 | 123 | **0** | 1 |

**Combined: fail 0.** Every skip carries a surfaced, documented reason (below) —
no silent red, no silent truncation, no loosened assertion (the no-silent-caps
invariant holds).

### Documented skips (5 total — every one has a reason)

Main suite (4), as observed locally with `SKIP_VISUAL=1`:
- `visual-regression: SKIPPED via SKIP_VISUAL=1` — the sketch-regression self-skip
  guard. **In CI this runs for real** (Chromium installed, `SKIP_VISUAL` unset).
- 2× `Plan 05-06 item (e) CONVERGENCE GATE / ANCESTOR-CHAIN AUDIT … (Playwright
  headless)` in `test/ui/chat/...chat-live-sticky` — Playwright-headless CSS
  convergence gates that self-skip without a browser locally; CI runs them after
  the Chromium install step.
- 1× `dist/ui/index.js inlines key audited classnames after build (gated on
  RUN_BUILD_TESTS=1)` — a build-artifact assertion gated behind an opt-in env flag.

Safety suite (1):
- `restore-tar-cve` R7 — `t.skip('platform cannot create symlinks (Windows
  without admin/dev mode)')` — a CVE in-tree-symlink extraction test. Pre-existing
  and platform-conditional (Plan 20-01 documented it); **runs on Linux CI**.

## Proof the SC5 matrix executes

`node --test test/worker/blocked-no-edge-verdict-consistency.test.mjs` → 16 tests,
fail 0. The run output contains the full 4 surfaces × 8 terminal-kind matrix:

```
✔ SC5 matrix — 4 surfaces × kind=AWAITING_HUMAN: every surface reads ONE consistent verdict
✔ SC5 matrix — 4 surfaces × kind=AWAITING_AGENT_WORKING: …
✔ SC5 matrix — 4 surfaces × kind=AWAITING_AGENT_STUCK: …
✔ SC5 matrix — 4 surfaces × kind=SELF_RESOLVING: …
✔ SC5 matrix — 4 surfaces × kind=UNOWNED: …
✔ SC5 matrix — 4 surfaces × kind=EXTERNAL: …
✔ SC5 matrix — 4 surfaces × kind=CYCLE: …
✔ SC5 matrix — 4 surfaces × kind=UNCLASSIFIED: …
```

Because this file is under `test/worker`, the recursive `test/**` glob matches it —
the one-verdict-everywhere guarantee is now continuously enforced in CI.

## Carried invariants (D-07)

- **blocker-chain.ts byte-unchanged** — `git diff --stat src/shared/blocker-chain.ts`
  is empty.
- **No AI-token imports in blocker-chain.ts** — grep for
  openai/anthropic/claude/gpt/llm imports returns NONE.
- **No src/ file changed by this plan** — `git diff --name-only e64a6f1~1 HEAD -- src/`
  is empty; the only file changed is `.github/workflows/scaffold-check.yml`.
- **tsc --noEmit clean** (exit 0).
- **a11y-check.yml + coexistence.yml unchanged.**

## Deviations from Plan

None — plan executed exactly as written. The recursive glob, the separate serial
safety segment, and letting the visual test run for real in CI (rather than
excluding it) were all anticipated by the plan's `<interfaces>` watch-out and
Plan 20-01's serial-execution finding; no auto-fixes (Rules 1–3) and no
architectural escalations (Rule 4) were needed.

## Verification

- `grep -q "test/\*\*/\*.test.mjs"` and `grep -q "scripts/safety/test"` against
  scaffold-check.yml → both present ("CI glob widened OK").
- `node --test "test/**/*.test.mjs"` → 2937 tests, fail 0, 4 documented skips.
- `node --test --test-concurrency=1 "scripts/safety/test/**/*.test.mjs"` → 124
  tests, fail 0, 1 pre-existing platform skip.
- SC5 matrix subtests present in the run output (all 8 terminal kinds × 4 surfaces).
- `npx tsc --noEmit` → exit 0.
- `git diff --stat src/shared/blocker-chain.ts` → empty (byte-unchanged); no
  AI-token imports.
- Only `.github/workflows/scaffold-check.yml` changed by this plan;
  a11y-check.yml + coexistence.yml untouched.

## Commits

- `e64a6f1` ci(20-02): widen test glob to recursive — run SC5 matrix + nested suites + safety-CLI (HYG-01/D-03)
- (Task 2 is verification-only — no commit; evidence captured above.)

## Self-Check: PASSED

- SUMMARY.md present at `.planning/phases/20-hygiene-honestly-green-ci/20-02-SUMMARY.md`.
- Task 1 commit `e64a6f1` exists in git history.
