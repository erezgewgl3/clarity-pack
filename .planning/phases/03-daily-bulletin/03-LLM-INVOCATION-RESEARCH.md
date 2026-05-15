# Phase 3 Spike — How a Paperclip Plugin Gets an LLM to Generate Content

**Researched:** 2026-05-15
**Domain:** Paperclip plugin SDK 2026.512.0 — agent invocation / LLM-completion mechanism
**Scope:** Targeted spike feeding a re-plan of Plan 03-02 (Bulletin compile pipeline). NOT a full phase research pass.
**Confidence:** HIGH on SDK type surface and the canonical example (verified against installed `@paperclipai/plugin-sdk@2026.512.0` + `@paperclipai/shared@2026.512.0` and the open-source `plugin-llm-wiki`).

---

## Problem Statement

Clarity Pack's Editor-Agent compile pipeline (Phase 2 TL;DRs, Phase 3 Bulletin) was built against an injectable `LlmAdapter` with a **synchronous** `complete({maxTokens, prompt}): Promise<string>` method, wired in production to `ctx.llm`. **`ctx.llm` does not exist** — `PluginContext` (SDK types.d.ts:1292-1340) has no `llm` member. The fallback the code comments describe — "wire `ctx.llm` to `ctx.agents.invoke()` via an adapter shim" — **cannot be built**: `ctx.agents.invoke()` returns only `Promise<{ runId: string }>` (types.d.ts:1123-1128). It wakes an agent asynchronously and hands back a run id; it never returns completion text. Both `compileTldr()` and `compilePass1()` therefore work only against test stubs; the live "agent compiles content" capability does not function. This spike determines the real production mechanism and what it costs Plan 03-02.

**The headline finding:** The synchronous-`complete()` seam was an architectural fiction. The real SDK gives plugins LLM-generated content via **agent sessions** — `ctx.agents.sessions.create()` + `sendMessage({ prompt, onEvent })`, where the agent's text response arrives as streamed `chunk` events on an async callback. Plan 03-02's `facts → compilePass1 → verifyDraft → publish` straight-line job must be restructured around this async, event-driven contract.

---

## Mechanism 1 — `ctx.agents.sessions.*` (Agent Chat Sessions)

### How it works

`PluginAgentsClient.sessions` is a `PluginAgentSessionsClient` (types.d.ts:1135-1136, 1175-1195) with four methods:

- `create(agentId, companyId, { taskKey?, reason? }) → Promise<AgentSession>` — opens a conversational session (maps to an `AgentTaskSession` row host-side). Requires capability `agent.sessions.create`.
- `sendMessage(sessionId, companyId, { prompt, reason?, onEvent? }) → Promise<AgentSessionSendResult>` — sends a prompt. **Returns `{ runId }` immediately. The agent's actual output is delivered asynchronously through the `onEvent` callback.** Requires `agent.sessions.send`.
- `list(agentId, companyId)` / `close(sessionId, companyId)` — housekeeping. Require `agent.sessions.list` / `agent.sessions.close`.

The `onEvent` callback receives `AgentSessionEvent` objects (types.d.ts:1153-1162):

```ts
interface AgentSessionEvent {
  sessionId: string;
  runId: string;
  seq: number;
  eventType: "chunk" | "status" | "done" | "error";
  stream: "stdout" | "stderr" | "system" | null;
  message: string | null;
  payload: Record<string, unknown> | null;
}
```

`eventType: "chunk"` carries output text in `message`; `"done"` signals end-of-stream; `"error"` signals failure. **This is the LLM-completion mechanism.** The agent's adapter (`claude_local`) IS the LLM; messaging its session runs a turn and streams the model's text back.

### Evidence — the canonical example

`packages/plugins/plugin-llm-wiki` is Paperclip's official open-source example of a plugin that drives an LLM. Its `startWikiQuerySession()` (`src/wiki/core.ts:3838-3982`) is the exact pattern:

```ts
const session = await ctx.agents.sessions.create(agentId, input.companyId, {
  taskKey: `plugin:${PLUGIN_ID}:session:wiki:${wikiId}:query:${operation.operationId}`,
  reason: "LLM Wiki query session",
});

let answer = "";
const sendResult = await ctx.agents.sessions.sendMessage(session.sessionId, input.companyId, {
  prompt,
  reason: "LLM Wiki query",
  onEvent: (event) => {
    if (event.eventType === "chunk" && event.stream !== "stderr" && event.message) {
      answer += event.message;                       // <-- accumulate the LLM's text
    }
    ctx.streams.emit(channel, { type: "agent.event", ... });
    if (event.eventType === "done" || event.eventType === "error") {
      // answer is now the complete LLM response — file it, comment on the issue, etc.
      void ctx.issues.createComment(operation.issue.id, `Query completed.\n\n${answer.trim()}`, ...);
    }
  },
});
```

`isTerminalSessionEvent()` (core.ts:3834-3836) is literally `event.eventType === "done" || event.eventType === "error"`. The plugin accumulates `chunk.message` into a string and treats the `done` event as "the completion is ready." Required capabilities are declared verbatim in llm-wiki's manifest: `agent.sessions.create`, `agent.sessions.list`, `agent.sessions.send`, `agent.sessions.close`.

### Can it deliver LLM-generated content to the plugin? — **YES**

This is the supported, documented, example-proven way for a plugin worker to get an agent (= an LLM) to produce text the plugin then consumes. The PLUGIN_AUTHORING_GUIDE confirms it (line 274-276): *"Use `ctx.agents.invoke()` or `ctx.agents.sessions` only after you have a real agent id … resolved from `ctx.agents.managed`."*

### Trade-offs

- **Async, not sync.** No `Promise<string>` of completion text. You get text by accumulating `chunk` events and waiting for `done`. The `sendMessage` Promise resolving means "the send was accepted," NOT "the answer is ready" — though in practice llm-wiki `await`s it and the terminal event fires within the same `onEvent` lifecycle.
- **Governance-preserving.** The agent must not be `paused`/`terminated`/`pending_approval` (llm-wiki guards this explicitly, core.ts:3868-3881; `invoke()`/session calls *throw* otherwise). Budget caps, pause/terminate, and the audit trail all apply because it runs as a real agent run. **This satisfies coexistence guarantee #4 / Decision #3.**
- **Output is free-text, not guaranteed JSON.** The agent streams whatever its adapter produces. Clarity Pack's pass-1 needs structured `BulletinDraft` JSON — the prompt must demand JSON and the existing `JSON.parse` + `validateDraftSchema` in `compilePass1` still apply to the accumulated `answer`.
- **One extra resource to manage.** Sessions should be `close()`d. `taskKey` gives idempotency/dedupe.

**Confidence: HIGH** — verified against installed SDK `.d.ts` and a complete, current first-party example.

---

## Mechanism 2 — MCP / Plugin Tools Called by the Agent on Its Heartbeat

### How it works

A plugin declares `tools[]` (`PluginToolDeclaration` — shared/types/plugin.d.ts:49-58): `{ name, displayName, description, parametersSchema }`. The worker registers handlers via `ctx.tools.register(name, declaration, fn)` (types.d.ts:708-717), requiring capability `agent.tools.register`. When an agent calls the tool during a run, the handler `fn(params, runCtx)` executes inside the worker; `runCtx` is `ToolRunContext` `{ agentId, runId, companyId, projectId }` (types.d.ts:98-107) and the handler returns a `ToolResult` `{ content?, data?, error? }` (types.d.ts:113-120).

The intended design for agent-authored content: a managed agent runs (woken by a routine or session), its `claude_local` adapter IS the LLM, and it calls plugin tools to (a) **read facts** and (b) **write the finished artifact back**. `plugin-llm-wiki` is exactly this — 11 tools (`wiki_read_page`, `wiki_write_page`, `wiki_update_index`, `wiki_append_log`, …) that the Wiki Maintainer agent uses to read context and persist pages. The tool handlers do the deterministic filesystem/DB work; the LLM decides *what* to write.

### Evidence

- `registerWikiTools()` — `src/wiki/core.ts:4061-4250+`, 11 `ctx.tools.register(...)` calls.
- llm-wiki manifest `tools[]` array (manifest.ts) — full declarations with JSON-schema `parametersSchema`.
- Agent permission wiring: llm-wiki agent declares `permissions: { pluginTools: [PLUGIN_ID] }` — the managed agent is granted use of its own plugin's tools.

### Can it deliver LLM-generated content to the plugin? — **YES, indirectly**

This is the "the agent writes the result itself" model. The plugin never sees a completion string; instead the agent calls a plugin-provided **write** tool (`bulletin_save_draft`) and the tool handler persists the structured artifact into the plugin's DB namespace. The LLM-authored content lands in `bulletins.draft_json` via the tool handler, not via a return value to the worker.

### Trade-offs

- **Full governance parity.** Identical to Mechanism 1 — runs as a real agent run, subject to budget/pause/audit.
- **Hardest to control output shape.** You cannot `JSON.parse`+`validateDraftSchema` a return value; the agent calls your write tool with `params`, and the *tool handler* must validate `params` against the `BulletinDraft` schema and return `error` to the agent if invalid. The two-pass verifier (`verifyDraft`) moves *inside* the `bulletin_save_draft` tool handler — reject in-handler, the agent retries within the same run.
- **Requires the agent to actually be running.** Tools fire only during an agent run; something must wake the agent (a routine, a session, or `invoke()`).
- **Bigger build delta.** New `tools[]` declarations, `ctx.tools.register` handlers, `agent.tools.register` capability, agent `permissions.pluginTools`, MCP server config, and substantial new agent instructions. This is the architecture llm-wiki uses but it is the most code.

**Confidence: HIGH** that the mechanism exists and works (example-proven). **MEDIUM** that Clarity Pack *needs* the full tool-driven model for v1 — see Recommendation.

---

## Mechanism 3 — Managed Routines vs Jobs

### How it works

`routines[]` (`PluginManagedRoutineDeclaration` — shared/types/plugin.d.ts:193-224) declares a Paperclip **Routine** entity: a recurring task, assigned to an agent (`assigneeRef`), that on each trigger fire **creates an issue** the agent processes on its heartbeat. `ctx.routines.managed.reconcile/run` (types.d.ts:634-652) provisions and fires it; `RoutineRun` (shared/types/routine.d.ts:141-158) carries a `linkedIssueId` — proof that a routine run materializes an issue. A `jobs[]` entry (`PluginJobDeclaration` — shared/types/plugin.d.ts:17-26) is a bare cron that fires the worker's `ctx.jobs.register(jobKey, handler)` callback — pure worker code, no agent, no issue.

### Was the jobs-vs-routines decision the thing that severed LLM access?

**Partially — but the existing 03-RESEARCH.md analysis is still correct about what it warned against.** 03-RESEARCH.md Pitfall 1 (lines 775-783) correctly states: a `routines[]` entry is NOT a cron handler for worker code; it fires as a Paperclip routine-run that creates an issue. Choosing `jobs[]` for *scheduling the worker callback* was right — that decision is sound and should stand.

**The subtler point this spike surfaces:** a routine's value was never "scheduling." It is that **a routine run hands work to an agent as an issue, and the agent processes it on its heartbeat with its adapter (the LLM) live.** That heartbeat run is itself an LLM-invocation pathway — the agent reads the issue, calls plugin tools, writes the result. So the jobs-vs-routines choice did not "sever LLM access" (a `jobs[]` handler can still open an agent session — Mechanism 1), but it did mean the bulletin compile got framed as *worker-only code that needs an LLM injected*, which is the framing that produced the impossible `ctx.llm` seam. Routines are the framing where the LLM is intrinsic because the agent owns the work.

### Can it deliver LLM-generated content? — **YES, as the heartbeat host for Mechanism 2**

A routine does not itself "return completion text." It is the vehicle that puts an agent run on a schedule. Combined with tools (Mechanism 2) it is exactly the llm-wiki architecture: routine fires → issue created for the agent → agent heartbeat run → agent calls plugin tools → tool handlers persist the artifact.

### Trade-offs

- **Pro:** Native Paperclip audit trail — every run is a visible issue with its own run history; operator sees it in the Routines panel.
- **Pro:** The LLM is intrinsic to the model — no injected adapter, no `ctx.llm` fiction.
- **Con:** Heaviest conceptual shift from Plan 03-02's current straight-line job. The bulletin issue and the routine-operation issue are different things to keep distinct (cf. 03-RESEARCH.md Pitfall 2 — self-loop).
- **Con:** 03-RESEARCH.md already recorded (Q-NEW, line 884-888) the decision to **defer `routines[]`** for Phase 3. Adopting routines reopens that decision.

**Confidence: HIGH** on the type-level distinction; **MEDIUM** on exact host runtime semantics of a routine-run-to-heartbeat handoff (the formal spec under-documents it; llm-wiki proves it works in practice).

---

## Mechanism 4 — Direct External LLM Call via `ctx.http.fetch` + `ctx.secrets.resolve()`

### How it works

`PluginContext` has `http: PluginHttpClient` (capability `http.outbound`) and `secrets: PluginSecretsClient` (capability `secrets.read-ref`). The worker could resolve an Anthropic API key via `ctx.secrets.resolve(secretRef)` and `POST` directly to `api.anthropic.com/v1/messages` from inside the `compile-bulletin` job. This would actually restore a literal synchronous `complete(): Promise<string>` — the `LlmAdapter` interface would work unchanged, just backed by a real `fetch` instead of a stub.

### Can it deliver LLM-generated content? — **YES, and it is the only mechanism that keeps the existing code shape**

A direct HTTP completion call returns the model's text in the response body. `compilePass1`'s `JSON.parse` + `validateDraftSchema` + the two-pass verifier all keep working with zero structural change.

### Trade-offs — **flagged: governance conflict**

- **Violates Decision #3 / coexistence guarantee #4.** A direct API call bypasses the Editor-Agent entirely: **no budget cap enforcement, no pause/terminate, no Paperclip audit trail, no agent-run record.** CLAUDE.md's "What NOT to Use" table explicitly forbids the analogous custom-heartbeat pattern for exactly this reason. The Editor-Agent would be a manifest decoration that never actually does the compiling.
- **Operator key management.** The plugin must own an Anthropic key as a secret ref — a second credential surface beyond the agent adapter the operator already configured.
- **Token cap is self-policed only.** `MAX_BULLETIN_TOKENS` becomes the *only* spend guard; there is no host-side budget backstop.

This is the lowest-effort path and the only zero-restructure path, but it is **architecturally non-compliant** with the project's locked decisions. Document it as the break-glass fallback; do not adopt it as the primary mechanism.

**Confidence: HIGH** on feasibility; **HIGH** on the governance conflict (CLAUDE.md states it explicitly).

---

## Recommendation

**Adopt Mechanism 1 — `ctx.agents.sessions.*` — as the production LLM-invocation mechanism for the Bulletin compile (and retrofit Phase 2's TL;DR compile the same way).**

Rationale:

1. It is the supported, example-proven path (`plugin-llm-wiki/startWikiQuerySession`) and keeps **full governance parity** — the agent must be invokable, runs as a real agent run, respects budget/pause/audit (Decision #3 / guarantee #4 satisfied).
2. It requires **far less new surface area than Mechanism 2** (no `tools[]`, no `agent.tools.register`, no agent-instruction rewrite for tool use). The compile worker already computes the factsTable deterministically; it just needs the LLM to *write prose around it*, which is a single prompt → single response — a textbook session `sendMessage`.
3. Unlike Mechanism 4 it does not bypass the Editor-Agent or introduce a second credential surface.
4. Mechanism 2 (tool-driven, agent-authored) is the right model if/when the Editor-Agent needs to autonomously gather facts. For v1 the worker already gathers facts deterministically (and *must* — the verified-numerics design forbids the LLM touching numbers). Session-messaging is the correct weight for "deterministic facts in, LLM prose out." Keep Mechanism 2 as the documented v2 evolution.
5. Keep `jobs[]` for scheduling — 03-RESEARCH.md's jobs-not-routines call stands. Routines are not needed because the *job* opens the session; the job is just a scheduler and the agent session is the governed LLM run.

### Concrete restructure of Plan 03-02's compile path

**Current (broken):** `compile-bulletin` job → `computeStandingNumbers` → `computeFactsTable` → `compilePass1(ctx, …)` calls `ctx.llm.complete()` *(undefined)* → `verifyDraft` → `publishBulletin` → advance `next_due_at`. Synchronous, single-pass-through.

**New (async, session-driven):**

1. **Replace the `LlmAdapter` injection seam.** Delete the `ctx.llm` / `LlmAdapter.complete()` fiction from the production path. Introduce a real adapter: `sessionLlmAdapter(ctx, { agentId, companyId })` whose `complete({ maxTokens, prompt })` internally does:
   - `const session = await ctx.agents.sessions.create(agentId, companyId, { taskKey: \`clarity-pack:bulletin:cycle-${cycleNumber}\`, reason: 'Daily Bulletin compile' })`
   - guard the agent: `ctx.agents.get(agentId, companyId)` — if `paused`/`terminated`/`pending_approval`, throw a tagged error (feeds the existing circuit breaker and `recordCompileFailure`).
   - accumulate: `let out = ''; await ctx.agents.sessions.sendMessage(session.sessionId, companyId, { prompt, reason: 'bulletin pass-1', onEvent: e => { if (e.eventType==='chunk' && e.stream!=='stderr' && e.message) out += e.message; } })`
   - wrap the terminal event in a Promise: resolve `out` on `done`, reject on `error`.
   - `await ctx.agents.sessions.close(session.sessionId, companyId)` in a `finally`.
   - This keeps `compilePass1`'s body (`buildPrompt` → `complete` → `JSON.parse` → `validateDraftSchema`) **unchanged** — the adapter interface is preserved; only its production implementation becomes real. Tests keep their stubs.
2. **Add capabilities to the manifest:** `agent.sessions.create`, `agent.sessions.send`, `agent.sessions.close` (and `agent.sessions.list` if reused). The manifest already has `agents.read` (needed for the invokability guard) and `agents.managed`.
3. **Resolve the agent id once per company per cycle** — the job already does this: `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, company.id) → editorAgentId` (compile-bulletin.ts:142-156). Pass `editorAgentId` into the `sessionLlmAdapter` factory instead of relying on `ctx.llm`.
4. **The two-pass verifier and publish stay deterministic and synchronous.** `verifyDraft` and `publishBulletin` run in worker code *after* the session resolves — unchanged. The async boundary is contained entirely inside the new adapter; the rest of the per-company loop body reads as before.
5. **`worker.ts`:** replace `registerCompileBulletinJob(ctx as unknown as CompileBulletinCtx)` (the bare cast that masked the missing `llm`). `CompileBulletinCtx.llm` becomes non-optional in production by constructing the real adapter per-company at job time, OR drop `llm` from the ctx type and have the job build the adapter inline from `ctx.agents` + `editorAgentId`. The latter is cleaner — it removes the type-level lie that a single `llm` exists independent of an agent.
6. **Failure paths:** an unwoken/paused agent, a session-`error` terminal event, or a non-JSON streamed answer all route through the *existing* `recordFailure` / `recordCompileFailure` / circuit-breaker plumbing — no new failure machinery. The agent-paused case is new and important: the circuit breaker can itself pause the agent, so the compile must fail gracefully (and the banner from Plan 03-04 surfaces it), not loop.

**Net plan delta:** one new file (`src/worker/bulletin/session-llm-adapter.ts` — the real adapter), ~3 manifest capability lines, a small `worker.ts` wiring change, and removal of the `ctx.llm`/`as unknown as` casts. `compilePass1`, `verifyDraft`, `publishBulletin`, and all existing tests are structurally untouched. This is a contained re-plan, not a Phase 3 rewrite.

### Open follow-ups for the planner

- **Drill the agent-paused path.** The manifest ships the Editor-Agent `status: 'paused'`. On a fresh install the first compile WILL hit a paused agent. The re-plan must cover "resume the Editor-Agent before the first bulletin can compile" — either an operator step in the runbook or a guarded `ctx.agents.resume` (the manifest already has `agents.resume`).
- **Confirm `sendMessage` resolution timing on a live instance.** HIGH confidence the `done` event fires within the `onEvent` lifecycle (llm-wiki relies on it), but the Promise-wrapping must be drilled on Countermoves: does the `sendMessage` Promise resolve before, with, or after the terminal `onEvent`? Wrap defensively (resolve on terminal event, with a timeout) rather than assuming.
- **Phase 2 retrofit.** `compileTldr` has the identical `ctx.llm` fiction. Same `sessionLlmAdapter` fix applies; the planner should scope whether to fix it in this re-plan or a follow-up.

---

## Confidence Summary

| Claim | Confidence | Why |
|---|---|---|
| `ctx.llm` does not exist; `invoke()` returns only `{ runId }` | HIGH | Read directly from installed `types.d.ts:1123-1340`. |
| `ctx.agents.sessions.*` delivers LLM text via `chunk`/`done` events | HIGH | `types.d.ts:1153-1195` + `plugin-llm-wiki/src/wiki/core.ts:3838-3982` (live example accumulates `chunk.message`, treats `done` as completion). |
| Sessions preserve agent governance (budget/pause/audit) | HIGH | llm-wiki guards agent status before messaging (core.ts:3868-3881); runs as a real agent run. |
| Plugin tools (`tools[]` + `ctx.tools.register`) let an agent author content | HIGH | `shared/types/plugin.d.ts:49-58`, `types.d.ts:708-717`, llm-wiki `registerWikiTools` (core.ts:4061+). |
| `routines[]` ≠ scheduling; a routine run creates an agent-processed issue | HIGH | `RoutineRun.linkedIssueId` (routine.d.ts:141-158); 03-RESEARCH.md Pitfall 1 corroborates. |
| Direct `ctx.http.fetch` to Anthropic works but violates Decision #3 / guarantee #4 | HIGH | `PluginContext.http`/`.secrets` exist; CLAUDE.md "What NOT to Use" forbids the analogous governance-bypassing pattern. |
| Recommended restructure is a contained re-plan, not a rewrite | MEDIUM-HIGH | The adapter interface is preserved; only its production impl + ~3 manifest lines change. MEDIUM pending the live `sendMessage`-timing drill. |
| Exact host routine-run → agent-heartbeat handoff semantics | MEDIUM | Formal spec under-documents it; llm-wiki proves it works but Clarity Pack's recommendation does not depend on it. |

## Sources

### Primary (HIGH)
- `node_modules/.pnpm/@paperclipai+plugin-sdk@2026.512.0_*/…/dist/types.d.ts` — `PluginAgentsClient` (1110-1137), `PluginAgentSessionsClient` (1175-1195), `AgentSessionEvent` (1153-1162), `ToolRunContext`/`ToolResult` (98-120), `PluginToolsClient` (708-717), `PluginRoutinesClient` (634-652), `PluginContext` (1292-1340).
- `node_modules/.pnpm/@paperclipai+shared@2026.512.0/…/dist/types/plugin.d.ts` — `PluginJobDeclaration` (17-26), `PluginToolDeclaration` (49-58), `PluginManagedAgentDeclaration` (86-124), `PluginManagedRoutineDeclaration` (193-224).
- `node_modules/.pnpm/@paperclipai+shared@2026.512.0/…/dist/types/routine.d.ts` — `Routine` (33-58), `RoutineRun` (141-158).
- `github.com/paperclipai/paperclip` (master) `packages/plugins/plugin-llm-wiki/` — `src/manifest.ts` (full agent/tools/routines manifest), `src/wiki/core.ts` (`startWikiQuerySession` 3838-3982, `isTerminalSessionEvent` 3834, `registerWikiTools` 4061+).
- `doc/plugins/PLUGIN_AUTHORING_GUIDE.md` (master) — agent/session/routine authoring rules (lines 270-296).

### Local context
- `src/worker/agents/compile-tldr.ts` — Phase 2 `LlmAdapter` seam + the "SDK does not expose ctx.llm" architecture note (lines 17-29).
- `src/worker/bulletin/compile-pass-1.ts`, `src/worker/jobs/compile-bulletin.ts` — Phase 3 pipeline (the `ctx.llm` consumer + the `as unknown as` cast).
- `src/manifest.ts` — current `agents[]`/`jobs[]`/`capabilities`.
- `.planning/phases/03-daily-bulletin/03-RESEARCH.md` — jobs-vs-routines correction (Pitfall 1, Q-NEW).

**Research date:** 2026-05-15 — **Valid until:** ~2026-06-15 (SDK is date-versioned; re-verify on any `@paperclipai/plugin-sdk` bump).
