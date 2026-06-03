# Phase 10: Unblock-Resume Spike - Research

**Researched:** 2026-06-01
**Domain:** Live-host agent-resume semantics — does a comment alone unblock+resume a parked Paperclip agent, or is a status/blocker transition required? (Falsify-first spike; no production code.)
**Confidence:** HIGH (codebase + SDK type surface verified locally; prior live-spike evidence on the exact mechanism; one MEDIUM unknown is the spike's entire reason to exist — the `blocked`-status resume path)

## Summary

This is a **falsify-first spike**, not feature code. The deliverable is a probe script (committed under `scripts/spike/`) plus a written unblock-resume contract (`10-…-SPIKE-FINDINGS.md`) that gates Phase 14. The one make-or-break question: against the live BEAAA Paperclip host, does posting a comment to a blocked agent's thread actually unblock and resume that agent, or must a status/blocker transition accompany it? The answer must be captured per the three "blocked shapes" (A: awaiting-reply; B: `status='blocked'`; C: `blockedByIssueIds` relation), each judged by a three-signal PASS (behavioral + consumption + state).

The strongest piece of prior art — **04.1-01 PROBE-OQ3 PASS-NATIVE** — already proved that a bare comment natively re-wakes an assigned employee-agent for N>1 turns on an `in_progress` (and even `done`) topic, with **no `requestWakeup` call needed**. The original 04-01 spike (OQ-3, "STATUS-FLIP-NOT-NEEDED") proved the same on a `done` topic. So Shape A is the *low-risk extension* of an already-proven result (the novelty is the explicit *awaiting-an-answer* condition), and the entire spike's genuine unknown is **Shape B**: whether the terminal `blocked` status behaves like `done`/`in_progress` for native wake, or whether the host's gate refuses to dispatch a heartbeat to a `blocked` issue until `ctx.issues.update({status})` un-terminals it first. Shape C is partially-bounded by capability: the relations-clear path needs `issue.relations.write`, which is **NOT declared** (D-10) — so Shape C is proven only as far as "answer the blocking issue and watch for a cascade," with the relations-clear path documented as spec'd-not-proven.

**Primary recommendation:** Build a single throwaway Node probe (`scripts/spike/unblock-resume-spike-probe.mjs`) modeled exactly on `chat-true-task-spike-probe.mjs` (REST-direct, bearer auth, per-step try/catch, one structured JSON summary). Drive a **dedicated sacrificial probe agent** into each of the three shapes on **live BEAAA**, attempt comment-alone resume first, and — per the D-08 fallback ladder — escalate one minimal transition at a time (`issues.update({status})` → `requestWakeup` → `resumeHeartbeat`/`resume`) until a turnkey recipe is found, recording all three signals at each rung. Use the REST-direct harness (not the `chat.send` handler) because Phase 14's Send ultimately calls `ctx.issues.createComment` + the *same* transitions, and the REST surface is the only thing reachable from outside the worker; document the one fidelity gap (worker `ctx` vs REST) explicitly. Bookend with a DO-droplet backup + plugin-reinstall rollback (no safety-CLI on BEAAA). **A clean negative is a successful spike** — do not strain toward a manufactured PASS.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Drive probe issue into each blocked shape | API / Backend (REST) | — | Probe runs outside the worker; the only mutation surface it can reach is the host REST API (`/api/companies/{id}/issues`, `/api/issues/{id}/...`). |
| Comment-write (the resume trigger under test) | API / Backend (`createComment`) | — | Phase 14's `chat.send`-style Send calls `ctx.issues.createComment`; the REST `POST /api/issues/{id}/comments` is the same write the probe uses out-of-worker. |
| Status / blocker transition (the fallback levers) | API / Backend (`issues.update`, `requestWakeup`) | — | Declared-capability mutations; the spike tests whether any is *required* to accompany the comment. |
| Agent dispatch / heartbeat consumption | Host runtime (Paperclip dispatcher) | — | The host owns whether/when a parked agent runs; the plugin can only *nudge* (comment, requestWakeup) and *observe*. CTT-07 invariant: plugin avoids mutating `public.issues` and leans on host disposition-recovery. |
| Three-signal observation (behavioral/consumption/state) | API / Backend reads | — | Probe polls `listComments` (behavioral), issue status via `GET /api/issues/{id}` (state), and the heartbeat/run surface (consumption) — all reads. |
| Probe agent + probe issue teardown | API / Backend + operator | DO backup | Mint via REST, tear down via issue-delete + agent-terminate (or rollback to the bookend snapshot). |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Run against **live BEAAA** — the real Paperclip host and host version the milestone is about (not a Countermoves proxy).
- **D-02:** Act **only on a dedicated throwaway probe agent + controlled blocked issues created on BEAAA for the spike**, fully owned by the spike. Do **not** write to real in-flight blocked items. Real blocked items may be **observed read-only** to confirm the probe shapes match what BEAAA actually produces. Clean up probe agent + issues after.
- **D-03:** Every live action is **bookended** by DO-droplet backup + plugin-reinstall rollback (safety-CLI not installed on BEAAA).
- **D-04 (Shape A):** Agent posted a question, awaiting reply (primary DO-03 case). Prove a reply comment resumes it. Builds on the proven `in_progress` native-wake result (04.1-01) under a *waiting-on-answer* condition.
- **D-05 (Shape B):** Issue status = `blocked` (terminal status per `topic-watchdog.ts`). Prove whether a comment alone flips it back, or whether `ctx.issues.update({status})` is required to un-terminal it.
- **D-06 (Shape C):** `blockedByIssueIds` relation (dependency edge). Prove whether answering/resolving the chain resumes it, or whether the relation itself must be cleared.
- **D-07 (three-signal PASS):** A shape is **resumed** only when corroborated by **all three**: (1) **behavioral** — probe agent emits a new action/comment/status change of its own within a heartbeat window; (2) **consumption** — heartbeat context / agent run-state shows it re-focused on / picked up the issue; (3) **state** — issue transitions off `blocked`/`awaiting`. Signal 3 alone is necessary-but-not-sufficient.
- **D-08 (fallback depth):** If comment-alone does NOT resume a shape, **keep going** — test comment + the minimal accompanying transition (`issues.update({status})`, `agents.resumeHeartbeat`, `requestWakeup`) until a working turnkey recipe is found and documented. Phase 14 must receive an executable recipe per shape, within the capability boundary.
- **D-09 (capability boundary):** Spike uses **only currently-declared capabilities**: `issues.createComment` (`issue.comments.create`), `issues.requestWakeup` (`issues.wakeup`), `issues.update` (status/assignee — declared v1.3.0/Phase 9), `agents.pause`/`agents.resume`, `agents.resumeHeartbeat`. Shapes A and B are fully provable within these.
- **D-10 (Shape C boundary):** If Shape C's working recipe requires clearing the dependency relation via **`issue.relations.write`** (only `issue.relations.read` declared today), **do NOT add the capability or redeploy.** Document the relations-clear path as **"spec'd-not-proven"**: the exact transition, the capability it needs, and its CTT-07 / governance cost. Still prove Shape C as far as declared caps allow (e.g. whether answering the *blocking* issue cascades a resume without touching the relation).
- **D-11 (output artifact):** Produce a written **unblock-resume contract** — `10-…-SPIKE-FINDINGS.md` in the phase dir — capturing per shape: comment-write path used, any required accompanying transition, when/whether the agent consumes it on heartbeat, the observed three-signal evidence, and a PASS / PARTIAL / FAIL verdict with DO-03 scope implication. Commit the probe script(s) following the `scripts/spike/*-probe.mjs` pattern.

### Claude's Discretion

- Probe **harness mechanics**: reuse the `scripts/spike/*-probe.mjs` REST-direct pattern vs drive through the real `chat.send` handler — pick whichever most faithfully mirrors Phase 14's Send. (Research recommends REST-direct; see Architecture Patterns.)
- Exact **probe-agent + probe-issue construction and teardown** on BEAAA.
- **Heartbeat / observation window** timing; how long before declaring FAIL.
- Which signal combination is the **minimal** recipe vs belt-and-suspenders.
- Whether to additionally package findings as a reusable project skill (optional; findings doc is required).

### Deferred Ideas (OUT OF SCOPE)

- **`issue.relations.write` capability + redeploy** to clear `blockedByIssueIds` edges — explicitly out (D-10). Documented as spec'd-not-proven; deploy decision belongs to Phase 14 planning.
- **Reply-in-place UI / Send affordance** — Phase 14 (DO-01/02/04/05). Spike proves plumbing only.
- **Quick-decision chips (Approve/Reject/pick-one)** — Phase 14; spike may *note* whether a structured decision-comment resumes differently from free-text, but building chips is out.
- **Packaging findings as a reusable project skill** — optional.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DO-03 | Completing the action actually **unblocks and resumes** the agent — verified end-to-end against the live Paperclip model (comment alone vs. comment + status transition). | This entire research: prior-art baseline (04-01 / 04.1-01 native wake), the three-shape construction recipes, the D-08 transition ladder, the three-signal observation map, and the false-pass/false-fail landmine guards. UI realization rides in Phase 14. |

## Standard Stack

**No new dependencies.** This is a throwaway probe script using Node's built-in `fetch` and the live Paperclip REST API. It ships nothing to npm, imports no plugin code, and adds no package. The probe mirrors the *existing* `scripts/spike/chat-true-task-spike-probe.mjs` exactly (native fetch, bearer header, per-step try/catch, structured JSON summary).

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Node `fetch` (built-in) | Node ≥20 | REST calls to the live host | The proven probe-harness pattern (04-01, 04.1-01). No `node-fetch`, no axios. |
| Paperclip REST API | host @2026.525.0+ (BEAAA) | issue/comment/agent CRUD + wakeup | The only mutation surface reachable from outside the worker. |
| `@paperclipai/plugin-sdk` types | 2026.512.0 (already in `node_modules`) | Reference only — to confirm which transitions are declared-capability-reachable | Read locally; not bundled by the probe. |

### Installation

**None.** The probe is a single `.mjs` file run with `node`. No `npm install`.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** The probe uses only Node built-ins and the live host REST API. No registry verification, slopcheck, or postinstall audit is required. If the planner later proposes any package install (it should not), gate it behind a `checkpoint:human-verify` task.

## Architecture Patterns

### System Flow Diagram

```
                       ┌─────────────────────────────────────────────────┐
   operator (Eric)     │  BOOKEND: DO-droplet backup (manual)            │
   on a LOCAL window   │  + verify plugin-reinstall rollback path once   │
   (tunnel + SSH)      └─────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  ssh -L 3100:localhost:3100 ariclaw   mint bearer token (auth login)
        │                                   │
        ▼                                   ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  unblock-resume-spike-probe.mjs  (REST-direct, runs OUTSIDE worker)   │
  │  PAPERCLIP_API_URL / API_KEY / COMPANY_ID(BEAAA) / probe agent id     │
  └──────────────────────────────────────────────────────────────────────┘
        │
        │  STEP 0  resolve/mint a SACRIFICIAL probe agent (NOT Editor, NOT a real hire)
        ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │ For each shape A / B / C:                                            │
   │   1. CONSTRUCT  → drive a fresh probe issue into the blocked shape   │
   │   2. COMMENT-ALONE  → POST /api/issues/{id}/comments  (the reply)    │
   │   3. OBSERVE (3 signals, polled, bounded window):                    │
   │        behavioral  = new agent comment/action  (listComments)       │
   │        consumption = run-state / heartbeat re-focus  (runs surface)  │
   │        state       = issue status off blocked/awaiting (GET issue)   │
   │   4. IF not all-3 within window → D-08 LADDER, one rung at a time:   │
   │        a) + issues.update({status:'in_progress'})  (un-terminal)     │
   │        b) + requestWakeup(reason, idempotencyKey)                    │
   │        c) + agents.resume / resumeHeartbeat (if agent itself paused) │
   │      re-OBSERVE after each rung; lock the MINIMAL passing recipe     │
   └─────────────────────────────────────────────────────────────────────┘
        │
        ▼
   single structured JSON summary on stdout  →  paste into GSD session
        │
        ▼
   10-…-SPIKE-FINDINGS.md  (per-shape recipe + 3-signal evidence + verdict)
        │
        ▼
   TEARDOWN: delete probe issues + terminate/delete probe agent (or rollback)
```

### Pattern 1: REST-direct probe harness (RECOMMENDED over `chat.send`)

**What:** A standalone Node `.mjs` that hits the live REST API with a bearer token, exactly like `chat-true-task-spike-probe.mjs`. Every step wrapped in try/catch; one structured JSON summary printed at the end; bearer token redacted from all error output.

**When to use:** Always, for this spike. The probe runs *outside* the plugin worker, so it has no `ctx` and cannot call `chat.send` directly anyway.

**Why over `chat.send`:** Phase 14's Send is a thin worker handler that calls `ctx.issues.createComment` + (per this spike's verdict) one transition. The REST `POST /api/issues/{id}/comments` is the *same canonical write* (`chat-send.ts` line 78 → `ctx.issues.createComment`). Reusing the proven REST harness gets a result in one run with zero build/deploy cycle. **Document the one fidelity gap:** `ctx.issues.requestWakeup` and `ctx.issues.update` run in a *worker action scope* on the host; the REST equivalents (`POST /api/issues/{id}/wakeup`, `PATCH /api/issues/{id}`) may behave differently (see Pitfall 3 — requestWakeup 404/scope). The findings doc must state which transitions were proven via REST and flag any that Phase 14 must re-confirm in-worker.

**Verified route shapes (live, 04-01):** issue/agent COLLECTION routes are companyId-scoped (`/api/companies/{id}/issues`, `/api/companies/{id}/agents`); per-issue SUB-routes are FLAT (`/api/issues/{id}`, `/api/issues/{id}/comments`, `/api/issues/{id}/wakeup`).

```javascript
// Source: scripts/spike/chat-true-task-spike-probe.mjs (lines 198–231) — reuse verbatim
const C = () => encodeURIComponent(COMPANY_ID);
const I = (id) => encodeURIComponent(id);
function createIssue(p)         { return call('POST',  `/api/companies/${C()}/issues`, p); }
function getIssue(id)           { return call('GET',   `/api/issues/${I(id)}`); }
function updateIssue(id, patch) { return call('PATCH', `/api/issues/${I(id)}`, patch); }
function listComments(id)       { return call('GET',   `/api/issues/${I(id)}/comments`); }
function createComment(id, b)   { return call('POST',  `/api/issues/${I(id)}/comments`, { body: b }); }
function requestWakeup(id, o)   { return call('POST',  `/api/issues/${I(id)}/wakeup`, o); }
```

### Pattern 2: Construct each blocked shape faithfully (the research crux)

The resume test is only valid if the probe issue is *genuinely* in the shape under test. Below is the most faithful construction per shape, with what each looks like in `public.issues` / heartbeat context. **Before relying on a construction, observe one REAL BEAAA blocked item read-only (D-02) and confirm the probe shape matches** what the host actually produces (status string, relation shape).

| Shape | How to construct on BEAAA | What it looks like (state) | Resume hypothesis |
|-------|---------------------------|----------------------------|-------------------|
| **A — awaiting reply** | Create issue `status:'in_progress'`, assign to probe agent, post a comment that *poses a question/decision* and instruct "reply by posting a COMMENT (not a document)". Let the agent run, ask its question, and park. | `status` stays `in_progress` (04.1-01 OQ1: agent leaves topic at `in_progress`); the "awaiting" is *semantic* (agent asked, is waiting), not a distinct status value. May also manifest as the host disposition-recovery `system_notice` ("needs a disposition") if the run ended without a clear next-step. | **Comment alone resumes** (extends 04.1-01 PASS-NATIVE to the awaiting-answer condition). Lowest risk. |
| **B — `status='blocked'`** | Create issue, assign to probe agent, then `PATCH /api/issues/{id}` `{status:'blocked'}` (declared `issues.update`). This is the terminal `blocked` in `TERMINAL_OR_BLOCKED_STATUSES`. | `status === 'blocked'` in `public.issues`. This is the genuine unknown: the host may refuse to dispatch a heartbeat to a terminal-status issue until it is un-terminalled. | **Unknown — the spike's reason to exist.** Test comment-alone; if it fails, the minimal fallback is almost certainly `issues.update({status:'in_progress'})` *then* the comment (or comment then flip). |
| **C — `blockedByIssueIds` relation** | Create a *blocker* issue X and a *blocked* issue Y; set Y `blockedByIssueIds:[X]` at **create time** (declared via `issues.create` — `blockedByIssueIds` is in the create input, line 1090) so no `relations.write` needed to *establish* the edge. Assign Y to the probe agent. | Y carries a blocked-by relation to X (`ctx.issues.relations.get` / `getSubtree({includeRelations})`). Maps to `blocker-chain.ts` edge `reason:'blocks'`. | **Bounded by D-10.** Test: does *answering/resolving X* (comment on X, or flip X to `done`) cascade a resume of Y *without* touching Y's relation? If Y only resumes after the edge is *cleared* (needs `relations.removeBlockers` / `setBlockedBy([])` → `issue.relations.write`, NOT declared), record that path as **spec'd-not-proven** with its capability + governance cost. |

**Key construction note for C:** `blockedByIssueIds` is settable at **create** time via `issues.create` (declared) — only *mutating* the edge later needs `issue.relations.write`. So the probe CAN establish the edge legally; what it cannot do within the boundary is *clear* it. Design Shape C to test the cascade-on-answer hypothesis first (legal), and only document the clear-the-edge path as spec'd-not-proven.

### Pattern 3: The D-08 transition ladder (minimal-first escalation)

For any shape where comment-alone fails the three-signal test, escalate one rung at a time and re-observe, so the *minimal* passing recipe is identified (not a belt-and-suspenders blob). Governance cost noted per rung (all rungs use declared caps; all are operator/plugin-attributed and host-governed — parity preserved).

| Rung | Transition | Declared cap | Governance cost | When it's the likely fix |
|------|-----------|--------------|-----------------|--------------------------|
| 0 | comment alone (`createComment`) | `issue.comments.create` | none beyond a comment write | Shape A (proven baseline). |
| 1 | + `issues.update({status:'in_progress'})` before/after the comment | `issues.update` | mutates `public.issues.updated_at` — the CTT-07 concern; host audit-logs the actor. Operator-attributed. | Shape B — un-terminal a `blocked` issue so the host will dispatch. **Note:** `chat-send.ts`'s watchdog deliberately does NOT do this (CTT-07 hotfix relies on host disposition-recovery); the spike must determine empirically whether `blocked` genuinely needs the explicit flip or whether host recovery handles it. |
| 2 | + `requestWakeup(reason, idempotencyKey)` | `issues.wakeup` | a nudge; host gate may 404/timeout (Pitfall 3). Idempotency-key coalesces repeats. | If native wake is slow and the operator needs *immediate* resume; or if comment-alone never dispatches. **Unreliable on this host — keep fire-and-forget, never block on it.** |
| 3 | + `agents.resume` / `agents.resumeHeartbeat` | `agents.resume` | resumes a *paused* agent; host throws on terminated/pending_approval. Explicit operator gesture, audit-logged. | ONLY if the agent itself is `paused` (distinct from the issue being blocked). The probe should check agent status — if the probe agent is `idle`, rung 3 is irrelevant. |

**Lock the minimal recipe:** the first rung at which all three signals fire is the recipe Phase 14 implements. Record the full ladder result (which rungs failed) so Phase 14 understands *why* the minimal recipe is what it is.

### Pattern 4: Three-signal observation map (how each signal is actually read)

| Signal (D-07) | What it proves | How to OBSERVE via live API | Realistic window before FAIL |
|---------------|----------------|------------------------------|------------------------------|
| **Behavioral** | The agent actually woke and acted | Poll `GET /api/issues/{id}/comments`; a NEW comment with `authorType:'agent'` (or `authorAgentId === probeAgentId`) that wasn't in `seenIds`. Also accept a new activity event if the agent acted without commenting. | First reply: **8 min** (04.1 used `FIRST_REPLY_WINDOW_MS = 8*60_000`). Re-wake: **4 min** per rung. Real LLM replies take minutes; heartbeat min interval ~30s. |
| **Consumption** | The agent *re-focused on / picked up* the issue (not just any wake) | Best available out-of-worker: the run surface tied to the issue. The replied comment carries `createdByRunId` (seen in 04.1 evidence) — a *fresh* `createdByRunId` after the reply is evidence a new run consumed the issue. If a `GET /api/issues/{id}/runs`-style route exists, poll it; otherwise use `createdByRunId` on the new comment as the consumption proxy. The in-worker `paperclipGetHeartbeatContext` / `getSubtree({includeActiveRuns})` is the higher-fidelity source Phase 14 can use — note it as the worker-side upgrade. | Within the same window as behavioral; consumption is corroborated by the same poll cycle. |
| **State** | The issue transitioned off `blocked`/`awaiting` | Poll `GET /api/issues/{id}` and watch `status`. For Shape B: `blocked → in_progress` (or whatever the agent/host sets). For Shape C: the blocked-by relation no longer blocks (re-read via subtree/relations). | Snapshot status every poll (30s) across the window; record the full transition list (04.1 OQ1 pattern: `statusTransitions[]`). |

**Why all three (D-07 rationale):** signal 3 alone is necessary-but-not-sufficient — status could flip without the agent ever resuming (e.g. the watchdog/host flipped it). Pairing behavioral + consumption prevents a false PASS where state changed but the agent never actually picked the work back up.

### Anti-Patterns to Avoid

- **Declaring FAIL too early.** Heartbeat dispatch + LLM run takes minutes. Use the 8-min first-reply / 4-min re-wake windows; do not poll for 60s and call it dead.
- **Blocking on `requestWakeup`.** It 404s/times-out on this host (Pitfall 3). Keep it fire-and-forget; never let it gate the probe's progress or the resume verdict.
- **Mutating a real blocked item.** D-02 is absolute — only the sacrificial probe agent + probe issues are written to. Real items are read-only.
- **Adding `issue.relations.write` or redeploying for Shape C.** D-10 forbids it. Document the clear-the-edge path; do not exercise it.
- **Conflating "issue blocked" with "agent paused".** Two different states with two different fixes. Check `agents.get(probeAgentId).status` before assuming rung 3 (resume) is relevant.
- **Single-signal PASS.** A status flip alone, or a stray comment alone, is not a PASS. All three signals, or it's PARTIAL/FAIL.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| REST client / auth / redaction | A new fetch wrapper | The `call()` + `redactedError()` + `asArray()` helpers from `chat-true-task-spike-probe.mjs` | Proven live, token-safe, route-shapes verified. Copy verbatim. |
| Poll-for-new-comment loop | A bespoke waiter | `pollForNewComment(issueId, seenIds, windowMs)` (04.1 probe) | Already handles seen-id dedup, bounded window, non-2xx skip. |
| Agent resolution (pick a non-Editor agent) | Manual id juggling | `resolveEmployeeAgent()` pattern + a `SPIKE_PROBE_AGENT_ID` env pin | But for THIS spike, **mint a dedicated sacrificial agent** rather than reusing a real hire (D-02) — see Open Questions Q-teardown. |
| Comment write | Direct DB / document upsert | `POST /api/issues/{id}/comments` = `ctx.issues.createComment` | Canonical `public.issue_comments` write; the exact path Phase 14 Send mirrors. |
| Un-terminal a blocked issue | A custom status machine | `PATCH /api/issues/{id}` `{status:'in_progress'}` = `ctx.issues.update` | Declared `issues.update` capability (v1.3.0). |
| Snapshot/rollback on BEAAA | safety-CLI (`scripts/safety/cli.mjs`) | **DO-droplet backup + plugin-reinstall** | safety-CLI is a Countermoves inheritance; **NOT installed on BEAAA** (no `~/clarity-pack`, no `/etc/paperclip/db.env`). |

**Key insight:** Every primitive this spike needs already exists and is live-proven. The spike's value is entirely in the *empirical answers per shape*, not in new tooling. Resist any urge to build infrastructure.

## Runtime State Inventory

> Rename/refactor concerns do not apply (this is a read-and-probe spike). The relevant inventory is **live residue the probe leaves on BEAAA** that must be torn down.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Probe issues created on `public.issues` (tagged `[SPIKE 10]` in titles, `originKind:'plugin:clarity-pack'`, `originId:'spike-…'`); their `public.issue_comments`; any host disposition-recovery `system_notice` comments provoked. | Delete each probe issue after the run (`paperclipai issue delete <id>` if available, else rollback to the bookend DO backup). Tag every title `[SPIKE 10]` so a botched run is greppable + deletable. |
| Live service config | The sacrificial probe **agent** registered on BEAAA's roster (an org-chart row + possibly an adapter registration). | Pause then terminate/delete the probe agent after the run. If delete isn't available via REST, document the manual teardown step; worst case the DO-backup rollback removes it. |
| OS-registered state | None — the probe is a one-shot Node script; it schedules no cron, registers no OS task. | None — verified by construction (no `jobs.schedule`, no routine). |
| Secrets/env vars | Bearer token minted for the probe (`PAPERCLIP_API_KEY` from `auth login`); BEAAA company id `59f8876e-e729-4dda-98f9-1317c2b50492`. | Token is short-lived; do not commit it. Probe redacts it from all output (`redactedError`). |
| Build artifacts | None — the probe imports no plugin code, is not bundled, ships nothing. The committed artifact is the `.mjs` under `scripts/spike/` + the findings doc. | Commit probe + findings (D-11). No build, no migration (Success Criterion 3 — touches no schema). |

**Canonical question answered:** After the run, the only residue is the probe agent + probe issues on the live board. Teardown = delete those, or rollback to the DO backup. **Nothing in OS-registered state or build artifacts** — verified by construction.

## Common Pitfalls

### Pitfall 1: `blocked` is a terminal status — the host may refuse to dispatch (Shape B's whole risk)

**What goes wrong:** Posting a comment to a `status='blocked'` issue may not wake the agent, because the host treats `blocked` (in `TERMINAL_OR_BLOCKED_STATUSES`) as a non-dispatchable terminal — unlike `done` (where 04-01 proved native wake *did* fire).
**Why it happens:** `done` and `blocked` are both terminal in the watchdog's set, but the host's dispatcher may gate them differently (a `done` issue is "complete"; a `blocked` issue may be "frozen pending a transition").
**How to avoid:** This is the spike's central question — test it head-on. If comment-alone fails Shape B, the minimal fallback is `issues.update({status:'in_progress'})` to un-terminal, then re-test. Record the *exact* required transition (flip-before-comment vs flip-after-comment vs both) — Phase 14's recipe depends on the ordering.
**Warning signs:** Behavioral signal never fires for Shape B within 8 min while it fired for Shape A; status stays `blocked` across the whole window.

### Pitfall 2: Disposition-recovery race produces a FALSE pass (host flips status, agent never resumes)

**What goes wrong:** The host's disposition-recovery service can flip a chat-topic/issue status post-run (04.1 captured the `system_notice` "Paperclip needs a disposition…"). If the probe only checks the *state* signal, a host-driven status flip looks like a resume — but the agent never actually picked the work back up.
**Why it happens:** Disposition-recovery is a separate host loop that mutates status independent of the agent. CTT-07 hotfix exists precisely because the plugin should NOT fight this loop.
**How to avoid:** D-07's three-signal rule is the guard. Require behavioral + consumption (a fresh agent comment with a new `createdByRunId`) in addition to state. A status flip with no fresh agent run is recorded as **PARTIAL (host recovery, not agent resume)**, not PASS.
**Warning signs:** State flipped but the only new comment is `authorType:'system'` with a `system_notice` presentation — that's recovery, not resume.

### Pitfall 3: `requestWakeup` is unreliable on this host (404 / 30s timeout / scope-error) → false fail if blocked-on

**What goes wrong:** Treating `requestWakeup` as a hard requirement. On paperclipai@2026.525.0 it 404s in some scopes (04.1 PROBE-OQ3: all three REST attempts returned HTTP 404 "API route not found"), times out after 30s, and scope-errors in worker→host calls. `chat-send.ts` keeps it fire-and-forget and notes "native wake suffices."
**Why it happens:** `ctx.issues.requestWakeup` has no reliable public REST surface on this host; it works only in a *valid action scope* in-worker, not from the outside-worker probe.
**How to avoid:** Order the ladder so native-wake (comment-alone) is tested first; treat `requestWakeup` as rung 2 and fire-and-forget. If it 404s from the probe, that does NOT mean the shape failed — it means the nudge path is REST-unavailable (a known fact), and native wake / status-flip is the real lever. Record the HTTP status verbatim; do not let a 404 here flip a shape to FAIL.
**Warning signs:** `requestWakeup` returns `{httpStatus:404, queued:null, runId:null}` — expected; do not interpret as resume-failure.

### Pitfall 4: CAS-guarded status transitions reject a stale flip (PLUGIN_SPEC §25.4.2 + PR #4738)

**What goes wrong:** A status `update` racing the host's own lifecycle transition can be rejected/ignored if the host CAS-guards run-status updates against the observed previous status. The probe's flip silently no-ops and the issue stays blocked.
**Why it happens:** PR #4738 guards run-status updates so stale finalizers don't emit duplicate terminal events — a flip computed from a stale read can lose the CAS.
**How to avoid:** Re-`GET` the issue immediately before each transition; pass the freshly-observed status. Record both the pre-flip and post-flip status from a *re-read*, not from the PATCH response alone. If a flip appears to no-op, re-read and retry once with the current status.
**Warning signs:** PATCH returns 200 but a subsequent `GET` shows the status unchanged.

### Pitfall 5: Heartbeat-recompile / token-ceiling exhaustion makes the agent look dead

**What goes wrong:** If the probe agent burns its budget (or the company budget hard-stop trips), the host will refuse to dispatch and the behavioral signal never fires — looking like a resume failure when it's actually a budget block.
**Why it happens:** The probe agent is under standard governance (caps, budget hard-stop) — `PluginIssueInvocationBlockSummary` exists for exactly this.
**How to avoid:** Keep prompts tiny (one-sentence asks, as 04.1 did). Check the agent isn't `paused`/budget-blocked before each shape. If a run never starts, inspect for an `invocationBlock` / budget incident before declaring resume-FAIL.
**Warning signs:** No new run at all (no fresh `createdByRunId`), agent status not `idle`, or a budget-incident notice.

### Pitfall 6: Wrong-terminal / probe-shape doesn't match real BEAAA blocked items

**What goes wrong:** The probe constructs a shape that doesn't match what BEAAA actually produces, so the recipe is valid for the probe but useless for Phase 14's real rows.
**Why it happens:** "Blocked" has three expressions (A/B/C); a real BEAAA item might use a different status string or relation shape than the probe assumes.
**How to avoid:** D-02 read-only confirmation — before each shape, observe one REAL BEAAA blocked item (status string, relation shape, whether it's awaiting-answer vs status-blocked vs relation-blocked) and confirm the probe construction matches. Record the real-item evidence alongside the probe evidence in the findings doc.
**Warning signs:** Real BEAAA blocked items never show `status='blocked'` (e.g. they all park at `in_progress` awaiting an answer) — in which case Shape B is academic and Shape A carries DO-03.

## Code Examples

### Construct Shape B (`status='blocked'`) and test comment-alone resume

```javascript
// Source: pattern derived from scripts/spike/chat-true-task-spike-probe.mjs (probeOQ3)
// + SDK update() signature (types.d.ts:1097 — status is patchable).
const SPIKE_TAG = '[SPIKE 10]';
const REPLY_CHANNEL_INSTRUCTION =
  'Reply to comments on this issue by posting a COMMENT on this issue (not a document).';

// 1. Create + assign to the sacrificial probe agent.
const create = await createIssue({
  title: `Shape B blocked-status probe ${SPIKE_TAG}`,
  description: `Spike 10 Shape B. ${REPLY_CHANNEL_INSTRUCTION} Safe to delete.`,
  status: 'in_progress',
  assigneeAgentId: PROBE_AGENT_ID,
  originKind: 'plugin:clarity-pack',
  originId: `spike-shapeB:${Date.now()}`,
});
const issueId = create.body.id;

// 2. Drive INTO the blocked terminal (declared issues.update capability).
await updateIssue(issueId, { status: 'blocked' });           // PATCH /api/issues/{id}
const pre = await getIssue(issueId);                          // re-read (CAS guard, Pitfall 4)
//   expect pre.body.status === 'blocked'

// 3. COMMENT-ALONE (the resume trigger under test).
const seen = new Set();
const c = await createComment(issueId, 'Spike 10: here is your answer — proceed with X.');
if (c.body?.id) seen.add(c.body.id);

// 4. OBSERVE three signals within the window.
const reply = await pollForNewComment(issueId, seen, 8 * 60_000);   // behavioral
const post  = await getIssue(issueId);                              // state
const behavioral  = !!reply && (reply.fresh.authorType === 'agent');
const consumption = !!reply && !!(reply.fresh.createdByRunId);      // fresh run consumed it
const state       = post.body?.status && post.body.status !== 'blocked';
//   PASS only if behavioral && consumption && state.
//   If not → D-08 ladder rung 1: updateIssue(issueId,{status:'in_progress'}) then re-test.
```

### Establish Shape C's `blockedByIssueIds` edge at create time (no relations.write)

```javascript
// Source: SDK issues.create input (types.d.ts:1090 — blockedByIssueIds is in CREATE).
// X = blocker, Y = blocked. Setting the edge at CREATE needs only issues.create.
const blockerX = await createIssue({
  title: `Shape C blocker X ${SPIKE_TAG}`, status: 'in_progress',
  originKind: 'plugin:clarity-pack', originId: `spike-shapeC-X:${Date.now()}`,
});
const blockedY = await createIssue({
  title: `Shape C blocked Y ${SPIKE_TAG}`, status: 'in_progress',
  assigneeAgentId: PROBE_AGENT_ID,
  blockedByIssueIds: [blockerX.body.id],          // <-- legal at create; NO relations.write
  originKind: 'plugin:clarity-pack', originId: `spike-shapeC-Y:${Date.now()}`,
});
// Test the CASCADE hypothesis (D-10): answer/resolve X (comment on X, or flip X to 'done')
// and observe whether Y resumes WITHOUT clearing Y's relation.
// If Y only resumes after the edge is CLEARED (relations.removeBlockers / setBlockedBy([])),
// that needs issue.relations.write (NOT declared) → record as spec'd-not-proven (D-10).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "requestWakeup is required to re-wake an agent" | Native wake — a bare comment re-wakes the assignee for N>1 turns, no nudge | 04.1-01 (2026-05-20), proven live | Shape A is comment-alone by default; `requestWakeup` is rung 2, fire-and-forget only. |
| "requestWakeup 404s; native wake suffices, period" | requestWakeup *does* work in a valid in-worker ACTION scope (chat-send), but 404s/times-out in scheduled-job and REST-direct scopes | `chat-send.ts` note (2026-05-29) | The probe (REST-direct) will see 404; Phase 14 (in-worker action) may get a working nudge. Findings must distinguish the scope. |
| Plugin flips terminal status itself (original 04.1-03) | Plugin avoids mutating `public.issues`; leans on host disposition-recovery (CTT-07 hotfix) | rc.8 (2026-05-26) | The spike must determine whether Shape B genuinely needs the plugin to flip status, or whether host recovery handles it — if the former, it's a deliberate CTT-07 exception Phase 14 must own. |
| safety-CLI snapshot/restore as the bookend | DO-droplet backup + plugin-reinstall rollback | BEAAA deploy (Phase 8/9) | No `scripts/safety/cli.mjs` on BEAAA; the probe's usage header (which references safety-CLI) must be adapted to the DO-backup bookend. |

**Deprecated/outdated for this spike:**
- `scripts/safety/cli.mjs snapshot/verify/gate` steps in the existing probe headers — **inapplicable on BEAAA** (Countermoves inheritance). Replace with the DO-backup bookend in the new probe's usage header.
- The assumption that `requestWakeup` from outside the worker will queue a run — it 404s; don't design the resume verdict around it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `status:'blocked'` can be set on a probe issue via `PATCH /api/issues/{id}` `{status:'blocked'}` using the declared `issues.update` capability. | Pattern 2 / Shape B | If `blocked` requires `blockedByIssueIds` to be non-empty (i.e. you can't be `blocked` without a blocker), Shape B construction merges into Shape C. Mitigation: try the bare status flip; if rejected, set a blocker edge too and record the host's actual rule. |
| A2 | A fresh `createdByRunId` on the agent's reply comment is a sound proxy for the "consumption" signal when no dedicated heartbeat-context REST route is reachable from the probe. | Pattern 4 | If `createdByRunId` is reused/stale, consumption could false-pass. Mitigation: also require the run id to differ from the run that produced the *question* (Shape A) / from any pre-existing run; note that the in-worker `paperclipGetHeartbeatContext` is the higher-fidelity source Phase 14 should use. |
| A3 | The probe can mint a dedicated sacrificial agent on BEAAA via REST (or the operator mints one manually) that is NOT a real hire and NOT the Editor-Agent. | Runtime State Inventory / Open Questions | If agent creation isn't reachable via the probe's REST surface, the spike must reuse an existing low-stakes agent (still NOT Editor, still D-02-safe by only touching probe issues). Mitigation: confirm the agent-create route in Wave 0; fall back to operator-minted agent. |
| A4 | The REST `POST /api/issues/{id}/comments` write is behaviorally identical (for wake purposes) to the in-worker `ctx.issues.createComment` that Phase 14's Send will call. | Pattern 1 | If the host wakes differently for plugin-worker-authored vs bearer-token-authored comments, the recipe might not transfer. Mitigation: 04-01/04.1-01 used REST-direct comments and the result *did* transfer to the worker handler — strong prior evidence it's identical; flag for Phase 14 in-worker re-confirm anyway. |
| A5 | BEAAA at its current host version behaves like Countermoves did at 04.1-01 spike time for native wake. | State of the Art | BEAAA runs @2026.525.0+ (newer); native-wake behavior could differ. Mitigation: Shape A re-validates the baseline on BEAAA first — if it fails, that's itself a critical finding and the rest of the ladder is re-prioritized. |
| A6 | `agents.resume`/`resumeHeartbeat` (rung 3) is only relevant if the probe *agent* is `paused`; an issue being blocked does not pause the agent. | Pattern 3 | If the host pauses an agent when its only issue goes blocked, rung 3 becomes load-bearing. Mitigation: read `agents.get(PROBE_AGENT_ID).status` before/after blocking the issue and record it. |

**Note for planner & discuss-phase:** A1, A3, and A5 are the assumptions most likely to reshape the plan. A1/A3 are cheap to resolve in a Wave-0 dry probe (a single create+patch round-trip against BEAAA) before the full 3-shape run; recommend doing so.

## Open Questions

1. **Can the probe mint + delete a sacrificial agent via REST, or must the operator do it manually? (teardown)**
   - What we know: agents are read via `GET /api/companies/{id}/agents`; the SDK exposes `agents.managed.reconcile` (in-worker) but the probe runs outside the worker. Agent *create*/*delete* REST routes weren't exercised by prior probes.
   - What's unclear: whether a bearer-token REST caller can create and later delete an agent on BEAAA.
   - Recommendation: Wave-0 dry run — attempt agent create+delete via REST against BEAAA with a `[SPIKE 10]`-tagged throwaway. If unavailable, the operator mints one agent manually before the run and terminates it after; the probe pins it via `SPIKE_PROBE_AGENT_ID`. Either way the DO-backup rollback is the safety net.

2. **Does BEAAA produce `status='blocked'` items in practice, or do real blocks manifest only as awaiting-answer (`in_progress`) + `blockedByIssueIds`?**
   - What we know: `topic-watchdog.ts` treats `blocked` as terminal; 04.1 showed agents leave topics at `in_progress`.
   - What's unclear: whether real BEAAA agents ever set `status='blocked'`, or whether the human-visible "blocked" is always relation/awaiting-driven.
   - Recommendation: the D-02 read-only confirmation answers this directly. If `status='blocked'` is rare/never on BEAAA, the findings doc should weight Shape A's recipe as the DO-03-carrying one and mark Shape B as "constructed-and-tested but not observed in real traffic."

3. **For Shape C, does answering the blocker issue X cascade-resume the blocked issue Y within the declared boundary, or is edge-clearing the only path?**
   - What we know: `blockedByIssueIds` is settable at create (declared) but clearable only via `issue.relations.write` (NOT declared, D-10).
   - What's unclear: whether the host auto-resumes Y when X reaches `done`, or whether Y stays blocked until the edge is explicitly cleared.
   - Recommendation: test the cascade hypothesis (flip X to `done`, observe Y); if Y stays blocked, document the edge-clear path (`relations.removeBlockers`/`setBlockedBy([])` + `issue.relations.write` cap + CTT-07 cost) as **spec'd-not-proven** for Phase 14's deploy decision.

4. **Does a structured decision-comment (Approve/Reject) resume differently from a free-text reply?**
   - What we know: Phase 14 wants quick-decision chips (DO-02); CONTEXT D-defers building chips but allows *noting* a difference.
   - What's unclear: whether the host/agent treats a structured interaction (`createInteraction`/`askUserQuestions` reply) differently from a plain comment for resume.
   - Recommendation: out of required scope, but if cheap, the probe can post one structured-style decision body and note whether resume behavior differs. Don't gate the verdict on it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Live BEAAA host (AriClaw DO droplet) | D-01 — the spike's only valid target | ✓ | paperclipai @2026.525.0+ | None — D-01 forbids a Countermoves proxy. |
| SSH access to BEAAA | run probe + bookend | ✓ | alias `ariclaw` → `root@46.101.105.87`, key `beaaa_ariclaw_ed25519` | DO Web Console (Path B) — immune to fail2ban banner-exchange timeouts. |
| Tunnel `ssh -L 3100:localhost:3100 ariclaw` | reach `http://localhost:3100/BEAAA/...` | ✓ | — | — |
| Bearer token (`auth login --instance-admin`) | probe REST auth | ✓ (operator mints) | token at `~/.paperclip/auth.json` | — |
| Node ≥20 on the box (or run probe locally through the tunnel) | run the `.mjs` probe | ✓ | host engines `>=20` | Run probe from the local machine against the tunnelled `localhost:3100`. |
| DO-droplet backup | D-03 bookend (pre-run) | ✓ (operator) | — | None — this IS the bookend (no safety-CLI). |
| Plugin-reinstall rollback (prior tarball) | D-03 bookend (rollback) | ✓ | additive schema; reinstall prior tarball | DO-backup restore. |
| safety-CLI (`scripts/safety/cli.mjs`) | snapshot/verify | ✗ | — | **DO-backup bookend** (safety-CLI is a Countermoves-only inheritance; `~/clarity-pack` and `/etc/paperclip/db.env` absent on BEAAA). |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** safety-CLI → DO-droplet backup + plugin-reinstall (the established BEAAA bookend).

**BEAAA operational gotchas (from `beaaa-deploy-mechanics.md`):**
- Paperclip runs as **`beai-agent`**, NOT root. Plugin/CLI commands: `sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai <...>'` (npx, `cd ~` = beai-agent home; `/root/paperclip` does NOT exist — `cd ~/paperclip` as root short-circuits and gives an empty plugin list, a probe artifact, not "plugin gone").
- **fail2ban:** bursts of SSH → "Connection timed out during banner exchange". Minimize SSH calls; wait 15–30 min or use the DO Web Console (Path B).
- BEAAA company prefix `BEAAA` = `59f8876e-e729-4dda-98f9-1317c2b50492`; plugin UUID `a763176a-2f4d-4986-b190-b5151e42cc00`.
- Per `autonomous-deploy-authorization`: Eric runs fully autonomous — deploy to BEAAA + live drills WITHOUT pausing (daily backup + rehearsed Phase-1 restore satisfy the bookended-by-snapshots rule). Deploy/drill needs a **LOCAL** window (tunnel + SSH).
- Per `countermoves-throwaway-credential`: that credential is Countermoves-only; BEAAA drills used the already-logged-in "Board" Playwright session.

## Validation Architecture

> This is a spike — the "tests" are the live probe run and its three-signal evidence, not a unit suite. The project's `nyquist_validation` posture still applies to any committed probe code (it must lint/typecheck-clean as an `.mjs`), but there is no behavior to unit-test deterministically: the SUT is the *live host's* resume semantics, which cannot be mocked without defeating the spike's purpose.

### "Test" Framework (spike-appropriate)

| Property | Value |
|----------|-------|
| Framework | Live REST probe (`scripts/spike/unblock-resume-spike-probe.mjs`) — no test runner |
| Config file | none — single `.mjs`, run with `node` |
| Quick run command | Wave-0 dry probe: one create+patch+delete round-trip vs BEAAA to confirm A1/A3 |
| Full run command | `PAPERCLIP_API_URL=… PAPERCLIP_API_KEY=… PAPERCLIP_COMPANY_ID=59f8876e-… node scripts/spike/unblock-resume-spike-probe.mjs > 10-01-probe-output.txt 2>&1` |

### Phase Requirements → Evidence Map

| Req ID | Behavior | Evidence Type | How proven | Exists? |
|--------|----------|---------------|------------|---------|
| DO-03 (Shape A) | Comment resumes an awaiting-answer agent | live 3-signal | probe Shape A run on BEAAA | ❌ Wave 0 (new probe) |
| DO-03 (Shape B) | Comment ± status flip resumes a `blocked` issue | live 3-signal + ladder | probe Shape B run | ❌ Wave 0 |
| DO-03 (Shape C) | Answering blocker cascades resume (or edge-clear documented) | live 3-signal, bounded by D-10 | probe Shape C run | ❌ Wave 0 |

### Sampling / cadence

- **Wave 0:** dry probe to resolve A1 (can we set `status:'blocked'`?) and A3 (can we mint/delete a probe agent?) before the full run.
- **Full run:** one bookended pass on BEAAA exercising all three shapes + the D-08 ladder; capture the single JSON summary.
- **Phase gate:** `10-…-SPIKE-FINDINGS.md` written with a PASS/PARTIAL/FAIL verdict per shape, three-signal evidence, the locked recipe, and the DO-03 scope implication (honest-negative is a valid gate-pass).

### Wave 0 Gaps

- [ ] `scripts/spike/unblock-resume-spike-probe.mjs` — new probe (copy harness from `chat-true-task-spike-probe.mjs`; adapt usage header to the DO-backup bookend, NOT safety-CLI).
- [ ] Dry probe to confirm A1 (`status:'blocked'` settable) + A3 (agent mint/delete via REST) against BEAAA.
- [ ] D-02 read-only confirmation: observe one real BEAAA blocked item per shape to validate probe-shape fidelity.
- [ ] Operator pre-flight: DO-droplet backup taken + plugin-reinstall rollback path confirmed once (D-03), on a LOCAL tunnel+SSH window.

## Security Domain

> `security_enforcement` posture applies, but this spike introduces no new attack surface (no UI, no new endpoint, no schema, no package). The relevant controls are operational safety, not application security.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer token via `auth login --instance-admin`; token at `~/.paperclip/auth.json`; **redacted from all probe output** (`redactedError`). Never commit the token. |
| V3 Session Management | no | One-shot script; no session state persisted. |
| V4 Access Control | yes | Probe acts under the declared-capability boundary (D-09); writes ONLY to the sacrificial probe agent + probe issues (D-02); real items read-only. Governance parity preserved (probe agent under standard caps/pause/terminate). |
| V5 Input Validation | n/a | No user input surface; the probe is operator-run with fixed payloads. |
| V6 Cryptography | no | No crypto introduced; relies on host TLS for the API. |

### Known Threat Patterns for this spike

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Probe writes to a REAL in-flight blocked item | Tampering | D-02 — only `[SPIKE 10]`-tagged probe issues + the sacrificial agent are written; real items observed read-only. |
| Bearer token leaks into committed output/logs | Information disclosure | `redactedError()` scrubs the token from every error/log line; output file (`10-01-probe-output.txt`) reviewed before commit; token not committed. |
| Botched run leaves residue on the live board | (operational) | `[SPIKE 10]` title tags make residue greppable + deletable; DO-backup bookend (D-03) provides a rehearsed rollback. |
| A status flip violates CTT-07 (plugin mutating `public.issues`) | (governance) | The spike's `issues.update` is operator-attributed and bounded to probe issues; if Shape B *requires* the flip, the findings doc flags it as a deliberate CTT-07 exception for Phase 14 to own — not a silent default. |
| Governance parity break (probe agent with special privileges) | Elevation of privilege | Probe agent is a standard hire under normal caps/pause/terminate (Success Criterion 3); no plugin-private resume mechanism. |

## Project Constraints (from CLAUDE.md)

The planner must honor these directives (same authority as locked decisions):

- **Bookended-by-snapshots rule:** every live action against BEAAA MUST be bookended by a verified backup taken immediately before, and a rollback path verified at least once before any feature work ships. On BEAAA this is the **DO-droplet backup + plugin-reinstall** (no safety-CLI).
- **Declared capabilities only (D-09):** `issue.comments.create`, `issues.wakeup`, `issues.update`, `agents.pause`, `agents.resume`, `agents.managed`, `agents.read`, `issue.relations.read` are declared. `issue.relations.write` is **NOT** declared — do not use it (D-10). (Verified against `src/manifest.ts` lines 649–725.)
- **Additive-schema rule / Success Criterion 3:** the spike touches **no schema at all** (no migration). The committed artifacts are the probe `.mjs` + the findings doc.
- **Governance parity (coexistence #4):** the probe agent is a regular org-chart hire under standard caps/pause/terminate/audit — no special privileges.
- **Same-origin trust model:** capabilities gate worker-side host RPC; they do NOT prevent direct HTTP API calls. The probe uses direct HTTP (bearer) — legitimate, but the findings doc must distinguish REST-direct results from in-worker `ctx` results (the Pitfall 3 scope difference).
- **MemPalace protocol:** query MemPalace (`clarity_pack` wing, rooms `runbook`/`decisions`) before proposing BEAAA snapshot/restore/install commands; file new drawers (drill outcomes, the locked recipe) at end of substantive work.
- **GSD workflow enforcement:** all file changes go through a GSD command; do not make direct edits outside the workflow.

## Sources

### Primary (HIGH confidence)
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` (2026.512.0) — `PluginIssuesClient.update` (status patchable, `blockedByIssueIds` in patch — line 1097–1101), `create` (`blockedByIssueIds` at create — line 1090), `createComment` (1124), `requestWakeup` (1113), `PluginIssueRelationsClient.setBlockedBy/addBlockers/removeBlockers` requiring `issue.relations.write` (915–920), `PluginAgentsClient.pause/resume/invoke/managed` (1166–1182), `getSubtree`/`includeActiveRuns`/`includeRelations` (1019–1028). Read locally this session.
- `src/manifest.ts` lines 619–726 — exact declared capability list (confirms D-09 boundary; `issue.relations.read` declared, `issue.relations.write` absent). Read locally.
- `src/worker/handlers/chat-send.ts` — canonical comment-write path (`ctx.issues.createComment` line 78) + `requestWakeup` fire-and-forget + the "native wake suffices / requestWakeup unreliable" notes. Read locally.
- `src/worker/chat/topic-watchdog.ts` — `TERMINAL_OR_BLOCKED_STATUSES = {done,cancelled,blocked}`, `NON_TERMINAL_CONVERSATION_STATUS='in_progress'`, the CTT-07 hotfix (plugin does NOT call `ctx.issues.update`; relies on host disposition-recovery). Read locally.
- `src/worker/handlers/agent-resume-heartbeat.ts` — `agents.managed.reconcile` + `agents.resume` pattern; governance-parity note. Read locally.
- `src/worker/handlers/issue-request-wakeup.ts` — `requestWakeup` + idempotency-key; 404/timeout unreliability note. Read locally.
- `src/shared/blocker-chain.ts` — edge `reason:'blocks'|'awaiting'|'external'`, `nodeMeta.status`, `HUMAN_ACTION_ON` fires on `status==='awaiting'`. Read locally.
- `.planning/phases/04.1-chat-true-task/04.1-01-SPIKE-FINDINGS.md` — PROBE-OQ3 PASS-NATIVE (multi-turn native wake, no requestWakeup; all 3 REST wakeup attempts 404'd); OQ1 agent-leaves-in-progress; the captured disposition-recovery `system_notice` JSON. Read locally.
- `.planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md` — D-01 native wake PASS; OQ-3 STATUS-FLIP-NOT-NEEDED (comment alone wakes a `done` topic); verified REST route split (collection company-scoped, per-issue flat). Read locally.
- `scripts/spike/chat-true-task-spike-probe.mjs` — the probe-harness pattern to copy (REST client, redaction, poll loop, agent resolution, structured JSON). Read locally.
- `.planning/phases/10-unblock-resume-spike/10-CONTEXT.md` — D-01..D-11 locked decisions. Read locally.
- `.planning/ROADMAP.md` — Phase 10 goal + 4 success criteria; Phase 14 dependency. Read locally.
- `.planning/REQUIREMENTS.md` — DO-03 text + Phase-10/Phase-14 mapping. Read locally.
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` §4 (the OPEN RISK verbatim) + §6 (verification target #4). Read locally.
- `.planning/research/PITFALLS.md` — CAS-guarded transitions (PR #4738 / §25.4.2), disposition-recovery, heartbeat-recompile/token-ceiling, requestWakeup misuse. Read locally.
- `MEMORY.md → beaaa-deploy-mechanics.md` — BEAAA SSH/user/no-safety-CLI/DO-backup/fail2ban/company-id facts. Read locally.

### Secondary (MEDIUM confidence)
- `@paperclipai/shared` Issue/Agent status enums — the package is workspace-internal (not present in `node_modules` as a readable `.d.ts`); the status values used here (`in_progress`, `done`, `cancelled`, `blocked`, `awaiting`, `todo`, `in_review`, `backlog`) are taken from the project's own code (`topic-watchdog.ts`, `blocker-chain.ts`) rather than the upstream enum. The exact set BEAAA accepts must be confirmed empirically in Wave 0 (A1).

### Tertiary (LOW confidence)
- None — every load-bearing claim is grounded in local code, the SDK type surface, or prior live-spike evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; the probe harness is a verbatim reuse of a live-proven pattern.
- Architecture (harness, shape construction, ladder, observation map): HIGH — all primitives verified in the SDK types + existing handlers + two prior live spikes.
- Shape A resume outcome: HIGH (likely PASS) — direct extension of 04.1-01 PASS-NATIVE; only the awaiting-answer framing is new.
- Shape B resume outcome: MEDIUM — this is the spike's genuine unknown (terminal `blocked` dispatch behavior); the *method* to resolve it is HIGH-confidence, the *answer* is what the spike produces.
- Shape C resume outcome: MEDIUM, bounded by D-10 — the cascade hypothesis is testable within declared caps; the edge-clear path is intentionally spec'd-not-proven.
- Pitfalls / false-pass-false-fail guards: HIGH — each is grounded in a documented prior finding (disposition-recovery race, requestWakeup 404, CAS guards, budget blocks).

**Research date:** 2026-06-01
**Valid until:** ~2026-06-15 (7 days nominal for a fast-moving live host; the BEAAA host version and native-wake behavior are the volatile inputs — re-confirm Shape A baseline at run time).
