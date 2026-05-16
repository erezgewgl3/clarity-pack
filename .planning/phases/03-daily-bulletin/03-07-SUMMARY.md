---
phase: 3
plan: 03-07
subsystem: worker
tags: [llm-pipeline, result-readback, plugin-tools, gap-closure, bulletin, tldr, editor-agent, circuit-breaker]
status: AWAITING-CHECKPOINT

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "agent-task-delivery.ts deliverAgentTask scoped-issue handoff (03-06, PROVEN on the 2026-05-16 re-drill); circuit-breaker.ts isCircuitOpenDurable; both compile paths route LLM work through deliveryLlmAdapter."
provides:
  - "compile-result-tool.ts — registerCompileResultTool(ctx) registers the submit-compile-result plugin tool via ctx.tools.register; the handler resolves the matching in-flight deliverAgentTask promise via the shared PENDING_DELIVERIES Map. The canonical plugin-llm-wiki result-readback channel (Option C)."
  - "agent-task-delivery.ts — readback steps 4-5 rewritten: deliverAgentTask registers a {resolve,reject} entry in PENDING_DELIVERIES keyed by issue.id before the readback race, then Promise.race's it against the timeout and a slow ~15s comment+document fallback poll. Operation-issue CREATION path (steps 1-3) byte-identical to 03-06."
  - "manifest — agent.tools.register capability + a one-entry tools[] declaring submit-compile-result; Editor-Agent agents[].permissions { pluginTools: ['clarity-pack'] }; agents[].instructions rewritten tool-directed; version 0.2.0 -> 0.3.0."
  - "circuit-breaker.ts — version-scoped durable breaker: recordFailure stamps CLARITY_PACK_VERSION (sourced from manifest.version) on each editor_agent_failures row; isCircuitOpenDurable counts only current-version rows."
  - "migration 0005_breaker_version_scope.sql — additive: nullable plugin_version text column on editor_agent_failures."
affects: []

tech-stack:
  added: []
  patterns:
    - "Typed tool-boundary result-readback (Option C) — the canonical plugin-llm-wiki pattern: a managed agent delivers its result by calling a declared plugin tool; the tool handler resolves an in-flight promise via a shared in-process Map keyed by operation-issue id. Replaces the 03-06 comment-poll race."
    - "Version-scoped durable circuit breaker — failure rows carry the recording plugin version; the durable predicate filters to the current version so a fresh install is not DOA on stale pre-fix failure history."

key-files:
  created:
    - "src/worker/agents/compile-result-tool.ts"
    - "test/worker/agents/compile-result-tool.test.mjs"
    - "migrations/0005_breaker_version_scope.sql"
  modified:
    - "src/worker/agents/agent-task-delivery.ts"
    - "src/worker/agents/circuit-breaker.ts"
    - "src/worker.ts"
    - "src/manifest.ts"
    - "package.json"
    - "test/helpers/host-faithful-ctx.mjs"
    - "test/worker/agents/agent-task-delivery.test.mjs"
    - "test/worker/agents/circuit-breaker-durable.test.mjs"
    - "test/worker/circuit-breaker.test.mjs"

decisions:
  - "CLARITY_PACK_VERSION is sourced from manifest.version via an import (not a hard-coded literal) — the durable-breaker version scope tracks a manifest version bump automatically with no second source of truth. The manifest import bundled into the worker cleanly (esbuild, no warning), so the plan's manifest-import-preferred form was used."
  - "PluginIssueDocumentsClient is not re-exported from the SDK index barrel — only PluginIssuesClient is. The type is reached via PluginIssuesClient['documents'] (which is typed PluginIssueDocumentsClient) rather than a separate import."
  - "agents[].permissions copied from plugin-llm-wiki is { pluginTools: [PLUGIN_ID] } — grants the managed agent ALL the plugin's declared tools by plugin id, not per-tool-name. For Clarity Pack: { pluginTools: ['clarity-pack'] }."
  - "package.json version was bumped 0.1.0-smoke -> 0.3.0 (Rule-3 blocking fix) so npm pack produces the clarity-pack-0.3.0.tgz the Task-5 drill expects — the npm pack filename derives from package.json, not the manifest."

metrics:
  duration: "~50 min"
  tasks_completed: 4
  tasks_total: 5
  completed_date: "2026-05-16"
  suite: "676 -> 696 (+20; 694 pass / 0 fail / 2 skip)"
  commits: "c1f4145..91772fc (4 commits)"
---

# Phase 3 Plan 03-07: Result-Readback Channel (Option C) + Durable-Breaker Stale-History Fix Summary

Closes the contained output-channel gap the 2026-05-16 Countermoves re-drill found by replacing the comment-poll readback with a typed plugin-tool boundary (`submit-compile-result`, the canonical `plugin-llm-wiki` pattern), and version-scopes the durable circuit breaker so a fresh install is no longer DOA on stale failure history.

## What Was Built

Plan 03-06's scoped-issue task-delivery architecture was PROVEN on the 2026-05-16 re-drill (the Editor-Agent ran scoped to the operation issue, `PAPERCLIP_TASK_ID` confirmed, and produced a flawless `BulletinDraft`). The only remaining defect was the result channel: the agent filed the JSON as an issue *document* and posted prose as the comment, while `deliverAgentTask` polled `listComments` for a JSON comment — so nothing published. This plan does NOT re-open that architecture; it rewrites only the readback (steps 4-5).

**Task 1 — RED** (`c1f4145`). Three failing suites:
- `compile-result-tool.test.mjs` (NEW) — Tests 1-5 for `registerCompileResultTool` / `PENDING_DELIVERIES` / `SUBMIT_COMPILE_RESULT_TOOL`.
- `agent-task-delivery.test.mjs` (EXTENDED) — Tests A-D: the tool-channel resolve, the comment fallback poll, the document fallback scan, and the timeout `PENDING_DELIVERIES` cleanup.
- `circuit-breaker-durable.test.mjs` (EXTENDED) — Tests E-G: `recordFailure` stamps the version, `isCircuitOpenDurable` filters by it, and a fresh install (only pre-fix NULL rows, filtered out) reads as a closed circuit.

**Task 2 — GREEN** (`2e48770`).
- `compile-result-tool.ts` (NEW) — `registerCompileResultTool(ctx)` calls `ctx.tools.register('submit-compile-result', SUBMIT_COMPILE_RESULT_TOOL, handler)`. The handler validates `{operationIssueId, result}`, looks up `PENDING_DELIVERIES` by `operationIssueId`, calls `resolve(result)`, returns `{content:'received'}`. Bad params / a missing pending entry return a `ToolResult.error` (never throw).
- `agent-task-delivery.ts` — readback steps 4-5 rewritten: register a `{resolve,reject}` entry in `PENDING_DELIVERIES` keyed by `issue.id` before the readback race; `Promise.race` the pending promise against the `timeoutMs` deadline and a slow (~15s) fallback poll that scans BOTH `listComments` (Option A) AND `documents.list` + `.get` (Option B); a `finally` deletes the Map entry and clears the timer/fallback. Steps 1-3 (idempotency / create / wakeup) byte-identical to 03-06.
- `circuit-breaker.ts` — `CLARITY_PACK_VERSION` exported (sourced from `manifest.version`); `recordFailure` extends its INSERT with `plugin_version`; `isCircuitOpenDurable` adds `WHERE plugin_version = $N`.
- `migrations/0005_breaker_version_scope.sql` (NEW) — additive `ADD COLUMN IF NOT EXISTS plugin_version`; no `CREATE INDEX`, no apostrophe-in-comment.
- `worker.ts` — `registerCompileResultTool` wired into `setup()` before the compile-bulletin job.

**Task 3 — Manifest** (`1684a8f`).
- `capabilities[]` + `agent.tools.register`.
- `tools[]` — one entry declaring `submit-compile-result`, structurally identical to `SUBMIT_COMPILE_RESULT_TOOL` (locked by a contract test).
- `agents[0].permissions` — `{ pluginTools: ['clarity-pack'] }`, copied from `plugin-llm-wiki`'s `agents[]` block (fetched verbatim from `master`).
- `agents[0].instructions` — delivery clause rewritten tool-directed (call `submit-compile-result`; no comment, no document).
- `version` 0.2.0 -> 0.3.0.

**Task 4 — Host-faithful e2e + rebuild/pack** (`91772fc`).
- `host-faithful-ctx.mjs` — added a `ctx.tools.register` fake (captures handlers), a `ctx.issues.documents` fake (`list`/`get`, default empty), and a `callTool(name, params, runCtx)` helper that simulates the agent invoking a registered tool.
- `agent-task-delivery.test.mjs` — one e2e test proving `deliverAgentTask` resolves end-to-end via the `submit-compile-result` tool channel with no comment / document posted.
- Rebuilt worker (179.1 KB), UI (105.1 KB), manifest — all clean.
- `npm pack` → `clarity-pack-0.3.0.tgz`, sha256 `785441b4f556e131e1486f0c7ba3bdc9591065fc0f50c16b2786e3b139f1c3e8`.

**Task 5** — the blocking `checkpoint:human-verify` Countermoves closure re-drill. NOT executed — this is Eric's action. Stopped here.

## SDK Pre-flight (Task 2 mandate — research Open Question 1)

Confirmed against the installed `@paperclipai/plugin-sdk@2026.512.0`:
- `ctx.tools` is `PluginToolsClient` (types.d.ts:1337-1338); `register(name, declaration, fn)` exists (types.d.ts:708-716), `declaration` is `Pick<PluginToolDeclaration,'displayName'|'description'|'parametersSchema'>`, the handler is `(params: unknown, runCtx: ToolRunContext) => Promise<ToolResult>`.
- `ToolResult` = `{ content?: string; data?: unknown; error?: string }`.
- `ctx.issues.documents` is `PluginIssueDocumentsClient` (types.d.ts:1098) with `list`/`get`.

Option C is implementable as designed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test/worker/circuit-breaker.test.mjs` asserted the pre-fix 3-param INSERT shape**
- **Found during:** Task 2 (full-suite verify)
- **Issue:** The pre-existing test `recordFailure appends to editor_agent_failures …` asserted `dbCalls[0].params` deepEquals a 3-element array. The version-stamped INSERT now carries 4 params (`plugin_version` added).
- **Fix:** Updated the assertion to check the first three params unchanged + a 4th string param + the SQL mentions `plugin_version`.
- **Files modified:** `test/worker/circuit-breaker.test.mjs`
- **Commit:** `2e48770`

**2. [Rule 3 - Blocking] `package.json` version was `0.1.0-smoke` — `npm pack` produced the wrong tarball name**
- **Found during:** Task 4 (`npm pack`)
- **Issue:** `npm pack` derives the tarball filename from `package.json` `version`, not the manifest. The plan's Task-4 acceptance criterion requires `clarity-pack-0.3.0.tgz`.
- **Fix:** Bumped `package.json` `version` 0.1.0-smoke -> 0.3.0.
- **Files modified:** `package.json`
- **Commit:** `91772fc`

### Plan-text adaptations (within escape-hatch scope)

**3. `PluginIssueDocumentsClient` import** — the plan said `import PluginIssueDocumentsClient from the SDK`. It is NOT re-exported from the SDK index barrel (only the interface lives in `types.d.ts`; the barrel re-exports `PluginIssuesClient` but not the documents client). Resolved by deriving the type as `PluginIssuesClient['documents']` — the `documents` member is typed `PluginIssueDocumentsClient`, so this is exact and needs no separate import. Typecheck clean.

**4. Manifest contract tests placement** — the RED commit (`c1f4145`) initially included the manifest contract tests in `compile-result-tool.test.mjs`, but the plan assigns them to Task 3 (the manifest changes land there). They were moved out for the GREEN commit and re-added in Task 3, so the suite stayed green at every commit boundary.

## Open Questions Carried to the Task-5 Drill

- **Open Question 1 (LOW confidence) — does the `permissions: { pluginTools: ['clarity-pack'] }` block actually grant the managed Editor-Agent the `submit-compile-result` tool on its tool surface?** Copied verbatim from `plugin-llm-wiki`. The Task-5 drill MUST confirm `clarity-pack:submit-compile-result` appears on the agent's tool list. A miss is NOT a hard STOP — the slow comment+document fallback poll still catches a filed result.
- **Open Question 2 — does a `claude_local` managed agent reliably CALL a declared plugin tool given tool-directed instructions?** `plugin-llm-wiki` proves the pattern for its adapter; the drill confirms it for the Editor-Agent. The drill records which channel won (tool / comment-fallback / document-fallback).

## Anti-Pattern Honored

Per the phase `.continue-here.md`: the host-faithful fakes model host CONSTRAINTS (the `ctx.tools` / `issues.documents` API shapes), NOT agent BEHAVIOUR. A green local suite does NOT prove the real Editor-Agent calls `submit-compile-result` rather than reverting to document-filing. **Phase 3 is NOT claimed closed and the readback channel is NOT claimed proven** — Task 5's live Countermoves drill is the only proof, and it is the user's job.

## Verification

- Full suite: `node --test "test/**/*.test.mjs"` — 696 tests, 694 pass, 0 fail, 2 skip (baseline 676).
- `npx tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` (179.1 KB), `node scripts/build-ui.mjs` (105.1 KB), `npx tsc --project tsconfig.manifest.json` — all clean.
- `npm pack` → `clarity-pack-0.3.0.tgz`, sha256 `785441b4f556e131e1486f0c7ba3bdc9591065fc0f50c16b2786e3b139f1c3e8`.

## Commits

- `c1f4145` — test(03-07): RED — submit-compile-result tool + promise-registry readback + version-scoped breaker
- `2e48770` — feat(03-07): GREEN — submit-compile-result tool + promise-registry readback + version-scoped breaker
- `1684a8f` — feat(03-07): submit-compile-result tool manifest declaration + tool-directed Editor-Agent instructions
- `91772fc` — test(03-07): host-faithful tool-channel e2e + rebuild for the closure drill

## Self-Check: PASSED

All created files exist on disk; all four task commits (c1f4145, 2e48770, 1684a8f, 91772fc) are present in git history.
