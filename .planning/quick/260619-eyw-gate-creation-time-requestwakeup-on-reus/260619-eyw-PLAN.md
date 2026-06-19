---
phase: quick-260619-eyw
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - test/worker/agents/agent-task-delivery.test.mjs
  - src/worker/agents/agent-task-delivery.ts
  - package.json
  - src/manifest.ts
autonomous: true
requirements: [EYW-WAKE-ON-CREATE]

must_haves:
  truths:
    - "A reuse-poll of an in-flight op-issue fires ZERO requestWakeup (no wake on the reuse branch)."
    - "A genuine op-issue CREATE still fires exactly one governed requestWakeup (the LOOP-07 wake is preserved on creation)."
    - "One distinct stuck compile produces exactly one wake regardless of Reader poll cadence — the 6/min wake-governor ceiling can no longer self-trip from ~5s repolls."
    - "The plugin version is 1.8.9 in BOTH package.json and src/manifest.ts so wake-kill-switch-repo.isEngaged (version-scoped) ignores CounterMoves' stale engaged row on deploy."
  artifacts:
    - path: "src/worker/agents/agent-task-delivery.ts"
      provides: "startAgentTask with the creation-time wake gated on !reused"
      contains: "!reused"
    - path: "test/worker/agents/agent-task-delivery.test.mjs"
      provides: "reuse-branch no-wake test + create-branch wake test"
      contains: "reuse"
    - path: "package.json"
      provides: "version bump to 1.8.9"
      contains: "1.8.9"
    - path: "src/manifest.ts"
      provides: "manifest version bump to 1.8.9 (host reads dist/manifest.js)"
      contains: "1.8.9"
  key_links:
    - from: "src/worker/agents/agent-task-delivery.ts startAgentTask"
      to: "checkAndRecordWake + ctx.issues.requestWakeup"
      via: "guarded by `if (!reused)`"
      pattern: "!reused"
    - from: "src/manifest.ts version"
      to: "wake-kill-switch-repo.isEngaged (version-scoped)"
      via: "manifest.version stamp"
      pattern: "1\\.8\\.9"
---

<objective>
Eliminate the editor wake-storm at its SOURCE: gate the creation-time `requestWakeup` in `startAgentTask` so it fires ONLY on a genuine op-issue CREATE, never on a reuse-poll. Bump the plugin version 1.8.8 → 1.8.9 so the version-scoped durable kill-switch auto-clears CounterMoves' stale engaged row on deploy.

Purpose: The Reader polls a TL;DR compile ~every 5s while "Compiling…". Each poll calls `startAgentTask`, which today fires a wake on BOTH the create AND the reuse branch — ~12 wakes/min for one stuck compile. wake-governor's ceiling is 6/min; at >6/min it auto-engages the durable kill-switch (never auto-clears), every editor wake is suppressed, the op falls to Paperclip's recovery sweep (status_only, write-blocked), and the wrong agent (CTO/CEO) runs the TL;DR. The editor never runs (zero tokens). Gating the wake on `!reused` makes one distinct compile = exactly one wake, so the 6/min ceiling becomes a true cap on *distinct* issues and is no longer self-tripped by poll cadence.

Output: One surgical conditional in `startAgentTask`, a TDD test proving the reuse-branch fires no wake, and a load-bearing version bump in both version sources.

Scope boundary: This plan ends at tests-pass + version-bumped + committed. DEPLOY to BEAAA + CounterMoves and live verification happen AFTER this plan, driven by the orchestrator/operator — NOT part of this code plan's tasks.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- The wake site to gate. Extracted from src/worker/agents/agent-task-delivery.ts (startAgentTask).
     The whole storm SOURCE is that this block runs on the reuse branch too. -->

startAgentTask returns `{ operationIssueId: string; reused: boolean }`.

Idempotency search (top of startAgentTask) sets `reused = true` and `issue = { id: reusable.id }`
when a non-terminal op-issue is found; otherwise `issue` stays null.

Create branch (~line 465): `if (!issue) { issue = await ctx.issues.create({...}) }`.

Provenance write (~line 498, runs for BOTH branches, KEEP AS-IS):
  `await recordOwnOperationIssue(ctx, opts.companyId, issue.id);`

The wake block to gate (~line 529, currently UNCONDITIONAL — fires on reuse too):
  const allowed = await checkAndRecordWake(ctx, opts.companyId);
  if (allowed) {
    try { await ctx.issues.requestWakeup(issue.id, opts.companyId, { reason, idempotencyKey }); }
    catch (e) { ctx.logger?.warn?.(... non-fatal ...); }
  } else {
    ctx.logger?.info?.(... wake suppressed by governor — degrade-safe ...);
  }
  return { operationIssueId: issue.id, reused };

Test harness (test/worker/agents/agent-task-delivery.test.mjs):
  makeFakeCtx({ existing, ... }) returns { ctx, calls }; `calls.requestWakeup` / `calls.create` /
  `calls.provenanceWrites` are recorded. An `existing: [existingIssue]` with a non-terminal
  status drives the REUSE branch (create.length === 0). Fake db.query returns [] so the
  governor ALLOWS a wake by default (so the create branch genuinely fires one).
  Test runner: `npm test` → `node --test "test/**/*.test.mjs"`.

Version sources (per CLAUDE.md "Plugin version bump — two sources"):
  package.json line 3: `"version": "1.8.8"`
  src/manifest.ts line 702: `version: '1.8.8'`
  Host reads dist/manifest.js (built from src/manifest.ts) — BOTH must move to 1.8.9.
</interfaces>
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: TDD — prove no wake on reuse, one wake on create</name>
  <files>test/worker/agents/agent-task-delivery.test.mjs, src/worker/agents/agent-task-delivery.ts</files>
  <behavior>
    - REUSE branch: with `existing: [nonTerminalOpIssue]` (matching originId/assignee, status `in_progress`), `startAgentTask` returns `{ reused: true }`, `calls.create.length === 0`, and `calls.requestWakeup.length === 0` (NO wake on a reuse-poll — this is the storm-source fix). The observable contract is "no wake on reuse"; do not assert on whether checkAndRecordWake was called.
    - CREATE branch (regression guard, already covered by existing LOOP-07 tests but pin it alongside the new test): with `existing: []`, `startAgentTask` returns `{ reused: false }`, `calls.create.length === 1`, and `calls.requestWakeup.length === 1` targeting the created op-issue.
    - Existing suite stays green: the existing "idempotency — an existing operation issue ... is REUSED" test (which currently does NOT assert on wake count) must continue to pass; the new reuse test adds the wake assertion the old one lacks.
  </behavior>
  <action>
    RED first. Add a new test to test/worker/agents/agent-task-delivery.test.mjs named like "startAgentTask: storm-source fix — a REUSE-poll of an in-flight op-issue fires ZERO requestWakeup". Build the ctx via makeFakeCtx with an `existing` array holding one non-terminal op-issue shaped like the existing idempotency test's `existingIssue` (id 'op-existing', status 'in_progress', assigneeAgentId AGENT_ID, originKind operationOriginKind('bulletin-compile'), originId 'cycle-1'). Call `await startAgentTask(ctx, BASE_OPTS)`. Assert: result.reused === true, calls.create.length === 0, calls.requestWakeup.length === 0. Run `npm test` and confirm THIS test fails (the current unconditional wake fires on reuse).

    Then GREEN. In src/worker/agents/agent-task-delivery.ts, gate the creation-time wake block (the `const allowed = await checkAndRecordWake(...)` ... `}` block around line 529–549) so the ENTIRE governed-wake block runs ONLY when `!reused`. Wrap it in `if (!reused) { ... }`. On the reuse path, skip the wake entirely (the agent was already woken when the op was created; the recovery sweep stays the documented degrade-safe backstop). Preserve the existing try/catch, the non-fatal warn log on a thrown requestWakeup, and the degrade-safe info log when the governor suppresses a genuine creation wake. Keep the `recordOwnOperationIssue` provenance write (line 498) UNCONDITIONAL — it must still fire on reuse. Do NOT touch wake-governor.ts or the kill-switch design.

    Update the comment block above the wake (the LOOP-07 / STORM-SEVERANCE / DEGRADE-SAFE prose) to explain the `!reused` gating: one distinct compile = exactly one wake; the Reader's ~5s reuse-polls no longer each fire a wake, so the 6/min governor ceiling caps DISTINCT issues and is no longer self-tripped by poll cadence. Cross-reference the 2026-06-19 storm diagnosis (Reader poll → startAgentTask reuse → wake → governor auto-engages durable kill-switch → editor suppressed → recovery sweep escalates to wrong agent).

    Run `npm test` and confirm the new reuse test plus all existing tests (the three LOOP-07 create-branch tests at lines 300/326/347, the idempotency test at 367, and the happy-path/document tests that assert requestWakeup.length === 1 on CREATE) are green. The create-branch wake assertions must still pass because those tests use `existing: []` (reused === false).
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>The new reuse-branch test asserts `calls.requestWakeup.length === 0` and passes; the create-branch wake (requestWakeup.length === 1 with `existing: []`) still passes; the unconditional `recordOwnOperationIssue` provenance write still fires on reuse; full `node --test "test/**/*.test.mjs"` suite is green; wake-governor.ts and the kill-switch repo are unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Version bump 1.8.8 → 1.8.9 in both sources + typecheck</name>
  <files>package.json, src/manifest.ts</files>
  <action>
    Bump the plugin version 1.8.8 → 1.8.9 in BOTH version sources (per CLAUDE.md "Plugin version bump — two sources": the host reads dist/manifest.js built from src/manifest.ts, NOT package.json — shipping one without the other ships v1.8.9 code under a v1.8.8 label).

    1. package.json line 3: `"version": "1.8.8"` → `"version": "1.8.9"`.
    2. src/manifest.ts line 702: `version: '1.8.8'` → `version: '1.8.9'`.

    This version bump is LOAD-BEARING beyond labeling: src/worker/db/wake-kill-switch-repo.ts `isEngaged` is version-scoped to manifest.version. A bump makes CounterMoves' stale engaged kill-switch row (stamped at the old version) invisible to v1.8.9, auto-recovering the stuck state on deploy with no manual DB write. Do not change any other version string or stamp.

    Run `npm run typecheck` to confirm the manifest edit compiles cleanly (the manifest is type-checked against PaperclipPluginManifestV1).
  </action>
  <verify>
    <automated>npm run typecheck && node -e "const p=require('./package.json'); if(p.version!=='1.8.9'){console.error('package.json version is',p.version);process.exit(1)} console.log('package.json OK 1.8.9')" && grep -n "version: '1.8.9'" src/manifest.ts</automated>
  </verify>
  <done>package.json version === "1.8.9"; src/manifest.ts version === '1.8.9'; `npm run typecheck` exits 0; no other version stamp changed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| plugin worker → host (ctx.issues.requestWakeup) | The wake crosses into the host's agent dispatcher; over-firing it is the storm vector this plan closes. |
| plugin worker → durable kill-switch (wake_kill_switch) | The governor's durable safety cap; this plan removes the storm SOURCE but does NOT weaken the cap. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-eyw-01 | Denial of Service | startAgentTask creation-time wake | mitigate | Gate the wake on `!reused` so Reader ~5s reuse-polls cannot each fire a wake; one distinct compile = one wake. The 6/min governor ceiling and durable kill-switch stay untouched as the backstop. |
| T-eyw-02 | Tampering | wake-governor.ts / wake-kill-switch-repo.ts | accept | Out of scope — explicitly NOT modified. The safety cap stays exactly as designed (Phase 16.1 anti-storm). This plan only removes the source that self-trips it. |
| T-eyw-SC | Tampering | npm/pip/cargo installs | accept | No package installs in this plan (test + source edit + version bump only). No new dependencies. |
</threat_model>

<verification>
- `npm test` green (full `node --test "test/**/*.test.mjs"` suite), including the new reuse-branch no-wake test and the preserved create-branch wake tests.
- `npm run typecheck` exits 0.
- `git diff` touches only the four declared files; wake-governor.ts and wake-kill-switch-repo.ts are unchanged.
- The six coexistence guarantees are untouched (no schema change, no UI replacement, additive/surgical worker edit only).
</verification>

<success_criteria>
- A reuse-poll of an in-flight op-issue fires ZERO requestWakeup (proven by a unit test).
- A genuine op-issue CREATE still fires exactly one governed wake (proven by the preserved create-branch tests).
- Version is 1.8.9 in both package.json and src/manifest.ts.
- wake-governor.ts and the kill-switch design are unchanged.
- Code plan ends here: tests pass + version bumped + committed. Deploy/live-verify is the orchestrator/operator's next step.
</success_criteria>

<output>
Create `.planning/quick/260619-eyw-gate-creation-time-requestwakeup-on-reus/260619-eyw-SUMMARY.md` when done.
</output>
