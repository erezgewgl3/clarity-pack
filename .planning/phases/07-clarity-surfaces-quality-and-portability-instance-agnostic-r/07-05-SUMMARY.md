---
phase: 07-clarity-surfaces-quality-and-portability-instance-agnostic-r
plan: 05
subsystem: Bulletin lineage filter + view-driven LLM gloss + clickable affordances (the LAST Phase 7 chunk)
tags: [bulletin, lineage, filter, gloss, editor-agent, tldr-cache, view-driven, clickable, deep-link, no-uuid-leak, BULL-10, D-I5-01, D-I5-02, D-I5-03, D-I5-04]
requires:
  - src/worker/agents/editor.ts (driveTldrCompileStep template + resolveEditorAgentId — now exported)
  - src/worker/agents/compile-tldr.ts (tldrContentHash + finalizeTldr cache primitives)
  - src/worker/db/tldr-cache.ts (getTldrByScope + the surface='bulletin' union — NO migration)
  - src/worker/agents/agent-task-delivery.ts (startAgentTask + pollAgentTaskResult + OperationKind)
  - src/worker/handlers/bulletin-by-cycle.ts (the valid-scope read handler that resumes pending compiles)
  - src/ui/surfaces/chat/deep-link.mjs (buildChatDeepLink employee-only carrier — ROOM-09)
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx (07-03 item-4 affordance idiom mirrored)
provides:
  - src/worker/bulletin/lineage-filter.ts (filterLineageThreads + isRoutineThread — pure, conservative)
  - src/worker/bulletin/bulletin-gloss.ts (driveBulletinGlossStep — view-driven gloss compile, cached, paused-graceful)
  - src/worker/handlers/bulletin-by-cycle.ts (filters + enriches identifier/ownerAgentId + glosses lineage threads)
  - src/ui/surfaces/bulletin/lineage-footer.tsx (count-aware heading + per-thread gloss + 2 affordances)
  - src/shared/types.ts (LineageThread gains optional gloss/identifier/ownerAgentId)
affects:
  - "BULL-10 — the lineage section reads as insight not a LOG; routine/dup threads filtered, survivors glossed + clickable"
  - "agent-task-delivery OperationKind — adds a third operation kind ('bulletin-gloss') with a JSON-object readback gate"
tech_stack:
  added: []   # NO new runtime dep — the filter is hand-rolled, the gloss reuses the TL;DR engine + tldr_cache
  patterns:
    - "View-driven gloss compile (mirror of driveTldrCompileStep): cache-check getTldrByScope('bulletin', 'bulletin-gloss:<cycle>') → on miss resolveEditorAgentId (op-issue discovery, no dead reconcile) → PAUSED check (no auto-resume) → startAgentTask + ONE poll → finalizeTldr the JSON {threadId→gloss} map. NEVER throws; paused/unavailable → status + gloss:null."
    - "Content-hash keyed to the FILTERED thread set (canonical id + node name/detail/time signatures, fixed ordering) so the gloss recompiles ONLY when the surviving threads change — not on every view. Cache HIT short-circuits with NO agent call."
    - "Pure conservative filter: a thread is routine only when EVERY node is cadence-shaped (a single substantive node defeats it); exact dups dropped by entityId+node signature keeping the first; unsure → keep. No ctx, no I/O, byte-equal output, never mutates input."
    - "Read-time enrichment in the data handler: dedupe distinct entityIds, ctx.issues.get in parallel per-entity, read .identifier (open-issue link) + .assigneeAgentId ?? .assigneeUserId (chat-link target). A thrown/absent get → identifier:null/ownerAgentId:null. The UUID is the chat-link target ONLY — never rendered (NO_UUID_LEAK)."
    - "LineageFooter reuses the 07-03 banner affordance idiom byte-for-byte: useHostNavigation/useHostLocation + extractCompanyPrefixFromPathname + buildChatDeepLink({route:'employee-only'}); owner-gated chat affordance; React text nodes only; no dangerouslySetInnerHTML."
    - "Empirical bundle-ceiling recalibration (05-04/05-11/07-02/07-03/07-04 precedent): the LineageFooter delta overflowed the ~1.4 kB 07-03 headroom; ceiling 704→708 kB with a dated justification comment + a confirmed zero-SheetJS scan."
key_files:
  created:
    - src/worker/bulletin/lineage-filter.ts
    - src/worker/bulletin/bulletin-gloss.ts
    - test/worker/bulletin/lineage-filter.test.mjs
    - test/worker/bulletin/bulletin-gloss.test.mjs
    - test/ui/surfaces/bulletin/lineage-footer.test.mjs
  modified:
    - src/shared/types.ts
    - src/worker/agents/editor.ts
    - src/worker/agents/agent-task-delivery.ts
    - src/worker/handlers/bulletin-by-cycle.ts
    - src/ui/surfaces/bulletin/lineage-footer.tsx
    - src/ui/styles/bulletin.css
    - test/worker/bulletin/bulletin-by-cycle-handler.test.mjs
    - scripts/check-ui-bundle-size.mjs
    - .planning/REQUIREMENTS.md
  deleted: []
decisions:
  - "GLOSS-COMPILE-SCOPE = the bulletin.byCycle DATA HANDLER (a valid HTTP-request scope already used to RESUME pending compiles), NOT the scope-dead compile-bulletin scheduled job (paperclipai@2026.525.0 PR #6547). Mirrors the shipped driveTldrCompileStep (TL;DR in the issue.reader handler's valid scope)."
  - "CACHE-vs-MIGRATION = NO new migration. The gloss reuses the EXISTING tldr_cache table — its surface column already admits 'bulletin' (tldr-cache.ts:27 + types.ts:42), the body column holds the JSON {threadId→gloss} map string, and the (surface,scope_id,content_hash) UNIQUE constraint gives idempotency for free. Deliberate reuse, not an oversight."
  - "ONE agent operation per view emits a JSON MAP for ALL surviving threads (not N tasks) — cheaper/faster; the prompt instructs STRICT JSON {id→one-line sentence}, instance-agnostic (no BEAAA literal)."
  - "Added 'bulletin-gloss' to the OperationKind union + a dedicated readback gate (isResultComment): a gloss result body must parse to a non-array JSON object of sane size. The TL;DR + bulletin-compile gates are byte-unchanged."
  - "resolveEditorAgentId EXPORTED from editor.ts (one-word back-compat change) and reused by the gloss step rather than replicated."
  - "Owner source for the chat affordance = the thread's entityId resolved via ctx.issues.get .assigneeAgentId ?? .assigneeUserId; gated like the 07-03 banner (null owner → chat affordance disabled, open-issue affordance still shows)."
  - "Heading reframe (D-I5-04): 'Work in motion — N threads' (singular '1 thread' when one) — the original 'One artifact, end-to-end' was WRONG because it claimed one while showing many."
  - "Bundle ceiling recalibrated 704→708 kB (724,992 B): the LineageFooter delta (gloss element + 2 affordances + count-aware heading + the now-required hook wiring) is the only UI-bundle addition (+2,417 B over the prior ceiling); zero SheetJS sentinels confirmed; per the 05-04/05-11/07-02/07-03/07-04 empirical-recalibration precedent."
metrics:
  duration: "~1 session (autonomous)"
  tasks_completed: 3
  files_created: 5
  files_modified: 9
  files_deleted: 0
  completed_date: "2026-05-29"
  suite: "2156 total / 2153 pass / 1 fail (pre-existing situation.artifacts) / 2 skip"
---

# Phase 7 Plan 05: Bulletin lineage filter + gloss + clickable (ITEM 5) Summary

**One-liner:** The Daily Bulletin's "ONE ARTIFACT, END-TO-END" lineage section no longer reads like a flat activity LOG — a pure conservative filter drops routine/scheduled outputs (Daily/Nightly digests, status reports) and exact-duplicate threads while keeping agent-self substantive work; each surviving thread now carries a one-line plain-English Editor-Agent gloss ("what this means for you") compiled VIEW-DRIVEN in the `bulletin.byCycle` data handler's valid request scope and cached in the EXISTING `tldr_cache` (surface='bulletin', no migration); and each thread gets TWO clickable affordances (open the issue + open chat with the owner via the reused ROOM-09 carrier). The heading reframes to a count-aware label. No raw UUID is rendered anywhere (NO_UUID_LEAK). Version stays 1.0.0; no migration; no new runtime dep.

## What shipped

### 1. Pure lineage FILTER (D-I5-01) — Task 1

`src/worker/bulletin/lineage-filter.ts` exports `filterLineageThreads` + the unit-testable `isRoutineThread` predicate. PURE (no ctx, no I/O, byte-equal output, never mutates input; mirrors `lineage-grouper.ts` style). It:

- **Drops routine/scheduled threads:** a thread is routine only when it has ≥1 node AND **every** node is cadence-shaped (case-insensitive tokens `daily`/`nightly`/`weekly`/`digest`/`status report`/`status update`, plus a `<Cadence> … report` pairing so a bare substantive "report" is NOT caught). A SINGLE non-cadence node defeats the routine flag — conservative, D-I5-01 "when unsure, keep". On BEAAA these are the "Daily Founder digest" / "Daily CEO status report" ×2 / "Nightly Auditor Report" threads.
- **Drops exact duplicates:** a canonical signature (`entityId|name~detail~time>…`) keeps only the FIRST occurrence (stable, order-preserved).
- **Keeps everything else** (agent-self substantive threads). Never throws on a malformed thread (missing name/detail → empty strings).

Instance-agnostic (no `BEAAA` literal). Pinned by `test/worker/bulletin/lineage-filter.test.mjs` (RED→GREEN): routine-drop, dup-drop, agent-self-keep, conservative single-substantive-node, mixed-set order-preservation, empty/null/undefined → [], malformed → no-throw, purity (no input mutation), and a NO_UUID_LEAK composite-id pass.

### 2. View-driven gloss COMPILE step (D-I5-02) — Task 1

`src/worker/bulletin/bulletin-gloss.ts` exports `driveBulletinGlossStep(ctx, { companyId, cycleNumber, threads })` mirroring `driveTldrCompileStep` exactly:

1. `threads.length === 0` → `{ threads:[], status:'glossed' }`, no agent call.
2. Build `scopeId = 'bulletin-gloss:'+cycleNumber` + a `contentHash = tldrContentHash({surface:'bulletin', scopeId, inputs:{ body:<canonical JSON of the filtered threads' id + node signatures>, comments:[], refs:[] }})`. Cache-check `getTldrByScope(ctx,'bulletin',scopeId)`; a row whose `content_hash` matches → parse `row.body` as the JSON map, apply (`thread.gloss = map[thread.id] ?? null`), return `glossed` — **NO compile**.
3. Cache MISS → `resolveEditorAgentId(ctx, companyId)` (the EXPORTED editor helper — op-issue discovery, no dead reconcile loop). Null → all `gloss:null`, `status:'unavailable'`.
4. PAUSED check (`ctx.agents.get`; `status==='paused' || pausedAt != null`) → all `gloss:null`, `status:'paused'` — does NOT start, **never auto-resumes** (governance parity, mirrors the TL;DR lock).
5. `startAgentTask({operationKind:'bulletin-gloss', operationId:'bulletin-gloss-'+cycle, …, prompt})` + ONE `pollAgentTaskResult`. Not ready → `gloss:null`, `status:'compiling'`. Ready → defensively `JSON.parse` the map (parse-throw/non-object → all-null), `finalizeTldr({surface:'bulletin', …, body:<raw JSON map string>})`, apply the map, mark the op issue done (best-effort), return `glossed`.
6. **NEVER throws** — every host call is in a try/catch that degrades to `gloss:null` + a non-error status.

`OperationKind` gains `'bulletin-gloss'` + a dedicated readback gate in `agent-task-delivery.ts` (a gloss result must parse to a non-array JSON object of sane size — the TL;DR + bulletin-compile gates byte-unchanged). `resolveEditorAgentId` is now `export`ed from `editor.ts` (one-word, back-compat). `LineageThread` gains the three optional fields `gloss?`/`identifier?`/`ownerAgentId?` (pre-05 persisted draft_json rows still type-check). Pinned by `test/worker/bulletin/bulletin-gloss.test.mjs` (RED→GREEN): empty→no call; cache-hit→no startAgentTask; ready→gloss applied + finalizeTldr once; paused→null + no start + **no resume**; unavailable→null; not-ready→compiling; start-throw / non-JSON body→null without throwing; NO_UUID_LEAK in the returned gloss.

### 3. Handler wire-in: filter + enrich + gloss (D-I5-03 enrichment) — Task 2

`src/worker/handlers/bulletin-by-cycle.ts` — after the draft parse, before the return (all **best-effort**; a hiccup NEVER fails the bulletin read):

1. `filterLineageThreads(draft.lineageThreads ?? [])`.
2. **Enrich**: dedupe distinct `thread.entityId`s, resolve each via `ctx.issues.get(entityId, companyId)` in parallel (each in try/catch), read `.identifier` (→ `thread.identifier`) and `.assigneeAgentId ?? .assigneeUserId ?? null` (→ `thread.ownerAgentId`). A thrown/absent get → `identifier:null, ownerAgentId:null`. The UUID is carried ONLY as `ownerAgentId` (the chat-link target) — never as text.
3. **Gloss**: `driveBulletinGlossStep(driveCtx, {companyId, cycleNumber:row.cycle_number, threads})` (the existing `ctx as unknown as CompileBulletinCtx` cast already carries db/issues/agents; cast onward to `BulletinGlossCtx`). On throw → threads with `gloss:null`.
4. Return `lineageThreads` (the filtered+enriched+glossed array) in place of `draft.lineageThreads ?? []`.

Pinned by extended `test/worker/bulletin/bulletin-by-cycle-handler.test.mjs`: routine + dup filtered (only `t-sub` survives); survivor enriched with `identifier:'COU-42'` + `ownerAgentId:'agent-7'` + a `gloss` string; NO raw UUID in any returned gloss; a thrown gloss degrades to `gloss:null` (read does NOT fail); a paused agent → `gloss:null`. The pre-existing `cycle=latest` deep-equal was updated to the additive-fields shape (the stub thread survives the filter and degrades to null enrichment with no agents/issue metadata).

### 4. LineageFooter render: heading + gloss + 2 affordances (D-I5-02/03/04) — Task 2

`src/ui/surfaces/bulletin/lineage-footer.tsx` — now a hook-calling component (mirrors the 07-03 banner):

- **Heading (D-I5-04):** reframed from `One artifact, end-to-end` to a count-aware `Work in motion — {N} thread(s)` label.
- **Gloss (D-I5-02):** each thread renders `thread.gloss` as a `.clarity-bulletin-thread-gloss` line, or a quiet `.clarity-bulletin-thread-gloss--pending` "Gloss pending…" note when null — NOT an error.
- **Two affordances (D-I5-03):** a `.clarity-bulletin-thread-actions` row — "Open issue" navigates `/<companyPrefix>/issues/<identifier>` (disabled when identifier null) and "Open chat with owner" builds `buildChatDeepLink({route:'employee-only', companyPrefix, assigneeAgentId: thread.ownerAgentId})` then `navigate(deepLink.to)` (disabled when ownerAgentId null). `companyPrefix` derived internally via `useHostLocation` + `extractCompanyPrefixFromPathname` (the `{ threads }` prop shape + the `index.tsx` mount are unchanged).
- React text nodes ONLY; NO `dangerouslySetInnerHTML`; `entityId`/`ownerAgentId` NEVER rendered as visible text.

New CSS scoped under `[data-clarity-surface="bulletin"]` (gloss + actions selectors). Pinned by `test/ui/surfaces/bulletin/lineage-footer.test.mjs` (source-grep, the repo idiom — no jsdom): imports, heading reframe, gloss + pending render, both affordances, owner-gating, no-innerHTML, no-UUID-as-text, no hardcoded UUID, and the scoped CSS selectors.

### 5. BULL-10 — Task 2

`BULL-10` added to `.planning/REQUIREMENTS.md` (a bullet in the BULL block + a status-table row marked **Pending** — flips to Implemented after the live BEAAA drill confirms the filter + gloss + affordances).

## Deviations from Plan

**1. [Rule 3 — path adaptation] The handler test file is `test/worker/bulletin/bulletin-by-cycle-handler.test.mjs`, not the plan's `test/worker/bulletin-by-cycle.test.mjs`.** The plan's `files_modified` listed `test/worker/bulletin-by-cycle.test.mjs`; the actual existing suite lives at `test/worker/bulletin/bulletin-by-cycle-handler.test.mjs`. Extended the real file in place (kept all 7 original tests green). No behavior change — just the correct path.

**2. [Rule 2 — required for the readback to work] Added a `'bulletin-gloss'` branch to the agent-task-delivery readback gate.** `OperationKind` was a closed union (`bulletin-compile | tldr-compile`); an unhandled kind fell into the `bulletin-compile` branch which validates a full BulletinDraft structure and would REJECT the gloss JSON map. Added `'bulletin-gloss'` to the union + a dedicated `isResultComment` branch (accept a non-array JSON object of sane size). Without this the ready poll would never recognize a gloss result. The other two gates are byte-unchanged. Pinned by the Task-1 ready/malformed tests.

**3. [Rule 1 — intended TDD churn] The pre-existing `cycle=latest` deep-equal assertion updated.** The original test asserted `result.lineageThreads` deep-equals `stubDraft().lineageThreads`; the handler now attaches the additive `identifier/ownerAgentId/gloss` fields (the stub thread has empty nodes → not routine → survives, then degrades to null enrichment with no agents/issue metadata). Updated to assert the additive-fields shape in the same task. Not a regression — strictly additive read-time enrichment.

**4. [AUTHORIZED recalibration] UI bundle ceiling 704 → 708 kB.** The LineageFooter delta (gloss element + the two affordances + count-aware heading + the now-required `useHostNavigation`/`useHostLocation`/`buildChatDeepLink`/`extractCompanyPrefixFromPathname` wiring) pushed the built `dist/ui/index.js` from 719,502 B (07-03) to **723,313 B** (+3,811 B over the 07-03 build; +2,417 B over the prior 704 kB / 720,896 B ceiling, overflowing the ~1.4 kB 07-03 headroom). The filter + gloss step are worker-side (zero UI cost) and the `LineageThread` type fields are type-only (zero runtime). Per the plan's explicit contingency + the empirical-recalibration precedent (05-04 / 05-11 / 07-02 / 07-03 / 07-04): confirmed **zero SheetJS sentinels** (`XLSX`/`SheetJS`/`!ref` all 0 in the UI bundle), bumped `UI_BUNDLE_BYTES_CEILING` 704→708 kB (724,992 B, ~1.7 kB / 1,679 B headroom) with a dated justification comment. The locked feature surface (D-I5-02/03/04) was NOT crippled to fit ~2.4 kB.

## Threat surface

- **T-07-05-UUID (load-bearing) — mitigated.** The owner UUID is resolved to a chat-link TARGET only (`thread.ownerAgentId`) and NEVER rendered as text; the open-issue link uses the human `identifier` (not the entityId UUID); the gloss step does not inject raw host UUIDs into the prompt (only the opaque composite `thread.id` as the map key). Pinned by the Task-1 gloss test (composite-id, no UUID in the returned gloss), the Task-2 handler test (no UUID in any returned gloss), and the Task-2 UI test (entityId/ownerAgentId never a visible text node + no UUID-shaped string in source).
- **T-07-05-XSS — mitigated.** LineageFooter emits React text nodes only (no `dangerouslySetInnerHTML`); affordances navigate via the host router; the chat link rides the URL_HASH carrier. Pinned by the Task-2 no-innerHTML source-scan.
- **T-07-05-LLM — mitigated.** The gloss result is `JSON.parse`d in a try/catch (parse-throw / non-object → all-null; the step never throws); each applied gloss is a plain string rendered as an escaped React text node; the compile runs via the governed operation-issue handoff (budget caps + pause/terminate). Pinned by the Task-1 malformed-body test.
- **T-07-05-SCOPE — mitigated.** The gloss computes in the `bulletin.byCycle` DATA HANDLER (valid scope), NOT the scope-dead compile-bulletin job. Pinned by the Task-1 plain-ctx gloss-step test + the Task-2 handler test.
- **T-07-05-PAUSE — mitigated.** Paused/unresolvable → no gloss (graceful), never an error, never auto-resume. Pinned by the Task-1 paused test (no startAgentTask, no resume).
- **T-07-05-DoS — accepted.** Enrichment is a bounded handful of deduped reads (survivors only); the gloss is ONE agent task per view (a JSON map for all threads) cached by the filtered-thread content-hash (subsequent views are cache-hits). **T-07-05-SC — mitigated: NO new runtime deps** (`package.json` `dependencies` unchanged; no install attempted).

## Quality gates (Task 3 — all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `node scripts/check-css-scope.mjs` | PASS — 164 selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/build-worker.mjs` | PASS — dist/worker.js 2.5 MB |
| `node scripts/build-ui.mjs` | PASS — dist/ui/index.js 706.4 kB (723,313 B) |
| `npx tsc --project tsconfig.manifest.json` | PASS — dist/manifest.js version '1.0.0' |
| `node scripts/check-ui-bundle-size.mjs` | PASS — **723,313 B ≤ 724,992 ceiling (recalibrated 704→708 kB, see Deviation #4)**; 0 SheetJS sentinels |
| `node --test "test/**/*.test.mjs"` | **2156 total / 2153 pass / 1 fail / 2 skip** — the 1 fail is the documented pre-existing `situation.artifacts: per-agent arrays sorted DESC by createdAt`; every other test passes |
| `grep -c paperclipInvocation dist/worker.js` | **5** (≥ 5 — SDK NOT externalized) |
| Version literal | `1.0.0` in package.json:3 AND src/manifest.ts:337 AND dist/manifest.js — NO bump |
| No new dep / migration | `dependencies` unchanged; no new migration (latest is 0014, untouched) |
| Source assertions | `lineage-filter.ts` exports filterLineageThreads + isRoutineThread, pure (no `ctx.`), no `BEAAA`; `bulletin-gloss.ts` reuses getTldrByScope/finalizeTldr/tldrContentHash + surface:'bulletin' + no `resume` call + no `BEAAA`; `bulletin-by-cycle.ts` calls filterLineageThreads + driveBulletinGlossStep (the dead compile-bulletin JOB untouched); `lineage-footer.tsx` no `dangerouslySetInnerHTML`, renders thread.gloss, reframes the heading, never renders entityId/ownerAgentId as text |

## Tarball

- **filename:** `clarity-pack-1.0.0.tgz` (repacked at the orchestrator's deploy step from this commit)
- **sha256:** `54e517e6b4fa386c7c7d1ba37a0eaeea5237ec769e1f4c6ef83d82f8f5f87f63`
- **size:** `714536` bytes (714.5 kB)
- **files:** 18 (dist/ + migrations/ + README.md + package.json); 0 src/, 0 test/, 0 .png leaks
- **version:** 1.0.0 (unchanged)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `93fb085` | feat(07-05): pure lineage filter + view-driven bulletin gloss step (RED→GREEN) |
| 2 | `3628a84` | feat(07-05): wire lineage filter+gloss+enrichment into byCycle + LineageFooter UI |
| 3 | (this commit) | docs(07-05): full gates + builds + pack + SUMMARY/STATE/ROADMAP/REQUIREMENTS |

---

## AUTONOMOUS post-build deploy + live BEAAA Playwright drill (run by the orchestrator — verdicts TBD)

Performed by the orchestrator window AFTER this build/pack — do NOT pause for operator approval. Deploy via DEPLOY-RUNBOOK Path A (PRE-AUTHORIZED: the bookended-by-snapshots rule is satisfied by the DO daily backup + the rehearsed Phase 1 restore; no manual pre-deploy snapshot — memory `autonomous-deploy-authorization`). Requires the LOCAL environment (authenticated localhost:3100 tunnel + BEAAA SSH). Minimize SSH connections (rm+cat-over-stdin upload as ONE connection + one install here-string) — fail2ban bans rapid SSH. Radix tabs need a real `browser_click`; read DOM via `browser_evaluate`. The Editor-Agent IS running on BEAAA (item-3/item-4 drills), so the gloss is live-verifiable; BEAAA's bulletin has the routine/scheduled threads (Daily Founder digest, Daily CEO status report ×2, Nightly Auditor Report) the filter must drop.

1. **Routine/dup threads are filtered out (PRIMARY).** Open `/<prefix>/bulletin`; `browser_evaluate` the lineage section DOM — assert the lineage threads NO LONGER include the routine/scheduled outputs (Daily Founder digest / Daily CEO status report / Nightly Auditor Report) NOR exact-duplicate threads; the section reads as distinct substantive threads, not a flat LOG. — **VERDICT: PASS** (2026-05-29, BEAAA "Vol. I · No. 1", `f34c5eee…` tarball). The lineage section rendered `Work in motion — 1 thread` — exactly the single substantive thread ("AC#2 live re-runs — Voiceflow 25/25 + NS priors via promptfoo runner"); the routine/scheduled outputs + exact dups are filtered out.
2. **Surviving threads show a one-line gloss (Editor-Agent running).** Assert each surviving thread renders a one-line plain-English gloss element — OR, if the agent is paused, a calm "Gloss pending…" (NOT an error / NOT "Compiling…" forever). On a first view the gloss may be pending while it compiles; a second view (after the byCycle re-poll) should show the cached gloss. Assert NO raw base62/UUID string appears in any gloss text (NO_UUID_LEAK live check). — **VERDICT: PASS** (Editor-Agent "1 live"). The surviving thread shows the gloss TEXT: *"We re-ran the live quality tests on your voice assistant 25 times to confirm its answers stay consistent run-to-run, so the quality numbers you cite are trustworthy."* `browser_evaluate`: `hasGlossPending:false`, `uuidInPageText:false` on BOTH views. **This required the read-back idempotency fix (commit `dad114b`)** — the original 07-05 ship spawned a fresh op every view + did one immediate poll that always returned pending, so the agent's stored result was never read back ("permanent Gloss pending"). The fix: on a cache-miss the gloss step now reads back the EXISTING op's stored `compile-result` BEFORE spawning a new one. Worker log proof — view 1 (10:58:47): `result DOCUMENT received on operation issue 5c9712b4-… (key=compile-result)` (an op created 10:20:43, pre-deploy) → finalized into the cache; view 2 (11:01:48): `bulletin.byCycle 200` with NO new op + NO read-back poll = pure cache hit. No fresh op per view.
3. **Both per-thread affordances exist + work.** Assert each thread carries the two affordances — "Open issue" (navigates `/<prefix>/issues/<identifier>`) and "Open chat with owner" (builds the employee-only `#h=` deep link). A `browser_click` on "Open chat" should land on the chat surface with the owner pre-selected (reuses the verified ROOM-09 carrier). — **VERDICT: PASS** (structural — both buttons present on the surviving thread; the click-through carrier itself was already verified live in the 04.2 ROOM-09 + 07-03 drills).
4. **Heading + scope-fence sanity.** Confirm the heading no longer falsely claims "one artifact" while showing many (count-aware label); confirm the rest of the bulletin (masthead, action inbox, departments, standing numbers, errata) renders unchanged. Record the BEAAA filtered-thread count + a sample gloss + a sample row's owner-name. — **VERDICT: PASS**. Heading: `Work in motion — 1 thread` (count-aware, no false "one artifact"); the masthead ("The Bulletin · Vol. I · No. 1"), four department summaries, and Standing Numbers (Open 151 / Completed·7d 256 / Blocked 24 / Spend $0 / Budget 0.0%) all render unchanged. Filtered-thread count = 1; sample gloss recorded in step 2; owner not surfaced as text (NO_UUID_LEAK — the owner UUID is the chat-link target only).

**ALL FOUR VERDICTS PASS** (live BEAAA drill 2026-05-29, tarball `f34c5eee00b24cde4cc18c2d12b668432f6b7a1f190734dbc3e3328f4f495872`, deployed via Path A in 2 SSH connections; `status=ready version=1.0.0 id=a763176a-…`). **BULL-10 → Implemented.** This is the LAST Phase 7 chunk — **Phase 7 is COMPLETE.** Next action: Plan 05-10 (rc → 1.0.0 npm publish + milestone close, operator-gated).

## Self-Check: PASSED

- Created files exist: `src/worker/bulletin/lineage-filter.ts`, `src/worker/bulletin/bulletin-gloss.ts`, `test/worker/bulletin/lineage-filter.test.mjs`, `test/worker/bulletin/bulletin-gloss.test.mjs`, `test/ui/surfaces/bulletin/lineage-footer.test.mjs`, `07-05-SUMMARY.md` — all FOUND.
- Per-task commits exist: `93fb085` (Task 1), `3628a84` (Task 2) — both FOUND.
- Full gate battery green (Task 3) except the documented pre-existing `situation.artifacts` test; bundle ceiling recalibrated 704→708 kB (justified, zero SheetJS); tarball packed sha256 `54e517e6…`.
- Live BEAAA deploy + Playwright drill NOT run in this build task — orchestrator-pending (verdicts TBD above).
