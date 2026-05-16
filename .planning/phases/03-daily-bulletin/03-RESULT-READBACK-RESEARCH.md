# Phase 3 Follow-up Spike — How a Plugin Worker Reads a Structured Artifact Back From a Managed Agent

**Researched:** 2026-05-16
**Domain:** `@paperclipai/plugin-sdk@2026.512.0` — the result-readback channel between a managed org-chart agent and a plugin worker
**Scope:** Targeted follow-up to `03-AGENT-INVOCATION-GAP-RESEARCH.md` (Plan 03-06). Plan 03-06's *task-delivery* (operation-issue handoff) WORKS — the Editor-Agent received the compile prompt and produced a flawless `BulletinDraft`. The *result-readback* does not: the agent put the JSON in an issue **document** + a prose **comment**; the worker polls comments for JSON and finds only prose. Pure output-channel mismatch.
**Confidence:** HIGH on the SDK API surface (read verbatim from the installed `.d.ts`). HIGH on the canonical pattern (llm-wiki manifest + prompts fetched from master). MEDIUM on the exact line-count of the recommended delta pending the Plan 03-07 drill.
**Builds on — do not repeat:** `03-AGENT-INVOCATION-GAP-RESEARCH.md` (task-delivery / Path d), `03-06-SUMMARY.md` (what was built).

---

## Problem Statement

Plan 03-06 closed the *invocation* gap: `compile-bulletin` now creates an off-board operation issue (`surfaceVisibility:'plugin_operation'`, `originKind: plugin:clarity-pack:operation:bulletin-compile`) assigned to the Editor-Agent via `deliverAgentTask` (`src/worker/agents/agent-task-delivery.ts`). The agent's heartbeat picks it up scoped, reads the compile prompt from the issue body, and produces the bulletin. **This works.** The 2026-05-16 Countermoves drill confirmed the agent generated a correct `BulletinDraft`.

The remaining defect is the *readback*. The drill showed the agent stored the `BulletinDraft` JSON as a Paperclip **issue document** (the issue UI showed a "Documents" section: `bulletin / rev 1 / Daily Bulletin — Cycle 1 (BulletinDraft)`) and posted a **prose summary** as the issue comment. `deliverAgentTask` step 4 polls `ctx.issues.listComments` for a comment whose body parses as JSON and passes `validateDraftSchema` — it sees only prose, never resolves, and times out after 5 minutes. Nothing publishes.

The headline question: **what is the correct, SDK-supported channel for a plugin worker to read a structured JSON artifact back from a managed agent, and what is the smallest contained fix?** Three candidates were on the table:

- **Option A** — tighten the Editor-Agent's manifest instructions so its deliverable is a *single comment whose entire body is the raw `BulletinDraft` JSON* (no document, no prose). Zero worker change.
- **Option B** — change `deliverAgentTask`'s readback to read the issue's **document** instead of / in addition to comments.
- **Option C** — the agent calls a declared plugin **tool** (`ctx.tools.register`) to hand the result back; the tool handler receives the structured params directly.

---

## Evidence Per Research Question

### Q1 — Does the SDK expose a plugin-worker API to READ an issue's documents?

**YES. Unambiguously.** This is a direct correction to the implicit assumption behind the drill defect — there *is* a document-read API, so Option B is *technically* viable (it was not killed by a missing API).

`@paperclipai/plugin-sdk@2026.512.0` `dist/types.d.ts:798-851` declares `PluginIssueDocumentsClient`, mounted at `ctx.issues.documents` (`types.d.ts:1097-1098`: `documents: PluginIssueDocumentsClient`). Exact signatures, read verbatim:

```ts
// types.d.ts:798-851 — PluginIssueDocumentsClient
list(issueId: string, companyId: string): Promise<IssueDocumentSummary[]>;
get(issueId: string, key: string, companyId: string): Promise<IssueDocument | null>;
upsert(input: { issueId: string; key: string; body: string; companyId: string;
                title?: string; format?: string; changeSummary?: string }): Promise<IssueDocument>;
delete(issueId: string, key: string, companyId: string): Promise<void>;
```

Capability strings (`types.d.ts:793-794`, `1006-1007`):
- `issue.documents.read` — for `list` and `get`
- `issue.documents.write` — for `upsert` and `delete`

**Both capabilities are ALREADY declared in `src/manifest.ts`** (lines 44-45: `'issue.documents.read'`, `'issue.documents.write'`). No manifest capability change is needed for Option B. The host capability whitelist confirms both are valid members of `PLUGIN_CAPABILITIES` (`@paperclipai/shared/dist/constants.d.ts:239`).

`IssueDocument` shape (`@paperclipai/shared/dist/types/issue.d.ts:51-69`):

```ts
export type DocumentFormat = "markdown";              // <-- ONLY "markdown"
export interface IssueDocumentSummary {
  id; companyId; issueId; key; title: string | null;
  format: DocumentFormat;                              // <-- typed to "markdown"
  latestRevisionId; latestRevisionNumber: number;      // <-- the "rev 1" the UI showed
  createdByAgentId: string | null; ...; createdAt; updatedAt;
}
export interface IssueDocument extends IssueDocumentSummary { body: string; }
```

**Conclusion Q1:** A plugin worker CAN read issue documents — `ctx.issues.documents.list(issueId, companyId)` then `ctx.issues.documents.get(issueId, key, companyId)`. Option B is not blocked by a missing API. **But note the `DocumentFormat = "markdown"` constraint** — see Q2; the document model is markdown-typed, so a raw-JSON document is a slightly off-label use of the surface.

### Q2 — What is a Paperclip issue "document"? Is it a work-product? Can `ctx.db.query` read it?

A **document** is a *versioned, keyed, markdown text artifact attached to an issue*. Each `upsert` with an existing key bumps `latestRevisionNumber` (`types.d.ts:821-826`: "If a document with the given key already exists, it is updated and a new revision is created") — that is the `rev 1` the drill UI showed. The full revision history is `DocumentRevision` (`issue.d.ts:70-84`). The canonical example keys are `"plan"`, `"design-spec"` (`types.d.ts:816`). It is the host's first-class artifact for issue-attached prose like plans and specs.

A document is **NOT the same as a work-product.** `IssueWorkProduct` (`@paperclipai/shared/dist/types/work-product.d.ts:1-26`) is a distinct entity: `type` ∈ `"preview_url" | "runtime_service" | "pull_request" | "branch" | "commit" | "artifact" | "document"`, `provider` ∈ `paperclip|github|vercel|s3|custom`, with `url`, `reviewState`, `healthStatus`. Work-products are pointers to *external* deliverables (a deployed preview, a GitHub PR, an S3 artifact). Confusingly, `"document"` is *one of* the work-product `type` values — so a work-product can *reference* a document — but the issue-attached versioned text artifact itself is the `IssueDocument` entity, surfaced under `ctx.issues.documents`. **There is NO `ctx.issues.workProducts` client in SDK 2026.512.0** — `IssueWorkProduct[]` appears only as an optional `workProducts?` field on the hydrated `Issue` type (`issue.d.ts:313`), not as a standalone read client. So the only worker-reachable handle on the agent's stored artifact is `ctx.issues.documents`.

**Can `ctx.db.query` read it?** `ctx.db` is `PluginDatabaseClient` (`types.d.ts:369-378`): `query<T>(sql, params)` is documented as "a restricted SELECT against the plugin namespace **and whitelisted core tables**." The whitelist is `PLUGIN_DATABASE_CORE_READ_TABLES` (`@paperclipai/shared/dist/constants.d.ts:247`):

```
"companies", "projects", "goals", "agents", "issues",
"issue_documents", "issue_relations", "issue_comments",
"heartbeat_runs", "cost_events", "approvals", "issue_approvals", "budget_incidents"
```

**`issue_documents` IS on the whitelist** — and it is ALREADY listed in `src/manifest.ts` `database.coreReadTables` (line 105). So `ctx.db.query('SELECT ... FROM issue_documents WHERE issue_id = $1', [...])` is *permitted*. **However:** the typed `ctx.issues.documents` client is the cleaner, host-blessed path — it is purpose-built, returns hydrated `IssueDocument`, and does not require the plugin to know the host's column names or `document_revisions` join shape (`document_revisions` is NOT whitelisted, so a raw query could only see `issue_documents`, not necessarily the latest body — risky). **For Option B, use `ctx.issues.documents.get`, never raw SQL.**

### Q3 — Is there a comment-body size limit that threatens Option A?

**No size limit is declared anywhere in the installed SDK types.** A full grep of `types.d.ts` for `maxLength|MAX_|sizeLimit|byte|length|truncate` returns exactly one hit — `truncated: boolean` on an unrelated activity/log type (`types.d.ts:272`). `IssueComment` (`@paperclipai/shared/dist/types/issue.d.ts:322-339`) has `body: string` with no length annotation. `createComment(issueId, body: string, companyId, options?)` (`types.d.ts:1076-1078`) declares no limit. The host's `issue_comments` table is a standard Postgres `text` column (no length cap in the schema the SDK surfaces).

The `BulletinDraft` JSON is ~3 KB. There is no evidence of a 3 KB-threatening limit. **Option A is not blocked by a size limit.** (Caveat — MEDIUM confidence on the negative: "no limit in the SDK type surface" is verified; a host-side validation cap not reflected in the public types cannot be 100% ruled out. But a 3 KB comment is trivially within any plausible cap — agents post far longer comments routinely — so this is not a real risk for Option A.)

### Q4 — How does the canonical `plugin-llm-wiki` example get a structured artifact back from its agent?

**Decisive finding: llm-wiki uses Option C — plugin TOOLS — not comments and not documents.**

`plugin-llm-wiki/src/manifest.ts` (fetched from `master`, 2026-05-16) declares a **`tools[]` array with 10 `PluginToolDeclaration` entries**:

```
wiki_search, wiki_read_page, wiki_write_page, wiki_propose_patch,
wiki_list_sources, wiki_read_source, wiki_append_log,
wiki_update_index, wiki_list_backlinks, wiki_list_pages
```

and its capabilities array includes **`agent.tools.register`** (alongside `issue.documents.read/write` and `issue.comments.read/create` — it has *all* the channels, but uses tools for the structured handoff).

`plugin-llm-wiki/src/templates.ts` — the operation prompts (`QUERY_PROMPT`, `LINT_PROMPT`) — instruct the agent, verbatim, to deliver results **by calling the plugin's tools**:

> "Useful durable synthesis should be filed back into `wiki/synthesis/` inside that same space. **Always pass the operation issue's `wikiId` and `spaceSlug` to LLM Wiki tools.**"

The prompts **never** tell the agent to post a comment or write an issue document as the result channel. The structured result flows: agent runs the operation issue → agent calls e.g. `wiki_write_page` with structured params → the plugin's registered tool handler (`ctx.tools.register('wiki_write_page', decl, fn)`, `types.d.ts:708-717`) receives those params *directly as a typed object* and persists them. The plugin never has to *parse a comment* or *poll a document* — the agent hands the worker a structured payload through the tool-call boundary.

The `ctx.tools.register` handler signature (`types.d.ts:716`):

```ts
register(name, declaration, fn: (params: unknown, runCtx: ToolRunContext) => Promise<ToolResult>): void;
// ToolRunContext = { agentId, runId, companyId, projectId }   (types.d.ts:98-107)
// ToolResult     = { content?: string; data?: unknown; error?: string }  (types.d.ts:113-119)
```

The agent invokes the tool *during its run*; the handler runs *synchronously inside the worker* with the structured `params`; there is no poll, no timeout, no JSON-from-prose extraction.

**This is the canonical answer and it weighs heavily.** llm-wiki is Paperclip's own first-party LLM-driving plugin. It uses operation-issues for *task delivery* (which 03-06 already correctly adopted) AND plugin tools for *result handoff*. The 03-06 design adopted only half the canonical pattern.

### Q5 — Why the agent did what it did (and why neither A nor B is the canonical fix)

The drill behaviour is fully explained. The Editor-Agent is a `claude_local` adapter agent running Paperclip's standard org-chart heartbeat. When an agent "produces a deliverable" on an assigned issue, the host-trained default behaviour is to **file the substantive artifact as an issue document** (the first-class versioned artifact — exactly what the UI showed: `bulletin / rev 1`) and **post a human-readable progress comment**. The agent did the *idiomatic Paperclip thing*. Our worker's readback contract — "the result is a comment whose whole body is raw JSON" — fights the platform's grain. 03-06's instruction rewrite *asked* for raw-JSON-as-comment, but a competent agent's document-filing instinct overrode it, because filing a named artifact as a document is what Paperclip agents are built to do.

That is why Option A is fragile: it depends on *every future run* of an LLM agent suppressing its strongest idiomatic instinct on the strength of a prompt line. And Option B, while it works, asks the worker to *scrape* an artifact the agent filed for human consumption — there is no contract that the document `key` is stable, that `format` is JSON (it is typed `"markdown"`), or that the agent will not also revise it. Both A and B are *parsing a side-effect*. Option C is *receiving a return value*.

---

## A / B / C Recommendation

### Recommendation: **Option C — the agent delivers the `BulletinDraft` by calling a declared plugin tool.** With **Option A retained as a belt-and-suspenders fallback inside the same readback.**

This is the canonical `plugin-llm-wiki` pattern, it eliminates the parse-a-side-effect fragility of both A and B, and — critically — it makes the result handoff a *typed boundary* instead of a *polling race*. The earlier `03-AGENT-INVOCATION-GAP-RESEARCH.md` deferred tools ("Path c — rejected for v1") on the reasoning that *task delivery* still needed an issue. That reasoning was correct **for task delivery** — and 03-06 correctly built the operation-issue delivery. But that doc conflated *delivery* with *readback*. Tools were rejected as a *delivery* mechanism; they are the canonical *readback* mechanism, and 03-06 is now built such that adding them is small.

**Why not A alone:** A fights the platform grain (Q5). It is one prompt line away from silent breakage on any agent/adapter/model change, with no type-level or test-level guard. It already failed once on a live drill.

**Why not B alone:** B works (Q1 confirms the API), but it scrapes an artifact filed for humans: no stable-`key` contract, `format` typed `"markdown"` not JSON, the agent may revise the document mid-read, and the worker must guess which `key` the agent chose. It trades a comment-poll race for a document-poll race.

**Why C:** the agent *returns* the draft. The tool handler receives `params` as a structured object inside the worker — `JSON.parse` of a comment body is replaced by *the agent already having handed you the object*. No poll, no 5-minute timeout, no `extractJsonObject` fence-peeling on the result path. It is governance-faithful (the tool call happens inside the normal audited agent run — Decision #3 / coexistence guarantee #4 fully preserved) and it is exactly what the first-party reference plugin does.

### The verified-numerics contract is preserved either way

Whichever channel carries the bytes, the worker still: (1) computes `factsTable` / `standingNumbers`, (2) passes them into the operation-issue prompt as DATA with `{{NUMBER:key}}` placeholders, (3) re-runs `verifyDraft` (pass-2) on the returned draft, re-executing every SQL. Option C changes *only* how the draft bytes arrive — from "scraped out of a comment" to "passed as a tool parameter". `buildPrompt`, `computeStandingNumbers`, `computeFactsTable`, `validateDraftSchema`, `verifyDraft`, `publishBulletin` and all their tests are structurally untouched.

---

## Concrete Build Delta (for the Plan 03-07 planner)

The 03-06 architecture is proven and the delta is contained. Net: one manifest `tools[]` entry + one capability, one `ctx.tools.register` handler, a small change to `deliverAgentTask`'s readback, and an instruction rewrite.

**1. Manifest — declare the result-delivery tool (`src/manifest.ts`).**
   - Add `capabilities: [... 'agent.tools.register']` (valid `PLUGIN_CAPABILITIES` member, `constants.d.ts:239`).
   - Add a `tools: [...]` array (manifest field `tools?: PluginToolDeclaration[]`, `plugin.d.ts:464`) with one entry, e.g.:
     ```ts
     {
       name: 'submit-compile-result',
       displayName: 'Submit Clarity Pack compile result',
       description: 'Deliver the completed BulletinDraft or TL;DR for the current ' +
         'clarity-pack operation issue. Call this exactly once when the operation ' +
         'is complete, passing the operation issue id and the result payload.',
       parametersSchema: { type: 'object', required: ['operationIssueId', 'result'],
         properties: {
           operationIssueId: { type: 'string' },
           result: { type: 'string', description: 'Raw BulletinDraft JSON object, ' +
             'or the raw TL;DR text — no prose, no markdown fences.' },
         } },
     }
     ```
   - `agents[].permissions` may need a `pluginTools` allow-entry — confirm against the host on the drill (the kitchen-sink / llm-wiki agent permissions block is the reference; `PluginManagedAgentDeclaration.permissions` is `Record<string, unknown>`, host-normalized — `plugin.d.ts:111-112`).

**2. Tool handler (`src/worker.ts` or a new `src/worker/agents/compile-result-tool.ts`).**
   - `ctx.tools.register('submit-compile-result', decl, async (params, runCtx) => { ... })`.
   - The handler validates `params.operationIssueId` + `params.result`, then **resolves the pending `deliverAgentTask` call** for that operation issue. Mechanism: `deliverAgentTask` keeps an in-process `Map<operationIssueId, {resolve, reject}>` of in-flight deliveries; the tool handler looks up the entry and calls `resolve(params.result)`. The handler returns `ToolResult { content: 'received' }`.
   - The handler is the *single writer* of the result — no poll, no race.

**3. `deliverAgentTask` readback (`src/worker/agents/agent-task-delivery.ts`).**
   - Replace the comment-poll loop (steps 4-5) with: register a pending-promise in the shared `Map` keyed by `issue.id` *before* `requestWakeup`, then `await` that promise against the existing `AGENT_TASK_DELIVERY_TIMEOUT` (a `Promise.race` with a timeout).
   - **Belt-and-suspenders (folds in Option A + B):** keep a *low-frequency* fallback poll alongside the tool path — if no tool call arrives, scan (a) comments via `listComments` for a schema-valid JSON body (today's logic, the Option A path) and (b) `ctx.issues.documents.list` + `.get` for a document whose body parses + validates (the Option B path). The first of {tool-call, comment, document} to yield a schema-valid draft wins. This makes the readback robust to an agent that ignores the tool — but the tool is the *designed* path and will be the normal case. Keep the fallback poll cadence slow (e.g. 15 s) since it is now a safety net, not the primary.
   - `isResultComment` / the schema gate logic is reused unchanged for the fallback scans.

**4. Editor-Agent instructions (`src/manifest.ts` `agents[].instructions.content`).**
   - Rewrite the delivery clause: "When the operation is complete, call the `submit-compile-result` tool with the operation issue's id and the result payload. Do NOT post the result as a comment and do NOT file it as a document — the `submit-compile-result` tool is the only delivery channel." Keep the `originKind`-dispatch, the `{{NUMBER:key}}` rule, and the "Insufficient context" graceful-skip (which can also be delivered by calling the tool with a sentinel, or by an `error` field).
   - Mirror the llm-wiki prompt style — its prompts are entirely tool-directed.

**5. No change** to numerics, `verifyDraft`, `publishBulletin`, schema validation, the circuit-breaker, or the operation-issue *creation* path (steps 1-3 of `deliverAgentTask` — idempotency search, `create`, `requestWakeup` — are unchanged; only the *readback* steps 4-5 change).

**Net delta:** one `tools[]` manifest entry, one capability string (`agent.tools.register`), one `ctx.tools.register` handler (~30-40 lines), a readback rewrite inside one function (promise-registry + a slow fallback poll that *reuses* existing comment logic and *adds* a document scan), and one instruction-clause rewrite. Estimated MEDIUM-HIGH confidence at ~120-180 LOC net, pending the Plan 03-07 drill confirming the `agents[].permissions.pluginTools` shape and that a `claude_local` agent reliably calls a declared plugin tool when instructed.

---

## Open Questions for the Planner

1. **`agents[].permissions` shape for plugin tools.** `PluginManagedAgentDeclaration.permissions` is `Record<string, unknown>` (host-normalized). The exact key that grants a managed agent access to a plugin-declared tool is not in the public types. Resolution: copy the llm-wiki agent's `permissions` block verbatim from `plugin-llm-wiki/src/manifest.ts` `agents[]`, and verify on the 03-07 drill that the Editor-Agent's tool list includes `clarity-pack:submit-compile-result`.
2. **Does a `claude_local` agent reliably call a declared plugin tool?** llm-wiki proves the pattern works for *its* adapter setup; confirm on the Countermoves drill that the Editor-Agent, given the rewritten instructions, calls `submit-compile-result` rather than reverting to document-filing. If it does not, the slow fallback poll (step 3 belt-and-suspenders) catches it — so the fix degrades gracefully — but the drill should confirm the tool is the *normal* path.
3. **Same fix for the TL;DR path.** `compileTldr` / `editor.ts` ride the same `deliverAgentTask`. The `submit-compile-result` tool already carries an `operationKind` distinction via the operation issue; one tool serves both `bulletin-compile` and `tldr-compile`. Confirm in 03-07.
4. **Timeout semantics.** With the tool path, resolution is near-immediate once the agent calls the tool; the `AGENT_TASK_DELIVERY_TIMEOUT` becomes a guard against the agent never calling the tool at all (then the fallback poll runs out and `recordCompileFailure` fires — same failure routing as today).

---

## Confidence Summary

| Claim | Confidence | Source |
|---|---|---|
| `ctx.issues.documents` exists; `list` / `get` read issue documents | HIGH | `@paperclipai/plugin-sdk@2026.512.0` `dist/types.d.ts:798-851`, `1097-1098` — read verbatim from installed SDK |
| Document-read needs `issue.documents.read`; already in manifest | HIGH | `types.d.ts:793-794`; `src/manifest.ts:44` |
| `DocumentFormat` is typed `"markdown"` only — JSON-in-document is off-label | HIGH | `@paperclipai/shared/dist/types/issue.d.ts:50` |
| A document is versioned (`latestRevisionNumber`) — the drill's "rev 1" | HIGH | `issue.d.ts:51-84` (`IssueDocumentSummary`, `DocumentRevision`) |
| Documents ≠ work-products; no `ctx.issues.workProducts` client exists | HIGH | `work-product.d.ts:1-26`; `IssueWorkProduct` appears only as `Issue.workProducts?` field (`issue.d.ts:313`), no read client in `types.d.ts` |
| `issue_documents` is in `PLUGIN_DATABASE_CORE_READ_TABLES` — `ctx.db.query` *can* SELECT it | HIGH | `@paperclipai/shared/dist/constants.d.ts:247`; manifest `coreReadTables` line 105 |
| Typed `ctx.issues.documents.get` is preferred over raw SQL (`document_revisions` not whitelisted) | HIGH | `constants.d.ts:247` (no `document_revisions`); `types.d.ts:373` |
| No comment-body size limit declared in the SDK type surface | HIGH (negative) | Full grep of `types.d.ts` — only `truncated:boolean` on an unrelated type; `IssueComment.body:string` / `createComment` unannotated |
| A 3 KB JSON comment is safely within any plausible host cap | MEDIUM (negative) | No SDK-declared cap; host-side cap not reflected in public types cannot be 100% ruled out, but 3 KB is trivial |
| `plugin-llm-wiki` declares a 10-entry `tools[]` array + `agent.tools.register` | HIGH | `plugin-llm-wiki/src/manifest.ts` fetched from `master` 2026-05-16 |
| llm-wiki's operation prompts direct the agent to deliver results by **calling plugin tools**, not comments/documents | HIGH | `plugin-llm-wiki/src/templates.ts` (`QUERY_PROMPT`, `LINT_PROMPT`) fetched from `master` |
| `ctx.tools.register(name, decl, fn)` receives structured `params` + `ToolRunContext` | HIGH | `types.d.ts:708-717`, `98-119`, `1338` |
| Manifest supports `tools?: PluginToolDeclaration[]` | HIGH | `@paperclipai/shared/dist/types/plugin.d.ts:464`, `49-58` |
| Option C preserves verified-numerics + governance parity | HIGH | Channel-only change; `verifyDraft` / numerics untouched; tool call is inside the audited agent run |
| Recommended delta ~120-180 LOC net | MEDIUM-HIGH | Readback layer is well-isolated; MEDIUM pending the `permissions.pluginTools` shape + Countermoves drill |
| `agents[].permissions` key for plugin-tool access | LOW | `PluginManagedAgentDeclaration.permissions` is `Record<string,unknown>`, host-normalized — not in public types; resolve by copying llm-wiki's agent block + drill |

## Sources

### Primary (HIGH — read verbatim from installed packages)
- `@paperclipai/plugin-sdk@2026.512.0` `dist/types.d.ts` — `PluginIssueDocumentsClient` (798-851), `ctx.issues.documents` (1097-1098), `PluginToolsClient` / `ctx.tools.register` (700-717, 1338), `ToolRunContext` / `ToolResult` (98-119), `PluginIssuesClient` (1009-1102), `PluginDatabaseClient` (369-378).
- `@paperclipai/shared@2026.512.0` `dist/types/issue.d.ts` — `IssueDocument` / `IssueDocumentSummary` / `DocumentRevision` / `DocumentFormat` (50-84), `IssueComment` (322-339), `Issue.workProducts?` (313).
- `@paperclipai/shared@2026.512.0` `dist/types/work-product.d.ts` — `IssueWorkProduct` (1-26).
- `@paperclipai/shared@2026.512.0` `dist/constants.d.ts` — `PLUGIN_CAPABILITIES` (239), `PLUGIN_DATABASE_CORE_READ_TABLES` (247).
- `@paperclipai/shared@2026.512.0` `dist/types/plugin.d.ts` — `PluginToolDeclaration` (49-58), manifest `tools?` field (464), `PluginManagedAgentDeclaration.permissions` (111-112).
- `github.com/paperclipai/paperclip` (master) `packages/plugins/plugin-llm-wiki/src/manifest.ts` — `tools[]` 10-entry array, `agent.tools.register` capability — fetched 2026-05-16.
- `github.com/paperclipai/paperclip` (master) `packages/plugins/plugin-llm-wiki/src/templates.ts` — `QUERY_PROMPT` / `LINT_PROMPT`, tool-directed result delivery — fetched 2026-05-16.

### Local context
- `.planning/phases/03-daily-bulletin/03-AGENT-INVOCATION-GAP-RESEARCH.md` — task-delivery / Path (d); deferred tools as a *delivery* mechanism.
- `.planning/phases/03-daily-bulletin/03-06-SUMMARY.md` + `src/worker/agents/agent-task-delivery.ts` — the built readback (the comment-poll Option B would replace, the tool path Option C supersedes).
- `src/manifest.ts` — Editor-Agent instructions + capabilities (`issue.documents.read/write` already present; `agent.tools.register` and `tools[]` to be added).

**Research date:** 2026-05-16 — **Valid until:** re-verify on any `@paperclipai/plugin-sdk` host bump (date-versioned) or if the `plugin-llm-wiki` tool pattern changes upstream.
