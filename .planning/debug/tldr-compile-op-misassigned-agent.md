---
slug: tldr-compile-op-misassigned-agent
status: awaiting_human_verify
trigger: "Clarity Pack v1.8.7 (paperclipai@2026.525.0): tldr-compile operation issues are assigned to the WRONG agent (the triggering / source-issue agent, e.g. CTO/CEO) instead of the dedicated managed Editor-Agent (role=editor). The misassigned agent has no Clarity-Pack execution path, so the op never reaches a terminal state; the Reader wedges on 'Compiling…' forever and Paperclip's terminal-run-recovery churns the wrong agents (burning tokens)."
created: 2026-06-18
updated: 2026-06-18
tdd_mode: true
related_sessions:
  - reader-tldr-stuck-compiling.md (RESOLVED 2026-05-30, v1.2.0 — SAME surface symptom "Compiling… forever" but a DIFFERENT root cause = orphaned-done-op result-consumption gap; fix = consume-before-spawn in driveTldrCompileStep. THAT fix assumes the op REACHES 'done'. The current bug is upstream: the op never completes because it's assigned to an agent with no execution path, so there is never a compile-result document to consume. Do NOT confuse the two; do NOT regress consume-before-spawn.)
  - tldr-heartbeat-recursion.md (RESOLVED v0.6.5 — recursion guard isOwnOperationIssue() + tldr_cache array-literal fix. The editor heartbeat correctly skips its own operation issues; that guard is benign and MUST stay.)
---

# Debug: tldr-compile operation issue assigned to the WRONG agent

## Symptoms

- **Expected:** Opening any issue's Reader creates a `tldr-compile` operation issue ASSIGNED TO the dedicated managed Editor-Agent (role=editor); the editor runs it, files a `compile-result` document, the op reaches a terminal `done`, and the Reader resolves "Compiling…" → a real TL;DR.
- **Actual:** The `tldr-compile` op is assigned to the agent whose heartbeat/invocation TRIGGERED the compile (= the source issue's owner, e.g. the CTO; or the CEO when recovery runs in the CEO's context). That agent has no Clarity-Pack execution path, so the op never completes. The Reader data handler returns `{tldr: null, tldrStatus: "compiling"}` permanently.
- **Error / log messages:**
  - Worker, every ~6s forever: `[plugin] agent-task-delivery: reusing in-flight operation issue <opId> for tldr-compile/tldr-<sourceIssueId> (idempotency — no duplicate created)` — the op stays NON-terminal, so the idempotency search keeps finding the same wedged op and never spawns a fresh (correctly-assigned) one.
  - Paperclip terminal-run-recovery: `Paperclip automatically retried continuation for this assigned in_progress issue during terminal run recovery, but it still has no live execution path.`
- **Caught red-handed (fresh op creation log):**
  `created operation issue 49789779-517e-4e2e-8894-ded8bffb5b3e  kind=tldr-compile  originId=tldr-592665de-5897-4bc8-ae8e-a1972cde5595  assignee=fe557a0e-54f4-437d-b009-5dccd5a8dd54` — assignee = CTO, NOT the Editor-Agent. Source issue 592665de is the CTO's; its compile op went to the CTO ⇒ assignee tracks the TRIGGERING agent, not the dedicated editor.
- **Agent UUIDs on the live instance (CounterMoves):**
  - Editor-Agent (role=editor) = `d385f16a-e2d3-409c-bed7-b4e06eecc30d`  ← compiles SHOULD go here
  - CTO = `fe557a0e-54f4-437d-b009-5dccd5a8dd54`  ← they are going here
  - CEO = `8dfeb8db-25fd-4981-ae64-4fd6ed4266c3`  ← recovery escalates them here
- **Timeline:** Observed on live CounterMoves, clarity-pack v1.8.7. The dedicated Editor-Agent is HEALTHY and idle (clean conversations on hermes_local / claude-haiku-4-5) — nothing is ever assigned to it.
- **Reproduction:** Open any issue's Reader on an instance where the source issue is owned by a non-editor agent → a `tldr-compile` op is created assigned to that owner → op never terminalizes → Reader stuck "Compiling…" + 6s "reusing in-flight" loop + recovery churn on the wrong agent.

## Current Focus

**ROOT CAUSE PINNED = (b)** — the caller passes a wrong `agentId` into `startAgentTask`. The wrong id is produced by `resolveEditorAgentId` (`src/worker/agents/editor.ts:717-743`), whose PRIMARY strategy returns the first op-issue's `assigneeAgentId` from an **assignee-unfiltered** `ctx.issues.list` (`editor.ts:728-731`). Once a host-side terminal-run-recovery reassignment lands a non-editor (CTO/CEO) assignee on ANY clarity op, the resolver reads it back and returns it → every new op is created with that wrong assignee (self-propagating). (a)+(c) ELIMINATED: `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY)` resolves by stable agent KEY (`PluginManagedAgentResolution.agentId`, by `resourceKey`) — `compile-bulletin.ts:854` uses it directly and is NOT misassigned, and the dedicated editor `d385f16a…` is healthy → reconcile returns the correct editor.

reasoning_checkpoint:
  hypothesis: "resolveEditorAgentId (editor.ts:717-743) returns a NON-editor agent id because its primary resolution reads back the assigneeAgentId of the newest plugin operation issue (editor.ts:728-731) from a ctx.issues.list that is NOT filtered by assignee; a host-reassigned (terminal-run-recovery) op poisons it, and every view-driven caller (Reader TL;DR editor.ts:902, action-cards action-cards.ts:697, bulletin-gloss bulletin-gloss.ts:239) then passes that wrong id into startAgentTask, which creates the op with assigneeAgentId=wrong (agent-task-delivery.ts:471)."
  confirming_evidence:
    - "SDK types.d.ts:1058-1069 — issues.list assigneeAgentId is OPTIONAL; resolveEditorAgentId omits it (editor.ts:722-727) → returns ops for ANY assignee, then trusts ops[0].assigneeAgentId as the editor id (editor.ts:728-731)."
    - "compile-bulletin.ts:854 uses managed.reconcile directly (NOT op read-back) and is not reported misassigned; the dedicated editor d385f16a is healthy/idle ⇒ reconcile returns the correct editor ⇒ (a)/(c) eliminated."
    - "Red-handed log: op created assignee=fe557a0e (CTO) = source-issue owner; startAgentTask create uses assigneeAgentId: opts.agentId (agent-task-delivery.ts:471) ⇒ opts.agentId was the CTO ⇒ the resolver fed a wrong id."
    - "PluginManagedAgentResolution.agentId (shared plugin.d.ts:230) resolves by resourceKey (stable agent KEY) — the canonical non-poisonable editor UUID; reconcileEditorAgent (editor.ts:129-135) already returns it."
  falsification_test: "If reconcile (by stable key) ALSO returned the CTO, the bulletin-compile path would misassign too and the dedicated editor would be churning — neither is observed. And if resolveEditorAgentId filtered list by the resolved editor assignee, a poisoned op could not be read back. The RED test simulates a poisoned op (assigned CTO) + reconcile returning the editor, and asserts the next op's assignee === editor: if current code already passed, the hypothesis would be wrong."
  fix_rationale: "Make resolveEditorAgentId resolve the editor id from the AUTHORITATIVE managed-agent registry (ctx.agents.managed.get/reconcile by EDITOR_AGENT_KEY) FIRST — the same source compile-bulletin already trusts — and stop trusting op-issue assignees as the source of truth. This addresses the ROOT (wrong id at its single shared source) not the symptom (a stuck op). Surgical: one function, shared by all three view-driven paths; the editor-heartbeat path already uses payload.agentId (host-provided) and the bulletin path already uses reconcile, so both are correct and untouched."
  blind_spots: "Whether managed.get/reconcile in a Reader HTTP-request scope is reliable on host 2026.525.0 (the original rework moved AWAY from reconcile citing PR #6547 scope-death — but that was about DETACHED/scheduled-job scopes; a reconcile INSIDE the request handler runs in a valid scope, exactly like compile-bulletin's job-scope reconcile). Verified at runtime is a post-deploy rider. Also: pre-existing wedged ops already assigned CTO/CEO need an operator DB cleanup (close them) so idempotency reuse frees — captured as the operator rider."

tdd_checkpoint:
  test_file: "test/worker/agents/editor-id-resolution-poison.test.mjs"
  test_name: "resolveEditorAgentId — a CTO-reassigned op must NOT poison the editor id; returns the managed editor (+ driveTldrCompileStep fresh-op assignee === editor)"
  status: "green"
  failure_output: "RED (pre-fix): got fe557a0e (CTO), expected d385f16a (editor). GREEN (post-fix): resolveEditorAgentId returns the managed editor; the fresh op's assignee === editor. 5/5 in the poison suite; full suite 2959 pass / 0 fail / 2 skipped."

- **next_action:** DEPLOY — fix is code-complete + locally gated GREEN. See Resolution for the post-deploy verification rider, the operator-cleanup rider, and the two-source v1.8.7→v1.8.8 version bump (deploy step, deliberately NOT done here).

## Evidence

- (from user report, live CounterMoves v1.8.7) The fresh-op log proves assignee = CTO UUID = source-issue owner, not the editor UUID. The 6s "reusing in-flight" loop proves the op never terminalizes (idempotency reuse of a non-terminal op). The Editor-Agent is idle/healthy ⇒ nothing is being routed to it.
- (prior session reader-tldr-stuck-compiling, code note L32) `src/worker/agents/agent-task-delivery.ts` `startAgentTask` idempotency reuses only NON-terminal ops (TERMINAL_STATUSES `{done,cancelled}` filtered out); creates a new op otherwise. ⇒ a permanently-non-terminal (because misassigned) op is reused forever — consistent with the 6s loop and explains why consume-before-spawn never fires (no `compile-result` is ever produced).
- **2026-06-18 — assignee enters at `agent-task-delivery.ts:471` `startAgentTask` `ctx.issues.create({assigneeAgentId: opts.agentId})`.** `opts.agentId` is supplied by the CALLER. The three view-driven callers (Reader TL;DR `editor.ts:902`, action-cards `action-cards.ts:697`, bulletin-gloss `bulletin-gloss.ts:239`) all resolve it via `resolveEditorAgentId(ctx, companyId)`.
- **2026-06-18 — ROOT CAUSE PINNED at `src/worker/agents/editor.ts:717-743` `resolveEditorAgentId`.** Its PRIMARY strategy lists `ctx.issues.list({originKindPrefix: OPERATION_ORIGIN_KIND_PREFIX, includePluginOperations:true, limit:5})` and returns the **first op's `assigneeAgentId`** (`editor.ts:728-731`). The list is **NOT filtered by assignee** — it returns op-issues regardless of who they are assigned to. So the resolver reads back **whatever agent the newest operation issue happens to be assigned to** and treats that as "the Editor-Agent." This is a self-referential / circular resolution: once ANY op carries a non-editor assignee, the resolver returns that non-editor id, the next op is created with the same wrong assignee (`startAgentTask` → `create assigneeAgentId`), and the poison is locked in + amplified every Reader poll. The fallback to `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY)` (`editor.ts:737-742`) ONLY fires when the op list is empty (brand-new company), so it never corrects a poisoned company.
- **2026-06-18 — discriminator that ELIMINATES (a) and (c):** `src/worker/jobs/compile-bulletin.ts:854` resolves the editor via the DIRECT `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, company.id)` → `resolution.agentId` (NEVER an op-issue read-back). The bulletin compile is NOT reported as misassigned, and the dedicated Editor-Agent (`d385f16a…`) is healthy/idle — i.e. reconcile resolves the CORRECT editor. If reconcile returned the CTO (hyp a) or a non-editor were registered as the managed editor (hyp c), the bulletin path would ALSO misassign — it does not. ⇒ reconcile is correct; the defect is exclusively the op-issue-assignee read-back in `resolveEditorAgentId`. **ROOT CAUSE = (b)** (the caller passes a wrong agentId — sourced from the poisoned op-issue read-back resolver — into `startAgentTask`/`create`).
- **2026-06-18 — the SEED (how a non-editor assignee first lands):** Paperclip's terminal-run-recovery (Symptoms log: "Paperclip automatically retried continuation for this assigned in_progress issue during terminal run recovery… escalates to CEO") reassigns/escalates a stuck assigned in_progress op to a fallback/escalation agent (source-issue owner → CEO). That host-side reassignment writes a non-editor `assigneeAgentId` onto a clarity op-issue. On the next Reader poll, `resolveEditorAgentId`'s read-back picks up that reassigned op (newest, limit:5) and returns the non-editor id — converting a one-off host reassignment into a permanent, self-propagating misassignment. The seed is host-side and out of plugin control; the FIX is to stop trusting op-issue assignees as the editor-id source-of-truth.

## Eliminated

- **hypothesis (a):** `ctx.agents.managed.reconcile` returns the CURRENT invocation's agent rather than the managed Editor-Agent.
  evidence: `reconcile(agentKey, companyId)` resolves by stable agent KEY (`PluginManagedAgentResolution`, `resourceKey` → `agentId`; shared `plugin.d.ts:225-230`), NOT by invocation context. `compile-bulletin.ts:854` uses it directly and is NOT misassigned; the dedicated editor `d385f16a…` is healthy/idle ⇒ reconcile returns the correct editor.
  timestamp: 2026-06-18
- **hypothesis (c):** a NON-editor agent is registered as the managed editor.
  evidence: same as (a) — if the registry mapped `editor-agent` → CTO, the bulletin path (reconcile-by-key) would also assign the CTO and the CTO would be churning bulletin ops. Not observed. The registry maps the key to the real editor.
  timestamp: 2026-06-18

## TDD — RED → GREEN

- test file: `test/worker/agents/editor-id-resolution-poison.test.mjs`
- **RED** (pre-fix; 2/5 fail for the right reason; 3 guard tests pass under current code):
  - `resolveEditorAgentId — a CTO-reassigned op must NOT poison the editor id` → got `fe557a0e…` (CTO), expected `d385f16a…` (editor).
  - `driveTldrCompileStep — a NEW tldr-compile op is assigned to the EDITOR, not the CTO` → fresh op assignee `fe557a0e…` (CTO), expected editor.
  - This proved ROOT CAUSE (b): the op-issue assignee read-back in `resolveEditorAgentId` returns the poison agent and propagates it onto the next created op.
- **GREEN** (post-fix, 2026-06-18): all 5/5 in the poison suite pass. `resolveEditorAgentId` now returns the managed editor `d385f16a…`; `driveTldrCompileStep` assigns the fresh op to the editor. The 3 guard tests (brand-new company, healthy op+registry-agree, namespace constant) still pass — no behavior change for the healthy case.

## Evidence (continued)

- **2026-06-18 — GREEN fix applied + full local gate.** Rewrote `resolveEditorAgentId` (editor.ts) to resolve the editor from `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId)` (authoritative registry, by stable key — the SAME call `compile-bulletin.ts:854` trusts) and REMOVED the op-issue assignee read-back entirely. Fallback when reconcile returns null/throws = `null` (caller honestly reports `unavailable`; does NOT spawn a misassigned op — the poison is not reintroducible). Signature + all 3 call sites (editor.ts:904, action-cards.ts:697, bulletin-gloss.ts:239) unchanged. `isOwnOperationIssue` (editor.ts:236) and `consumeExistingTldrOpResult` (editor.ts:778) untouched. `OPERATION_ORIGIN_KIND_PREFIX` import retained (still used by the recursion guard at editor.ts:240).
- **2026-06-18 — regression caught + fixed (test-fidelity, NOT a code regression).** The fix changed the editor-resolution CONTRACT: callers must now supply `ctx.agents.managed.reconcile`. Three OLDER test files (written before that contract) modeled the now-removed op-assignee read-back by seeding an op assigned to `EDITOR_UUID` and mocking only `agents.get` — 10 tests then went `unavailable`. Confirmed this is stale-mechanism, not broken behavior: the NEWEST sibling `bulletin-gloss.test.mjs` ALREADY mocks `agents.managed.reconcile` (returning the editor) and ALREADY has an "UNRESOLVABLE (reconcile null) → unavailable" test — and it did NOT fail. Brought the 3 stale ctxs up to that fidelity (added `agents.managed.reconcile → { agentId: EDITOR_UUID }`; the one genuine "no editor" test now uses `reconcileEditorId: null`). Every behavioral assertion preserved. Files: `test/worker/agents/tldr-view-driver.test.mjs`, `test/worker/agents/tldr-orphaned-done-op.test.mjs`, `test/worker/agents/action-cards.test.mjs`. Also refreshed now-stale "op-issue discovery" comments at the two prod call sites `action-cards.ts:696` + `bulletin-gloss.ts:237`.
- **2026-06-18 — LOCAL GATE GREEN:** `node --test` → **2959 pass / 0 fail / 2 skipped** (2961 total). `tsc --noEmit` → exit 0, no errors. build → worker.js 2.6mb (exit 0), ui/index.js 765.2kb (exit 0), manifest exit 0. Guardrails re-confirmed: consume-before-spawn + recursion-guard tests green; `requestWakeup`/wake-governor untouched; versions NOT bumped (deploy step).

## Notes / Constraints

- **Surgical / additive only.** Preserve the six coexistence guarantees. Keep operation issues OFF the human board (`surfaceVisibility` unchanged).
- **Independent of** the requestWakeup reliability work + wake-governor — this is purely an assignee-resolution defect.
- **Do NOT regress** the consume-before-spawn fix (reader-tldr-stuck-compiling) or the recursion guard `isOwnOperationIssue()` (tldr-heartbeat-recursion).
- **Deploy** via the normal build → tarball → install-helper → restart flow. Two-source version bump REQUIRED: BOTH `package.json` AND `src/manifest.ts` (host reads `dist/manifest.js` built from `src/manifest.ts`). Current live = v1.8.7 → next bump v1.8.8. **TARGET = CounterMoves (Hostinger), NOT ariclaw/BEAAA — see the deploy-target correction below.**
- **Operator cleanup (post-fix):** pre-existing wedged ops created under the bug (assigned CEO/CTO, status in_progress/blocked, originKind `plugin:clarity-pack:operation:tldr-compile`) should be closed (status=done) so the idempotency reuse frees and a fresh, correctly-assigned compile can run. This is a live-DB operator step, NOT a code change.

## Resolution

root_cause: |
  ROOT CAUSE (b) — `resolveEditorAgentId` (src/worker/agents/editor.ts:717-743, pre-fix) discovered "the Editor-Agent" by listing the newest plugin operation issues via an assignee-UNFILTERED `ctx.issues.list({originKindPrefix, includePluginOperations})` and returning `ops[0].assigneeAgentId` (decisive: editor.ts:728-731). The SDK list filter `assigneeAgentId` is optional (types.d.ts:1061) and was omitted, so the list returned ops for ANY assignee. Once Paperclip's host-side terminal-run-recovery reassigned a stuck in_progress clarity op to a NON-editor (source-issue owner CTO `fe557a0e…`, escalating to CEO `8dfeb8db…`), the resolver read that assignee back as the editor id and every NEW op was created with the same wrong assignee (`startAgentTask` → `ctx.issues.create({assigneeAgentId})`, agent-task-delivery.ts:471) — a permanent, self-propagating misassignment. The misassigned agent has no Clarity execution path → the op never terminalizes → Reader wedges on "Compiling…" forever + the 6s "reusing in-flight" idempotency loop + recovery churn on the wrong agents. (a)/(c) eliminated: `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY)` resolves by stable agent KEY (PluginManagedAgentResolution.agentId) and is what compile-bulletin.ts:854 already trusts un-poisoned; the dedicated editor `d385f16a…` is healthy/idle.

fix: |
  Rewrote `resolveEditorAgentId` (editor.ts) to resolve the editor id from the AUTHORITATIVE managed-agent registry FIRST — `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId)` → `res.agentId` — the SAME source compile-bulletin.ts:854 trusts (reconcile resolves by stable resourceKey; cannot be poisoned by a reassigned op; runs INSIDE the caller's valid HTTP-request scope, unlike a detached/scheduled-job scope which PR #6547 kills). REMOVED the op-issue assignee read-back entirely — op assignees are NEVER the editor source of truth. SAFE fallback: when reconcile returns null/throws, return `null` (caller honestly reports `unavailable`; never falls back to an arbitrary op assignee → poison cannot be reintroduced). Surgical: one function body; signature + all 3 call sites unchanged (Reader TL;DR editor.ts:904, action-cards.ts:697, bulletin-gloss.ts:239); editor-heartbeat keeps its host-provided `payload.agentId`; consume-before-spawn (`consumeExistingTldrOpResult`) + recursion guard (`isOwnOperationIssue`) untouched; `requestWakeup`/wake-governor untouched; `surfaceVisibility` unchanged (ops stay OFF the human board); no version bump (deploy step).

verification: |
  LOCAL gate GREEN (2026-06-18): node --test → 2959 pass / 0 fail / 2 skipped (2961 total); tsc --noEmit → exit 0 no errors; build → worker.js 2.6mb + ui/index.js 765.2kb + manifest, all exit 0. Regression test editor-id-resolution-poison.test.mjs RED→GREEN (5/5). Guardrails re-run green (consume-before-spawn orphaned-done-op tests; recursion-guard untouched). Test-fidelity follow-on: 3 older test files updated to supply the authoritative `agents.managed.reconcile` (the contract the fix enforces) — behavioral assertions preserved.
  POST-DEPLOY VERIFICATION RIDER (live, after v1.8.8 deploy — operator):
    1. Open a Reader on an issue OWNED BY A NON-EDITOR agent (e.g. a CTO-owned task). Confirm the freshly-created tldr-compile op's assignee === Editor-Agent UUID `d385f16a-e2d3-409c-bed7-b4e06eecc30d` (NOT the CTO `fe557a0e…` / CEO `8dfeb8db…`).
    2. Confirm the Editor-Agent actually runs the op and it reaches `done` (~1m30s), files a `compile-result` document, and the Reader resolves "Compiling…" → a real TL;DR.
    3. Confirm the worker log no longer shows the 6s `reusing in-flight operation issue … for tldr-compile` loop for that scope.
    4. Confirm NO terminal-run-recovery churn (`Paperclip automatically retried continuation …`) on the CTO/CEO for clarity ops.
  OPERATOR-CLEANUP RIDER (live-DB, one-time — frees the idempotency reuse of already-wedged ops; the code fix prevents NEW ones but does not retroactively terminalize the old ones): close the pre-existing wedged ops — `originKind = plugin:clarity-pack:operation:tldr-compile`, `assigneeAgentId` IN (CEO `8dfeb8db-25fd-4981-ae64-4fd6ed4266c3`, CTO `fe557a0e-54f4-437d-b009-5dccd5a8dd54`), `status` IN (in_progress, blocked) → set `status = done`. After closing them, a fresh Reader open spawns a NEW correctly-assigned (Editor-Agent) compile.
  TWO-SOURCE VERSION BUMP REMINDER (deploy step, NOT done in this fix): bump `v1.8.7 → v1.8.8` in BOTH `package.json` AND `src/manifest.ts` (the host reads `dist/manifest.js` built from `src/manifest.ts`; bumping only one ships v1.8.8 code under a v1.8.7 label).

files_changed:
  - "src/worker/agents/editor.ts — resolveEditorAgentId rewritten: registry reconcile FIRST, op-assignee read-back removed, null-safe fallback (the FIX)."
  - "src/worker/agents/action-cards.ts — refreshed now-stale call-site comment (op-issue discovery → authoritative registry). No logic change."
  - "src/worker/bulletin/bulletin-gloss.ts — refreshed now-stale call-site comment. No logic change."
  - "test/worker/agents/editor-id-resolution-poison.test.mjs — the RED→GREEN regression test (already authored in the RED phase)."
  - "test/worker/agents/tldr-view-driver.test.mjs — makeCtx now supplies agents.managed.reconcile (reconcileEditorId param); the genuine no-editor test uses reconcileEditorId:null; stale comments refreshed."
  - "test/worker/agents/tldr-orphaned-done-op.test.mjs — makeCtx now supplies agents.managed.reconcile."
  - "test/worker/agents/action-cards.test.mjs — 3 ctxs (makeCtx + paused-test + WR-03) now supply agents.managed.reconcile; stale comment refreshed."

## Orchestrator verification + deploy-target correction (2026-06-18)

INDEPENDENTLY RE-VERIFIED by the orchestrator (NOT relayed from the debugger):
- Targeted `node --test` on the fix + guardrail suites = **38/38 pass, 0 fail, 0 skip** — incl. both decisive poison tests (`resolveEditorAgentId` not-poisoned; `driveTldrCompileStep` fresh-op assignee === editor) AND the guardrails (consume-before-spawn orphaned-done-op; `isOwnOperationIssue` recursion guard) still green.
- `tsc --noEmit` re-run = **exit 0 clean**.
- Ancillary diffs (`action-cards.ts`, `bulletin-gloss.ts`) confirmed **comment-only** — the `await resolveEditorAgentId(...)` lines are byte-identical; only the explanatory comment changed.
- **SCOPE-SAFETY (the one real risk — PR #6547 — CLOSED WITH STATIC EVIDENCE, not deferred to a post-deploy rider):** all 3 `resolveEditorAgentId` call sites await `reconcile` INLINE within a live dispatch — Reader request (`editor.ts:904`); editor heartbeat (`editor.ts:417` → action-cards; note `driveActionCardsStep` is DELETED from the situation-room request path per `situation-room.ts:594`); by-cycle handler (`bulletin-by-cycle.ts:229` → bulletin-gloss). `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY)` is used successfully in 4 places across BOTH job and request scopes (`compile-bulletin.ts:854` JOB · `editor-pause-status.ts:160` request · `agent-resume-heartbeat.ts:65` · `reconcileEditorAgent` `editor.ts:133`). PR #6547 kills only DETACHED / post-return RPCs — none of these is detached. The original "scheduled-job reconcile scope is dead" comment was over-cautious / conflated with the detached-scope incident.

**DEPLOY-TARGET CORRECTION:** the observed box is **CounterMoves (Hostinger VPS — `ssh -i ~/.ssh/countermoves_vps_ed25519 eric@82.29.197.74`)**, NOT BEAAA/ariclaw (the initial Notes bullet wrongly inherited the BEAAA deploy memory). CounterMoves HAS an on-box safety-CLI (`node scripts/safety/cli.mjs`; snapshot needs `--db-url` from `/etc/paperclip/db.env`) per memory `countermoves-safety-cli-invocation` — so the bookend snapshot is a CLI snapshot, NOT a DO backup. **NOTE:** BEAAA also runs v1.8.7 and is LATENTLY exposed to the same defect (a host reassignment would poison it too) — the fix should land on both boxes, but the immediate target is CounterMoves.
