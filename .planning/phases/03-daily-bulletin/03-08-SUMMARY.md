---
phase: 03-daily-bulletin
plan: 08
subsystem: api
tags: [paperclip-plugin, agent-task-delivery, issue-documents, llm-adapter, circuit-breaker]

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "Plan 03-06 scoped-issue task-delivery (deliverAgentTask steps 1-3 — operation-issue create + requestWakeup + idempotency search); Plan 03-02 verified-numerics compile pipeline (verifyDraft pass-2, publishBulletin)"
provides:
  - "deliverAgentTask readback rewritten to Option B — a PRIMARY ctx.issues.documents.get(operationIssueId, 'compile-result', companyId) poll at 5s, with an off-key documents.list scan and a legacy comment scan as fallbacks"
  - "RESULT_DOCUMENT_KEY ('compile-result') + RESULT_DELIVERY_INSTRUCTION — the agent-facing document-delivery contract, carried in the operation-issue DESCRIPTION (the channel that propagates to a live managed agent)"
  - "the dead Option C surface removed — compile-result-tool.ts deleted, manifest tools[]/agent.tools.register/permissions.pluginTools stripped, worker.ts wiring removed"
  - "version 0.3.0 -> 0.4.0 (re-scopes the durable circuit breaker past the 3 stale plugin_version='0.3.0' failure rows)"
  - "clarity-pack-0.4.0.tgz — the build for Eric's Countermoves closure re-drill"
affects: [04-employee-chat, phase-3-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Issue-document readback: a plugin worker reads a managed agent's structured result back via ctx.issues.documents.get at a contract key, not a tool call and not a comment poll"
    - "Agent-instruction delivery via operation-issue DESCRIPTION — the static manifest agents[].instructions.content does NOT propagate to an already-existing managed agent; per-operation instructions must ride the freshly-created operation issue"

key-files:
  created: []
  modified:
    - "src/worker/agents/agent-task-delivery.ts — readback steps 4-5 rewritten to the Option B document poll"
    - "src/manifest.ts — Option C stripped (tools[], agent.tools.register, permissions); instructions rewritten; version 0.4.0"
    - "src/worker.ts — registerCompileResultTool import + setup() call removed"
    - "package.json — version 0.4.0"
    - "test/worker/agents/agent-task-delivery.test.mjs — readback tests re-pointed at the document-poll-primary path + 2 host-faithful e2e tests"
    - "test/helpers/host-faithful-ctx.mjs — resultDocuments fixture added; dead tools.register fake/callTool removed"
  deleted:
    - "src/worker/agents/compile-result-tool.ts — the dead Option C tool module"
    - "test/worker/agents/compile-result-tool.test.mjs — its test file"

key-decisions:
  - "Option B over Option C: a claude_local managed agent's session never receives a plugin-declared tool (live-disproven on the 2026-05-16 drill) — the worker reads the agent's issue document keyed compile-result, the agent's proven observed behaviour"
  - "The document-delivery instruction is carried in the operation-issue DESCRIPTION (created fresh every compile), NOT the static manifest agents[].instructions.content — the manifest instructions provably do not propagate to an existing managed agent"
  - "The 03-07 fallback-poll miss was STRUCTURAL: the document scan was correct code but a never-primary 15s backstop racing a 300s timeout; Option B promotes it to the PRIMARY 5s poll"

patterns-established:
  - "Issue-document readback as the managed-agent result channel for a same-origin Paperclip plugin worker"
  - "Per-operation agent instructions ride the operation-issue description, not the manifest"

requirements-completed: []  # BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02 — NOT complete until Task 4's live drill passes

# Metrics
duration: ~35min
completed: 2026-05-17
---

# Phase 3 Plan 08: Option B Document-Readback Gap Closure Summary

**deliverAgentTask's result readback rewritten to a PRIMARY ctx.issues.documents.get poll at key `compile-result` (Option B); the dead Option C plugin-tool surface stripped; v0.4.0 packed — awaiting Eric's Countermoves closure re-drill (Task 4) to close Phase 3.**

## Performance

- **Duration:** ~35 min (auto Tasks 1-3)
- **Started:** 2026-05-17 (execution session)
- **Completed (Tasks 1-3):** 2026-05-17
- **Tasks:** 3 of 4 (Task 4 is a blocking human-verify checkpoint — NOT executed)
- **Files modified:** 6 (2 deleted)

## Accomplishments

- **Diagnosed the 03-07 fallback-poll miss** (verdict below) — the document scan was correct code but structurally a never-primary backstop.
- **Rewrote `deliverAgentTask` steps 4-5** to Option B: a PRIMARY `ctx.issues.documents.get(operationIssueId, 'compile-result', companyId)` poll at 5s, with an off-key `documents.list` scan and a legacy `listComments` scan as lower-priority fallbacks. The `Promise.race` and the `PENDING_DELIVERIES` tool registry are gone.
- **Carried the document-delivery instruction in the operation-issue DESCRIPTION** via the new `RESULT_DELIVERY_INSTRUCTION` constant — the channel that provably propagates to a live managed agent (the static manifest `agents[].instructions.content` does NOT).
- **Stripped the dead Option C surface** — deleted `compile-result-tool.ts` + its test, removed the manifest `tools[]` / `agent.tools.register` capability / `agents[].permissions.pluginTools`, removed the `worker.ts` wiring.
- **Bumped 0.3.0 → 0.4.0** — re-scopes the durable circuit breaker (`CLARITY_PACK_VERSION = manifest.version`) past the 3 stale `plugin_version='0.3.0'` failure rows; `npm pack` produces `clarity-pack-0.4.0.tgz`.

## The 03-07 Fallback-Poll-Miss Diagnosis Verdict

The 03-07 readback DID code a `documents.list` + `.get` scan, and it keyed the correct `operationIssueId` — the poll and the create share one `issue.id` variable (threat-model item 5; no second id was introduced). The SDK `list(issueId, companyId)` / `get(issueId, key, companyId)` arity at the old lines 359-368 matched research Q1 verbatim, so there was **no API-shape mismatch**.

**The miss was STRUCTURAL, not a bug.** The document scan ran only as a never-primary ~15s belt-and-suspenders backstop inside a `Promise.race` whose other branches were the (live-disproven) Option-C tool promise and a 300s timeout. A slow 15s backstop racing a multi-minute `claude_local` compile is fragile, and — critically — the readback's *designed* path was the tool channel that never fired on the real agent (the agent's session never received the declared tool). The document poll was demoted to a backstop that the architecture never expected to be the winner.

**Verdict:** the document path was correct code but structurally a backstop, not the primary. Option B fixes it by promoting `documents.get` at key `compile-result` to the PRIMARY 5s poll, removing the `Promise.race` and the dead tool registry entirely.

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose + rewrite deliverAgentTask readback to Option-B document poll** — `d50fda2` (feat)
2. **Task 2: Strip the dead Option C surface and bump version 0.3.0 → 0.4.0** — `4240d3f` (chore)
3. **Task 3: Rebuild v0.4.0 artifacts and pack clarity-pack-0.4.0.tgz** — `ae529f5` (chore, allow-empty — dist/ + tgz are gitignored; the e2e tests landed in the Task 1 file)

## Files Created/Modified

- `src/worker/agents/agent-task-delivery.ts` — readback steps 4-5 rewritten; `RESULT_DOCUMENT_KEY`, `RESULT_DELIVERY_INSTRUCTION`, `RESULT_POLL_INTERVAL_MS` added; `PENDING_DELIVERIES` / `compile-result-tool` imports removed; steps 1-3 byte-identical except the one `description: opts.prompt + RESULT_DELIVERY_INSTRUCTION` concatenation.
- `src/manifest.ts` — `agent.tools.register` capability, `tools[]` array, `agents[0].permissions` block all removed; Editor-Agent instructions rewritten to deliver via a `compile-result` document; `version: '0.4.0'`.
- `src/worker.ts` — `registerCompileResultTool` import block + `setup()` call removed.
- `package.json` — `"version": "0.4.0"`.
- `test/worker/agents/agent-task-delivery.test.mjs` — readback tests re-pointed at the document-poll-primary path; 2 host-faithful e2e tests added (document at `compile-result`, off-key fallback) + 3 manifest-strip drift guards.
- `test/helpers/host-faithful-ctx.mjs` — `resultDocuments` fixture added to the `issues.documents` fake; dead `tools.register` fake / `callTool` helper / `registeredTools` Map removed.
- `src/worker/agents/compile-result-tool.ts` — **DELETED** (dead Option C module).
- `test/worker/agents/compile-result-tool.test.mjs` — **DELETED** (its test file).

## Suite Delta

- Baseline (Plan 03-07): 696 tests / 694 pass / 0 fail / 2 skip.
- After Plan 03-08: **689 tests / 687 pass / 0 fail / 2 skip.**
- Net −7: `compile-result-tool.test.mjs` removed (~13 tests); `agent-task-delivery.test.mjs` net change from the readback-test re-point + 2 host-faithful e2e tests + 3 manifest-strip drift guards.

## Build + Pack

- `node scripts/build-worker.mjs` → `dist/worker.js` 176.3 kb (exit 0).
- `node scripts/build-ui.mjs` → `dist/ui/index.js` 105.1 kb (exit 0).
- `npx tsc --project tsconfig.manifest.json` → `dist/manifest.js` (exit 0).
- `npm pack` → **`clarity-pack-0.4.0.tgz`** — package size 70.1 kB / unpacked 323.1 kB / 9 files.
  - **sha256: `0a7891e67ac803abb6ced55f4e02fe16a24009257ea728995dae37ee8673baa2`**
- `dist/worker.js` grep-clean of `registerCompileResultTool` / `submit-compile-result` / `PENDING_DELIVERIES`.

## Decisions Made

- **Option B over the dead Option C.** A `claude_local` managed agent's session never receives a plugin-declared tool — live-disproven on the 2026-05-16 closure re-drill. The agent's reliable observed behaviour is to file the result as an issue document; the worker reads that document. (Already a locked direction from the debug doc; this plan implements it.)
- **The document-delivery instruction rides the operation-issue DESCRIPTION, not the manifest.** `reconcile()` sets `agents[].instructions.content` at agent creation only; it does not propagate to an existing managed agent. The operation issue is created fresh every compile and the agent provably reads its body.
- **Task 3 committed `--allow-empty`** — `dist/` and the `.tgz` are gitignored build artifacts, and the host-faithful e2e tests were authored in the Task 1 test-file rewrite. The Task 3 commit records the tarball name + sha256 per the plan's acceptance criteria.

## Deviations from Plan

None — plan executed exactly as written. Steps 1-3 of `deliverAgentTask` were kept byte-identical except the one mandated `description` concatenation; the verified-numerics contract (`verifyDraft`, `publishBulletin`, `computeStandingNumbers`, `computeFactsTable`) was untouched; the version-scoped durable breaker was left to auto-track `manifest.version`.

## Issues Encountered

- 3 manifest-strip drift-guard tests in `agent-task-delivery.test.mjs` failed at the end of Task 1 (the manifest still carried Option C) — expected and explicitly anticipated by the plan ("the full suite at the end of Task 2"). All green after Task 2.

## User Setup Required

None — no external service configuration. **Task 4 requires Eric to run the live Countermoves closure re-drill** (see below).

## Task 4 — Awaiting Checkpoint (BLOCKING, human-verify)

Task 4 is `checkpoint:human-verify` with `gate="blocking"`. It was NOT executed — it is a live production drill on the remote Countermoves Hostinger VPS that only Eric can run.

**What was built for the drill:** `clarity-pack-0.4.0.tgz` (sha256 `0a7891e6...`) — a v0.4.0 build whose `deliverAgentTask` readback is an issue-document poll (Option B). The worker creates the operation issue with the "store the result as a document keyed `compile-result`" instruction in the issue DESCRIPTION; the Editor-Agent files the `BulletinDraft` as a document at that key; the worker reads it back via `ctx.issues.documents.get`. The dead Option C tool channel is stripped; the version-scoped durable breaker (migration 0005) is unchanged and the 0.4.0 bump re-scopes it past the stale 0.3.0 rows.

**Drill summary:** pre-drill snapshot → uninstall v0.3.0 → clear the 3 stale `plugin_version='0.3.0'` `editor_agent_failures` rows → scp + install v0.4.0 → watch a `compile-bulletin` fire → confirm the worker creates an operation issue whose DESCRIPTION carries the `compile-result` instruction → the Editor-Agent files the `BulletinDraft` as a document at key `compile-result` → HARD GATE: the worker reads the document back, a `bulletins` row reaches `compile_status='published'`, a `Bulletin No. N` issue is created, no new `0.4.0` `deliverAgentTask`-timeout rows → render `/COU/bulletin` → spot-check BULL-06 standing numbers → spot-check the Reader TL;DR (`/COU/issues/COU-N`).

**Resume signal:** `approved — phase 3 closed` if the bulletin compiles + publishes + renders and the Reader TL;DR populates. Otherwise Eric describes the failure (worker log + the operation issue's document section + `editor_agent_failures` rows) and the planner routes a gap-closure plan.

## Next Phase Readiness

- Auto Tasks 1-3 complete and green — `clarity-pack-0.4.0.tgz` is ready for the drill.
- **Phase 3 is NOT closed.** Per the phase advisory anti-pattern: a green local suite does NOT prove the live `claude_local` agent files the document — the host-faithful e2e tests model host CONSTRAINTS (the documents API shape), not agent BEHAVIOUR. Only Task 4's live Countermoves drill closes Phase 3.
- On `approved — phase 3 closed`: Phase 3 closes (also satisfies Plan 03-04's pending checkpoint), the milestone advances to Phase 4 (Employee Chat).

## Self-Check: PASSED

- `03-08-SUMMARY.md` — FOUND.
- `clarity-pack-0.4.0.tgz` — FOUND.
- `src/worker/agents/agent-task-delivery.ts` — FOUND (rewritten).
- `src/worker/agents/compile-result-tool.ts` — DELETED (verified absent).
- `test/worker/agents/compile-result-tool.test.mjs` — DELETED (verified absent).
- Commits `d50fda2`, `4240d3f`, `ae529f5` — all FOUND in git history.

---
*Phase: 03-daily-bulletin*
*Completed (Tasks 1-3): 2026-05-17 — Task 4 awaiting Eric's Countermoves closure re-drill*
