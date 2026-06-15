---
phase: 21-stuck-agent-reply-in-place
plan: 01
subsystem: pure engine — activate the reply-to-unstick gate for AWAITING_AGENT_STUCK
tags: [stuck-03, d-1, d-2, d-8, engine-only, pure, no-ai, no-io, no-migration, nudge-affordance, reply-reachable]
requires:
  - "12-01 (D-05): the prior lock that routed AWAITING_AGENT_STUCK → actionAffordance:'assign' / isReplyReachable false — REVERSED by this plan"
  - "11-01 (D-14): classifyVerdict exhaustive-switch + never-guard idiom (the verdict-triple producer this plan edits one case of)"
  - "14-02 (DO-05/SC4): isReplyReachable pure predicate (the boolean this plan flips one case of)"
  - "10 spike (Shape A + Shape B): proof that a plain answer-comment resumes a status='blocked' agent — the recipe that makes a stuck reply reachable"
provides:
  - "src/shared/blocker-chain.ts: AWAITING_AGENT_STUCK verdict triple { tier:'watch', actionAffordance:'nudge', needsYou:false } — the dormant 'nudge' slot is now ACTIVE"
  - "src/shared/reply-reachable.ts: isReplyReachable('AWAITING_AGENT_STUCK') === true — exactly TWO reachable kinds now (AWAITING_HUMAN + AWAITING_AGENT_STUCK)"
affects:
  - "every Wave-2 UI surface consumer (employee-row.tsx, live-blocker-panel.tsx, reply-in-place.tsx) — a stuck row now carries 'nudge' + reachable:true, the structural precondition Wave 2 mounts <ReplyInPlace> on"
  - "src/worker/situation/build-employees-rollup.ts + org-blocked-backlog.ts — stuck rows now emit 'nudge' (was 'assign'); D-7 'assign' consumers must be audited in Wave 2 (UNOWNED still 'assign')"
tech-stack:
  added: []
  patterns:
    - "one-triple edit to the classifyVerdict exhaustive switch + one-boolean edit to the isReplyReachable exhaustive switch — both never-guards still total over the 8 kinds (tsc enforces; no 9th kind, no new union member)"
    - "engine purity boundary preserved: the verdict + predicate read ONLY the terminal discriminant — no AI/LLM token, no I/O, no wall-clock, no UUID/label string-match (source-grep purity guards stay green)"
key-files:
  created:
    - .planning/phases/21-stuck-agent-reply-in-place/21-01-SUMMARY.md
  modified:
    - src/shared/blocker-chain.ts
    - src/shared/reply-reachable.ts
    - test/shared/reply-reachable.test.mjs
    - test/worker/blocked-no-edge-verdict-consistency.test.mjs
    - test/shared/blocker-chain.test.mjs
    - test/worker/situation/build-employees-rollup.test.mjs
    - test/worker/situation/build-employees-rollup-needsyou.test.mjs
    - test/worker/org-blocked-backlog.test.mjs
decisions:
  - "SEED DIVERGENCE confirmed and corrected: V1.6-SEED.md said 'blocker-chain.ts stays untouched' and 'loosen a terminal-kind gate in situation-reply-and-resume.ts'. Live code is the opposite — the handler NEVER gated on terminal kind (it acts on the caller-supplied needsDurabilityFlip boolean), and the REAL gate is exactly the engine verdict triple (blocker-chain.ts) + the reachable predicate (reply-reachable.ts), both locked to 'assign'/false under Phase-12 D-05. This plan edits the engine (correctly) and leaves the handler untouched (correctly)."
  - "tier 'watch' + needsYou false DELIBERATELY UNCHANGED (21-CONTEXT D-1 / Phase-12 D-04 / Phase-15 lock): a stuck agent stays a QUIET Watch affordance ('nudge to unstick'), NOT a promotion to the loud Needs-you tier. Only actionAffordance moved ('assign' → 'nudge')."
  - "THREE extra engine-derived test files patched as in-scope Rule-1 fixes (NOT just the two named in the plan): blocker-chain.test.mjs (verdict table + single STUCK case), build-employees-rollup.test.mjs (Test 22 split-identity), build-employees-rollup-needsyou.test.mjs (Test 7), and org-blocked-backlog.test.mjs all pinned the OLD 'assign' value and went red the instant the engine source changed. They re-assert the engine verdict, so the source change directly caused the failure (scope-boundary: directly caused by this task's edit). UNOWNED's legitimate 'assign' assertions were left untouched in every file."
  - "NO migration / NO capability change (21-CONTEXT D-9): purely structural engine edit (a verdict triple + a boolean). package.json version unchanged (1.8.0) — version bump belongs to the deploy plan, not this engine-only plan."
metrics:
  duration: "~20 min"
  completed: "2026-06-15"
  tasks: 2
  files_changed: 8
requirements: [STUCK-03]
---

# Phase 21 Plan 01: Activate Stuck-Agent Reply-Reachability (engine gate flip) Summary

Flipped the two pure-engine gates that have kept stuck agents out of the
reply-in-place loop since the Phase-12 D-05 lock. `AWAITING_AGENT_STUCK` now
carries `actionAffordance:'nudge'` (the dormant-but-reserved slot, now active) and
`isReplyReachable('AWAITING_AGENT_STUCK')` returns `true` — the structural
precondition every Wave-2 UI surface consumes to mount the existing
`<ReplyInPlace>` Send on a stuck row. `tier:'watch'` and `needsYou:false` are
deliberately unchanged: stuck stays a quiet Watch affordance, not a loud Needs-you
promotion. No new terminal kind, no migration, no handler change, no capability
change. The engine stays AI-free / pure / I/O-free.

## What shipped

**Task 1 — engine verdict + reachable predicate (commit 5cbeb54).**
- `src/shared/blocker-chain.ts` `classifyVerdict`: the `case 'AWAITING_AGENT_STUCK'`
  return changed from `actionAffordance:'assign'` to `actionAffordance:'nudge'`;
  `tier:'watch'` and `needsYou:false` left intact. The Plan-12 D-05 comment block
  was replaced with a Phase-21 note (reserved nudge slot now active; tier/needsYou
  unchanged on purpose). No other case touched.
- `src/shared/reply-reachable.ts` `isReplyReachable`: `case 'AWAITING_AGENT_STUCK'`
  changed `return false` → `return true`. The case comment, the file-header SCOPE
  block, and the function JSDoc were all rewritten to drop the "DEFERRED / Phase-12
  D-05 LOCK" rationale and cite the Phase-21 activation (Shape-B answer-comment
  resume). The predicate still reads only the kind discriminant.
- Verify: `npx tsc --noEmit` exits 0 — both `never` guards still total over all 8
  kinds.

**Task 2 — engine-level tests (commit 806defd).**
- `test/shared/reply-reachable.test.mjs`: STUCK assertion flipped to `true`; the
  reachable-set test renamed to "exactly TWO of the 8 kinds are reachable" and now
  asserts `['AWAITING_HUMAN', 'AWAITING_AGENT_STUCK']` (the order `KINDS.filter`
  yields). Header comment updated. Purity guards untouched.
- `test/worker/blocked-no-edge-verdict-consistency.test.mjs`: TDD-1 Reader STUCK
  cell assertion flipped `'assign'` → `'nudge'` (tier/needsYou asserts kept). The
  SC5 4×8 matrix derives expected via `verdictKey` (which includes
  `actionAffordance`), so the STUCK column now flows `'nudge'` automatically — no
  hard-coded `'assign'` literal remained for that kind.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three additional engine-derived test files pinned the stale value**
- **Found during:** Task 2 (the first full-suite run after the source edit).
- **Issue:** Beyond the two test files named in the plan, four assertions in three
  other files pinned `AWAITING_AGENT_STUCK → 'assign'` and went red the instant
  Task 1 changed the engine source. They re-assert the engine verdict, so the
  failure is directly caused by this task's edit (in scope).
- **Fix:** flipped each STUCK affordance assertion to `'nudge'` (updating titles +
  comments to cite Phase-21 D-1); left every legitimate UNOWNED `'assign'`
  assertion untouched.
  - `test/shared/blocker-chain.test.mjs` — the 8-kind verdict table + the single
    conservative-STUCK case test.
  - `test/worker/situation/build-employees-rollup.test.mjs` — Test 22 (split
    identity / NO_UUID_LEAK).
  - `test/worker/situation/build-employees-rollup-needsyou.test.mjs` — Test 7
    (stuck excluded from Needs-you; the `needsYou:false` invariant is the real
    point and was preserved).
  - `test/worker/org-blocked-backlog.test.mjs` — the AWAITING_AGENT_STUCK builder
    row test.
- **Commit:** 806defd

## Seed divergence (required by plan output spec)

The seed asserted (a) `blocker-chain.ts` stays untouched and (b) the gate to loosen
lives in `situation-reply-and-resume.ts`. Live-code grounding (confirmed in
21-CONTEXT) shows the opposite is the correct minimal design: the handler is already
terminal-kind-agnostic (it acts on the caller-supplied `needsDurabilityFlip`
boolean, never on `terminal.kind`), and the real gate is the engine verdict triple
plus the reachable predicate. This plan edits the engine and leaves the handler
alone — exactly inverting the seed, as 21-CONTEXT directed.

## Verification

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (both `never` guards total over the 8 kinds).
- `node --test test/shared/reply-reachable.test.mjs test/worker/blocked-no-edge-verdict-consistency.test.mjs test/shared/blocker-chain.test.mjs` → 48/48 pass (includes the engine purity grep guards).
- Full suite `npm test` → **2940 tests, 2938 pass, 0 fail** (2 are pre-existing platform-conditional skips, unrelated).
- Acceptance greps: STUCK→`true` count in reply-reachable test = 2; no stale `'assign'` / reachable-`false` STUCK assertion remains in the two named files.

## Downstream for Wave 2

- A stuck row now carries `actionAffordance:'nudge'` + `isReplyReachable:true`. Wave 2 mounts the existing `<ReplyInPlace>` on the `'nudge'` branch in both surfaces (D-3), adds the optional `variant:'nudge'` copy prop (D-4), maps `'nudge' → 'answer'` in action-cards (D-6, no migration), and audits the `actionAffordance === 'assign'` consumers (D-7 — UNOWNED still `'assign'`; only stuck moved).

## Self-Check: PASSED
