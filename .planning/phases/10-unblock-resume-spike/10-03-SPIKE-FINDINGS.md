---
status: draft-awaiting-live-run
phase: 10-unblock-resume-spike
plan: 03
requirement: DO-03
generated: 2026-06-01 (overnight, pre-live-run)
sources:
  - 10-01 dry-confirm (live, partial — A1/A3/D-02)
  - 10-02 three-shape run (NOT YET RUN — sections marked AWAITING LIVE RUN)
---

# Unblock-Resume Spike — Findings Contract (DRAFT)

> **STATUS: DRAFT.** The dry-confirm (A1/A3/D-02) data below is REAL — captured live against
> BEAAA on 2026-06-01. The three-shape verdicts (Shape A/B/C resume recipes) are **AWAITING
> THE LIVE RUN** (Plan 10-02), which was blocked overnight by the harness prod-write guardrail.
> See `MORNING-RUNBOOK.md`. Do NOT treat the three-shape sections as final until the live run
> fills them. **A clean negative recorded honestly is a SUCCESS — no manufactured PASS.**

## The DO-03 question

Phase 14 will let Eric unblock a stuck agent. The make-or-break question this spike answers,
per blocked **shape**: *does answering/commenting actually un-stick and resume the agent, or is
a status/blocker transition also required — and if so, exactly which transition, in what order?*
Phase 14 must receive an **executable recipe per shape**, not a yes/no.

## Capability boundary (D-09 / D-10) — confirmed against `src/manifest.ts`

- **DECLARED (usable):** `issue.comments.create`, `issues.wakeup`, `issues.update`,
  `agents.pause`, `agents.resume`, `agents.managed`, `agents.read`, `issue.relations.read`.
- **NOT DECLARED (forbidden — D-10):** `issue.relations.write`. The Shape C edge-clear path is
  documented spec'd-not-proven and is NEVER exercised by the probe (grep-verified: no
  relations-write route is passed to `call()`).

---

## Wave-0 dry-confirm results (LIVE, 2026-06-01 — REAL)

### A1 — is `status:'blocked'` settable via `PATCH /api/issues/{id}`?
**INCONCLUSIVE (pending live re-run).** The first attempt could not even create the throwaway
test issue: `POST /api/companies/{C}/issues` returned **HTTP 422** because the payload omitted
`assigneeAgentId` (BEAAA's create validator requires it; the proven chat-true-task analog always
assigns at create). The probe was fixed (`251cec1`, `589a5a6`) to assign the throwaway to the
operator-minted **sacrificial** agent (`SPIKE_PROBE_AGENT_ID`) — never a real agent (D-02).
A1's yes/no will be filled by the re-run once the sacrificial agent exists.

**Strong prior from D-02:** 13 real items currently sit at bare `status='blocked'` with empty
`blockedByIssueIds`. That the state EXISTS in the wild is strong evidence the host permits
`blocked` without a blocker edge — i.e. A1 is very likely **SETTABLE** and Shape B is independent
of Shape C. To be CONFIRMED by the live PATCH read-back.

### A3 — can the probe mint AND delete a sacrificial agent via REST?
**NO — manual mint required (clean resolved negative; anticipated by the plan).**
`POST /api/companies/{C}/agents` → **HTTP 400 (Validation error)**. Agents are not mintable via
the bearer REST surface. **Recipe:** the operator hand-hires ONE sacrificial agent (standard
org-chart hire, governance parity — NOT the Editor-Agent, NOT a real teammate) and pins it via
`SPIKE_PROBE_AGENT_ID`. Teardown is operator-side (pause → terminate), DO-backup as the net.

### D-02 — per-shape fidelity (READ-ONLY scan of 200 live issues)
Status histogram: `{done:166, in_review:10, blocked:13, in_progress:2, todo:2, cancelled:6, backlog:1}`.

| Shape | Real on BEAAA? | Evidence |
|---|---|---|
| **A** awaiting-answer | ✅ yes | BEAAA-1047, `status='in_progress'`, agent parked awaiting reply (semantic, status stays in_progress — matches 04.1-01 OQ1) |
| **B** `status='blocked'` | ✅ yes, **dominant** | BEAAA-1602 + 12 others; bare `status='blocked'`, empty `blockedByIssueIds` |
| **C** `blockedByIssueIds` relation | ❌ none in sample | Candidate's `blockedByIssueIds` empty → **construct synthetically** at create time (Open Question 3) |

**Implication:** real BEAAA blocks are status-based (Shape B), not relation-based. Phase 14 should
prioritize the Shape B recipe; Shape C is the rarer/synthetic case.

---

## Per-shape resume contract — AWAITING LIVE RUN (Plan 10-02)

> Filled by the three-shape live run. Construction + ladder below are what the probe WILL execute;
> verdicts (PASS/PARTIAL/FAIL) + locked recipe are pending. Three-signal rule: a PASS needs all of
> **behavioral** (new agent comment), **consumption** (fresh `createdByRunId`), and **state** (off
> blocked/awaiting). A state-only flip with no fresh run = **PARTIAL** (host disposition-recovery),
> never PASS.

### Shape A — awaiting-answer
- **Construct:** create `in_progress` issue assigned to PROBE; comment a question + reply-channel
  instruction; let it run+park; post the answer comment.
- **Baseline hypothesis (from 04.1-01):** comment-alone resumes (native multi-turn wake on
  `in_progress`, no `requestWakeup` needed).
- **VERDICT:** _AWAITING LIVE RUN._
- **LOCKED RECIPE:** _AWAITING LIVE RUN._

### Shape B — `status='blocked'`  ← the dominant real shape
- **Construct:** create + assign; drive into `blocked` (runtime-determined); CAS-guarded.
- **Ladder (minimal-first):** rung0 comment-alone → rung1 `issues.update({status:'in_progress'})`
  testing BOTH orderings (flip-before-comment vs flip-after) → rung2 `requestWakeup` (REST 404
  EXPECTED, fire-and-forget) → rung3 `agents.resume` ONLY if `agents.get(PROBE).status==='paused'`.
- **VERDICT:** _AWAITING LIVE RUN._
- **LOCKED RECIPE + required transition & ordering:** _AWAITING LIVE RUN._
- **CTT-07 note:** if Shape B REQUIRES the status flip, that is a deliberate CTT-07 exception
  Phase 14 must own (operator-attributed, bounded, host-audit-logged) — flagged here, not silent.

### Shape C — `blockedByIssueIds` relation (synthetic)
- **Construct:** blocker X + blocked Y with `blockedByIssueIds:[X]` set AT CREATE (legal via
  `issues.create`, no relations.write); assign Y to PROBE.
- **Test:** answer/resolve X; observe whether Y cascades to resume WITHOUT touching Y's relation.
- **VERDICT:** _AWAITING LIVE RUN._
- **If Y stays blocked:** edge-clear path recorded SPEC'D-NOT-PROVEN — needs `issue.relations.write`
  (undeclared) + carries CTT-07/governance cost; NEVER exercised (D-10).

---

## DO-03 scope implication for Phase 14 (preliminary)

- Phase 14's unblock action must implement **per-shape recipes**, with Shape B (status-based) as
  the primary real case.
- If Shape B needs the `issues.update` flip (likely), Phase 14 owns a deliberate, audited CTT-07
  exception — it is NOT free disposition-recovery.
- Shape C relation-clear is **out of the current capability envelope** (needs `issue.relations.write`)
  — Phase 14 either declares that capability (with governance review) or scopes Shape C to the
  cascade-on-answer path only.
- **Final scope locks when the three-shape verdicts above are filled by the live run.**
