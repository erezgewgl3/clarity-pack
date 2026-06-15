---
phase: 21-stuck-agent-reply-in-place
plan: 04
subsystem: tests — extend the Phase-14 reply-and-resume suite to the stuck/nudge path; pin the kind-agnostic handler + STUCK-04 no-auto-resume + STUCK-06 NO_UUID_LEAK
tags: [stuck-04, stuck-06, d-8, reply-in-place, nudge-affordance, kind-agnostic, no-auto-resume, no-uuid-leak, tests-extend-not-rewrite]
requires:
  - "21-01 (D-1/D-2): the engine flip — AWAITING_AGENT_STUCK now carries actionAffordance:'nudge' + isReplyReachable:true. The render-path tests pin the surfaces that consume it."
  - "21-02 (D-4): ReplyInPlaceProps.variant?: 'answer' | 'nudge' — the primitive copy coverage this plan relies on (already landed + green in 21-02)."
  - "21-03 (D-3/D-5/D-7): the Wave-2 surface edits (employee-row showNudge Watch-tier mount; live-blocker-panel isNudgeBranch re-wire; the case 'nudge' onAction=null). These are the render paths Task 1 pins."
  - "14-01 (DO-01): situation.replyAndResume — the terminal-kind-agnostic handler Task 2 confirms (read-only, NO edit)."
provides:
  - "test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs: +5 assertions pinning showNudge (=== 'nudge') + the Watch-tier <ReplyInPlace variant='nudge'> mount + the real reachable/needsDurabilityFlip pins + Watch-tier containment (no Needs-you promotion) + no stale 'assign an owner' copy (STUCK-01)"
  - "test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs: +3 assertions pinning isNudgeBranch + variant='nudge' mount + the case 'nudge' onAction=null (no requestWakeup button, dead wake path removed) (STUCK-02)"
  - "test/worker/handlers/situation-reply-and-resume.test.mjs: +4 tests — kind-agnostic source-grep (needsDurabilityFlip present, terminal.kind/terminalKind absent), the stuck Shape-B resume behavioral case ({ ok, durable:true } + update {status:'in_progress'}), and the STUCK-04 no-auto-resume source-grep over the primitive (dispatch only on Send/chip/Enter, no useEffect)"
affects:
  - "21-05 (live-drill): the green full suite is the pre-deploy gate; the BEAAA stuck reply→resume drill exercises the surfaces these tests pin."
tech-stack:
  added: []
  patterns:
    - "Extend-don't-rewrite (D-8): every Phase-14 reply-branch assertion stays unchanged; the new assertions sit ALONGSIDE them on the nudge path. No assertion was deleted; the 21-03 in-flight edits already reconciled the two stale OLD-copy assertions."
    - "Source-grep over stripComments(src) (no jsdom): the UI + no-auto-resume contracts are pinned against the SOURCE, mirroring the existing employee-row-no-uuid-leak / reply-in-place convention; behavioral cases use the existing mock-ctx (no jsdom, no new harness)."
    - "Kind-agnostic confirmation by construction: the handler test reads the handler source and asserts the ABSENCE of terminal.kind/terminalKind — a future edit that re-introduces a kind branch fails the suite (the seed-divergence guard)."
key-files:
  created:
    - .planning/phases/21-stuck-agent-reply-in-place/21-04-SUMMARY.md
  modified:
    - test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs
    - test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs
    - test/worker/handlers/situation-reply-and-resume.test.mjs
decisions:
  - "D-8 (extend, don't rewrite): the two stale OLD-stuck assertions the plan anticipated (employee-row 'agent stuck · assign an owner' copy; the Reader nudge wake button) were ALREADY reconciled in 21-03 (Deviation 1) when the surface edits landed — 21-03 updated employee-row-actions.test.mjs T1-C and the live-blocker-panel suppression guard in-flight. So this plan ADDS nudge coverage to the *-reply-in-place suites without needing to remove anything; an explicit assert.doesNotMatch(/agent stuck · assign an owner/) was added to employee-row-reply-in-place.test.mjs as a regression pin."
  - "primitive variant/copy coverage (Task 1, third file) was already FULLY landed by 21-02 in reply-in-place.test.mjs (the variant?: union pin, the 'Nudge to unstick' literal, the byte-identical 'answer' copy pin, and the T-21-03 'variant absent from dispatchReply deps' pin). It is green and untouched here — no duplication added (extend-don't-rewrite)."
  - "Test 14 (kind-agnostic) deliberately asserts the ABSENCE of terminal.kind/terminalKind in the HANDLER SOURCE (stripped of comments). Test 5 (pre-existing) asserts the same contract behaviorally (a terminal.kind in PARAMS does not drive the flip). The two are complementary: source-grep catches a re-introduced source branch; the behavioral test catches a params-proxy. Both green."
  - "STUCK-04 no-auto-resume (Test 16-17) is pinned at the PRIMITIVE (the single dispatch site for all three surfaces), so SR + Reader + backlog are covered by construction. The pin is non-vacuous: it asserts reply({...}) appears EXACTLY ONCE (inside dispatchReply), that dispatchReply is invoked only from Send/chip onClick + Enter, AND that the primitive contains NO React.useEffect at all — so a mount-driven dispatch is structurally impossible."
  - "handler source UNCHANGED (git diff --stat clean) — confirmed, not edited (D-8). No edit to src/worker/handlers/situation-reply-and-resume.ts."
metrics:
  duration: "~25 min"
  completed: "2026-06-16"
  tasks: 2
  files_changed: 3
requirements: [STUCK-04, STUCK-06]
---

# Phase 21 Plan 04: Extend The Reply-And-Resume Test Suite To The Stuck/Nudge Path Summary

Extended (did NOT rewrite) the Phase-14 reply-and-resume test suite to lock the
v1.6.0 stuck reply-to-unstick behavior across both surfaces, the `variant` copy
prop, and the kind-agnostic handler. The Wave-2 surface edits (21-03) re-wired the
SR Watch-tier stuck row and the Reader `'nudge'` branch onto the SAME shared
`<ReplyInPlace variant='nudge'>`; this plan pins those NEW render paths with
source-grep assertions sitting alongside the unchanged Phase-14 reply-branch pins.
It adds an explicit, non-vacuous STUCK-04 no-auto-resume guard (the primitive
dispatches only on Send/chip/Enter and contains zero `useEffect`), confirms by
reading (not editing) that `situation.replyAndResume` is terminal-kind-agnostic
(needs NO change for the stuck path — the seed-divergence pin), exercises the stuck
Shape-B durable resume, and keeps the NO_UUID_LEAK render-scan (STUCK-06) green on
every new nudge path. Full suite: **2959 tests, 2957 pass, 0 fail, 2 skipped**.

## What shipped

**Task 1 — SR + Reader + primitive source-grep tests extended to the nudge path (commit fb6593c).**
- `employee-row-reply-in-place.test.mjs` (+5 assertions): `showNudge` gated
  strictly on `chain?.actionAffordance === 'nudge'`; a Watch-tier
  `<ReplyInPlace variant="nudge">` mount gated on `showNudge ?`; the nudge mount
  passes the REAL `reachable={isReplyReachable(chain.terminalKind)}` +
  `needsDurabilityFlip={chain.needsDurabilityFlip}` (no terminal.kind proxy); the
  stuck row stays in the QUIET Watch tier (the nudge branch lives inside the
  `visualTier === 'watch' && chain && !isChainlessIdle` block — no Needs-you
  promotion, `visualTierOf` not forked); and a regression pin that the OLD
  `agent stuck · assign an owner` copy is gone. Every Phase-14 reply-branch
  assertion (including the still-valid `showAssign === 'assign'` ⇔ UNOWNED pin) is
  unchanged.
- `live-blocker-panel-reply-in-place.test.mjs` (+3 assertions): `isNudgeBranch`
  gated on `data.actionAffordance === 'nudge'`; the `isReplyBranch || isNudgeBranch`
  mount with `variant={isNudgeBranch ? 'nudge' : 'answer'}`; and the `case 'nudge'`
  onAction is `null` — proving NO requestWakeup button (assert.doesNotMatch on the
  `onAction = () => { void nudge(` wake pattern, on `requestWakeup`, AND on
  `usePluginAction` — the dead wake wiring is fully removed). The pre-existing
  `!isReplyBranch && !isNudgeBranch` blockerLine-suppression test (added in 21-03)
  is retained.
- `reply-in-place.test.mjs` (the primitive's variant/copy coverage) — already FULLY
  landed by 21-02 (the `variant?: 'answer' | 'nudge'` union pin, the
  `Nudge to unstick` literal, the byte-identical `'answer'` copy pins, the
  render-sites-consume-copy pin, and the T-21-03 "variant absent from dispatchReply
  deps" pin). Green and untouched — no duplication (extend-don't-rewrite).

**Task 2 — kind-agnostic handler + stuck Shape-B resume + STUCK-04 no-auto-resume (commit 89c8b2e).**
- `situation-reply-and-resume.test.mjs` (+4 tests, +source-grep imports):
  - **Test 14** — source-grep over the handler: asserts it reads
    `needsDurabilityFlip` and does NOT match `terminal.kind` / `terminalKind`. This
    is the D-8 seed-divergence pin: the handler is kind-agnostic and needs NO change
    for the stuck path.
  - **Test 15** — the stuck Shape-B resume: `needsDurabilityFlip: true` →
    one createComment (the operator's unstick note, the native resume trigger) + one
    `update({ status: 'in_progress' })` durable flip → `{ ok:true, durable:true }`.
    Reuses the file's existing mock-ctx (no jsdom, no new harness); framed as the
    STUCK resume per D-8 (the stuck row is the dominant Shape-B case).
  - **Test 16** — single dispatch site: `reply({...})` appears exactly ONCE in the
    primitive source (inside `dispatchReply`).
  - **Test 17** — STUCK-04 no-auto-resume: `dispatchReply` is invoked ONLY from the
    Send button onClick, the chip onClick, and the Enter keydown — and the primitive
    contains NO `React.useEffect` at all, so a mount-driven dispatch is structurally
    impossible.
- The handler source `src/worker/handlers/situation-reply-and-resume.ts` is
  **unchanged** (`git diff --stat` clean) — confirmation only, per D-8.

## Deviations from Plan

None — plan executed exactly as written.

The plan anticipated possibly needing to remove two stale OLD-stuck assertions (the
employee-row "assign an owner" copy and the Reader nudge wake button). Those were
ALREADY reconciled in 21-03 (its Deviation 1, in-flight when the surfaces changed),
so no removal was needed here — only the additive nudge coverage the plan's
`<action>` blocks specify. An explicit `assert.doesNotMatch(/agent stuck · assign an
owner/)` regression pin was added to the employee-row suite as belt-and-suspenders.

## Verification

- `node --test` over the four UI files
  (employee-row-reply-in-place, live-blocker-panel-reply-in-place,
  reply-in-place, reply-in-place-no-uuid-leak) → 55 + 8 = green (0 fail).
- `node --test test/worker/handlers/situation-reply-and-resume.test.mjs` →
  **17/17 pass** (was 13; +4 new).
- Handler source confirmed UNCHANGED (`git diff --stat
  src/worker/handlers/situation-reply-and-resume.ts` empty) — kind-agnostic
  confirmation, not an edit (D-8 acceptance criterion).
- Full suite `npm test` → **2959 tests, 2957 pass, 0 fail, 2 skipped** (+12 from
  21-03's 2947: 8 UI + 4 handler). The 2 skips are the pre-existing
  platform-conditional cases (unrelated, documented in 21-03).
- STUCK-04 covered (Tests 16-17: dispatch-only-on-Send, no useEffect). STUCK-06
  covered (the whole-file NO_UUID_LEAK JSX-text-node render-scans in both UI suites
  stay green on the new nudge paths). No package installs in this plan (T-21-SC).

## Self-Check: PASSED
