# PLAN (for review) — Agent-delivery rework: split across job ticks

**Status:** DRAFT — awaiting Eric's review before any code changes. clarity-pack stays **v1.0.0**.
**Why now:** the on-demand "Generate bulletin now" button (Quick 260528-nns) surfaced a live defect that also affects the **daily** bulletin and **every TL;DR** on BEAAA (paperclipai@2026.525.0).

---

## 1. Root cause (confirmed live on BEAAA)

`agent-task-delivery.ts` `deliverAgentTask` creates an operation issue, wakes the Editor-Agent, then **polls for the result for up to 5 minutes inside a single `complete()` call** (a `while (now < deadline)` loop with `sleep(5s)`). That whole loop runs inside ONE host→worker invocation (one job tick, or one UI action).

paperclipai@2026.525.0 (PR #6547) invalidates the invocation scope once the originating RPC's window passes — well under 5 minutes. So every `ctx.issues.documents.get / .list / listComments` after that window is rejected with **"missing, expired, or unknown invocation scope."**

Evidence (2026-05-28 worker log):
- On-demand click → operation issue `5b95e546…` created + agent woken (sidebar "1 live"), then the poll loop logged 90+ scope-rejections every 5s for 3+ minutes (a zombie poll the UI action had already abandoned).
- 528 total scope errors in the log — but `result DOCUMENT received` succeeded at 07:02–07:03 (fast/warm agent answered inside the window).

So delivery **works only when the agent answers fast enough**; a cold bulletin compile (and especially a UI action, with an even shorter window) reliably outlives its scope. A synchronous long poll is the wrong shape for this host.

## 2. Goal

Both the **daily** bulletin and the **on-demand** button reliably complete the agent-backed compile by **never holding one invocation longer than its validity window**. Each host call happens in a fresh invocation. TL;DR compiles get the same reliability (or are explicitly deferred — see §6 open questions).

## 3. Architecture — split delivery across job ticks (state machine)

Replace the in-invocation long poll with: **start** in one tick, **resume/poll** on subsequent ticks (each a fresh, valid invocation), driven by the every-minute `compile-bulletin` job that already runs.

**`agent-task-delivery.ts`** — new primitives (the 5-min `while` loop is removed):
- `startAgentTask(ctx, opts) → { operationIssueId }` — idempotency-list (reuse in-flight) + create operation issue + `requestWakeup`. One invocation's worth of calls.
- `pollAgentTaskResult(ctx, opts) → { status:'ready', body } | { status:'pending' }` — ONE round of `documents.get(compile-result)` → off-key `documents.list` scan → `listComments` fallback. One invocation's worth of calls.
- Keep `deliverAgentTask` as a thin `start + immediate poll + (no loop)` compatibility wrapper only where a synchronous call is still wanted (tests); production paths use start/poll.

**`compile-pass-1.ts`** — split so the frozen inputs can be reused at finish (avoids re-introducing the v0.6.6 Bug-2 verifier race):
- `buildBulletinPrompt(args) → { prompt }` (the prompt string the agent reads).
- `finalizeBulletinDraft(rawBody, { factsTable, standingNumbers, … }) → BulletinDraft` (the existing post-`complete()` parse + slot-resolve + structure validate).
- `compilePass1` stays as a thin `buildBulletinPrompt → llm.complete → finalizeBulletinDraft` wrapper so existing stub-based tests are untouched.

**`ctx.state` pending record** (per company; `scopeKind:'company'`, `namespace:'bulletin'`, `stateKey:'pending-compile'`):
`{ operationIssueId, operationId, cycleNumber, nextDueAtIso, standingNumberRows (frozen), lineageThreads (frozen), companyName, startedAt, deadline, mode:'cron'|'force' }`. Plain JSON; no migration (uses the host KV store).

**`compile-bulletin.ts` `compileBulletinForCompany`** becomes a per-company state machine:
- **If a pending record exists** → `pollAgentTaskResult` once:
  - `ready` → `finalizeBulletinDraft` + `verifyDraft(draft, frozen standingNumberRows)` + (force) dedupe + `publishBulletin` + `recordSuccess` + clear state + (cron) `advanceScheduleForCompany` → return `published`/`no-change`/`duplicate`.
  - `pending` & before `deadline` → leave state, return `{ kind:'pending' }` (next tick re-polls).
  - `pending` & past `deadline` → (cron) `recordFailure` + `recordCycleCompileFailure` + advance; clear state → return `failed`.
- **Else (no pending)** → the START decision (cron due-gate / `force` / bootstrap). If compiling: `computeStandingNumbers` + `buildBulletinPrompt` + `startAgentTask` + **one immediate `pollAgentTaskResult`** (catches a warm agent + keeps the e2e suite's single-fire-publishes behaviour) → if ready, finish as above; else write the pending record and return `{ kind:'started' }`. **Do not advance the schedule or recordSuccess at START** — only on a terminal outcome.

**Runaway prevention (preserves the v0.6.6 fix intent):** while a pending record exists, every subsequent due tick **polls, never re-starts** (the ctx.state guard) and the idempotency-list reuse prevents a duplicate operation issue. `next_due_at` is advanced only on a **terminal** outcome (publish / no-change / timeout-failure), which then closes the due-gate. No every-minute recompile.

**The button (enqueue → job → poll)** — `bulletin.compileNow` action: write a `ctx.state` force-request marker (`stateKey:'force-requested'`) + return `{ kind:'queued' }` immediately (fast, within the action's invocation). The `compile-bulletin` job, each tick, checks the marker → runs the START path with `force:true` (dedupe on, no schedule advance) → clears the marker. **UI:** button → "Compiling… (≈1 min)" → poll `bulletin.byCycle` (e.g. every 8s for ~2 min) until a newer cycle/publishedAt appears → "Published Bulletin No. N" / "No changes…" / a soft timeout ("still working — check back shortly").

## 4. Test strategy (TDD)

- **Regression net:** the existing `test/worker/bulletin/*` e2e suite (212 tests) must stay green. The "START does one immediate poll" design keeps the fakes' single-fire-publishes behaviour, so most e2e tests pass unchanged; the few that assert cross-tick behaviour get a second `fn(JOB_EVENT)` fire.
- **New worker tests:** pending persists across ticks; a later tick consumes the result + publishes; deadline → failure (cron records, force doesn't); NO duplicate operation issue across ticks (idempotency); force dedupe on the resume tick; schedule advances only on terminal; the force-marker is honoured + cleared.
- **UI:** button enqueues + polls; the three result states; copy.

## 5. Deploy
Bundle: the committed timezone copy fix (`48f8c05`) + this rework. Detached stable-path install to BEAAA (the §5 NEXT-SESSION-BRIEF flow + the fail2ban-safe pattern). Verify: trigger the button → operation issue created → result consumed on a *later* tick → bulletin published (or no-change). Watch the daily 06:30 publish.

## 6. Decisions (LOCKED 2026-05-28, by Eric)
1. **TL;DR scope — INCLUDE in this phase.** The `editor.ts` heartbeat → `compileTldr` → `deliveryLlmAdapter` path has the same flaw and must be fixed now. (Design refinement below: TL;DR is driven off the operation ISSUES, not ctx.state — see §9.)
2. **`ctx.state` capability — CONFIRMED + DONE.** `ctx.state.get` needs `plugin.state.read`, `ctx.state.set`/`delete` need `plugin.state.write` (SDK types.d.ts:545-546,1531). Both added to `manifest.ts` `capabilities[]` (commit 74c9ec6). **Install-validation RISK:** the host validates capabilities at install (same class as the earlier `http.outbound`/`ui.page.register` cases). MUST confirm the BEAAA install accepts these two strings on paperclipai@2026.525.0; if rejected, report (do not work around).
3. **Version — stay v1.0.0.** No bump.
4. **Give-up window — decouple the two timers.** Job-side compile deadline stays **5 min** (`AGENT_TASK_DELIVERY_TIMEOUT`, one shared constant, now measured across ticks via the pending record's `deadlineMs`). UI-side: the button polls ~**90 s** showing "Compiling…", then switches to a calm non-error note ("Still compiling — the Editorial Desk can take a minute or two; your bulletin will appear here when it's ready.") and re-enables. The job finishes in the background regardless.

## 7. Out of scope
No version bump. No migration. No change to the cron's *observable* contract (publishes when due, settles cadence, trips breaker on 3 consecutive failures) — only its internal start/resume mechanics. No second UI framework / new capability beyond the two `plugin.state.*` strings.

---

## 8. EXECUTION STATUS (as of 2026-05-28 end of session) — START HERE

**FOUNDATION DONE — committed on `master`, all green, all BEHAVIOR-NEUTRAL (production path unchanged; NOTHING deployed; daily bulletin behaves exactly as before; the on-demand button still errors gracefully):**

| Commit | What | Tests |
|--------|------|-------|
| `48f8c05` | `fix(bulletin)`: "06:30 ET" → "06:30 Israel time" copy (bulletin-rendering.ts:55, bulletin/index.tsx first-edition, masthead.tsx + its test) | bulletin UI green |
| `74c9ec6` | `refactor(delivery)`: split `deliverAgentTask` → `startAgentTask` + `pollAgentTaskResult` (deliverAgentTask kept as thin start+loop wrapper); **added `plugin.state.read`/`plugin.state.write` to manifest.ts capabilities** | agent-task-delivery 22/22 |
| `ad87033` | `refactor(bulletin)`: split compile-pass-1 → exported `buildBulletinPrompt` + `finalizeBulletinDraft`; `compilePass1` unchanged (calls buildBulletinPrompt internally) | compile-pass-1 47/47 |

**These 3 commits are AHEAD of origin/master (NOT pushed as of the status write — see push step). `git rev-list --left-right --count origin/master...HEAD` → push before/with resuming.**

**New primitives ready for the state machine:**
- `agent-task-delivery.ts`: `startAgentTask(ctx, opts) → {operationIssueId, reused}` (idempotency-list + create + wake); `pollAgentTaskResult(ctx, {operationIssueId, companyId, operationKind, agentId}) → {status:'ready', body} | {status:'pending'}` (one sleepless readback round; catches host-call rejections incl. expired-scope → treats as pending). `AGENT_TASK_DELIVERY_TIMEOUT = 300_000` (5 min).
- `compile-pass-1.ts`: `buildBulletinPrompt({cycleNumber, departments, factsTable, standingNumbers}) → string`; `finalizeBulletinDraft(rawBody, {factsTable, cycleNumber, compiledAt?, companyName?}) → BulletinDraft` (parse → validateDraftSchema → resolveDraftSlots → buildMasthead; THROWS on bad json/schema/unknown-slot; does NOT recordFailure — caller owns that).
- `bulletins-repo.ts`: `getLatestPublishedBulletin(ctx, companyId)` (added in the v1 on-demand quick task d15d19f).
- `publish.ts`: `computeBulletinContentHash(draft)` + `bulletinDedupeHash(draft)` (masthead-excluded substance hash, the dedupe basis).

**NOT yet done (the remaining phase — §9):** the compile-bulletin start/resume state machine, the TL;DR drainer, the `bulletin.compileNow` enqueue rework, the UI poll, test rework, deploy.

**Context — why this exists:** the v1 on-demand button (Quick `260528-nns`, commits `d15d19f`/`8540f51`/`ad60011`) shipped but is NON-FUNCTIONAL on BEAAA: a synchronous UI action runs the agent compile via `deliverAgentTask`'s in-invocation 5-min poll, which paperclipai@2026.525.0 kills mid-poll with "expired invocation scope" (PR #6547). Live evidence 2026-05-28: operation issue `5b95e546…` created + agent woken, then 90+ `documents.get(compile-result)` rejections every 5s. The SAME flaw intermittently breaks the **daily** bulletin + every TL;DR (528 scope errors logged; `result DOCUMENT received` only succeeded at 07:03 when the agent answered fast). BEAAA has "First Edition — not compiled yet" (no bulletin ever published).

---

## 9. RESUME PLAN — detailed implementation (do TDD-first; keep `test/worker/bulletin/*` 212 green as the regression net)

### 9.1 compile-bulletin.ts — `compileBulletinForCompany` becomes a per-company state machine
Current shape (this session's earlier extraction): single-shot gate→reconcile→resume→cycleNumber→standing→facts→`compilePass1`(synchronous `llm.complete`)→verify→(force)dedupe→publish→advance. Rework to:

**ctx.state pending record** — `ctx.state.get/set/delete({ scopeKind:'company', scopeId: company.id, namespace:'bulletin', stateKey:'pending-compile' })`, value:
```
{ operationIssueId, operationId:`cycle-${cycleNumber}`, cycleNumber, nextDueAtIso,
  standingNumberRows (FROZEN), factsTable (FROZEN), lineageThreads (FROZEN),
  companyName, editorAgentId, compiledAtIso, deadlineMs (= start + 300_000), mode:'cron'|'force' }
```

**Flow:**
1. `pending = await ctx.state.get(...)` (defensive: if `ctx.state?.get` absent → skip pending logic; see 9.4 harness note).
2. **If pending:** `poll = pollAgentTaskResult(ctx, {operationIssueId: pending.operationIssueId, companyId, operationKind:'bulletin-compile', agentId: pending.editorAgentId})`.
   - `ready` → `finishCompile(...)` (see below) with `pending` as the frozen inputs + `poll.body`.
   - `pending` & `now > deadlineMs` → timeout: (cron) `recordFailure`+`recordCycleCompileFailure`; clear pending; (cron) `advanceScheduleForCompany`; return `{kind:'failed', reason:'delivery timeout'}`.
   - `pending` & before deadline → leave pending; return `{kind:'pending'}`.
3. **Else (no pending) — START:** the EXISTING gate/bootstrap/reconcile/breaker-resume/cycleNumber/reconcileDepartments/lineage/computeStandingNumbers/factsTable steps (unchanged, with the same `if(!force) advance`/skip semantics on each failure path). Then:
   - `prompt = buildBulletinPrompt({cycleNumber, departments: DEFAULT_DEPARTMENTS, factsTable, standingNumbers: standingNumberRows})`; token-cap check (`estimateTokens(prompt) > MAX_BULLETIN_TOKENS` → (cron) recordFailure+advance, return failed).
   - `{operationIssueId} = await startAgentTask(ctx, {agentId: editorAgentId, companyId, operationKind:'bulletin-compile', operationId:`cycle-${cycleNumber}`, title:`Compile Daily Bulletin — cycle ${cycleNumber}`, prompt})`.
   - **immediate poll** `poll = pollAgentTaskResult(...)` (catches warm agent + KEEPS e2e single-fire-publishes green): if `ready` → `finishCompile(...)`; else → `ctx.state.set(pending record)` + return `{kind:'started'}`. **NO advance, NO recordSuccess at START.**

**`finishCompile(ctx, company, frozen, rawBody, {force, now, bulletinTz})` (shared by the resume-ready + start-immediate-ready branches):**
   - `try { draft = finalizeBulletinDraft(rawBody, {factsTable: frozen.factsTable, cycleNumber: frozen.cycleNumber, compiledAt: new Date(frozen.compiledAtIso), companyName: frozen.companyName}) } catch` → (cron) recordFailure+recordCycleCompileFailure; clear pending; (cron) advance; return `{kind:'failed', cycleNumber}`.
   - `draftWithLineage = {...draft, lineageThreads: frozen.lineageThreads.length>0 ? frozen.lineageThreads : draft.lineageThreads ?? []}`.
   - `verdict = verifyDraft(draftWithLineage, frozen.standingNumberRows)` (FROZEN numbers — verifier honesty). if `!ok` → (cron) recordFailure+recordCycleCompileFailure; clear pending; (cron) advance; return failed.
   - **(force dedupe)** if `force`: `bulletinDedupeHash(draftWithLineage)` vs `getLatestPublishedBulletin(...).draft_json` substance hash → match → clear pending; return `{kind:'no-change', cycleNumber: lastPublished.cycle_number, publishedAt}` (NO advance — force never advances).
   - `priorCycleErratumSnapshot = buildPriorCycleErratumSnapshot(ctx, company.id, frozen.cycleNumber)`.
   - `publishResult = publishBulletin(ctx, {companyId, cycleNumber: frozen.cycleNumber, nextDueAtIso: frozen.nextDueAtIso, editorAgentId: frozen.editorAgentId, draft: draftWithLineage, compiledAt: new Date(frozen.compiledAtIso), priorCycleErratumSnapshot})`.
   - failed → (cron) recordCycleCompileFailure; clear pending; (cron) advance; return failed. duplicate/published → `recordSuccess(BULLETIN_COMPILE_AGENT_KEY)`; clear pending; (cron) advance; return duplicate/published.

**RUNAWAY GUARD (critical — preserves v0.6.6):** while a pending record exists, every due tick POLLS (never re-starts) → exactly one op in flight per company; idempotency-list reuse is a second guard. `next_due_at` is advanced ONLY on a terminal outcome (publish/no-change/timeout-fail), which then closes the due-gate. Add a focused test: two consecutive fires with the agent NOT-yet-ready must create exactly ONE operation issue and NOT advance the schedule.

### 9.2 TL;DR cross-tick (editor.ts) — drive off the operation ISSUES (no ctx.state needed)
TL;DR results are raw text (no frozen numbers), so don't use ctx.state. Instead:
- `handleEditorHeartbeat` per issue: `startAgentTask(... operationKind:'tldr-compile', operationId:`tldr-${issueId}`...)` + ONE immediate `pollAgentTaskResult`; if ready → finalize (the existing `compileTldr` validate + tldr-cache write) now; else leave it.
- **Drainer** (add to the every-minute `compile-bulletin` job, after the company loop, OR a small step in `recompute-situation`): `ctx.issues.list({originKindPrefix:'plugin:clarity-pack:operation:tldr-compile', includePluginOperations:true})` filtered to NON-terminal; for each, `pollAgentTaskResult`; on `ready` → write the tldr-cache (scopeId from operationId `tldr-<issueId>`) + mark the operation issue `done` (terminal = consumed, so it's not re-drained). On the deadline, mark done + skip. Keep the recursion guard (`isOwnOperationIssue`) intact.
- This needs `compileTldr` similarly split (build prompt / finalize text) — mirror the bulletin split; `compile-tldr.ts` is smaller.

### 9.3 bulletin.compileNow action + UI
- **Action** (`bulletin-compile-now.ts`): replace the synchronous `compileBulletinForCompany(force:true)` await with: `ctx.state.set({scopeKind:'company', scopeId:companyId, namespace:'bulletin', stateKey:'force-requested'}, true)` → return `{kind:'queued'}` immediately. The `compile-bulletin` job, at the top of each company iteration, checks the force-requested marker → if set, run the START path with `force:true` (mode:'force') + clear the marker (so it doesn't force every tick). REWORK the existing `bulletin-compile-now.test.mjs` (it currently asserts synchronous published/no-change/error — change to assert the marker is written + `{kind:'queued'}`; move the published/no-change/error assertions to compile-bulletin state-machine tests).
- **UI** (`bulletin/index.tsx` `GenerateBulletinNow`): on click → call action (gets `{kind:'queued'}`) → start polling `bulletin.byCycle` via the `refresh` + a setInterval (~8s) reading the latest cycleNumber/publishedAt; show "Compiling…" for ~90s; if a NEWER bulletin appears → "Published Bulletin No. N" + stop; if 90s elapse with no change → "Still compiling — …will appear here when ready." + re-enable. Rework `test/ui/bulletin-compile-now.test.mjs` copy assertions accordingly.

### 9.4 Test-harness notes (keep 212 e2e green)
- The e2e fakes (`compile-bulletin-end-to-end.test.mjs`, `compile-bulletin-host-faithful.test.mjs` via `test/helpers/host-faithful-ctx.mjs`) need a minimal in-memory `ctx.state` stub: `{ get:async(s)=>store.get(k(s))??null, set:async(s,v)=>{store.set(k(s),v)}, delete:async(s)=>{store.delete(k(s))} }` where `k(s)=`${s.scopeKind}:${s.scopeId}:${s.namespace}:${s.stateKey}``.
- The "START does one immediate poll" design + the fakes returning the canned result on the first poll means existing single-fire tests publish in ONE fire (no pending persisted) → they stay green. NOTE: `compile-bulletin-end-to-end`'s fake `issues` has NO `documents` member → `pollAgentTaskResult`'s `documents.get` throws → caught → falls to the `listComments` fallback which returns the canned draft → ready. (The host-faithful ctx has `documents`.) Both resolve on the immediate poll. Verify this holds when you wire it.
- NEW tests: pending persists across ticks; resume consumes+publishes on a later fire; deadline→failure (cron records, force doesn't); NO duplicate operation issue across ticks; force dedupe on resume; advance only on terminal; force-marker honored+cleared; TL;DR drainer consumes+marks-done.

### 9.5 Gates + deploy (bundle EVERYTHING incl. the 3 foundation commits + timezone fix)
- Gates: `npx tsc --noEmit`; `node scripts/check-css-scope.mjs`; `node scripts/check-ui-bundle-size.mjs` (ceiling currently 700,416 B / 684 kB — bumped in d15d19f); `node --test "test/**/*.test.mjs"` (1 pre-existing `situation-artifacts` fail OK); build worker/ui/manifest; `grep -c paperclipInvocation dist/worker.js` ≥ 5.
- Deploy: detached stable-path to BEAAA (NEXT-SESSION-BRIEF.md §5 + the fail2ban-safe pattern: fresh tgz name, `setsid …>log 2>&1 </dev/null &`, ONE on-box `DEPLOY_DONE`-wait connection; batch SSH — see MemPalace runbook `HOWTO-deploy-clarity-pack-to-beaaa`). **VERIFY the capability install accepts `plugin.state.read`/`write`** (install must end `status=ready version=1.0.0`); if it errors on the capability, report.
- **Verify the fix:** trigger `bulletin.compileNow` (or wait a daily tick) → confirm the operation issue's result is CONSUMED on a LATER job tick (worker log: `result DOCUMENT received` followed by `publishBulletin result kind=published` — NOT a wall of `expired invocation scope`) → a "Bulletin No. N" issue publishes → the page renders it. This is the acceptance the v1 button never reached.

### 9.6 Gotchas carried from this session
- **fail2ban**: rapid SSH to BEAAA gets the IP banned (timeouts, NOT a down box). Batch into few connections; detached install; if it times out, wait/Path B.
- **mempalace_search "Error finding id"**: transient HNSW; retry UNSCOPED (no wing filter) or `mempalace_reconnect` (see auto-memory `mempalace-search-error-finding-id`).
- **The zombie poll** from the v1 button's timed-out action may still be logging on BEAAA until its 5-min deadline — harmless, self-terminates.
- **Editor-Agent on BEAAA is ACTIVE** (status idle, pausedAt null, id `618eec58-2a0d-422f-9fbd-672c0cdddf2c`, company `59f8876e-…`). It DOES answer (07:03 success) — the bug is purely the cross-invocation poll, which this rework fixes.
