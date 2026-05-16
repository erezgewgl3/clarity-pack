# Phase 3 Follow-up Spike — Why the Editor-Agent Ignores the Compile Prompt, and How to Fix It

**Researched:** 2026-05-16
**Domain:** Paperclip plugin SDK 2026.512.0 — how a plugin makes a *managed org-chart agent* produce structured output on demand
**Scope:** Targeted follow-up to `03-LLM-INVOCATION-RESEARCH.md`. That doc chose "Mechanism 1" (`ctx.agents.sessions.*`). Mechanism 1 is now **proven non-functional for an org-chart agent** on a live host. This doc determines the correct mechanism and the contained fix → Plan 03-06.
**Confidence:** HIGH on root cause (host source + an open upstream PR confirm it independently). HIGH on the recommended mechanism (the canonical example proves it). MEDIUM on the exact build-delta line count pending the Plan 03-06 drill.
**Builds on — do not repeat:** `03-LLM-INVOCATION-RESEARCH.md` (Mechanism catalogue), `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (the live defect write-up).

---

## Problem Statement

`compile-bulletin` invokes the Editor-Agent through `sessionLlmAdapter` (`src/worker/agents/session-llm-adapter.ts`): `ctx.agents.sessions.create` → `sendMessage({ prompt, reason: 'compile pass', onEvent })`, accumulating `chunk` events. On the live Countermoves instance the Editor-Agent's run completes **succeeded**, but its output is a plain-English heartbeat status report ("No assignments in my inbox … the wake reason was `compile pass` with no `PAPERCLIP_TASK_ID`, so there is no scoped issue to act on …"). `compilePass1` correctly rejects the prose as non-JSON; `next_due_at` never advances; the job loops every minute.

The Editor-Agent never saw the compile prompt. It ran its ordinary 9-step org-chart heartbeat (identity → get assignments → pick work → …), found an empty inbox, and emitted a status report. The headline question for Plan 03-06: **what is the correct mechanism for a plugin worker to make a managed agent produce structured JSON on demand, and what is the contained fix?**

The answer below is also a **correction to `03-LLM-INVOCATION-RESEARCH.md`**: its "Mechanism 1" recommendation rested on a misreading of the `plugin-llm-wiki` example. llm-wiki does **not** drive its agent via a bare session prompt — it creates an **operation issue assigned to the agent first**, then the session is a thin streaming wrapper over an *already-issue-scoped* run. That is "Mechanism 3" (scoped-issue handoff), not "Mechanism 1". The two were conflated.

---

## Root Cause — `sessionPrompt` never reaches the agent on released hosts

### Sub-question 3 / 1 answered: what does `sendMessage`'s `prompt` deliver into the agent's run?

**On the host build Countermoves runs (≤ v2026.512.0): nothing. The `prompt` is discarded before it reaches the agent.**

Evidence — upstream PR **#3106**, `fix(heartbeat+adapters): propagate session prompt from plugin sendMessage to adapter stdin`, **status OPEN, not merged** as of 2026-05-16:

> "the prompt text is passed as `payload.prompt` in the wakeup request but never reaches the adapter — `enrichWakeContextSnapshot` discards it" … "The agent would run with zero knowledge of the user's message and respond with 'inbox empty, exiting.'"

The PR's own fix description confirms the current (broken) contract and that the fix is not yet shipped:

> Part 1 — "`enrichWakeContextSnapshot` now copies `payload.prompt` into `contextSnapshot.sessionPrompt`"
> Part 2 — "All 6 local adapters read `context.sessionPrompt` and include it in `joinPromptSections()` so the text lands in the agent's stdin"
> Scope — "`sessionPrompt` is only set when `payload.prompt` is a non-empty string — **no change for existing heartbeat/timer/comment-wake flows**."

So: `ctx.agents.sessions.sendMessage({ prompt })` *accepts* a `prompt`, the SDK type (`PluginAgentSessionsClient.sendMessage`, types.d.ts:1188-1192) *declares* it, the host wakeup payload *carries* it — and then `enrichWakeContextSnapshot` **drops it on the floor**. The agent is woken with only the `reason` string as a wake label; its turn input is the standard heartbeat context snapshot (identity, inbox, assigned issues). Our Editor-Agent's verbatim output — *"the wake reason was `compile pass` with no `PAPERCLIP_TASK_ID`"* — is the agent literally reporting that it received a wake label and no scoped task. It is behaving exactly as designed.

This means: **`sendMessage`'s `prompt` is, on a released host, effectively a no-op for behaviour.** It is a forward-looking field whose delivery path is still an open PR. Any mechanism that depends on the agent *reading the prompt* is non-functional today. This is the single fact that invalidates `03-LLM-INVOCATION-RESEARCH.md`'s Mechanism 1 as written.

### Why the prior spike got this wrong

`03-LLM-INVOCATION-RESEARCH.md` cited `plugin-llm-wiki/startWikiQuerySession` as proof that "messaging its session runs a turn and streams the model's text back." It accumulated `chunk.message` and treated `done` as completion — true. But the spike did not trace **what makes the agent actually do the work**. It does not — the *session prompt* — see the next section.

**Confidence: HIGH.** The host source path (`enrichWakeContextSnapshot`) and the open PR that fixes it are independent confirmation. The live Countermoves agent output is a third.

---

## Why `plugin-llm-wiki` Works and We Don't — Sub-question 2 answered

The difference is **not** the agent's instructions in isolation, **not** the way the session is created, and **not** the `reason`/`prompt` arguments. It is that **llm-wiki hands the agent its task as an assigned Paperclip issue before (or instead of) relying on the session prompt.**

### Evidence — llm-wiki creates an operation issue, assigned to the agent

`plugin-llm-wiki/src/wiki/core.ts` has `createOperationIssue` (confirmed by source inspection): for every wiki operation (`ingest`, `query`, `lint`, `distill`, …) it calls `ctx.issues.create` with:

- `assigneeAgentId: managedAgent.agent?.id` — the issue is **assigned to the Wiki Maintainer**.
- `originKind: 'plugin:llm-wiki:operation:<type>'` — a plugin-operation issue (`PluginIssueOriginKind`), kept off the human board (`includePluginOperations`/`surfaceVisibility`).
- the `wikiId`, `spaceSlug`, `operationType`, and the user's question carried **in the issue description**.

The session (`startWikiQuerySession`) is opened *around* that already-assigned issue. When the agent wakes, its standard heartbeat **finds the assigned operation issue in its inbox** ("Step 3 — Get Assignments", `GET …/issues?assigneeAgentId={yourId}`) and works it. The session is a streaming/UX wrapper; the **issue assignment** is what carries the task.

### Evidence — the Wiki Maintainer's instructions are issue-driven by construction

The Wiki Maintainer's `AGENTS.md` (verbatim, fetched from master) never once says "respond to a chat message." Every operative sentence is issue-scoped:

> "Resolve the configured wiki root folder and the **target space named in the operation issue**."
> "The **operation issue's `originKind`** (`plugin:llm-wiki:operation:<type>`) tells you which skill to load."
> "Always pass **the operation issue's `wikiId` and `spaceSlug`** arguments."

The agent is built, top to bottom, around *"there is an operation issue assigned to me; read it; pick the matching skill; do it."* That is the org-chart heartbeat loop — not a chat loop.

### Our Editor-Agent is neither pattern

Our `src/manifest.ts` `agents[]` declares the Editor-Agent with a *job-description* `capabilities` string ("Compiles TL;DRs, critical-path narratives, and the Daily Bulletin …") and `instructions.content` that describe a **role and a voice** ("You are the Clarity Pack Editorial Desk … Always sign off as 'Editorial Desk' …") — but it **never tells the agent how a compile task arrives or what to do when one does.** There is no operation issue, no `originKind`, no skill, no "on each heartbeat, look for X." The compile pipeline expected the *session prompt* to be the task — and on a released host the session prompt is discarded.

The contrast plugin (`paperclip-plugin-chat`) is the *other* dead end: it uses an operator-configured general "Chat Assistant" agent with **no instructions at all** and a bare session prompt — and it is itself broken pending the very same PR #3106. It is not a model to copy.

**Confidence: HIGH.** llm-wiki's `createOperationIssue` + the verbatim issue-driven `AGENTS.md` + the open PR together make the picture unambiguous.

---

## Candidate Fix Paths — Sub-question 4

### Path (a) — Rewrite the Editor-Agent's manifest `instructions` so a `compile pass` session message is its task — **REJECTED**

This cannot work on a released host. The session `prompt` is discarded by `enrichWakeContextSnapshot` *before any agent or any instruction is consulted*. No wording of `instructions` can make an agent act on a prompt it never receives. Re-instructing the agent only helps once it has the task in hand — which Path (d) gives it. **Reject as a standalone fix; fold the instruction rewrite into Path (d).**

### Path (b) — Change how `sendMessage`/`reason`/`prompt` are passed — **REJECTED**

There is no argument combination that fixes this. The SDK `sendMessage` signature is `(sessionId, companyId, { prompt, reason?, onEvent? })` — three fields, all already used correctly. `reason` is a wake label (delivered); `prompt` is the turn input (discarded). There is no `mode`, no `structuredOutput`, no JSON-schema field on `create` or `sendMessage` (verified against types.d.ts:1175-1195). The bug is host-side, not in our call. **Reject.**

### Path (c) — Switch to Mechanism 2: plugin `tools[]` the agent calls — **REJECTED for v1, keep as v2 evolution**

A real architecture (it is llm-wiki's), and it *would* work — but it does not escape the root cause on its own. Tools fire **only during an agent run**, and *something must still wake the agent into a run scoped to "compile the bulletin now."* That "something" is still an assigned issue (Path d). Mechanism 2 adds `tools[]` declarations, `ctx.tools.register` handlers, the `agent.tools.register` capability, agent `permissions.pluginTools`, and a substantial instruction rewrite — on top of Path (d), not instead of it. It also conflicts with the verified-numerics constraint unless the verifier is moved inside a `bulletin_save_draft` tool handler. **Too big for a gap-closure plan. Defer to v2.**

### Path (d) — Scoped-issue handoff (Mechanism 3): create a bulletin-compile operation issue assigned to the Editor-Agent — **RECOMMENDED**

This is exactly what `plugin-llm-wiki` does, it works on the *current* released host (it rides "Step 3 — Get Assignments", which PR #3106 explicitly says is **unchanged**), and it preserves full governance parity.

The mechanism: `compile-bulletin`, when a company is due, calls `ctx.issues.create` with:

- `assigneeAgentId: editorAgentId` — the resolved Editor-Agent UUID.
- `companyId`, `projectId` (a managed plugin project, or omit), `title` e.g. `"Compile Daily Bulletin — cycle N"`.
- `description`: the **full compile prompt** `buildPrompt()` already produces — factsTable as DATA, the "output a JSON BulletinDraft" instruction, the `{{NUMBER:key}}` placeholder rules. The prompt becomes the *issue body*, which the heartbeat **does** deliver to the agent (it is the assigned task).
- `originKind: 'plugin:clarity-pack:operation:bulletin-compile'` and `surfaceVisibility` / `includePluginOperations` so the operation issue stays **off Eric's human board** (coexistence guarantee #2 — the classic UI is not polluted).
- optionally `ctx.issues.requestWakeup(issueId, companyId, { reason: 'bulletin compile' })` to wake the agent immediately rather than waiting for the next scheduled heartbeat.

The agent wakes, its heartbeat finds the assigned operation issue, reads the prompt from the issue body, and produces the `BulletinDraft` JSON. The worker reads the result back **either** by polling `ctx.issues.get` / `listComments` for the agent's output comment (llm-wiki's `query` does this — files the answer as a comment), **or** keeps the session `onEvent` stream purely for *liveness/streaming* while the issue assignment carries the task. The deterministic `verifyDraft` + `publishBulletin` stay in worker code, unchanged. The verified-numerics rule is fully preserved — the worker still computes `factsTable`/`standingNumbers`; the issue body only *passes them as data*; pass-2 still re-runs every SQL.

**Governance parity — fully satisfied.** The work runs as a real, audited agent run against a real assigned issue, subject to budget caps, pause/terminate, and the Paperclip audit trail. This is *more* governance-faithful than the session approach: there is now a visible issue and run history for every compile, exactly as Decision #3 / coexistence guarantee #4 intend. The Editor-Agent is unambiguously a real org-chart hire processing assigned work.

### Path (e) — Mechanism 4 (direct `ctx.http.fetch` to an LLM) — **REJECTED, remains break-glass only**

`03-LLM-INVOCATION-RESEARCH.md` flagged this as governance-non-compliant. The defect does **not** change that verdict: Path (d) is a working governed mechanism, so the "every governed mechanism is proven impossible" bar (CLAUDE.md constraint) is **not met**. Mechanism 4 bypasses the Editor-Agent entirely — no budget cap, no pause/terminate, no audit run — and adds a second credential surface. **Keep documented as break-glass; do not adopt.** The only thing the defect changes is that Mechanism 1 joins Mechanism 4 in the "rejected" column — leaving Path (d) as the primary.

---

## Primary Recommendation

**Adopt Path (d) — the scoped-issue handoff. Replace `sessionLlmAdapter` as the bulletin compile's task-delivery mechanism with a bulletin-compile *operation issue* assigned to the Editor-Agent, and rewrite the Editor-Agent's manifest instructions to make it process that issue.**

Rationale:
1. It is the **only** mechanism proven to work on the *current released host* — it rides "Get Assignments", which PR #3106 confirms is unchanged. Mechanism 1 depends on an **open, unmerged** PR.
2. It is the **canonical pattern** — `plugin-llm-wiki`, Paperclip's own first-party LLM-driving plugin, is built entirely on operation-issues-assigned-to-a-managed-agent.
3. It **strengthens** governance parity (Decision #3 / coexistence guarantee #4): every compile is now a visible, audited issue + run, not an ephemeral session.
4. It **preserves the verified-numerics contract** — the worker still computes all numbers; the operation issue body carries them as data; pass-2 verification is untouched.
5. It is a **contained delta** — `buildPrompt`, `computeStandingNumbers`, `computeFactsTable`, `verifyDraft`, `publishBulletin`, and all their tests are structurally untouched. Only the *task-delivery* layer changes.

### Concrete Contained Build Delta (for the Plan 03-06 planner)

**1. Editor-Agent manifest instructions (`src/manifest.ts` `agents[].instructions.content`).** Rewrite to be issue-driven, mirroring the Wiki Maintainer pattern. It must tell the agent:
   - On each heartbeat, look for an assigned issue with `originKind` prefix `plugin:clarity-pack:operation:`.
   - For `…:bulletin-compile`: the issue body is a compile prompt; produce **only** the `BulletinDraft` JSON object it asks for, as the issue's output (a comment, or the issue body update — see step 4 decision). No prose preamble, no fences.
   - Keep the "Editorial Desk" voice/sign-off rule for *narrative* output, but make explicit that a compile operation issue's output is raw JSON.
   - Keep the "Insufficient context" graceful-skip escape.

**2. `compile-bulletin` job (`src/worker/jobs/compile-bulletin.ts`).** Replace the `sessionLlmAdapter(...)` + `compilePass1(...llm...)` call path with:
   - `ctx.issues.create({ companyId, assigneeAgentId: editorAgentId, title: 'Compile Daily Bulletin — cycle N', description: buildPrompt(...), originKind: 'plugin:clarity-pack:operation:bulletin-compile', surfaceVisibility: <off-board> })`.
   - optional `ctx.issues.requestWakeup(opIssueId, companyId, { reason: 'bulletin compile cycle N' })` for prompt-now behaviour.
   - read the agent's JSON result back (poll `ctx.issues.listComments` / `ctx.issues.get` with a bounded timeout, OR have the agent set issue status to a terminal value and read its output field). `extractJsonObject` (already built, Defect B) still peels fences/prose. Then `verifyDraft` → `publishBulletin` exactly as today.
   - Idempotency: dedupe the operation issue per `cycleNumber` (search `ctx.issues.list({ assigneeAgentId, originKind, originId: 'cycle-N' })` before creating) so a job re-fire mid-compile does not spawn duplicates.

**3. `compilePass1` (`src/worker/bulletin/compile-pass-1.ts`).** Keep `buildPrompt`, `validateDraftSchema`, `extractJsonObject`, the token cap, and the `recordFailure` paths. The `LlmAdapter` seam can stay as the *test* injection point, but its production wiring is no longer `sessionLlmAdapter`; the planner decides whether to keep the adapter shape (adapter now = "create op-issue, await result") or inline the issue handoff into the job. Keeping the adapter shape minimises test churn.

**4. Manifest capabilities.** `issues.create`, `issues.read`, `issue.comments.read` are already declared. **Add** `issues.wakeup` (for `requestWakeup`) and confirm whether an off-board `surfaceVisibility`/`originKind` operation issue needs `issues.orchestration.read`. The `agent.sessions.*` capabilities can be **removed** if sessions are dropped entirely — or kept if the session stream is retained purely for liveness. Recommend: keep them for now, drop in a later cleanup, to limit the manifest delta the host re-validates.

**5. `sessionLlmAdapter` (`src/worker/agents/session-llm-adapter.ts`).** Becomes dead code for the bulletin path. Do **not** delete it in 03-06 — Phase 2's `compileTldr` rides the same adapter (see follow-up below) and the planner should decide retire-vs-retain holistically. Mark it deprecated with a pointer to this doc.

**Net delta:** one manifest `instructions` rewrite, ~1 manifest capability line, a task-delivery rewrite inside one job function, a result-readback helper, and an idempotency guard. No change to numerics, verification, publish, schema, or their tests. This is a gap-closure plan, not a Phase 3 rewrite.

---

## Secondary Bug — Resume Defeats the Circuit Breaker — Sub-question 5

**The defect:** `recordFailure` (`src/worker/agents/circuit-breaker.ts:84-86`) pauses the Editor-Agent after 3 consecutive failures (`ctx.agents.pause`). But `compile-bulletin` (`compile-bulletin.ts:259-273`) **unconditionally resumes a paused Editor-Agent at the top of every cycle**, before each compile. Since the job fires every minute, the sequence is: fail×3 → breaker pauses agent → next minute, job resumes agent → fail×3 → pause → resume … The breaker can never hold. It is a **resume-defeats-breaker infinite loop**, and it is *why* the live instance logged `attempt_n` 466→470 instead of stopping at 3.

**Root cause:** the resume was added (Plan 03-05) to solve a *different* problem — the manifest ships the Editor-Agent `status: 'paused'` as a coexistence-friendly default, so the *first ever* compile must resume it. That intent is correct. The bug is that the resume cannot distinguish **"paused because it ships paused / operator paused it"** from **"paused because our own circuit breaker just tripped."**

**Recommended fix — make resume breaker-aware:**

- The job must **not** resume the agent if the circuit breaker is currently tripped for `BULLETIN_COMPILE_AGENT_KEY`. The breaker already owns a per-process counter (`circuit-breaker.ts` `counters` map). Add an exported predicate, e.g. `isCircuitOpen(agentKey): boolean` returning `counter >= MAX_CONSECUTIVE_FAILURES`. In `compile-bulletin.ts`, gate the resume: `if (agent.status === 'paused' && !isCircuitOpen(BULLETIN_COMPILE_AGENT_KEY)) { resume }`. A breaker-tripped pause then **sticks** — exactly D-06's "no auto-resume; operator must click Resume" intent.
- **Durability caveat — flag for the planner.** The breaker counter is *in-memory per worker process* (documented in `circuit-breaker.ts:35-37`). A worker restart resets it to 0 → the next cycle would resume a breaker-paused agent again. The robust fix reads breaker state from the **durable** `editor_agent_failures` table on the resume decision: "if the last `MAX_CONSECUTIVE_FAILURES` rows for this `agent_key` are all failures with no intervening success, treat the breaker as open and do not resume." This is the `circuit-breaker.ts:13-15` "v2 reads the last N rows on boot" note — Plan 03-06 should pull it forward, because the resume-defeats-breaker loop makes in-memory-only state an active hazard, not a deferred nicety.
- **Belt-and-suspenders:** distinguish the *first-install* resume from a *recovery* resume. The first-install resume is legitimate exactly once (paused→idle, no prior failure rows). After that, the only thing that should resume the Editor-Agent is an **operator gesture in classic Paperclip UI** — which is the governance-correct behaviour and what D-06 always intended.

Once Path (d) lands, failures should also drop sharply (the agent will actually produce JSON), so the breaker should rarely trip — but the loop must still be fixed: a *genuine* outage (LLM provider down, agent terminated) must still latch the breaker.

---

## Open Follow-ups for the Planner

1. **Phase 2 TL;DR rides the same broken mechanism.** `compileTldr` and `handleEditorHeartbeat` (`src/worker/agents/editor.ts:128`) build the identical `sessionLlmAdapter`. The Reader's "Compiling TL;DR…" stuck state is the **same root cause** — the session prompt is discarded. The planner must scope whether 03-06 fixes the TL;DR path too (same operation-issue pattern, `originKind: 'plugin:clarity-pack:operation:tldr-compile'`) or whether that is a Phase 2 re-open. Recommendation: fix both in 03-06 — they share one mechanism; fixing only the bulletin leaves the Reader broken on the same defect.
2. **Result readback contract.** Decide how the agent returns the `BulletinDraft`: (a) as a comment on the operation issue (`createComment` — llm-wiki's `query` pattern, easiest to read back), or (b) by updating the operation issue body/a document. (a) is recommended. The agent instructions and the worker readback must agree. Drill the polling timeout on Countermoves — how long does a `claude_local` compile run take end-to-end?
3. **Watch PR #3106.** If/when it merges and Countermoves updates, the session-prompt path becomes viable again — but Path (d) should still be preferred (it is the canonical, audit-visible pattern). Note PR #3106 in the runbook so a host bump does not silently change behaviour. Renovate already watches the SDK; add a manual check for this PR.
4. **Operation-issue hygiene.** Confirm on a live drill that `originKind: 'plugin:clarity-pack:operation:*'` + the right `surfaceVisibility` keeps the operation issue off Eric's human board (coexistence guarantee #2). llm-wiki uses `includePluginOperations` filtering — verify the exact off-board mechanism against the host before relying on it.
5. **`PAPERCLIP_TASK_ID`.** The agent's own output cited the absence of `PAPERCLIP_TASK_ID`. An assigned operation issue should set it for the agent's run — confirm the heartbeat scopes the run to the assigned issue (it should, per "Step 3 — Get Assignments"). Drill it.
6. **Circuit-breaker durability.** Decide in 03-06 whether to pull the "read last N failure rows from `editor_agent_failures`" durability fix forward (recommended — see Secondary Bug) or accept in-memory-only with a documented restart hazard.

---

## Confidence Summary

| Claim | Confidence | Why / Source |
|---|---|---|
| `sendMessage`'s `prompt` is discarded before reaching the agent on host ≤ v2026.512.0 | HIGH | Upstream PR #3106 (OPEN): "`enrichWakeContextSnapshot` discards it"; "no change for existing heartbeat/timer/comment-wake flows". Live Countermoves agent output is independent confirmation. |
| PR #3106 (the fix) is open / unmerged as of 2026-05-16 | HIGH | github.com/paperclipai/paperclip/pull/3106 — shown Open, approved, not merged. |
| `reason` is delivered as a wake label; `prompt` is not delivered as turn input | HIGH | Agent's verbatim output cites the `reason` ("wake reason was `compile pass`"); PR #3106 confirms `prompt` is dropped. |
| llm-wiki drives its agent via an **operation issue assigned to the agent**, not a bare session prompt | HIGH | `plugin-llm-wiki/src/wiki/core.ts` `createOperationIssue` (`ctx.issues.create` with `assigneeAgentId`, `originKind`); Wiki Maintainer `AGENTS.md` is entirely issue-scoped (verbatim fetch). |
| `03-LLM-INVOCATION-RESEARCH.md` Mechanism 1 conflated session-streaming with issue-handoff | HIGH | The prior doc cited llm-wiki's session accumulation but never traced the operation-issue that carries the task. |
| Path (d) — operation-issue handoff — works on the current released host | HIGH | Rides "Step 3 — Get Assignments" (heartbeat-protocol.md), which PR #3106 explicitly leaves unchanged; llm-wiki proves it in production. |
| `ctx.issues.create` supports `assigneeAgentId`, `originKind`, `surfaceVisibility`, `requestWakeup` | HIGH | `PluginIssuesClient` — types.d.ts:1023-1074 (read directly from installed SDK). |
| Path (d) preserves verified-numerics + governance parity | HIGH | Worker still computes numbers; issue body carries them as data; `verifyDraft` unchanged; run is a real audited assigned-issue run. |
| Resume-defeats-breaker is a real infinite loop | HIGH | `circuit-breaker.ts:84-86` pauses; `compile-bulletin.ts:259-273` unconditionally resumes every minute; live `attempt_n` 466→470 proves the breaker never latched. |
| In-memory breaker counter is a restart hazard for the fix | HIGH | `circuit-breaker.ts:35-37` — counter is per-process, lost on worker restart; `:13-15` already flags the durable-state v2. |
| Contained build delta (no numerics/verify/publish change) | MEDIUM-HIGH | Task-delivery layer is well-isolated; MEDIUM pending the Plan 03-06 readback-contract decision + Countermoves drill. |
| paperclip-plugin-chat is NOT a model to copy | HIGH | It uses a no-instructions general agent + bare session prompt — itself broken pending PR #3106. |

## Sources

### Primary (HIGH)
- **PR #3106** — `github.com/paperclipai/paperclip/pull/3106` — `fix(heartbeat+adapters): propagate session prompt from plugin sendMessage to adapter stdin`. Status OPEN. The decisive source: `prompt` is discarded by `enrichWakeContextSnapshot`; fix not shipped.
- `github.com/paperclipai/paperclip` (master) `packages/plugins/plugin-llm-wiki/` — `src/wiki/core.ts` (`createOperationIssue` — `ctx.issues.create` + `assigneeAgentId` + `originKind`), `src/manifest.ts` (Wiki Maintainer `agents[]`), `agents/wiki-maintainer/AGENTS.md` (verbatim issue-driven instructions), `src/templates.ts` (`QUERY_PROMPT`, `LINT_PROMPT`).
- `github.com/paperclipai/paperclip` (master) `docs/guides/agent-developer/heartbeat-protocol.md` — the 9-step heartbeat loop; "Step 3 — Get Assignments" / "Step 4 — Pick Work"; `PAPERCLIP_TASK_ID` scoping.
- Installed `@paperclipai/plugin-sdk@2026.512.0` `dist/types.d.ts` — `PluginAgentSessionsClient` (1175-1195), `AgentSessionEvent` (1153-1162), `PluginIssuesClient` (1009-1078: `create`, `requestWakeup`, `listComments`), `PluginAgentsClient` (1110-1137: `invoke` returns only `{ runId }`).
- Installed `@paperclipai/shared@2026.512.0` `dist/types/plugin.d.ts` — `PluginManagedAgentDeclaration` (86-124), `PluginManagedRoutineDeclaration` (193-224).

### Secondary (MEDIUM — verified against primary)
- `github.com/webprismdevin/paperclip-plugin-chat` — contrast case: operator-configured general agent + bare session prompt, no instructions; itself broken pending PR #3106.

### Local context
- `.planning/phases/03-daily-bulletin/03-LLM-INVOCATION-RESEARCH.md` — the prior spike this doc corrects.
- `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` — the live defect write-up + verbatim agent output.
- `src/worker/agents/session-llm-adapter.ts`, `src/worker/agents/editor.ts`, `src/worker/agents/circuit-breaker.ts`, `src/worker/bulletin/compile-pass-1.ts`, `src/worker/jobs/compile-bulletin.ts`, `src/manifest.ts` — current implementation.

**Research date:** 2026-05-16 — **Valid until:** re-verify if PR #3106 merges or on any `@paperclipai/plugin-sdk` / host bump (date-versioned; the session-prompt contract is the thing that can change).
