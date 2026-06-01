# Phase 10: Unblock-Resume Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 10-unblock-resume-spike
**Areas discussed:** Spike target environment, Blocked shapes, Proof-of-resume signal, Fallback depth, Test subjects (BEAAA safety), Capability boundary

---

## Spike target environment

| Option | Description | Selected |
|--------|-------------|----------|
| BEAAA live (real blocked items) | Run against production BEAAA board with the real ~9 blocked items; bookended by DO-droplet backup | ✓ |
| Countermoves throwaway first, BEAAA confirm | De-risk on throwaway, single confirm pass on live | |
| Countermoves only | Prove entirely on throwaway box | |

**User's choice:** BEAAA live (the real Paperclip host/model).
**Notes:** Combined with the Test-subjects answer below — live host, but acting on throwaway probe subjects, not real work.

---

## Blocked shapes (which to reproduce + resume)

| Option | Description | Selected |
|--------|-------------|----------|
| Agent posted a question, awaiting reply | Primary reply-in-place / DO-03 case | ✓ |
| Issue status = 'blocked' | Terminal status; tests whether comment flips it or needs ctx.issues.update(status) | ✓ |
| blockedByIssueIds relation | Dependency-edge wait; may need issue.relations.write to clear | ✓ |

**User's choice:** All three shapes.
**Notes:** Comprehensive matrix — Phase 14's Send must target the right blocked-shape, so prove all three on the live model.

---

## Proof-of-resume signal

| Option | Description | Selected |
|--------|-------------|----------|
| Agent emits a new action/comment post-reply | Strongest behavioral proof it woke and acted | ✓ |
| Heartbeat context shows agent picked it up | Proves consumption via paperclipGetHeartbeatContext / run-state | ✓ |
| Issue status transitions off blocked | Necessary-but-not-sufficient state signal | ✓ |

**User's choice:** All three required for a PASS.
**Notes:** State change alone is insufficient; behavioral + consumption signals guard against a false PASS.

---

## Fallback depth

| Option | Description | Selected |
|--------|-------------|----------|
| Prove the working recipe end-to-end, incl. required transition | If comment-alone fails, keep going until a turnkey recipe is found | ✓ |
| Prove comment-alone; document fallback as decision tree (don't execute) | Yes/no only, write up candidates | |
| Comment-alone only — strict go/no-go | Single-question go/no-go | |

**User's choice:** Prove the working recipe end-to-end, including any required state transition.
**Notes:** Phase 14 must receive an executable recipe per shape, not just a yes/no — bounded by the capability boundary below.

---

## Test subjects (live BEAAA safety scope)

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated throwaway probe agent + issues on BEAAA | Sacrificial agent + controlled blocked issues; zero risk to real work; cleaned up after | ✓ |
| Real in-flight blocked items | Act on the actual ~9 blocked items; max truthfulness, irreversible-in-effect | |
| Throwaway for state mutations, real items for read-only | Hybrid | |

**User's choice:** Dedicated throwaway probe agent + controlled blocked issues on BEAAA.
**Notes:** Real host/model fidelity without touching real in-flight work. Real items may be observed read-only to confirm shape fidelity.

---

## Capability boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Add capability + bookended redeploy if recipe needs it | Bump version, add issue.relations.write, snapshot-bookended reinstall | |
| Stay within declared caps; document relations-clear path as spec'd-not-proven | Use only declared caps; document the undeclared-cap path + CTT-07 cost for Phase 14 | ✓ |

**User's choice:** Stay within currently-declared capabilities.
**Notes:** Shapes A and B fully provable within declared caps. For Shape C, if the recipe needs issue.relations.write, document it as spec'd-not-proven rather than deploying for a spike.

---

## Claude's Discretion

- Probe harness mechanics (reuse `scripts/spike/*-probe.mjs` Node-script pattern vs driving the real `chat.send` handler path).
- Probe-agent + probe-issue construction and teardown procedure on BEAAA.
- Heartbeat / observation window timing before declaring a shape FAIL.
- Minimal-recipe vs belt-and-suspenders signal combination once observed.
- Whether to additionally package findings as a reusable project skill.

## Deferred Ideas

- `issue.relations.write` capability + redeploy to clear `blockedByIssueIds` edges (Phase 14 planning decision).
- Reply-in-place UI / Send affordance, quick-decision chips — Phase 14.
- Packaging findings as a reusable project skill (optional).
