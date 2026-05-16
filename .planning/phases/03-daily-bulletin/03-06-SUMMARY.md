---
phase: 03-daily-bulletin
plan: 06
subsystem: worker
tags: [gap-closure, agent-invocation, scoped-issue, bulletin, tldr, circuit-breaker, editor-agent]
status: AWAITING-CHECKPOINT

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "compile-bulletin.ts two-pass pipeline; compile-tldr.ts compileTldr kernel; compile-pass-1.ts buildPrompt + validateDraftSchema + extractJsonObject; circuit-breaker recordFailure/recordSuccess + BULLETIN_COMPILE_AGENT_KEY; editor_agent_failures table (migration 0002); manifest agents[] Editor-Agent declaration"
provides:
  - "agent-task-delivery.ts — deliverAgentTask(ctx,{agentId,companyId,operationKind,prompt,...}): creates a surfaceVisibility:'plugin_operation' operation issue assigned to the Editor-Agent (ctx.issues.create with assigneeAgentId/originKind/originId), fires ctx.issues.requestWakeup, polls listComments for the agent's result comment, returns the result string"
  - "deliveryLlmAdapter — a LlmAdapter whose complete() routes through deliverAgentTask; byte-identical interface to the deprecated sessionLlmAdapter so compilePass1/compileTldr and their stub tests are untouched"
  - "Idempotency: the operation-issue search passes includePluginOperations:true so an in-flight plugin_operation issue is found and not duplicated on a job re-fire (B-1)"
  - "circuit-breaker isCircuitOpen(agentKey) — in-memory breaker-open predicate; isCircuitOpenDurable(ctx,agentKey) — reads the last N editor_agent_failures rows so a worker restart that zeroes the in-memory counter cannot silently re-arm a tripped breaker"
  - "compile-bulletin.ts + editor.ts route LLM work through the operation-issue delivery; the Editor-Agent resume is breaker-aware (a breaker-tripped pause now sticks instead of being re-resumed every fire)"
  - "manifest: Editor-Agent instructions rewritten issue-driven (look for the bulletin-compile / tldr-compile operation originKind, output the requested JSON/TL;DR as a comment); capabilities[] gains issues.wakeup"
  - "sessionLlmAdapter deprecated (kept, unused on the production path) — the host discards the session prompt so it never worked live"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scoped-issue agent task delivery (Mechanism 3 / the canonical plugin-llm-wiki pattern) — a plugin gets structured output from a managed agent by creating an off-board operation issue assigned to the agent, waking it, and reading the result back from a comment. NOT ctx.agents.sessions.sendMessage, whose prompt the host discards (upstream PR #3106, open)."
    - "Off-board operation issues — surfaceVisibility:'plugin_operation' keeps compile issues off the default issue surface; idempotency searches MUST pass includePluginOperations:true to see them"
    - "Durable circuit-breaker check — pairing the in-memory breaker counter with a DB-backed isCircuitOpenDurable so a worker restart cannot defeat a tripped breaker"
    - "Breaker-aware agent resume — the compile job resumes a paused Editor-Agent only when the circuit is not open, closing the resume-defeats-breaker infinite-retry loop"

key-files:
  created:
    - src/worker/agents/agent-task-delivery.ts
    - test/worker/agents/agent-task-delivery.test.mjs
    - test/worker/agents/circuit-breaker-durable.test.mjs
  modified:
    - src/worker/agents/circuit-breaker.ts
    - src/worker/jobs/compile-bulletin.ts
    - src/worker/agents/editor.ts
    - src/worker/agents/session-llm-adapter.ts
    - src/manifest.ts
    - src/worker.ts
    - test/worker/bulletin/compile-bulletin-end-to-end.test.mjs
    - test/worker/bulletin/compile-bulletin-host-faithful.test.mjs
    - test/helpers/host-faithful-ctx.mjs

key-decisions:
  - "Adopted Mechanism 3 (scoped-issue handoff) — Plan 03-05's Mechanism 1 (ctx.agents.sessions.sendMessage as a prompt->completion channel) is non-functional: the host discards payload.prompt before it reaches the agent (upstream PR #3106, open/unmerged). plugin-llm-wiki, the example 03-05 cited, actually uses an operation issue assigned to its agent — the prior spike misread it."
  - "deliverAgentTask creates the operation issue with surfaceVisibility:'plugin_operation' (off the default issue surface) and the idempotency search passes includePluginOperations:true — without the flag the dedup search would never find the issue it just created and every job re-fire would spawn a duplicate (plan-checker B-1)."
  - "Result readback resolves on the FIRST comment that BOTH parses as JSON AND passes validateDraftSchema (bulletin) — a stray-brace progress comment cannot be consumed (plan-checker W-4). For tldr-compile the result is a plain string, gated on non-empty <=8000 chars (compileTldr's own validateLlmOutput bound), not validateDraftSchema — the per-operationKind validator branch the plan anticipated."
  - "validateDraftSchema in the delivery-layer result gate is called with an empty FactsTable — the readback only needs the structural shape; real per-slot numeric resolution + verification still run downstream in compilePass1 (real facts) and verifyDraft. The verified-numerics contract is unchanged."
  - "Editor-Agent resume is breaker-aware: compile-bulletin resumes a paused agent only when neither isCircuitOpen nor isCircuitOpenDurable reports the circuit open — closing the resume-defeats-breaker loop that drove attempt_n to 470 on the live drill."
  - "sessionLlmAdapter is deprecated but kept (not deleted) and the agent.sessions.* capabilities retained — minimizes the manifest delta the host re-validates; a later cleanup plan can drop them."

patterns-established:
  - "deliverAgentTask / deliveryLlmAdapter — the reusable scoped-issue task-delivery primitive; any future plugin worker code needing agent-generated output uses this, not agent sessions"
  - "isCircuitOpenDurable — the durable-failure-state pattern; pair any in-memory breaker counter with a DB-backed check so a process restart cannot re-arm a tripped breaker"

requirements-completed: [BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02]

# Metrics
duration: ~16min (agent wall-clock)
completed: 2026-05-16
---

# Phase 3 Plan 06: Agent-Invocation Gap Closure Summary

**The bulletin + Reader-TL;DR compile pipelines no longer invoke the Editor-Agent through a session prompt the host silently discards — they hand it a scoped operation issue (the canonical `plugin-llm-wiki` pattern) and read the result back from a comment; the circuit-breaker resume-loop is closed with a breaker-aware, durable-state resume gate.**

## Performance

- **Duration:** ~16 min agent wall-clock (Tasks 1-4; Task 5 is a pending human-verify checkpoint)
- **Completed (Tasks 1-4):** 2026-05-16
- **Tasks:** 4 of 5 (Task 5 = Eric's Countermoves Phase 3 closure re-drill — AWAITING CHECKPOINT)
- **Files:** 12 touched — 3 created, 9 modified

## Accomplishments

- **Scoped-issue task delivery** — new `agent-task-delivery.ts`: `deliverAgentTask` creates a `surfaceVisibility:'plugin_operation'` operation issue assigned to the Editor-Agent, fires `ctx.issues.requestWakeup`, polls `listComments` for the agent's result comment, and returns the result string. `deliveryLlmAdapter` wraps it in the byte-identical `LlmAdapter` interface so `compilePass1` / `compileTldr` and every stub test are structurally untouched.
- **B-1 idempotency** — the operation-issue dedup search passes `includePluginOperations:true`; without it the search could never see the off-board issue it just created and every `*/1` job re-fire would spawn a duplicate compile issue.
- **Durable circuit-breaker** — `isCircuitOpen` (in-memory) + `isCircuitOpenDurable` (reads the last N `editor_agent_failures` rows). A worker restart that zeroes the in-memory counter can no longer silently re-arm a tripped breaker.
- **Breaker-aware resume** — `compile-bulletin.ts` resumes a paused Editor-Agent only when the circuit is not open. This closes the resume-defeats-breaker infinite-retry loop that drove `attempt_n` to 470 on the live drill.
- **Both compile paths rewired** — `compile-bulletin.ts` (bulletin) and `editor.ts` (Reader TL;DR heartbeat) both route through the operation-issue delivery; `sessionLlmAdapter` is deprecated.
- **Issue-driven Editor-Agent** — manifest instructions rewritten so the agent looks for the bulletin-compile / tldr-compile operation `originKind` and outputs the requested JSON / TL;DR as a comment; `capabilities[]` gains `issues.wakeup`.

## Task Commits

TDD, committed atomically:

1. **Task 1: RED** — `3810bf6` — `agent-task-delivery.test.mjs` (8 tests) + `circuit-breaker-durable.test.mjs` (7 tests); all fail (target files absent).
2. **Task 2: GREEN** — `a522898` — `agent-task-delivery.ts` (`deliverAgentTask` + `deliveryLlmAdapter`) + `circuit-breaker.ts` (`isCircuitOpen` / `isCircuitOpenDurable`).
3. **Task 3: Wiring** — `9a34327` — operation-issue delivery wired into `compile-bulletin.ts` + `editor.ts`; breaker-aware resume; `sessionLlmAdapter` deprecated; e2e + host-faithful tests updated.
4. **Task 4: Manifest** — `9076f1e` — issue-driven Editor-Agent instructions + `issues.wakeup` capability.

_Task 5 (Eric's Countermoves Phase 3 closure re-drill) is a `checkpoint:human-verify` blocking gate — not yet run._

## Deviations from Plan

Six, all minor and within the plan's anticipated latitude — no scope or contract change:

1. **B-1 pre-flight verified, no deviation** — `includePluginOperations`, `requestWakeup`, `listComments`, `create` (assigneeAgentId/surfaceVisibility/originKind/originId), and the `issues.wakeup` capability all confirmed against the installed `@paperclipai/plugin-sdk@2026.512.0` (`types.d.ts:1018` for the flag).
2. **`validateDraftSchema` arity** — it requires a `FactsTable` arg; the delivery-layer result gate passes an empty facts table (structural-shape check only; real numeric resolution + verification run downstream). Documented in code.
3. **Per-`operationKind` validator** — `tldr-compile` results are plain strings, gated on non-empty ≤8000 chars (compileTldr's own bound) rather than `validateDraftSchema`. This is the per-`operationKind` branch the plan flagged for the executor.
4. **Obsolete host-faithful test reframed** — `compile-bulletin-host-faithful.test.mjs` Case 4 tested the now-off-path `ctx.agents.sessions.sendMessage` heartbeat-policy trap; reframed to test the operation-issue B-1 shape contract. No assertion weakened.
5. **`editor.ts` field rename** — widening `EditorHeartbeatCtx.issues` to the full `PluginIssuesClient` means `ctx.issues.get` returns the SDK `Issue` (`description`, not the old fake's `body`); call site updated, typecheck confirms.
6. **Manifest build command** — the plan's Task 4 `<verify>` referenced a non-existent `scripts/build-manifest.mjs`; used the project's actual `npx tsc --project tsconfig.manifest.json`.

## Verification

- `node --test "test/**/*.test.mjs"` — **676 tests / 674 pass / 0 fail / 2 skip** (baseline 660; +16). Re-run independently after execution — confirmed.
- `npx tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 160.4 KB unminified).
- `node scripts/build-ui.mjs` — clean (`dist/ui/index.js` 105.1 KB unminified).
- `npx tsc --project tsconfig.manifest.json` — clean.

## Checkpoint — Task 5 (AWAITING)

**Type:** `checkpoint:human-verify` (blocking). Plan 03-06 — and Phase 3 — is NOT complete until Eric runs the Phase 3 closure re-drill on Countermoves and reports `approved — phase 3 closed`. Full instructions are in `03-06-PLAN.md` Task 5.

**Stated primary risk (per the plan):** `PAPERCLIP_TASK_ID` run-scoping — an assigned operation issue *should* scope the Editor-Agent's heartbeat run to that issue, but if it does not, the agent re-enters the exact "no scoped issue to act on" state that caused the original defect and Path (d) is wrong. Task 5 step 8 is the hard gate: if the agent still runs unscoped, STOP — 03-06 needs a re-plan.

The drill also verifies: a bulletin compiles + publishes with real editorial prose and verified numbers; the Reader TL;DR populates; and the circuit-breaker holds (psql-seed three `editor_agent_failures` rows → confirm `isCircuitOpenDurable` reads the circuit open and the breaker-aware resume leaves the agent paused).

## Next Phase Readiness

- Once Eric's Task-5 re-drill PASSES, Plan 03-06 closes, Plan 03-04's closure-drill checkpoint is satisfied transitively (the same drill), Phase 3 closes, and the milestone advances to Phase 4 (Employee Chat).
- BULL-05/06/09, EDITOR-05, READER-02 are implemented; final confirmation pending the drill.

## Self-Check: PASSED

- `src/worker/agents/agent-task-delivery.ts` — FOUND
- `test/worker/agents/agent-task-delivery.test.mjs` — FOUND
- `test/worker/agents/circuit-breaker-durable.test.mjs` — FOUND
- `.planning/phases/03-daily-bulletin/03-06-SUMMARY.md` — FOUND
- Commits `3810bf6` (RED) / `a522898` (GREEN) / `9a34327` (wiring) / `9076f1e` (manifest) — FOUND

---
*Phase: 03-daily-bulletin*
*Plan 03-06 — Tasks 1-4 complete; Task 5 awaiting closure re-drill checkpoint*
*Completed (build): 2026-05-16*
