---
status: complete
phase: 10-unblock-resume-spike
plan: 02
requirement: DO-03
updated: 2026-06-02
---

# Plan 10-02 — Three-shape live run (COMPLETE)

> Ran live against BEAAA 2026-06-02 05:55–06:18 UTC, sacrificial agent
> `0f20fe53-f1fc-4c35-a8dd-6de2eeeb24db` (operator-hired `Spike10 Sacrificial Probe [SPIKE 10]`).
> Raw redacted JSON: `10-02-probe-output.txt`. **A clean, honest result — Shapes A & B PASS,
> Shape C relation could not be constructed within declared caps, teardown DELETE failed (residue).**

## Headline (the DO-03 answer)

**A plain comment resumes a stuck agent on BEAAA — in BOTH the awaiting-answer and the
`status='blocked'` cases — with no special transition required to trigger the resume.** This is
the make-or-break answer Phase 14 needed, and it is positive.

## Per-shape verdicts (three-signal rule: behavioral + consumption + state)

### Shape A (awaiting-answer) — ✅ PASS
- Recipe: **comment-alone (rung 0)** — native wake.
- Signals all true: agent reply `c5614d1d` (authorType `agent`), fresh runId `57f14de0`,
  status `in_progress → in_review → done`.

### Shape B (`status='blocked'`) — ✅ PASS  ← the dominant real shape
- Construction: bare `PATCH {status:'blocked'}` **stuck** (HTTP 200, read back `blocked`) → confirms
  **A1 = SETTABLE**, Shape B independent of Shape C. Agent status while blocked: `idle` (not paused).
- Recipe: **comment-alone (rung 0)** — the comment woke the agent; it ran (fresh runId `c3990329`),
  posted reply `ee60ec7a`, and status moved **off** `blocked` (to `in_progress`).
- **Nuance for Phase 14:** the issue **re-settled to `blocked`** after the run (finalStatus blocked).
  So comment-alone reliably *triggers the resume run*, but for a **durable** unblock Phase 14 should
  pair the comment with the (proven-settable) `{status:'in_progress'}` flip. The D-08 ladder never
  needed rungs 1-3; `requestWakeup` not invoked; agent was idle not paused (rung 3 N/A).

### Shape C (`blockedByIssueIds` relation) — ⚠ INCONCLUSIVE (cannot construct within declared caps)
- `blockedByIssueIds:[X]` at create **did NOT persist** — `Y.blockedByIssueIds=[]` on re-GET
  (`edgeEstablishedAtCreate: false`). So Y was never truly relation-blocked.
- The probe observed Y resume to `done` after X was resolved (comment + flip X to `done`), and
  recorded `cascadeObserved: true` — **but this is NOT a valid cascade test**, because the edge was
  never there. Honest reading: **the relation shape cannot be constructed within declared caps**
  (the create payload doesn't establish the edge, and `issue.relations.write` is NOT declared — D-10).
- Implication: real BEAAA blocks are status-based (Shape B), and the relation case is out of the
  current capability envelope for both construction and clearing.

## Dry-confirm (re-run, now conclusive)
- **A1 = SETTABLE** (201 create → PATCH 200 → read back `blocked` → DELETE 200). No blocker edge needed.
- **A3 = manual-mint** (agent create 400) — confirmed; operator-hired agent was used.
- **D-02:** 200 issues scanned; `{done:166, in_review:9, blocked:15, in_progress:1, todo:2, cancelled:6, backlog:1}`. Shape A real (BEAAA-1592), Shape B real & dominant (BEAAA-1858, 15 blocked), Shape C no real relation.

## Capability boundary (D-09/D-10) — HELD
Only declared caps used: `issues.create`, `issues.update`, `issues.createComment`, `agents.read`,
`issues` DELETE. `issue.relations.write` NEVER called (grep-verified). `requestWakeup` not invoked
(not needed). Governance parity: standard org-chart hire, no special privileges.

## Teardown — ❌ FAILED (residue on live board)
All 4 `[SPIKE 10]` probe issues returned **HTTP 500** on `DELETE /api/issues/{id}`:
- `4a5affe2-12cc-4208-b846-acd3fd3b94ee` (Shape A)
- `a2f0cf1c-d75d-4609-8901-eb00590c1cd6` (Shape B)
- `94abcab1-ca5f-48e6-93e4-50ace25c8e82` (Shape C blocker X)
- `bf5d6335-3cc5-40ef-92d8-65872decd096` (Shape C blocked Y)

Plus the sacrificial agent `0f20fe53-…` (operator-minted; operator-side teardown). **Finding:**
issues are not hard-deletable via `DELETE /api/issues/{id}` on this host (500). Cleanup recipe:
flip each to `status:'cancelled'` via the proven `PATCH /api/issues/{id}` (A1 path), and the operator
pauses+terminates the sacrificial agent. See cleanup note in `10-03-SPIKE-FINDINGS.md`. No real
in-flight item was ever written to (all writes targeted `[SPIKE 10]` throwaways); no schema touched.

## Key files
- `scripts/spike/unblock-resume-spike-probe.mjs` — probe (filled)
- `scripts/spike/run-spike-beaaa.sh`, `scripts/spike/find-spike-agent.sh` — operator launchers
- `10-02-probe-output.txt` — raw redacted run output
