---
slug: reader-tldr-stuck-compiling
status: resolved
trigger: "Reader TL;DR stuck on 'Compiling TL;DR…' forever on live BEAAA v1.2.0 (e.g. issue BEAAA-1101); the TL;DR never appears."
created: 2026-05-30
updated: 2026-05-30
tdd_mode: false
---

# Debug: Reader TL;DR stuck on "Compiling TL;DR…"

## Symptoms

- **Expected:** Opening an issue's Reader tab compiles a TL;DR (view-driven) and displays it within a poll cycle or two.
- **Actual:** The TL;DR strip shows `status='compiling'` ("Compiling TL;DR… The Editorial Desk is summarizing this task — it will appear here in a moment.") indefinitely; the TL;DR never lands.
- **Error messages:** No UI error. Worker logs show the every-minute `compile-bulletin` job failing `companies.list` with `"missing, expired, or unknown invocation scope"` (paperclipai@2026.525.0 dead scheduled-job scope, PR #6547).
- **Timeline:** Observed on live BEAAA v1.2.0 (2026-05-30, the Phase 8 ship). Likely latent across the view-driven rework (2026-05-28) whenever the agent compile outlasts a single Reader poll.
- **Reproduction:** Open the Reader tab on an issue with no fresh cached TL;DR on BEAAA → "Compiling…" never resolves.

## Current Focus

- **hypothesis:** The Editor-Agent compiles successfully, files the `compile-result` document, and marks the operation issue `done` (~1m36s). The completed op's result is then ORPHANED: `startAgentTask` excludes terminal (`done`/`cancelled`) ops from idempotency reuse, so the next view-driven poll spawns a BRAND-NEW op and polls that empty one (→ `compiling`) instead of reading the just-completed op's result. The only mechanism that would consume a completed op's result on a later tick — `drainTldrOperations` — is dead (called from the scope-dead `compile-bulletin` job). Net: `tldr_cache` is never written; the Reader loops forever, respawning ops.
- **test:** A failing unit test for `driveTldrCompileStep`: given a cache-miss AND an EXISTING recently-`done` tldr-compile op whose `compile-result` document is present + valid, it must finalize that result into the cache and return `status:'cached'` — NOT spawn a new op and return `'compiling'`.
- **expecting:** Current code returns `'compiling'` (spawns new op, ignores the done op's document) → test fails on `status` and on `tldr` being null.
- **next_action:** RESOLVED — failing test written + reproduced (RED), fix implemented (consume-before-spawn), test passes (GREEN), full gate suite green. See Resolution.

## Evidence

- timestamp: 2026-05-30 — Editor-Agent Runs panel (live BEAAA): adapter `claude_local` (anthropic/claude-sonnet-4-6), state `idle` (NOT paused). 8+ consecutive runs ALL `succeeded`, each "Done. TL;DR stored as `compile-result` document, op marked done." Run `1b4729bc` touched op issue "Compile TL;DR — 4255431f-…-911d5" → status `done`, duration 1m36s. ⇒ The agent EXECUTES and DELIVERS results correctly. The many back-to-back successful runs are consistent with the Reader endlessly respawning ops.
- timestamp: 2026-05-30 — pm2 logs: `[plugin] compile-bulletin: companies.list failed` every minute with `"missing, expired, or unknown invocation scope"`. ⇒ scheduled-job scope dead ⇒ `drainTldrOperations` (called from `compile-bulletin`) never runs ⇒ no safety-net consumption of completed ops.
- timestamp: 2026-05-30 — pm2 logs: `[plugin] Editor-Agent: skipped own operation issue (recursion guard)` for `originKind: plugin:clarity-pack:operation:tldr-compile`. ⇒ heartbeat correctly skips op issues (benign; not the bug).
- code: `src/worker/agents/agent-task-delivery.ts` — `startAgentTask` idempotency search reuses only NON-terminal ops (`TERMINAL_STATUSES = {done,cancelled}` filtered out, L364-366); creates a NEW op otherwise. `pollAgentTaskResult` reads `documents.get(opId,'compile-result')` etc. for the op id it is GIVEN. CONFIRMED in code.
- code: `src/worker/agents/editor.ts` `driveTldrCompileStep` — on cache miss it called `startAgentTask` → polled the returned op id → `'compiling'` if not ready. It NEVER polled a recently-completed op's result before spawning a new one. `handleEditorHeartbeat` has the same pattern. `drainTldrOperations` is the only consumer of completed/in-flight ops and is dead. CONFIRMED in code.
- code: `src/worker/handlers/issue-reader.ts` — the view-driven caller of `driveTldrCompileStep` (valid HTTP scope). UI (`src/ui/surfaces/reader/index.tsx`) polls `issue.reader` via setInterval while `tldrStatus==='compiling'`. CONFIRMED in code.
- test: `test/worker/agents/tldr-orphaned-done-op.test.mjs` (NEW) — reproduced the bug RED: cache-miss + a recently-`done` op carrying a valid `compile-result` document returned `status:'compiling'` (spawned a fresh empty op) instead of consuming the done op's result. After the fix: GREEN.

## Eliminated

- hypothesis: "The Editor-Agent is paused / its adapter is unconfigured / it never executes the compile." REFUTED by the Editor-Agent Runs panel — `claude_local` adapter working, idle not paused, 8+ `succeeded` runs each filing the `compile-result` document and marking the op done. The agent side is healthy; the failure is downstream in RESULT CONSUMPTION.

## Resolution

- **root_cause:** `driveTldrCompileStep` (and the heartbeat path) never read a recently-COMPLETED tldr-compile op's `compile-result` document before spawning a new op; `startAgentTask` excludes terminal (`done`/`cancelled`) ops from idempotency reuse, so the just-finished op's result was orphaned and the Reader respawned empty ops forever (the safety-net `drainTldrOperations` is dead behind the scope-dead `compile-bulletin` job — PR #6547).
- **fix:** Added CONSUME-BEFORE-SPAWN to `driveTldrCompileStep` via a new exported helper `consumeExistingTldrOpResult` (`src/worker/agents/editor.ts`): on cache-miss, before spawning, list the existing `tldr-compile` ops for this scope (`originId tldr-<issueId>`, `includePluginOperations:true`) — INCLUDING a recently-`done` one within a 2×timeout recency window — newest-first, and `pollAgentTaskResult` each; on a consumable `compile-result`, `finalizeTldr` into the cache and return `status:'cached'`. A new op is spawned ONLY when no existing op has a result. Decouples "don't re-DRIVE a done op" from "DO read its result."
- **test:** `test/worker/agents/tldr-orphaned-done-op.test.mjs` — two pins: (1) cache-miss + recently-done op with a valid result document → consumes, caches, `cached`, no new op spawned; (2) cache-miss + done op with NO result document → falls through to a fresh compile (`compiling`, one op spawned) so the fix doesn't over-reach. Both GREEN.
- **gate:** typecheck clean; full `pnpm test` = 2373 pass / 1 PRE-EXISTING out-of-scope `situation-artifacts` sort failure (documented exception, reproduces at d526987) / 2 skipped; build:worker/ui/manifest clean; check-css-scope (200 selectors all scoped) + check-ui-bundle-size (725.4 kB under 746496-byte ceiling) green.
- **cycles:** 1 investigation (prefilled, validated against code) + 1 fix.
- **deploy:** NOT YET DEPLOYED. Fix is code-complete on `master` working tree (uncommitted). Deploy to live BEAAA requires the two-source version bump (package.json + src/manifest.ts, currently 1.2.0) per memory `plugin-version-bump-two-sources`, DEPLOY-RUNBOOK Path A, and an explicit operator checkpoint.

## Notes / Constraints

- Live prod BEAAA; internal-only plugin (no npm publish). Two-source version bump REQUIRED (package.json + src/manifest.ts) per memory `plugin-version-bump-two-sources`. Deploy via DEPLOY-RUNBOOK Path A (SSH `ariclaw` authorized).
- **Same delivery layer backs the Daily Bulletin view-driven compile + the bulletin-gloss op.** The fix here is targeted at the TL;DR view-driven path (`driveTldrCompileStep`). The bulletin compile uses a cross-tick `ctx.state`-frozen flow (different consumption mechanism); the bulletin-gloss path should be reviewed for the same orphaned-done-op pattern as a FOLLOW-UP (not blocking the Reader fix). Flagged below.
- The dead `drainTldrOperations` is a SECOND latent gap: even with the view-driven fix, a result filed after the user closes the Reader is only consumed on the next Reader open. Acceptable for v1, but note it. The consume-before-spawn fix substantially closes the user-visible symptom (the next Reader open now consumes the done op's result instead of orphaning it).
- FOLLOW-UP: review `driveBulletinGlossStep` / the bulletin-gloss op consumption for the same terminal-op orphaning pattern. Not in scope for this debug session; surface at next bulletin-surface phase.
