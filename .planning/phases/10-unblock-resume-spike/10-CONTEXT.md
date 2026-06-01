# Phase 10: Unblock-Resume Spike - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

De-risk the make-or-break feasibility question for the v1.4.0 action loop **before any action UI exists**: against the live Paperclip model, does posting a comment to a blocked agent's thread actually **unblock and resume** that agent, or is a status/blocker transition also required? Output is a **proof + a written unblock-resume contract** that Phase 14 (Do-It-Here Action Loop, DO-01/02/04/05) implements against — not feature code or UI.

This phase satisfies requirement **DO-03**. It gates Phase 14. A negative or partial result is a valid, valuable outcome as long as it is recorded honestly with its DO-03 scope implication (Success Criterion 4).

Scope is fixed by ROADMAP.md Phase 10 (4 success criteria). This discussion locks HOW the spike is run and WHAT it produces.
</domain>

<decisions>
## Implementation Decisions

### Spike target environment
- **D-01:** Run against **live BEAAA** — the real Paperclip host and host version that the milestone is about — so the "live Paperclip model" claim is literal, not a Countermoves proxy.
- **D-02:** Act **only on a dedicated throwaway probe agent + controlled blocked issues created on BEAAA for the spike**, fully owned by the spike. Do **not** post comments to, or execute state transitions on, real in-flight blocked items. This gives the real host/model fidelity with **zero risk to real work**. The probe agent + probe issues are cleaned up after the spike completes. (Real blocked items may be **observed read-only** to confirm the probe shapes match what BEAAA actually produces, but never written to.)
- **D-03:** Every live action is **bookended by the standard snapshot/rollback discipline** for BEAAA (DO-droplet backup + plugin-reinstall rollback per the BEAAA deploy mechanics; safety-CLI is not installed on that box).

### Blocked shapes to reproduce and resume (all three)
The spike must construct and attempt to resume **all three** ways Paperclip can express "blocked," because Phase 14's reply-in-place must target the right one(s):
- **D-04:** **Shape A — Agent posted a question, awaiting reply.** The primary DO-03 case: an agent ran, asked a question/posed a decision, and is parked waiting for a human answer. Prove a reply comment resumes it. (Builds on the proven `in_progress` native-wake result from 04.1-01, but specifically under a *waiting-on-answer* condition.)
- **D-05:** **Shape B — Issue status = `blocked`.** The issue is in the terminal `blocked` status (per `topic-watchdog.ts` terminal set). Prove whether a comment alone flips it back, or whether `ctx.issues.update({status})` is required to un-terminal it.
- **D-06:** **Shape C — `blockedByIssueIds` relation.** The agent waits on a dependency edge (another issue blocks it). Prove whether answering/resolving the chain resumes it, or whether the relation itself must be cleared.

### Proof-of-resume signal (all three required for a PASS)
- **D-07:** A shape counts as **resumed** only when corroborated by **all three** signals, not just one:
  1. **Behavioral** — the probe agent emits a **new action/comment/status change of its own** within a heartbeat window after the reply (it actually woke and acted).
  2. **Consumption** — **heartbeat context** (`paperclipGetHeartbeatContext` / agent run-state) shows the agent **re-focused on / picked up** the issue.
  3. **State** — the issue **transitions off `blocked`/`awaiting`**.
- Rationale: signal 3 alone is necessary-but-not-sufficient; pairing the behavioral + consumption signals prevents a false PASS where state changed but the agent never actually resumed work.

### Fallback depth — find the working recipe end-to-end
- **D-08:** If **comment-alone does NOT resume** a given shape, **keep going**: test comment **+ the minimal accompanying state transition** (e.g. `ctx.issues.update({status})`, `agents.resumeHeartbeat`, `requestWakeup`) until a **working, turnkey recipe** is found and documented for that shape. Phase 14 must receive an executable recipe, not just a yes/no — for every shape the spike can fully exercise within the capability boundary below.

### Capability boundary
- **D-09:** The spike uses **only currently-declared capabilities**: `issues.createComment`, `issues.requestWakeup`, `issues.update` (status/assignee — declared in v1.3.0/Phase 9), `agents.pause`/`agents.resume`, `agents.resumeHeartbeat`. Shapes A and B are fully provable end-to-end within these.
- **D-10:** For **Shape C**, if the working recipe requires clearing the dependency relation via **`issue.relations.write`** (only `issue.relations.read` is declared today), **do NOT add the capability or redeploy for it in this spike.** Instead, document the relations-clear path as **"spec'd-not-proven"**: the exact transition required, the capability it needs, and its CTT-07 / governance-parity cost, so Phase 14 (or its planning) makes the deploy decision deliberately. The spike still proves Shape C as far as the declared caps allow (e.g. whether answering the *blocking* issue cascades a resume without touching the relation).

### Output artifact (the contract Phase 14 reads)
- **D-11:** Produce a written **unblock-resume contract** — a `10-…-SPIKE-FINDINGS.md` (or equivalently-named findings doc) in the phase dir — capturing, per shape: the comment-write path used, any required accompanying state transition, when/whether the agent consumes it on heartbeat, the observed three-signal evidence, and a PASS / PARTIAL / FAIL verdict with its DO-03 scope implication. This is the canonical input Phase 14 implements against. Commit the probe script(s) used (following the existing `scripts/spike/*-probe.mjs` pattern) alongside the findings.

### Claude's Discretion (planner/researcher)
- Probe **harness mechanics**: reuse the `scripts/spike/chat-spike-probe.mjs` / `chat-true-task-spike-probe.mjs` pattern (a Node script hitting the API directly with `PAPERCLIP_API_URL`/`API_KEY`/`COMPANY_ID`), vs driving through the real `chat.send` handler path. Pick whichever most faithfully mirrors the path Phase 14's "Send" will take.
- Exact **probe-agent + probe-issue construction and teardown** procedure on BEAAA (how to mint a sacrificial agent, how to drive it into each blocked shape, how to clean up).
- **Heartbeat / observation window** timing; how long to wait before declaring a shape FAIL.
- Which signal combination constitutes the **minimal** recipe vs belt-and-suspenders, once observed.
- Whether to additionally package findings as a reusable project skill (sketch/spike-findings pattern) or keep them as the phase findings doc only.
</decisions>

<specifics>
## Specific Ideas

- The open risk is stated verbatim in the seed design §4: *"The reply-in-place mechanic assumes that answering the agent actually unblocks it and causes it to resume… whether posting a comment is sufficient, or whether we must also clear the blocker / transition the issue status, and whether/when the agent consumes it on its next heartbeat."* The **UX (reply-in-place) is already decided**; only the **unblock plumbing** is in question here.
- Prior art to build on, not re-litigate: 04.1-01 PROBE-OQ3 established **native wake works for N>1 on `in_progress` topics with no `requestWakeup` nudge**. Phase 10's novelty is the **blocked** condition specifically.
- Honest-result discipline (Core Value): a clean negative ("comment alone does not resume shape B; status flip is required") is a *successful* spike. Do not strain to manufacture a PASS.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + the open risk
- `.planning/ROADMAP.md` — Phase 10 goal + 4 success criteria (the spike's acceptance spine).
- `.planning/REQUIREMENTS.md` — **DO-03** (the gating requirement) and its note that DO-03's UI realization rides in Phase 14.
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` §4 ("The reply-that-unblocks — OPEN RISK") + §6 (Verification target #4). The approved design seed.

### Proven prior spikes (native wake / comment-write)
- `.planning/phases/04.1-chat-true-task/04.1-01-SPIKE-FINDINGS.md` — PROBE-OQ3 PASS-NATIVE (native wake N>1, no `requestWakeup`). The baseline this phase extends to the blocked case.
- `.planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md` — original chat-send / comment-wakes-agent spike (D-01).

### Comment-write + wake + resume code (reuse, mirror the real path)
- `src/worker/handlers/chat-send.ts` — `ctx.issues.createComment(...)` canonical comment write + `ensureTopicWakeable(...)` fire-and-forget post-comment. The path Phase 14's Send mirrors.
- `src/worker/chat/topic-watchdog.ts` — `NON_TERMINAL_CONVERSATION_STATUS = 'in_progress'`; `TERMINAL_OR_BLOCKED_STATUSES = ['done','cancelled','blocked']`; the rc.8 CTT-07 hotfix: the watchdog deliberately does **NOT** call `ctx.issues.update` and relies on host disposition-recovery. Read this before deciding whether the spike's recipe should flip status itself.
- `src/worker/handlers/agent-resume-heartbeat.ts` — `agents.managed.reconcile` + `agents.resume` pattern (resume a paused agent).
- `src/worker/handlers/issue-request-wakeup.ts` — `ctx.issues.requestWakeup(...)` nudge + idempotency-key pattern; note 404-unreliability on recent host versions.
- `src/shared/blocker-chain.ts` — how the engine models blocked terminals (`edges: 'blocks'|'awaiting'|'external'`, `nodeMeta.status`); informs which shape maps to which terminal.

### SDK type surface (the mutation/observe contract)
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `issues.update` (`status` is patchable; also `blockedByIssueIds`), `createComment`, `requestWakeup`, `agents.pause/resume/resumeHeartbeat`, `agents.managed.*`. Confirms which transitions are declared-capability-reachable (D-09) vs require `issue.relations.write` (D-10).

### Safety, deploy, env
- `CLAUDE.md` — bookended-by-snapshots rule, declared capabilities, MCP env vars (`PAPERCLIP_API_URL` / `API_KEY` / `COMPANY_ID` / `AGENT_ID` / `RUN_ID`), governance parity, additive-schema rule.
- `MEMORY.md` → `beaaa-deploy-mechanics.md` — how to reach BEAAA (SSH `ariclaw`→root, `beai-agent`, DO-backup bookend, no safety-CLI on box, Path A vs Path B).
- `scripts/safety/cli.mjs` + `scripts/spike/{chat-spike-probe,chat-true-task-spike-probe}.mjs` — snapshot/restore CLI and the probe-harness pattern to follow.
- `.planning/research/PITFALLS.md` — heartbeat-recompile loop, token ceiling, CAS-guarded status transitions (PLUGIN_SPEC §25.4.2 + PR #4738) — relevant to "when does the agent consume the comment."
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ctx.issues.createComment(issueId, body, companyId, {authorAgentId?})`** — proven comment write (`chat-send.ts`). Returns `{ id }`; body lives only in `public.issue_comments`.
- **`ctx.issues.update(issueId, patch, companyId, actor?)`** — `status` is in the patchable Pick; declared as a capability since v1.3.0 (Phase 9 assign-owner). The lever for the "comment + status transition" fallback (D-08), within the declared boundary (D-09).
- **`ctx.issues.requestWakeup(...)`** + **`agents.resumeHeartbeat`** / **`agents.resume`** — the candidate accompanying transitions to test if comment-alone fails.
- **`scripts/spike/*-probe.mjs`** — established harness: a Node script hitting the live API with bearer auth; the model for Phase 10's probe.
- **`scripts/safety/cli.mjs`** — snapshot/restore/smoke/verify (note: BEAAA itself uses DO-droplet backup as the bookend, not this CLI).

### Established Patterns
- **CTT-07 invariant** (`topic-watchdog.ts` rc.8 hotfix): plugin code avoids mutating `public.issues` and leans on host disposition-recovery. The spike must determine empirically whether the **blocked** case can rely on the same recovery, or genuinely needs an explicit transition — this is the heart of the open risk.
- **Native wake for `in_progress`** (04.1-01) — established; the blocked condition is the delta under test.
- **Governance parity** — the probe agent obeys standard caps/pause-terminate/audit like any hire; no special privileges.

### Integration Points
- The spike's verified recipe becomes the contract that **Phase 14's reply-in-place Send action** is built against (`createComment` + any required transition + heartbeat-consumption timing).
- The blocked-shape→terminal mapping informs **Phase 11's taxonomy** (`agent-stuck` vs `awaiting-human` terminals) — though Phase 11 can proceed in parallel as read-only classification.
- No new migration intended (Success Criterion 3: touch no non-additive schema; ideally no schema at all).
</code_context>

<deferred>
## Deferred Ideas

- **`issue.relations.write` capability + redeploy** to clear `blockedByIssueIds` edges — explicitly out of this spike (D-10). Documented as spec'd-not-proven; the deploy decision belongs to Phase 14 planning.
- **Reply-in-place UI / Send affordance** — Phase 14 (DO-01/02/04/05). This spike only proves the plumbing the UI will call.
- **Quick-decision chips (Approve/Reject/pick-one)** — Phase 14; the spike may note whether a structured decision-comment resumes differently from a free-text reply, but building the chips is out of scope.
- **Packaging findings as a reusable project skill** — optional (D-11 discretion); the phase findings doc is the required artifact.

### Reviewed Todos (not folded)
None — no todo matches surfaced for Phase 10.
</deferred>

---

*Phase: 10-unblock-resume-spike*
*Context gathered: 2026-06-01*
