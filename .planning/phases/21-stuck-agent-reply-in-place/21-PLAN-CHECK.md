# Phase 21 - Plan Verification (Goal-Backward, Pre-Execution)

**Verifier:** gsd-plan-checker
**Date:** 2026-06-15
**Phase:** 21-stuck-agent-reply-in-place
**Plans checked:** 5 (21-01 .. 21-05)
**Verdict:** PASS

---

## VERIFICATION PASSED

Goal-backward analysis confirms the five plans WILL achieve the Phase 21 goal:
the operator can unstick a STUCK agent from inside the cockpit via the same
reply-in-place affordance shipped for AWAITING_HUMAN, on both the Situation Room
employee row and the Reader live-blocker panel, with a plain operator reply
resuming the agent - no auto-resume, stuck-context copy, degrade-safe and
NO_UUID_LEAK clean.

Every edit site named in the plans was checked against live source and is REAL.
Every STUCK requirement and every LOCKED decision (D-1..D-9) is realized by a
concrete task with checkable acceptance criteria. The hard scope constraints
(no migration, no new capability, engine purity, Watch-tier preservation, ONE
shared primitive) are honored by construction.

---

## Requirement Coverage (STUCK-01..06)

| Req | Covered by | Edit site verified | Status |
|-----|------------|--------------------|--------|
| STUCK-01 (SR affordance) | 21-03 T1 showNudge to ReplyInPlace in Watch body | employee-row.tsx:218-225 gates + 512-556 Watch body REAL | COVERED |
| STUCK-02 (Reader affordance) | 21-03 T2 isNudgeBranch to ReplyInPlace | live-blocker-panel.tsx:300/310-314/411-428 REAL | COVERED |
| STUCK-03 (reply resumes via replyAndResume) | 21-01 engine flip + 21-04 T2 handler Shape-B case | reply-reachable.ts:56-59 + handler kind-agnostic confirmed | COVERED |
| STUCK-04 (no auto-resume) | 21-03 T1/T2 mount-only + 21-04 T2 dispatch-only-on-Send test | dispatch isolated in dispatchReply, NO useEffect - STRUCTURALLY TRUE today | COVERED |
| STUCK-05 (stuck-context copy) | 21-02 T1 variant prop | reply-in-place.tsx:274/275/289 copy sites REAL | COVERED |
| STUCK-06 (degrade-safe + NO_UUID_LEAK) | 21-03 (no Uuid in render) + 21-04 T1 render-scan + 21-05 drill step 5 | render-scan guard reused; Uuid fields dispatch-only | COVERED |

Every requirement appears in at least one plan requirements frontmatter:
21-01 STUCK-03, 21-02 STUCK-05, 21-03 STUCK-01/02/04, 21-04 STUCK-04/06,
21-05 STUCK-06. No orphans. ROADMAP Requirements line (STUCK-01..06) fully mapped.

---

## Decision Coverage (CONTEXT D-1..D-9)

| Decision | Realized in | Checkable AC | Verified against source |
|----------|-------------|--------------|-------------------------|
| D-1 engine verdict flip assign-to-nudge, tier/needsYou unchanged | 21-01 T1 | YES | blocker-chain.ts:80-86 currently assign - flip target REAL |
| D-2 isReplyReachable STUCK to true | 21-01 T1 | YES | reply-reachable.ts:56-59 currently false - REAL |
| D-3 mount ReplyInPlace on nudge both surfaces | 21-03 T1+T2 | YES | both surfaces have the gate sites REAL |
| D-4 optional variant prop default answer, backward-compatible | 21-02 T1 | YES | props/copy sites REAL |
| D-5 needsDurabilityFlip flows unchanged (status-derived) | 21-03 T1 + 21-04 T2 | YES | rollup emits status-derived (14-04), affordance-agnostic |
| D-6 action-cards nudge to answer (no migration) | 21-03 T3 | YES | action-cards.ts:242-258 default-to-none REAL; map target valid |
| D-7 audit all assign consumers | 21-03 T4 | YES | rollup:916 gated needsYou true (stuck excluded by construction); backlog:130 gap identified |
| D-8 extend tests not rewrite | 21-01 T2 + 21-04 | YES | matrix + reply-reachable tests are the named extension points |
| D-9 NO new migration / NO new capability | enforced in 21-03, 21-05 ACs | YES | all 5 files_modified lists touch zero migration/capability files |

100% decision coverage. No decision is referenced-but-under-delivered. No scope
reduction language (v1/v2, static for now, future enhancement, stub) in any task.

---

## Targeted Checks

1. Every STUCK-01..06 in requirements + concrete task - PASS.
2. D-1..D-9 each in a task with checkable ACs - PASS.
3. NO new migration / NO new capability anywhere - PASS. Every migration/capability
   mention across the 5 plans is a constraint guard, not an addition. No .sql and
   no manifest capability appear in any files_modified.
4. Engine purity boundary preserved - PASS. 21-01 is a one-triple + one-boolean
   change keyed on the discriminant alone; ACs forbid reading label/owner/clock/net;
   tsc + purity-grep guards re-run.
5. Stuck stays Watch (needsYou false), no Needs-you promotion - PASS. D-1 keeps tier
   watch + needsYou false; 21-03 T1 wires nudge into the Watch-tier body; AC forbids
   touching visualTierOf/tier-utils.ts. Rollup needs-you partition (needsYou true)
   excludes stuck by construction.
6. Shared ReplyInPlace reused not copied; variant backward-compatible - PASS. Both
   surfaces import the SAME primitive (no new component file). 21-02 AC pins answer
   copy byte-identical and variant absent from dispatch - zero AWAITING_HUMAN regression.
7. 21-05 autonomous false + bookended backup before any BEAAA mutation - PASS. First
   checkpoint is a blocking human-verify confirming the automated DO backup BEFORE the
   install checkpoint; rollback path articulated (uninstall-then-reinstall prior
   extract-dir; additive namespace preserves data).
8. No-auto-resume (STUCK-04) genuinely tested - PASS. Live source confirms dispatch
   only inside dispatchReply, from Send/chip onClick, NO useEffect/mount dispatch.
   21-04 T2 adds a source-grep test (reply( only in dispatchReply, not in a useEffect)
   plus a behavioral handler case. Real, non-vacuous test of resume-only-on-Send.

---

## Standard Dimensions

- Task completeness: all auto tasks have files/action/verify/done + acceptance
  criteria; 21-05 checkpoints use what-built/how-to-verify/resume-signal. PASS.
- Dependency graph: 21-01 [] / 21-02 [] (Wave 1, parallel, disjoint files),
  21-03 deps 01+02 (Wave 2), 21-04 deps 01+02+03 (Wave 3), 21-05 deps all (Wave 4).
  Acyclic, no forward refs, waves consistent. 21-01/21-02 disjoint files - safe
  parallel. PASS.
- Key links planned: engine verdict to isReplyReachable to both surfaces reachable
  prop to Send dispatch to handler. Each hop has a task. variant to rendered copy
  wired. PASS.
- Scope sanity: 21-01 (2), 21-02 (1), 21-03 (4 small surgical edits), 21-04 (2),
  21-05 (1 auto + 3 checkpoints). Within budget. PASS.
- must_haves derivation: truths are user-observable, not implementation-only. PASS.
- Engine tests stay honest: the 4x8 matrix derives expected from the canonical
  engine via verdictKey so the stuck column flows nudge automatically; 21-01 T2 also
  flips the explicit Reader cell + the reply-reachable exactly-TWO assertion. PASS.

---

## Notes / Riders (non-blocking)

- Honest seed divergence captured: the handler never gated on terminal.kind; the real
  gate was the engine verdict + reachable predicate. 21-01 records it; 21-04 T2 pins it
  with a source-grep + a no-edit AC on the handler.
- Backlog-expander (21-03 T4) leaves a documented choice: mount ReplyInPlace
  variant=nudge for the nudge affordance OR document why stuck cannot reach the backlog.
  Either acceptable; plan prefers the mount (reuses the primitive). Executor should land
  the mount unless it proves stuck rows never reach that surface; capture in 21-03-SUMMARY.
- Live drill (21-05) carries the same env-gated risk as Phase 17/18 riders: a real
  AWAITING_AGENT_STUCK row must exist or be staged on the opted-in session. If none can
  be staged, STUCK-06 live acceptance becomes a deferred live-positive rider (consistent
  with prior phases), not a code gap.

---

## Recommendation

PASS - no blockers, no warnings. Proceed to /gsd:execute-phase 21.
