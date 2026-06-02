---
status: complete
phase: 10-unblock-resume-spike
plan: 03
requirement: DO-03
generated: 2026-06-01
finalized: 2026-06-02 (live three-shape run complete)
sources:
  - 10-01 dry-confirm (live) + 10-02 three-shape run (live, BEAAA 2026-06-02 05:55–06:18 UTC)
  - raw: 10-02-probe-output.txt
---

# Unblock-Resume Spike — Findings Contract (FINAL)

> Canonical input for **Phase 14** (the unblock-resume feature). All verdicts below are from LIVE
> runs against BEAAA with sacrificial agent `0f20fe53-…`. Three-signal rule: a PASS requires
> **behavioral** (new agent comment) + **consumption** (fresh `createdByRunId`) + **state** (status
> moved off blocked/awaiting). Honest result — two clean PASSes, one shape out-of-envelope.

## DO-03 — ANSWERED

**Does answering/commenting actually unblock and resume a stuck agent on BEAAA?**
**YES — for both the awaiting-answer (Shape A) and `status='blocked'` (Shape B) cases, a plain
comment alone triggers the agent to wake, run, and respond.** No special transition is required to
*trigger* the resume. For a *durable* status change on Shape B, pair the comment with a
`status:'in_progress'` flip (proven settable — A1).

## Capability boundary (D-09 / D-10) — HELD
- **Used (all declared):** `issue.comments.create`, `issues.update`, `issues.create`, `agents.read`.
- **NOT called:** `issue.relations.write` (undeclared — D-10), `requestWakeup` (not needed).
- Governance parity preserved: standard org-chart hire, no special privileges.

## Per-shape resume contract

### Shape A — awaiting-answer → ✅ PASS
- **Recipe (LOCKED):** post the answer as a comment. Native wake; no transition.
- Evidence: agent reply `c5614d1d` (authorType `agent`), fresh runId `57f14de0`, status
  `in_progress → in_review → done`. Ladder rungs needed: rung 0 only.

### Shape B — `status='blocked'` → ✅ PASS  (the dominant real shape — 15 live items)
- **Construction:** bare `PATCH {status:'blocked'}` sticks (A1 SETTABLE; no blocker edge needed).
- **Recipe (LOCKED):** **comment alone** wakes the blocked agent — it ran (fresh runId `c3990329`),
  posted reply `ee60ec7a`, status moved off `blocked`. Agent was `idle` (not paused) → rung 3 N/A.
- **Durability nuance (Phase 14 MUST handle):** after the resume run, the issue **re-settled to
  `blocked`** (finalStatus blocked). So:
  - To **trigger a resume run** → comment alone is sufficient.
  - For a **durable unblock** (issue stays workable) → pair the comment with
    `ctx.issues.update(id, {status:'in_progress'})`. Ordering tested: comment-only sufficed to
    trigger; the flip is the durability add-on. This is a deliberate **CTT-07 exception** Phase 14
    owns explicitly (operator-attributed, audited) — not silent disposition-recovery.

### Shape C — `blockedByIssueIds` relation → ⚠ OUT OF ENVELOPE (cannot construct within declared caps)
- `blockedByIssueIds:[X]` at create **did not persist** (`Y.blockedByIssueIds=[]` on re-GET) — the
  edge was never established. The observed Y→done after resolving X is therefore **NOT** a valid
  relation-cascade result (Y was effectively just an unblocked in_progress issue).
- **Conclusion:** the relation-blocked shape cannot be created via `issues.create`, and clearing a
  real edge needs `issue.relations.write` (undeclared). Both construction and clearing are outside
  the current capability envelope.
- **Edge-clear path (SPEC'D-NOT-PROVEN, never exercised):** `relations.removeBlockers(Y,[X])` /
  `setBlockedBy(Y,[])` requiring `issue.relations.write` + a CTT-07/governance review.

## DO-03 scope implication for Phase 14

1. **Primary recipe (Shapes A & B):** unblock = post operator's answer as a comment → agent resumes
   natively. For Shape B add the `{status:'in_progress'}` flip for durability (declared cap, audited).
2. **Relation case (Shape C):** out of scope under current caps. Phase 14 either (a) declares
   `issue.relations.write` with governance review, or (b) scopes the feature to status/awaiting
   blocks only and surfaces relation-blocks as "resolve the blocker issue" (which is just Shape A/B
   on the blocker). Recommend (b) for v1 — real BEAAA blocks are status-based; no real relation
   blocks were found in 200 issues.
3. **Integration:** new `situation.unblock` worker action mirroring `situation-assign-owner.ts`
   (UUID-based `ctx.issues.update` + `ctx.issues.createComment`). See `PHASE-14-PREP.md`.

## Operational findings (carry to runbook)
- **A1 SETTABLE:** `PATCH {status:'blocked'}` accepted bare on BEAAA (no blocker edge).
- **A3 manual-mint:** agents are NOT REST-mintable (400); operator hires + pins `SPIKE_PROBE_AGENT_ID`.
- **Issue DELETE returns 500** on BEAAA — issues are not hard-deletable via `DELETE /api/issues/{id}`.
  Cleanup throwaways by flipping `status:'cancelled'` via PATCH instead.
- **Residue from this run (needs cleanup):** `[SPIKE 10]` issues `4a5affe2`, `a2f0cf1c`, `94abcab1`,
  `bf5d6335` (all DELETE-500'd) + sacrificial agent `0f20fe53-…`. See cleanup steps below.

## Residue cleanup (run on BEAAA)
```bash
# Neutralize the 4 undeletable [SPIKE 10] issues by cancelling them (PATCH works; DELETE 500s):
AUTH=/home/beai-agent/.paperclip/auth.json
KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=Object.values(a.credentials||{})[0]||{};process.stdout.write(v.token||v.accessToken||v.bearerToken||v.apiKey||Object.values(v).filter(x=>typeof x==="string").sort((p,q)=>q.length-p.length)[0]||"")' "$AUTH")"
for ID in 4a5affe2-12cc-4208-b846-acd3fd3b94ee a2f0cf1c-d75d-4609-8901-eb00590c1cd6 94abcab1-ca5f-48e6-93e4-50ace25c8e82 bf5d6335-3cc5-40ef-92d8-65872decd096; do
  curl -s -X PATCH -H "authorization: Bearer $KEY" -H "content-type: application/json" -d '{"status":"cancelled"}' "http://localhost:3100/api/issues/$ID" -o /dev/null -w "$ID -> %{http_code}\n"
done
# Then in the UI: pause + terminate/delete the "Spike10 Sacrificial Probe [SPIKE 10]" agent (0f20fe53-…).
```
