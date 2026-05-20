---
gsd_state_version: 1.0
milestone: v0.6.6
milestone_name: milestone
status: executing
last_updated: "2026-05-20T10:04:28Z"
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 47
  completed_plans: 32
  percent: 68
---

# State: Clarity Pack

**Initialized:** 2026-05-07
**Last updated:** 2026-05-07

## Project Reference

**What:** A Paperclip plugin (`clarity-pack`) that adds four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of an unmodified Paperclip install, for a solo founder running Paperclip's agent-driven org chart on the live BEAAA insurance project.

**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

**Current Focus:** Phase 4.1 (Chat → True Task) — Wave 3 in progress 2026-05-20. Plans 04.1-02 + 04.1-03 + 04.1-04 + 04.1-05 COMPLETE; Plan 04.1-06 (Wave 3 UI surfaces) ready to run next; Plan 04.1-07 (closure) follows.

## Current Position

Phase: 04.1 (chat-true-task) — Wave 3 in progress 2026-05-20 (Wave 1 CLOSED with Gate Verdict GO; Wave 2 worker tier complete).
Plan: 5 of 7 complete — **Plan 04.1-05 COMPLETE 2026-05-20; 2 plans remaining.**

**Plan 04.1-05 — chat-topic archive (D-10) + chat.taskOwned (D-08) + chat_topic_tasks side table + createTrueTask cross-plan retrofit: COMPLETE 2026-05-20.**
Autonomous TDD. 2 tasks + 1 cross-plan retrofit / 8 commits `f0e1862..bc2e26e`:
- `f0e1862` (Task 1 RED) — `test(04.1-05): RED -- setChatTopicArchived + chat_topic_tasks repo helpers` (R1-R5: setChatTopicArchived UPDATE shape + boolean pass-through; insertChatTopicTask ON CONFLICT DO NOTHING + idempotency; listChatTopicTasksForTopic newest-first + scoping).
- `b821796` (Task 1 GREEN, repo + migration) — `feat(04.1-05): setChatTopicArchived + chat_topic_tasks side table (D-10 + D-08)` — migrations/0007_chat_topic_tasks.sql (additive plugin-namespace; validator-conformant per 0006 precedent: no procedural blocks, no standalone CREATE INDEX, apostrophe-free comments, ends on a semicolon-terminated statement) + repo helpers (setChatTopicArchived mirrors updateChatMessagePinned; insertChatTopicTask race-safe; listChatTopicTasksForTopic LIMIT 50 bounded).
- `3468234` (Task 1 RED, handler) — `test(04.1-05): RED -- chat.topic.archive handler tests` (8 cases incl. D-10 critical Test 6: spy on ctx.issues.update, zero invocations across both paths).
- `3cc126b` (Task 1 GREEN, handler) — `feat(04.1-05): chat.topic.archive action handler (D-10 -- plugin-side, never touches host status)` — new `src/worker/handlers/chat-topic-archive.ts` exports `registerChatTopicArchive`. The handler does NOT import the host issue-mutation API (no ctx.issues.update import or call); the load-bearing D-10 invariant is pinned by construction AND by the Test 6 spy. Registered in src/worker.ts alongside the existing chat handlers.
- `b99e3fe` (Task 2 RED) — `test(04.1-05): RED -- chat.taskOwned handler tests` (14 cases incl. Test 10 Pitfall-5 anti-regression: spy on ctx.issues.list, zero invocations across populated + empty paths).
- `ae67356` (Task 2 GREEN) — `feat(04.1-05): chat.taskOwned data handler (D-08 -- side-table lookup, no N+1)` — new `src/worker/handlers/chat-active-tasks.ts` exports `registerChatActiveTasks`. Reads chat_topic_tasks via listChatTopicTasksForTopic (LIMIT 50), enriches per-row via ctx.issues.get; per-row failures + null returns are SKIPPED (not failed). SELECT failure -> { error: 'TASKS_FAILED' } + warn-log. Defensive defaults (identifier/title/status/createdAt) for sparse host rows.
- `3cb1c83` (cross-plan retrofit RED) — `test(04.1-05): RED -- createTrueTask cross-plan retrofit (side-table back-link)` (4 tests: writes back-link / failure doesn't bubble / write skipped if create itself throws / write still issued if marker fails).
- `bc2e26e` (cross-plan retrofit GREEN) — `feat(04.1-05): createTrueTask cross-plan retrofit (chat_topic_tasks back-link)` — TrueTaskCtx grows an optional `db` field; insertChatTopicTask is called post-create in best-effort symmetry with the marker comment (try/catch + warn-log; never bubbles). Production callers (chat-true-task handler + chat-promote handler) thread ctx.db through PluginContext transparently; older test fixtures without db simply skip.

Suite: 1055 → 1091 tests (+36; 1089 pass / 0 fail / 2 pre-existing skip). CTT-07 (plugin-side archive — host issue untouched) + CTT-08 (live task-status tracking data path) worker-tier complete (UI rendering ships in Plan 04.1-06). **Four deviations recorded** (all anticipated by the prompt's `<scope_refinement_from_wave1>` block or authoring-time clarifications): (1) **[Rule 3 — Cross-plan retrofit per Wave 1 lock]** the createTrueTask side-table write touches src/worker/chat/true-task.ts which is in Plan 04.1-02's files_modified set, not 04.1-05's — the retrofit is the cross-plan glue without which chat.taskOwned would always return empty; pinned by 4 new tests; (2) **[Rule 3 — Blocking, anticipated]** acceptance grep `grep -c "ctx.issues.update" chat-topic-archive.ts == 0` is met SUBSTANTIVELY (0 function calls — `grep -nE "ctx\.issues\.update\("`) but not literally (1 explanatory comment hit naming the spied function in the regression-guard docstring); (3) **[Rule 3 — Blocking, anticipated]** acceptance grep `grep -c "ctx.issues.list" chat-active-tasks.ts == 1` was written for the original (non-Wave-1) plan path; the actual count is 0 CALLS + 2 explanatory comments per the Wave 1 scope refinement (Test 10 cross-pins the invariant with a runtime spy); (4) **[Rule 1 — Bug]** an authoring-time test-ordering confusion about missing-companyId vs missing-userId (opt-in-guard reads userId first) resolved during RED. SUMMARY: `04.1-05-SUMMARY.md`.

**Plan 04.1-06 (UI surfaces — chat shell + archive button + active-tasks rail + diagnostics view + host-stuck banner) UNBLOCKED.** Consumes both new handlers via `usePluginAction('chat.topic.archive')` + `usePluginData('chat.taskOwned')`. Independent on `files_modified` from this plan; Wave 3 sole remaining plan before closure (04.1-07).

---

**Plan 04.1-04 — classifyComment + chat.messages runtime-noise filter + watchdog-on-poll + host-stuck signal: COMPLETE 2026-05-20.**
Autonomous TDD. 2 tasks / 4 commits `1f42a9c..31ac0a4`:
- `1f42a9c` (Task 1 RED) — `test(04.1-04): RED — classifyComment pure function tests` (17 tests covering PRIMARY authorType / SECONDARY presentation.kind / FALLBACK 5-phrase RUNTIME_PHRASES / Pitfall-4 marker pin / defensive null-empty / contract assertion).
- `0b9d154` (Task 1 GREEN) — `feat(04.1-04): classifyComment pure function (D-14 host-field-first + body fallback)` — new `src/worker/chat/comment-classify.ts` exports `classifyComment` (pure I/O-free function; PRIMARY `authorType === 'system'` → SECONDARY `presentation?.kind === 'system_notice'` → FALLBACK case-insensitive body match against `RUNTIME_PHRASES`); `CommentClass` type; frozen `RUNTIME_PHRASES: readonly string[]` (5 entries — RESEARCH.md's 4 + the verbatim 5th phrase `"Paperclip needs a disposition before this issue can continue"` captured live on Countermoves COU-1757 comment fa25ef4d-... per 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM).
- `53c40ff` (Task 2 RED) — `test(04.1-04): RED — chat.messages runtime-noise filter + watchdog + topicStuck` (13 new U1..U13 cases; 10 failing on the new contract).
- `31ac0a4` (Task 2 GREEN) — `feat(04.1-04): chat.messages runtime-noise filter + watchdog cadence + host-stuck signal (D-11/D-13/D-14/D-15)` — `src/worker/handlers/chat-messages.ts` EXTENDED in place at the five precise places per PATTERNS.md DELTA: (1) imports `classifyComment` + `ensureTopicWakeable` + `isTopicStuck`; (2) extends local `CommentLike` with `authorType` + `presentation.kind`; (3) reads optional `params.includeDiagnostics === true` (D-16 default OFF); (4) fires `void ensureTopicWakeable(ctx, topicIssueId, companyId)` at handler head AFTER opt-in gate, BEFORE listComments — D-11 watchdog cadence on every poll; (5) adds a second `.filter((c) => includeDiagnostics || classifyComment(c) === 'conversation')` to the message pipeline; (6) reads topic issue once for `isTopicStuck(topicIssue)` + `activeRecoveryAction.recoveryOwnerName` extraction (best-effort with graceful degrade); (7) response shape grows `topicStuck: boolean` + `recoveryOwner: string | null` (kind/topicIssueId/messages preserved — Plan 04-05 UI continues to work; Plan 04.1-06's HostStuckBanner reads the new fields).

Suite: 1024 → 1055 tests (+31; 1053 pass / 0 fail / 2 pre-existing skip). CTT-04 (runtime noise filtered) + CTT-06 (host-stuck signal) worker-tier data path satisfied (UI rendering ships in Plan 04.1-06). **Zero deviations recorded** — plan executed exactly as written with the Wave 1 scope refinements applied verbatim (dual-keyed discriminator + 5th body phrase). One small implementation choice noted: an `body.length > 0 &&` short-circuit before the body-pattern fallback scan (defensive against any future empty-string entry in RUNTIME_PHRASES that would match everything; Tests 13 + 14 verify the right behaviour on empty bodies). SUMMARY: `04.1-04-SUMMARY.md`.

**Plan 04.1-05 (chat_topic_tasks side table + chat.taskOwned data handler) COMPLETE 2026-05-20** (see entry above). Plan 04.1-06 (UI surfaces) reads `topicStuck` / `recoveryOwner` from this plan's response shape for the HostStuckBanner.

---

**Plan 04.1-03 — topic-watchdog (D-09/D-11) + chat.send fire-and-forget + chat-topics converse-only: COMPLETE 2026-05-20.**
Autonomous TDD. 3 tasks / 6 commits `aa75677..dc7438e`:
- `aa75677` (Task 1 RED) — `test(04.1-03): RED — topic-watchdog tests (ensureTopicWakeable + isTopicStuck)` (17 tests).
- `216890c` (Task 1 GREEN) — `feat(04.1-03): topic-watchdog ensureTopicWakeable + isTopicStuck (D-09/D-11)` — new `src/worker/chat/topic-watchdog.ts` exports `ensureTopicWakeable` (defensive flip-off-done; status ∈ {done, cancelled, blocked} → in_progress; every step try/catch + warn-log; never throws), `isTopicStuck` (UI-SPEC Pattern G trigger — true when activeRecoveryAction set OR successfulRunHandoff.exhausted), and `NON_TERMINAL_CONVERSATION_STATUS = 'in_progress'` (single source of truth shared with chat-topics.ts Task 3).
- `cc3501f` (Task 2 RED) — `test(04.1-03): RED — chat.send fires ensureTopicWakeable fire-and-forget` (3 new + PROBE-OQ3 regression guard across 5 status paths).
- `813b6f1` (Task 2 GREEN) — `feat(04.1-03): chat.send fires ensureTopicWakeable fire-and-forget (D-09/D-11)` — auto-reopen block REPLACED with `void ensureTopicWakeable(ctx, topicIssueId, companyId)`. Fire-and-forget proven by a 50ms-delayed-get test ('chat.send returns BEFORE a slow watchdog completes'). Top-of-file rationale rewritten with the spike-locked D-09/D-11/PROBE-OQ3 PASS-NATIVE story.
- `5c821a2` (Task 3 RED) — `test(04.1-03): RED — chat-topics D-11 description + in_progress initial status` (6 new assertions; existing D-02 wake-contract test updated to expect status:'in_progress').
- `dc7438e` (Task 3 GREEN) — `feat(04.1-03): chat-topics D-11 converse-only + in_progress initial status` — buildTopicDescription extended with the D-11 'CONVERSATION CONTAINER, do NOT mark it done/cancelled' instruction (PATTERNS.md verbatim); the (incorrect) word 'private' is removed (ROADMAP scope correction #1); child topic-issue create uses `status: NON_TERMINAL_CONVERSATION_STATUS` (imported from topic-watchdog.ts) — initial value AND watchdog target agree by construction, no thrash. Parent `Chat — <employee>` issue keeps `status: 'todo'`.

Suite: 1000 → 1024 tests (+24; 1022 pass / 0 fail / 2 pre-existing skip). CTT-03 (multi-turn reliability) + CTT-05 (never stranded) + CTT-06 (host-stuck signal primitive) worker-tier satisfied (UI banner CTT-06 ships in Plan 04.1-06 reading `topicStuck`). **Three deviations recorded** (all anticipated): (1) **[Rule 3 — Scope simplification from Wave 1 findings]** dropped `ctx.issues.requestWakeup` entirely from `ensureTopicWakeable` per `04.1-01-SPIKE-FINDINGS.md` PROBE-OQ3 PASS-NATIVE (multi-turn native re-wake works; REST returns 404 on this host) — the prompt's `<scope_simplification_from_wave1>` explicitly instructed this override of PLAN.md text; regression-guarded by a dedicated 'NEVER calls ctx.issues.requestWakeup' test across 5 status paths; (2) **[Rule 3 — Blocking]** the PLAN.md acceptance grep `grep -cE "requestWakeup" chat-send.ts == 0` is met SUBSTANTIVELY (0 functional calls — verified by `grep -nE "ctx\.issues\.requestWakeup|\.requestWakeup\("`) but not literally (3 explanatory comment hits remain documenting why the call was dropped); (3) **[Rule 1 — Bug]** the initial 'Do NOT mark it' test regex was not whitespace-tolerant — the description text line-wraps 'Do' and 'NOT' across a newline; fixed to `/Do\s+NOT\s+mark\s+it/i`. SUMMARY: `04.1-03-SUMMARY.md`.

**Plan 04.1-04 (chat.messages classifyComment + watchdog wiring) UNBLOCKED.** Imports `ensureTopicWakeable`, `isTopicStuck`, and `NON_TERMINAL_CONVERSATION_STATUS` from this plan's `src/worker/chat/topic-watchdog.ts`. Touches `src/worker/handlers/chat-messages.ts` only — zero `files_modified` overlap with Plan 04.1-03 (same wave 2, parallel-safe per PLAN.md).

---

**Plan 04.1-02 — createTrueTask helper + chat.createTrueTask + chat.promote D-04 rewrite: COMPLETE 2026-05-20.**
Autonomous TDD. 3 tasks / 6 commits `0b13481..2715ac6`:
- `0b13481` (Task 1 RED) — `test(04.1-02): RED — createTrueTask helper tests` (13 tests).
- `5523b38` (Task 1 GREEN) — `feat(04.1-02): createTrueTask shared helper` — new `src/worker/chat/true-task.ts` exports `createTrueTask` + `titleFromBody`; top-level issue (no parent-pointer), `assigneeAgentId` required, `originId 'chat-task:<topic>:<source|composer>'`, best-effort D-07 marker comment.
- `16e8b4b` (Task 2 RED) — `test(04.1-02): RED — chat.createTrueTask handler tests` (15 tests).
- `e7bd567` (Task 2 GREEN) — `feat(04.1-02): chat.createTrueTask handler` — new `src/worker/handlers/chat-true-task.ts` (operator composer path), registered in `src/worker.ts` alongside `chat.promote`.
- `6dca532` (Task 3 RED) — `test(04.1-02): RED — chat.promote rewrite tests` (15 tests, 6 failing for new contract).
- `2715ac6` (Task 3 GREEN) — `refactor(04.1-02): chat.promote delegates to createTrueTask` — REWRITTEN; old `parentId: topicIssueId` + unassigned-todo behaviour DELETED. The Phase 4 followup bug ("orphan task nested under plugin plumbing, nobody acts on it") is impossible by construction: `grep -c parentId` returns 0 in all three target files (`src/worker/chat/true-task.ts`, `src/worker/handlers/chat-true-task.ts`, `src/worker/handlers/chat-promote.ts`).

Suite: 966 → 1000 tests (+34; 998 pass / 0 fail / 2 skip). CTT-01 + CTT-02 worker-tier satisfied (UI surfaces ship in Plan 04.1-06). Two deviations recorded (both [Rule 3 - Blocking]): updated `test/ui/chat-message-thread.test.mjs` chat.promote required-keys assertion to include new `assigneeAgentId` + `employeeName` (the Plan-04-04-era test pinned the old contract); and a plan-text inconsistency about missing-userId throwing — opt-in-guard fires first and returns `OPT_IN_REQUIRED` (documented inline in chat-true-task.test.mjs Test 3b). SUMMARY: `04.1-02-SUMMARY.md`.

**Plans 04.1-03 + 04.1-04 (also Wave 2 autonomous TDD) UNBLOCKED.** Both consume the locked spike findings (`04.1-01-SPIKE-FINDINGS.md`) but neither imports from this plan. The marker-comment wording locked here is pinned by `true-task.test.mjs` Test 6 so Plan 04.1-04's `classifyComment` cannot accidentally classify the marker as runtime noise (Pitfall 4 anti-regression).

---

**Plan 04.1-01 — Falsify-First Spike: COMPLETE 2026-05-20.**
Non-autonomous. **Phase 4.1 Gate Verdict: GO.** Multi-turn native re-wake
PROVEN live on Countermoves: a bare comment alone re-wakes the assigned
employee-agent on turn N>1 (PROBE-OQ3 PASS-NATIVE; all three legal
`requestWakeup` REST calls returned HTTP 404 — `ctx.issues.requestWakeup` has
no public REST surface on this host — but the bait comments themselves
natively woke the agent, making the wake nudge unnecessary). D-14 runtime-noise
discriminator captured verbatim on a real provoked recovery notice
(`fa25ef4d-...`): dual-keyed on `authorType === 'system'` AND
`presentation.kind === 'system_notice'`, with a structured `metadata.sections`
envelope (typed `issue_link` / `agent_link` / `key_value` / `run_link` rows
that Plan 04.1-06 D-16 diagnostics view can render directly), plus a 5-phrase
body-pattern fallback (RESEARCH's 4 + the new `"Paperclip needs a disposition
before this issue can continue"`). OQ1: the agent leaves the chat-topic at
`in_progress` after a successful run — D-11 watchdog is the defensive
flip-off-done path only, with no agent-set status to override. OQ2 WEAK
(REST-LIMIT): REST `issues.list` silently ignores `originId`/`originIdPrefix`
filters (returns 500-row cap regardless; exact-match returns 0 even when the
row exists) — Plan 04.1-05 ships `migrations/0007_chat_topic_tasks.sql` as
the defensive default. FLAG-1 reconciles as `caught-by-watchdog` (the host
disposition-recovery service does engage, evidence captured under D-14;
D-11's defensive sweep catches the flip). FLAG-2 PASS (Situation Room reads
`current_task_summary`, never does `issues.list({assigneeAgentId})`).

3 tasks, 4 commits `9703dbe..db29504`:
- `9703dbe` (Task 1) — built `scripts/spike/chat-true-task-spike-probe.mjs` + STUB findings doc + CTT-01..CTT-08 traceability rows in REQUIREMENTS.md.
- `eb44303` (Task 2) — Eric ran the probe on Countermoves 2026-05-20T08:23:41Z; continuation agent replaced the STUB with the locked findings (status: locked, verdict: GO).
- `30cba12` (Task 3 part A) — `test/phases/04.1-01-spike-findings.test.mjs` RED→GREEN; 9 tests pinning the findings contract; all GREEN.
- `db29504` (Task 3 part B) — `04.1-01-SUMMARY.md` written with plan-impact cross-reference table for Plans 04.1-02..04.1-07.

**Plans 04.1-02 / 04.1-03 / 04.1-04 (Wave 2, autonomous TDD) UNBLOCKED.** All
load-bearing design inputs locked in `04.1-01-SPIKE-FINDINGS.md`:
- Plan 04.1-03 DROPS the `requestWakeup` call entirely; `ensureTopicWakeable` keeps only the defensive D-11 status-flip-off-done check; topic issues created at `in_progress`.
- Plan 04.1-04 `classifyComment` primary on `authorType === 'system'`, secondary on `presentation.kind === 'system_notice'`; body-pattern fallback = 5 phrases.
- Plan 04.1-04 `topic-watchdog.ts` is defensive-only; `topicStuck` triggers on N≥2 failed flips.
- Plan 04.1-05 ships `migrations/0007_chat_topic_tasks.sql`; `chat.taskOwned` queries the side table, NOT `issues.list`.
- Plan 04.1-06 D-16 diagnostics view renders `presentation.metadata.sections` as typed rows.

**Followups (non-blocking, for Eric):** 4 `[SPIKE 04.1]`-tagged probe issues
on Countermoves to clean up (`0dc3bea1-...`, `67f53651-...`, `496474c9-...`,
`1958673d-...`); stale `cli.mjs gate` comment in probe header lines 49/56;
contaminated-codex artifact on the VPS (safe to delete after Wave 5 closes).

---

**Plan 04-06 — Coexistence + Phase 4 closure: COMPLETE 2026-05-19.**
Non-autonomous. Task 1 (`175d042`) — built the CHAT-11 coexistence check
`scripts/coexistence-checks/08-chat-disable.mjs` (static defense-in-depth: chat
messages survive plugin disable as ordinary `public.issue_comments` threaded
comments because content lives only there per CHAT-02/D-02; the
plugin-namespace `chat_topics`/`chat_messages`/`chat_employee_parents` tables
are not dropped on disable per COEXIST-03) plus
`test/ci/coexistence-chat-disable.test.mjs` and the checklist + run-all
extensions so a regression fails CI. Task 2 (`06b53bc`) — created
`test/phases/04-traceability.test.mjs` (RED→GREEN) pinning every CHAT-01..11
traceability row as Implemented; marked all 11 CHAT rows Implemented in
REQUIREMENTS.md with their delivering plan refs; updated ROADMAP.md. Manifest
version confirmed at the real shipped 0.7.8 (the plan text's "0.7.0" is stale —
NOT downgraded). **Task 3 — Phase 4 closure drill on live Countermoves: PASSED.**
Pre-drill snapshot bookend `2026-05-19T19-56-33Z`; gated 0.7.7→0.7.8 plugin
upgrade (`gate --gate-bypass` → `✓ Installed clarity-pack v0.7.8 (ready)`);
post-install smoke PASSED 4/4; chat works live (CEO employee-agent replied
in-thread); chat topics surface as ordinary `COU-####` issues in classic
Paperclip; **CHAT-11 proof: `issue_comments` count 907 before
`plugin disable clarity-pack` = 907 after** → zero comment rows destroyed;
plugin re-enabled → `ready`; CI checklist 36/36 pass incl. `08-chat-disable`.
Operator approved Phase 4 closure. SUMMARY: `04-06-SUMMARY.md`.

**Phase 4 verifier notes:**

- **CHAT-04** (real-time, no polling) is **host-blocked** — plugin streams
  return HTTP 501 on this Paperclip host (confirmed live); chat runs on 15s
  polling. Phase 4 verification must RECONCILE CHAT-04 as host-blocked, not
  fail it.

- Three follow-ups surfaced during the drill, routed to Phase 4.1 / runbook:
  (a) the VPS `cli.mjs snapshot` wrapper is broken (stale `~/clarity-pack`
  partial repo copy) — re-sync `~/clarity-pack/scripts/`; (b) the Employee Chat
  surface at `/COU/chat` overflows the viewport horizontally — chat-polish
  defect for Phase 4.1; (c) three harmless leftover instance dirs in
  `~/.paperclip/instances/` on the VPS — ops cleanup.

**NEXT: Phase 4 verification, then Phase 4.1 (Chat → True Task)** — the
operator-designated immediate priority; see
`.planning/phases/04-employee-chat/04-FOLLOWUP-chat-true-task.md`.

**Plan 04-05 — Employee Chat UI Surface: CLOSED on UI scope 2026-05-19.**
Non-autonomous (Eric Countermoves visual-fidelity drill). Tasks 1-3 built the
four-region chat shell (commits `33f781f..e5d5c10`); the Task-4 live checkpoint
drill + operator re-tests then surfaced a long run of host-faithfulness defects
the TDD fakes had hidden — all fixed across versions 0.7.0→0.7.8 (final commit
`93e7982`; suite 941 tests / 0 fail; `clarity-pack-0.7.8.tgz` packed). The chat
conversation surface works (send + "Eric · You" identity + "✓ Sent" + optimistic
send + Enter-to-send + attach graceful-degrade + reasoning/promote/pin affordances

+ a truthful sticky pulsing live indicator). CHAT-07 + CHAT-10 met for the UI.

DEFERRED to Phase 4.1: a real operator "true task" capability and the chat-topic/
agent-task-lifecycle fix (multi-turn conversation is currently unreliable — the
agent stops re-waking after the first reply). Also recorded: CHAT-04 real-time
streaming is host-blocked (plugin streams 501) — chat runs on polling. SUMMARY:
`04-05-SUMMARY.md`; problem statement: `04-FOLLOWUP-chat-true-task.md`.

---

**Plan 04-04 — Chat Read + CRUD Handlers: COMPLETE 2026-05-18.** TDD,
autonomous, 4 tasks / 8 commits (`c203c54..ff9ad5a`). Six worker handlers
feeding the 04-05 chat UI, all opt-in-guarded (T-04-15). Task A+B —
`chat-roster.ts` (`chat.roster` data: `ctx.agents.list` minus the Editor-Agent
resolved via `ctx.agents.managed.get('editor-agent',...)`, D-03; degrades to
the full roster on a managed-resolution failure rather than 500),
`chat-topics.ts` (`chat.topics` data list + `chat.topic.create` action — O(1)
parent resolve-or-create via `getEmployeeParentIssueId`/`insertEmployeeParent`,
BLOCKER-3 no issue-tree scan; child topic issue assigned to the employee-agent,
D-02 wake contract, with the D-14 reasoning block + OQ-4 reply-channel
instruction), `chat-messages.ts` (`chat.messages` data — `listComments` JOIN
`chat_messages` for supersedes/pin, ordered by SERVER `created_at`, PITFALLS
11.4; superseded comments marked for UI edit-chain collapse, CHAT-05).
`chat-search.ts` — `chat.search` data (CHAT-08): the verbatim RESEARCH `ILIKE`
query over `public.issue_comments` JOIN `chat_topics` `t.company_id=## Current Position

`
(T-04-14/17); exported `escapeLike` backslash-escapes `\`,`%`,`_` so a user
wildcard char matches literally (T-04-13). `chat-promote.ts` — `chat.promote`
action (CHAT-09/D-13): company-scoped `getChatMessageByUuid` IS the ownership
re-check (T-04-16), canonical comment body re-fetched, real issue created
linked to the topic via `parentId`. `chat-pin.ts` — `chat.pin` action toggles
`chat_messages.pinned` via `updateChatMessagePinned`. Task D — `worker.ts`
wires all six after the 04-03 chat block (7 handler keys total, non-exempt).
Deviations: two Rule-1 test-mock bugs fixed (a `chat_topics` SELECT matcher and
a `chat_messages` query that ignored `company_id` — the latter masked the
T-04-16 isolation property). Suite 856 tests / 854 pass / 0 fail / 2 skip;
typecheck + worker bundle (207.1kb) clean. SUMMARY: `04-04-SUMMARY.md`.
**NEXT: Plan 04-05 (chat UI surface — pure UI, all six handlers ready).**

---

**Plan 04-03 — Chat Realtime + Persistence Spine: COMPLETE 2026-05-18.** TDD,
autonomous, 4 tasks / 7 commits (`d6d143d..dede91a`). Task A —
`src/worker/handlers/chat-send.ts`: the `chat.send` action handler — dedup on
`message_uuid` (`getChatMessageByUuid`; a resend returns the original
`commentId` without re-posting, CHAT-06 / D-10), `ctx.issues.createComment`
canonical write to `public.issue_comments` (CHAT-02), `insertChatMessage`
id-map side-table insert, and D-06 auto-reopen (a `done` topic flips to
`in_progress` — best-effort, `requestWakeup` NOT called per 04-01 OQ-3
STATUS-FLIP-NOT-NEEDED). A `createComment` host failure returns
`{error:'SEND_FAILED'}` with no orphan side-table row. Task B —
`src/worker/handlers/chat-edit.ts`: the `chat.edit` action handler —
append-with-supersedes (D-11 / CHAT-05; a new comment + a `chat_messages` row
whose `supersedes_uuid` points at the prior message, original never mutated),
with a server-side ownership re-check rejecting agent/unknown messages
`{error:'NOT_OWNED'}` (T-04-09). Task C — `src/worker/streams/chat-stream-bridge.ts`:
the D-08 realtime spine — subscribes `issue.comment.created`, re-emits
chat-topic comments on the `chat:<companyId>` plugin SSE channel
(`ctx.streams.emit`); non-chat issues filtered via `getChatTopicByIssueId`
(T-04-11), null `entityId`/`companyId` guarded, body try/catch wrapped
(T-04-12); OQ-2 opaque payload resolved by a `listComments` re-fetch selecting
the newest comment id. Task D — `worker.ts` wiring: `chat.send` + `chat.edit`
registered after the exempt-key handlers (opt-in-guarded), the stream bridge
subscribed near the existing `ctx.events.on` block. Deviation: one Rule-3 type
fix — `IssueComment.createdAt` is a `Date`, normalized via `new Date().getTime()`.
Suite 798 tests / 796 pass / 0 fail / 2 skip; typecheck + worker bundle clean.
SUMMARY: `04-03-SUMMARY.md`. **NEXT: Plan 04-04 (read + CRUD handlers).**

---

**Plan 04-02 — Employee Chat Data Layer: COMPLETE 2026-05-18.** TDD, autonomous,
3 tasks / 7 commits (`5549206..6b251fa`). Task A — `migrations/0006_chat.sql`:
three additive plugin-namespace tables — `chat_topics` (CHT-NN topic metadata),
`chat_messages` (the D-09 id-map side table: `message_uuid -> comment_id`,
supersedes link, pin flag — NO `body` column, CHAT-02 invariant), and
`chat_employee_parents` (D-05 per-employee parent-issue map, composite PK,
race-safe). Validator-clean (fully-qualified, no CREATE INDEX, no DO $,
apostrophe-free, ;-terminated). Task B — `src/worker/db/chat-topics-repo.ts`:
typed CRUD mirroring `bulletins-repo.ts` — `insertChatTopic`,
`getChatTopicByIssueId`, `listChatTopicsForEmployee`, `allocateChtNumber`
(CHT-NN per-company allocator), `insertChatMessage` (ON CONFLICT message_uuid
dedup), `getChatMessageByUuid` (dedup-on-send), `updateChatMessagePinned`,
`getEmployeeParentIssueId`, `insertEmployeeParent` (race-safe). Task C —
manifest bumped 0.6.6 -> 0.7.0; no new capability strings (the chat handlers'
host calls are all covered by Phase 2/3 capabilities proven live). Deviation:
the stale Phase-2 COEXIST-05 stub (forbade any `chat_messages` table) corrected
to the real CHAT-02 invariant — side table allowed, `body` column forbidden.
Suite 767 tests / 765 pass / 0 fail / 2 skip; typecheck clean. SUMMARY:
`04-02-SUMMARY.md`. **NEXT: Plan 04-03 (realtime + persistence spine,
autonomous, TDD).**

---

03-10 re-drill, all as gap-closure debug sessions (no new plan filed):

  1. BULLETIN-VERIFIER-COUNTS-OWN-OPERATION-ISSUE — debug `verifier-counts-own-issue.md`
     (RESOLVED), fix `a0e77d3`. PROVEN LIVE on the v0.6.1 re-drill.

  2. BULLETIN-RENDER-DEPT-ITEMS-UNDEFINED — debug `render-dept-items-undefined.md`
     (RESOLVED), fix `c9c6318`. PROVEN LIVE on the v0.6.2 re-drill.
  3-6. v0.6.2 re-drill (2026-05-17) PUBLISHED Bulletin No. 1 end-to-end (issue
     ecdb1ba9) — pipeline architecture proven — but the rendered page showed 4
     content/operability defects: (A) {{NUMBER}} placeholders unresolved in
     department prose, (B) blank masthead, (C) mislabeled WARN, (D) job wrapper
     swallowed publish exceptions. All 4 fixed — debug `bulletin-content-defects.md`
     (RESOLVED), fix `c... ` commit (resolveDraftSlots + buildMasthead + log
     downgrade + recordFailure routing). Suite 710 tests, 708 pass / 0 fail / 2 skip.
  7-8. v0.6.3 cycle-2 re-drill (2026-05-17) exposed TWO latent bugs (NEITHER a
     v0.6.3 regression): (1) every cycle >= 2 silently fails to publish —
     publishBulletin's idempotency pre-check keyed on `next_due_at`, which the
     prior published cycle's row also carries (latent since Plan 03-02; first
     hit at cycle 2); (2) the Editor-Agent TL;DR compile has never run —
     editor.ts read comments via a fictional `ctx.issue.comments.read`
     (undefined on the host). Both fixed — debug `cycle2-publish-and-tldr-typo.md`
     (RESOLVED), fix `2b1419f` (pre-check re-keyed on (company_id,cycle_number);
     `ctx.issues.listComments`; + compile-bulletin post-readback instrumentation).
     Suite 712 tests, 710 pass / 0 fail / 2 skip.

  9. v0.6.4 cycle-2 re-drill (2026-05-17): **Bulletin No. 2 PUBLISHED end-to-end**
     (cycle_number=2, compile_status='published', issue c29d5ef7) — the cycle-2
     publish fix + resolved prose + populated masthead ALL PROVEN LIVE. Phase 3's
     bulletin deliverable works. BUT the v0.6.4 bug-2 fix (TL;DR heartbeat
     un-crashed) unleashed an infinite recursion: the editor heartbeat
     TL;DR-compiles every issue INCLUDING the plugin's own tldr-compile
     operation issues — each spawns the next (`originId=tldr-<prev>` chain),
     unbounded. Plus a `malformed array literal` db.execute error in the TL;DR
     write path (source_revisions[] column gets a scalar hash). v0.6.4
     UNINSTALLED 2026-05-17 ~12:56 to halt the cascade.

  10. v0.6.5 (2026-05-17): **both `tldr-heartbeat-recursion.md` bugs FIXED**
     (debug RESOLVED). Bug 1 — `handleEditorHeartbeat` now calls new
     `isOwnOperationIssue(issue)` and `continue`s for any issue whose
     `originKind` starts with `plugin:clarity-pack:operation:` — the cascade is
     dead at its source (guard runs before `compileTldr`). Bug 2 — new
     `toPgTextArrayLiteral`; `upsertTldr` binds `source_revisions`+`tags` as
     `$N::text[]` array-literal strings, not bare scalars. 8 new regression
     tests (`editor-heartbeat-recursion.test.mjs` ×5 + `tldr-cache.test.mjs`
     ×3). Suite 720 tests, 718 pass / 0 fail / 2 skip; tsc clean. Artifacts
     rebuilt; `clarity-pack-0.6.5.tgz` packed.

  11. v0.6.5 closure re-drill — RUN 2026-05-18 on live Countermoves. Full restore
     of snapshot `2026-05-17T12-52-04Z` onto live (atomic-swap; first time
     executed on the box — restore path now proven), uninstalled the v0.6.3 it
     carried, installed v0.6.5. **Both `tldr-heartbeat-recursion.md` bugs PROVEN
     LIVE:** recursion guard fires (`Editor-Agent: skipped own operation issue`)
     — no cascade, operation issues bounded at 62; no `malformed array literal`.
     The compile pipeline PUBLISHES end-to-end — `bulletins` cycles 2–7 all
     `compile_status='published'`. BUT the drill exposed a NEW blocker → debug
     `bulletin-compile-cadence-runaway.md` (INVESTIGATING): (1) **runaway
     cadence** — `compile-bulletin` re-fires every ~2 min and publishes a new
     cycle each time (2→7 in 14 min, unbounded); `next_due_at` is not advanced
     to a future instant after a publish. (2) **verifier loses every
     compile-window race** — `verifyDraft` re-runs `slotDef.sql` live at
     compile-end (tolerance 0); standing numbers drift during the ~50s compile
     (drift PINNED 2026-05-18: published `Bulletin No. N` issues
     `origin_kind='plugin:clarity-pack'` slip past the `:operation:`-scoped
     exclusion + Paperclip's own `stranded_issue_recovery` churn). Fix: verify
     against the FROZEN facts snapshot handed to pass-1, not a live re-run.
     v0.6.5 UNINSTALLED 2026-05-18 ~07:32 to halt the cadence; live Paperclip
     healthy on 3100; fresh bookend snapshot `2026-05-18T06-58-53Z` taken.

  12. **v0.6.6 (2026-05-18) — PHASE 3 CLOSED.** Both `bulletin-compile-cadence-runaway.md`
     bugs fixed: Bug 1 — `advanceScheduleForCompany` advances `next_due_at` on EVERY
     path that consumes a due tick (not just the success path), killing the runaway
     every-minute cron; Bug 2 — `verifyDraft` validates the draft against the FROZEN
     pass-1 facts snapshot, no live SQL re-run, so board churn during the ~50s
     compile can no longer lose the race. Version 0.5.0→0.6.6 (`manifest.ts` +
     `package.json`); suite 721 pass / 0 fail / 2 skip. **v0.6.6 closure re-drill
     PASSED on live Countermoves 2026-05-18:** Bulletin No. 8 published, exactly one
     compile fired, `next_due_at` advanced to the next 06:30-ET slot and held (no
     re-fire across a ~12-min watch), zero `0.6.6` verifier failures, operation
     issues flat at 64. Debug session RESOLVED →
     `.planning/debug/resolved/bulletin-compile-cadence-runaway.md`.

**PHASE 3 (daily-bulletin) IS CLOSED — 2026-05-18.** BULL-01..09 delivered;
clarity-pack v0.6.6 installed and working on live Countermoves. The bulletin
compile pipeline is proven end-to-end: DST-safe schedule, idempotent publish,
two-pass verifier (frozen-facts), errata, failed-compile banner, and the
Editor-Agent compiling under standard Paperclip governance.

**NEXT: Phase 04 — Employee Chat.** 0 plans, needs planning; UI-heavy. Start a
fresh chat with `/gsd:discuss-phase 4` (or `/gsd:ui-phase 4` first). Depends on
Phases 2 + 3 — both satisfied.

Carried-forward (non-blocking) recommendations:

- The host-faithful suite still cannot fully model the live compile-bulletin job
  control-flow timing; v0.6.6 added two cadence-settling regression tests, but a
  fuller faithful integration test of the fire→publish→advance→idle loop remains
  worthwhile.

- Masthead `prepareForName` uses the company display name with an 'Operations'
  fallback — no per-recipient config. If the masthead should name the human
  operator (Eric), an `instanceConfig` field is needed; the org-name default
  ships otherwise.

- `02-10-PLAN.md` deferred Phase 2 polish (React-key warnings / Vite-HMR console
  noise) is still open — non-blocking, can interleave with a later phase.
**Phase 3 plans:**

  - 03-01 — Foundation: **COMPLETE 2026-05-15** — `0004_bulletin.sql` migration (bulletins incl. `draft_json jsonb` + UNIQUE(next_due_at,content_hash) + bulletin_errata + clarity_department_membership + bulletin_compile_failures) + DST-safe `computeNextDueAt` (date-fns-tz) + bulletins repo (8 fns) + manifest `jobs[]`+capabilities+config + self-loop-filter `BULLETIN_TAG_PREFIX` extension + compile-bulletin no-op job. 3 TDD commits ab217b0..e059d8b; suite 455/453-pass/0-fail/2-skip; typecheck+build green. BULL-01, BULL-02 foundation delivered. SUMMARY: `03-01-SUMMARY.md`.
  - 03-02 — Compile Pipeline: **COMPLETE 2026-05-15** — facts-table.ts (computeFactsTable + replaceSlots) + standing-numbers.ts (STANDING_NUMBER_SLOTS 5-slot registry + computeStandingNumbers) + bulletin-verifier.ts (pure-async verifyDraft, typed mismatch/UNKNOWN_SLOT) + compile-pass-1.ts (cap-then-call LLM + validateDraftSchema, MAX_BULLETIN_TOKENS=6000) + bulletin-rendering.ts (renderBulletinIssueBody) + publish.ts (two-phase write, draft_json W3/W4, UNIQUE idempotency) + compile-bulletin.ts real pipeline (Wave-1 stub replaced) + circuit-breaker BULLETIN_COMPILE_AGENT_KEY. 4 TDD commits 9fe85b2..85c84fb; suite 455→504 (+49; 502 pass/0 fail/2 skip); typecheck+build green. BULL-05/06/09 delivered. 2 Rule-1 auto-fixes (pass-1 recordSuccess counter-reset bug; e2e test-fixture INSERT-index + multiline-regex). SUMMARY: `03-02-SUMMARY.md`.
  - 03-03 — UI + Action Inbox + Dept Reconcile + Lineage: **BUILD COMPLETE; drill PARTIAL 2026-05-15** — bulletin page renders cleanly on Countermoves (warm-paper empty state, no regression on Reader/Situation Room). Populated-layout + W2 (Standing Numbers SQL) + W7 (action-inbox mapping) verification deferred — they need a live compiled bulletin, which is blocked on 03-05's session-adapter defect. 3 autonomous build commits a1f24a5..f1cb14b. Task 1 RED: 7 test files (~61 assertions). Task 2 GREEN: `action-inbox-query.ts` (D-19 mapping — blocked + needs_attention/stalled + viewer-scoped + 30d), `department-reconcile.ts` (role-regex + idempotent UPSERT), `lineage-grouper.ts` (pure deterministic Δt≤300s clustering + 8-node truncation + 100-iter byte-equal), `bulletin-by-cycle.ts` (draft_json typed parse W3/W4, live viewer-scoped action inbox), `bulletin-action-approve/decline.ts` (T-03-16 ownership re-verify), worker.ts +3 register calls. Task 3 GREEN: 6 React components (`bulletin/{index,masthead,action-inbox,department-section,standing-numbers-panel,lineage-footer}.tsx`) + `bulletin.css` (warm-paper palette, Fraunces/Newsreader/JetBrains Mono, scoped `[data-clarity-surface="bulletin"]`, 1100px responsive) + `ui/index.tsx` real BulletinPage + bulletin.css runtime inject + compile-bulletin.ts wired with reconcileDepartments + groupLineageThreads. Suite 504→565 (+61; 563 pass / 0 fail / 2 skip). Typecheck + build clean (UI 69.6 KB min/16.3 KB gz, worker 70.9 KB min/21.9 KB gz). 2 SDK-shape deviations auto-resolved: (a) issues.update has no `resolution` field → Approve/Decline use status='done'; (b) Issue.lastActorId not an SDK field → lineage uses confirmed assigneeUserId. **Task 4 = Eric's Countermoves visual-fidelity drill (checkpoint:human-verify) — pending.** BULL-03, BULL-04. SUMMARY: `03-03-SUMMARY.md` (status AWAITING-CHECKPOINT).
  - 03-04 — Errata + Failed-Compile Banner + DST CI + Coexistence: **BUILD COMPLETE — AWAITING CHECKPOINT 2026-05-16** — auto Tasks 1-2 executed RED→GREEN, 2 TDD commits ec9c08c..e65088a. Task 1 RED: 5 test files / 629 insertions (errata 10, failed-compile-banner 9, dst-ci-matrix 10, idempotency 6, coexistence-bulletin-disable 5). Task 2 GREEN: `bulletin-errata.ts` (data `bulletin.errata.byCycle` + action `bulletin.errata.add`, T-03-22 server-side `compile_status='published'` check, append-only), `bulletin-latest-status.ts` (data `bulletin.latestCompileStatus` → `{kind:'ok'|'failed'}`), `publish.ts` extended with `priorCycleErratumSnapshot` (errata-as-comment on prior cycle's issue after a verified publish, non-fatal on failure, sets `applied_to_issue_comment_id`), `compile-bulletin.ts` one-row-per-retry accounting (attempt_n + 15-min next_retry_at; attempt_n≥3 trips circuit-breaker), `FailedCompileBanner`/`ErrataFooter` React components, settings-page errata composer, `bulletin.css` rules, `07-bulletin-disable.mjs` (7th coexistence check — static `0004_bulletin.sql` scan). Suite 626→660 (+34; 658 pass / 0 fail / 2 skip). Typecheck + worker (159.7 KB)/UI (105.1 KB)/manifest builds clean. 7/7 coexistence checks pass. 0 material deviations. **Task 3 = Eric's Countermoves Phase 3 closure drill (checkpoint:human-verify, blocking) — pending.** BULL-01, BULL-02, BULL-07, BULL-08. SUMMARY: `03-04-SUMMARY.md` (status AWAITING-CHECKPOINT).
  - 03-05 — LLM-Adapter Gap Closure: **BUILD COMPLETE — AWAITING CHECKPOINT 2026-05-15** — Wave-3 gap-closure plan filed after the 03-03 Countermoves drill surfaced that the compile pipeline had no production LLM wiring (`ctx.llm` does not exist on SDK 2026.512.0 PluginContext). 3 TDD commits 993b8fe..f6da35c. Task 1 RED: `test/worker/agents/session-llm-adapter.test.mjs` (11 tests, 7 behaviors). Task 2 GREEN: `src/worker/agents/session-llm-adapter.ts` — `sessionLlmAdapter(ctx,{agentId,companyId,taskKeyPrefix?,timeoutMs?})` returns a real LlmAdapter whose `complete()` opens an agent chat session via `ctx.agents.sessions.create`, accumulates `chunk` events (skipping stderr) through `sendMessage`'s `onEvent`, resolves the accumulated string on the terminal `done` event, rejects on `error` or after `SESSION_TIMEOUT_MS` (120s default), closes the session in a `finally`; guards agent status (paused/terminated/pending_approval/null → tagged `AGENT_NOT_INVOKABLE` before any session opens). Task 3: compile-bulletin job builds the adapter per-company from `ctx.agents`+`editorAgentId` and resumes the manifest-`paused` Editor-Agent before the first compile; editor heartbeat path builds the same adapter and passes it to `compileTldr` (Phase 2 Reader TL;DR production wiring closed); `CompileBulletinCtx`/`EditorHeartbeatCtx` lose the synthetic `llm` member; `worker.ts` drops the `as unknown as CompileBulletinCtx` cast; manifest gains `agent.sessions.create/list/send/close`. Suite 565→582 (+17; 580 pass / 0 fail / 2 skip). Typecheck + worker/UI/manifest builds clean. 0 deviations — plan executed exactly as written. **Task 4 — Countermoves production-compile drill RUN 2026-05-15 evening: did NOT pass.** The drill fixed 6 compile-path defects (commits cc8bf62..e8f1a01) and got the job running end-to-end, but the compile fails at the LLM call: `sendMessage` rejects `Session not found`. **OPEN BLOCKER** — see `.planning/debug/bulletin-compile-session-not-found.md`. BULL-05, BULL-06, BULL-09 NOT yet verified live. SUMMARY: `03-05-SUMMARY.md`.
  - 03-06 — Agent-Invocation Gap Closure: **BUILD COMPLETE — AWAITING CHECKPOINT 2026-05-16** — Wave-5 gap-closure plan filed after the 03-04 Phase 3 closure drill proved Plan 03-05's session-based LLM invocation is non-functional (the host discards `ctx.agents.sessions.sendMessage`'s prompt — upstream PR #3106, open). Researched (`03-AGENT-INVOCATION-GAP-RESEARCH.md`), plan-checked PASS after Revision 1. Tasks 1-4 executed, 4 TDD commits `3810bf6..9076f1e`. New `src/worker/agents/agent-task-delivery.ts` — `deliverAgentTask` creates an off-board (`surfaceVisibility:'plugin_operation'`) operation issue assigned to the Editor-Agent, fires `requestWakeup`, polls `listComments` for the result (the canonical `plugin-llm-wiki` pattern); `deliveryLlmAdapter` keeps the `LlmAdapter` interface byte-identical. Idempotency search passes `includePluginOperations:true` (plan-checker B-1). Durable `isCircuitOpen`/`isCircuitOpenDurable` (reads `editor_agent_failures`) + breaker-aware resume close the resume-defeats-breaker loop. Both bulletin-compile and Reader-TL;DR paths rewired; `sessionLlmAdapter` deprecated; Editor-Agent manifest instructions rewritten issue-driven + `issues.wakeup` capability. Suite 660→676 (+16; 674 pass / 0 fail / 2 skip). Typecheck + worker (160.4 KB)/UI (105.1 KB)/manifest builds clean. 6 minor deviations (all documented). **Task 5 = Eric's Countermoves closure re-drill (checkpoint:human-verify, blocking) — pending.** BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02. SUMMARY: `03-06-SUMMARY.md`.
  - 03-07 — Result-Readback Channel (Option C) + Durable-Breaker Stale-History Fix: **AUTO TASKS 1-4 COMPLETE — AWAITING TASK 5 CHECKPOINT 2026-05-16.** `gsd-executor` ran Tasks 1-4 RED→GREEN, 5 commits `c1f4145..7d925af`. Task 1 RED: `compile-result-tool.test.mjs` (new) + extended `agent-task-delivery.test.mjs` + `circuit-breaker-durable.test.mjs`. Task 2 GREEN: new `src/worker/agents/compile-result-tool.ts` (`registerCompileResultTool` + `PENDING_DELIVERIES` Map + `SUBMIT_COMPILE_RESULT_TOOL`); `agent-task-delivery.ts` readback rewritten (register pending promise before requestWakeup, `Promise.race` vs slow ~15s comment+document fallback poll); `circuit-breaker.ts` version-scoped (`recordFailure` stamps `CLARITY_PACK_VERSION`, `isCircuitOpenDurable` filters `plugin_version`); `worker.ts` wires `registerCompileResultTool` in setup(); additive migration `0005_breaker_version_scope.sql` (`ADD COLUMN IF NOT EXISTS plugin_version`). Task 3: manifest `agent.tools.register` cap + one-entry `tools[]` (`submit-compile-result`) + Editor-Agent `permissions` plugin-tool grant + tool-directed `instructions.content`; version 0.2.0→0.3.0. Task 4: host-faithful tool-channel e2e (`test/helpers/host-faithful-ctx.mjs`) + rebuild/pack. Suite 676→696 (+20; 694 pass / 0 fail / 2 skip). Typecheck + worker(179.1 KB)/UI(105.1 KB)/manifest builds clean. Tarball `clarity-pack-0.3.0.tgz` (sha256 `785441b4`). 0 material deviations; Self-Check PASSED. **Task 5 = Eric's Countermoves closure re-drill (checkpoint:human-verify, blocking) — RUN 2026-05-16, DID NOT PASS.** Migration 0005 + version-scoped breaker CONFIRMED. But the tool channel did not fire — ROOT CAUSE: manifest `agents[].instructions.content` does not propagate to an existing managed agent (live agent still shows pre-03-06 instructions; `reconcile()` sets instructions at creation only). The agent produced a flawless `BulletinDraft` but filed it as a document + prose comment; the fallback poll did not publish; `deliverAgentTask` timed out 3× → 3 `plugin_version='0.3.0'` rows now trip the durable breaker. Routed to gap-closure (likely Plan 03-08). Debug doc: `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (Plan 03-07 section). BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02. SUMMARY: `03-07-SUMMARY.md`.
  - 03-09 — Readback Structure-Only Validator Gap Closure: **AUTO TASKS 1-2 COMPLETE; TASK 3 CLOSURE RE-DRILL DID NOT PASS 2026-05-17.** `gsd-executor` ran Tasks 1-2, 2 commits `c2b55b9..b43f249`. Task 1 (`c2b55b9`, feat): split `validateDraftSchema` into a NEW exported structure-only core `validateDraftStructure` (object + masthead + 4-array key checks, NO slot resolution) + the slot-resolution pass; `validateDraftSchema` now delegates the structural checks to `validateDraftStructure` then runs the SAME `replaceSlots` loop — signature + external behaviour for `compilePass1` byte-identical; re-pointed the Option B readback (`isResultComment`/`isResultDocument`) from the bug-causing `validateDraftSchema(parsed, {})` to `validateDraftStructure(parsed)`; added a `{{NUMBER:key}}` regression fixture to `agent-task-delivery.test.mjs` (the 03-08 fixture used empty `editorialSummary` and never caught the bug). Task 2 (`b43f249`, chore): version 0.4.0→0.5.0 (`package.json` + `manifest.ts`), rebuilt 3 artifacts, `npm pack` → `clarity-pack-0.5.0.tgz` (sha256 `e687615287c65ab65a43356a64983d949dc4eb69fc4ff3b59aa5dadb4785f113`). Suite 689→690 (688 pass / 0 fail / 2 skip). **Task 3 = Eric's Countermoves closure re-drill (`checkpoint:human-verify`, blocking) — RUN 2026-05-17, DID NOT PASS.** The readback fix is PROVEN LIVE — worker log at 07:19:43: `agent-task-delivery: result DOCUMENT received ... (key=compile-result)`; the structure-only `validateDraftStructure` accepted the agent's placeholder-bearing `BulletinDraft`, no rejection poll loop, no `deliverAgentTask` timeout. The v0.4.0 validator-misuse bug is DEAD. BUT a NEW, unrelated gap blocks closure: `verifyDraft` pass-2's 5 standing-number `ctx.db.query` calls ALL failed at the host RPC layer — `mrr` → `column "active_subscription_cents" does not exist`; the other 4 (`briefs_sent_week`/`reply_rate_7d`/`discoveries_7d`/`refund_rate_30d`) → `column "tags" does not exist`. The standing-number SQL (`standing-numbers.ts` + almost certainly `facts-table.ts`) references columns that DO NOT EXIST in the live Paperclip schema. 3 `plugin_version='0.5.0'` `editor_agent_failures` rows (id 529-531), breaker tripped at `consecutive=3`. No `Bulletin No. N` published; `bulletins` still only bootstrap `cycle_number 0`. Operation issue COU-20. Local suite missed it because host-faithful fakes return canned `db.query` results — never execute the SQL against a real schema. Routed to gap-closure Plan 03-10 (standing-number / facts-table SQL schema-drift fix; a `gsd-debugger` pass against the live schema is the natural first step). BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02. Debug doc: `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (Plan 03-09 closure re-drill section). SUMMARY: `03-09-SUMMARY.md`.
  - 03-08 — Option B Document-Readback Gap Closure: **AUTO TASKS 1-3 COMPLETE — AWAITING TASK 4 CHECKPOINT 2026-05-17.** `gsd-executor` ran Tasks 1-3, 3 commits `d50fda2..ae529f5`. Task 1 (`d50fda2`, feat): diagnosed the 03-07 fallback-poll miss (VERDICT — structural, not an API-shape bug: the document scan was correct code keyed to the correct `operationIssueId`, but ran only as a never-primary ~15s backstop inside a `Promise.race` against a 300s timeout) and rewrote `deliverAgentTask` steps 4-5 to Option B — a PRIMARY `ctx.issues.documents.get(operationIssueId,'compile-result',companyId)` poll at 5s + off-key `documents.list` scan + legacy `listComments` scan; the `Promise.race` + `PENDING_DELIVERIES` registry removed; `RESULT_DOCUMENT_KEY`/`RESULT_DELIVERY_INSTRUCTION`/`RESULT_POLL_INTERVAL_MS` added; the delivery instruction now rides the operation-issue DESCRIPTION. Task 2 (`4240d3f`, chore): DELETED `compile-result-tool.ts` + its test; removed the manifest `tools[]`/`agent.tools.register` cap/`agents[].permissions.pluginTools` + `worker.ts` wiring; rewrote Editor-Agent instructions to document-delivery; version 0.3.0→0.4.0. Task 3 (`ae529f5`, chore): rebuilt all 3 artifacts + `npm pack` → `clarity-pack-0.4.0.tgz` (sha256 `0a7891e67ac803abb6ced55f4e02fe16a24009257ea728995dae37ee8673baa2`). Suite 696→689 (687 pass / 0 fail / 2 skip). Typecheck + worker(176.3 KB)/UI(105.1 KB)/manifest builds clean; `dist/worker.js` grep-clean of all Option C strings. 0 deviations; Self-Check PASSED. **Task 4 = Eric's Countermoves closure re-drill (`checkpoint:human-verify`, blocking) — NOT executed; awaiting Eric.** BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02. SUMMARY: `03-08-SUMMARY.md`.

  - 03-10 — Standing-Number Schema-Drift Gap Closure: **AUTO TASKS 1-3 COMPLETE — AWAITING TASK 4 CHECKPOINT 2026-05-17.** Filed after the Plan 03-09 closure re-drill proved the readback fix live but surfaced standing-number schema drift: `STANDING_NUMBER_SLOTS` defined 5 slots whose SQL referenced columns absent from the live Paperclip schema (`companies.active_subscription_cents`, `issues.tags`, `issue_comments.author_role`) — all 5 `verifyDraft` pass-2 `ctx.db.query` calls failed, draft rejected, breaker tripped, no bulletin published. `gsd-executor` ran Tasks 1-3, 3 commits `17b1340..b4a1a9e`. Task 1 (`17b1340`, feat): rewrote `STANDING_NUMBER_SLOTS` with 5 agent-operations slots — `open_issues`, `completed_7d`, `blocked_issues`, `agent_spend_mtd`, `budget_used_pct` — every column verified live in `03-10-SCHEMA-FINDINGS.md §2`; `verifyDraft` re-runs `slotDef.sql` by key so the verifier is fixed automatically; T-03-10 SQL-injection invariant preserved (static module-constant SQL, `## Current Position

` sole bound param, no template literals); cents→dollars currency-bug fixed in `agent_spend_mtd` (`/ 100.0`). Task 2 (`f80e4c2`, test): repointed 6 test/helper files keyed to the old slot names (`mrr`→`agent_spend_mtd` currency, `reply_rate_7d`→`budget_used_pct` pct) — incl. a Rule-3 inline fix of `test/helpers/host-faithful-ctx.mjs`'s `cannedDraft` (its old `mrr` key made the verifier `UNKNOWN_SLOT`-reject 3 host-faithful happy-path tests); `compile-pass-1.ts` `buildPrompt` checked — NO edit needed (facts/standingNumbers injected as JSON data). Suite 690 tests, 688 pass / 0 fail / 2 skip — count unchanged. Task 3 (`b4a1a9e`, chore): version 0.5.0→0.6.0 (`manifest.ts` + `package.json`; comment re-scopes the durable breaker past the 3 stale `plugin_version='0.5.0'` failure rows 529-531), rebuilt 3 artifacts (worker 176.0 KB / UI 105.1 KB / manifest carries 0.6.0; all exit 0), `npm pack` → `clarity-pack-0.6.0.tgz` (sha256 `9101d3575b298efb0801cccadf6785a73b911dd1c1372887340280fa396df3e2`). 1 deviation (the Rule-3 host-faithful-ctx fix, documented). Self-Check PASSED. **Task 4 = Eric's Countermoves closure re-drill (`checkpoint:human-verify`, blocking) — NOT executed; awaiting Eric.** CLOSURE CRITERION: a `Bulletin No. N` issue (`cycle_number >= 1`) published end-to-end on live Countermoves with the 5 verified standing numbers, breaker not tripped. BULL-05, BULL-06, BULL-09. SUMMARY: `03-10-SUMMARY.md` (Task 4 verdict = PENDING).

**Compile-path defects fixed during the 2026-05-15 Countermoves drill:**

  1. `cc8bf62` — migration `0004` apostrophe in a `--` comment broke the host's greedy SQL string-stripper (statement misclassified non-DDL). Added `test/migrations/ddl-prefix-validator.test.mjs`.
  2. `db07cef` — host plugin-migration validator has no `extractQualifiedRefs` pattern for `CREATE INDEX` → rejected. Dropped the 4 indexes (PK/UNIQUE constraints cover access paths).
  3. bootstrap row auto-assigned `cycle_number 1`, colliding with the first real compile's cycle-1 publish on the bulletins PK. Bootstrap now uses sentinel `cycle_number 0`.
  4. `897287e` — `compile-bulletin.ts` used a local `EDITOR_AGENT_KEY='clarity-pack-editor-agent'`; the manifest declares `'editor-agent'` → `reconcile` threw every fire. Now imports the key from `editor.ts`; added `editor-agent-key-consistency.test.mjs`.
  5. `b527d08` — the host forwards only fixed plugin-log fields and drops custom metadata (`err`); error text now folded into the log message string.
  6. `ece2b78` — `bulletins-repo.ts` ran INSERTs through `ctx.db.query` (host-restricted to SELECT). All writes → `ctx.db.execute`. `94fd6ad` — test fakes hardened host-faithful.

**Phase 3 artifacts:** `03-CONTEXT.md` (synthesized — no discuss-phase, yolo mode), `03-RESEARCH.md`, `03-PATTERNS.md` (30/30 Phase 2 analog coverage), 4 PLAN.md files. plan-checker VERIFICATION PASSED after revision 1.

---

Phase: 2 (Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In) — **COMPLETE 2026-05-15 ✓**
**Plans:**

  - 02-01 PARTIAL — smoke spike (Linux Check B deferred — non-blocking, accepted)
  - 02-02 COMPLETE 2026-05-13 — scaffold + 6 primitives + trust-model hardening
  - 02-03 + 02-03b + 02-03c CLOSED TOGETHER 2026-05-14T09:08+ — Editor-Agent + Reader view + companyId resolver + drill APPROVED on Countermoves COU-1
  - 02-04 APPROVED 2026-05-15 — Situation Room + Opt-In + Coexistence CI (via 02-08 → 02-09 closure chain)
  - 02-08 APPROVED 2026-05-15 — Situation Room gap-closure polish (CSS chrome + UUID-narration humanization + useOptIn refresh + prod esbuild + awaiting-you semantics)
  - 02-09 APPROVED 2026-05-15 — DEV-15-STRUCTURAL closure via UI-side `useResolvedUserId` resolver (DEVIATION from plan text — worker get-viewer infeasible; SDK has no caller-identity accessor) + DEV-16 issue-reader degradation contract locked
  - 02-05 + 02-06 + 02-07 + 02-10 DEFERRED follow-ons (React keys / LiveBlockerPanel UX / ActivityTimeline date / Vite WS console noise) — non-blocking, can interleave with Phase 3

**Status:** Ready to execute
**Progress:** [######    ] 2/5 phases complete; Phase 4 Employee Chat 3/6 plans done

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1 requirements | 79 |
| Phases | 5 |
| Granularity | coarse |
| Plans complete | 3 (all of Phase 1) |
| Phases complete | 0/5 (Phase 1 awaiting rehearsal) |
| Phase 1 tests | 103 (Plan 01: 48, Plan 02: 33, Plan 03: 22) — 103/103 passing |
| Phase 1 commits | 11 (RED + GREEN + docs across 3 plans) |
| Plan 03-01 | ~38 min, 3 TDD commits, 13 files (8 created), suite 422→455 (+33; 453 pass / 0 fail / 2 skip) |
| Plan 03-02 | ~42 min, 4 TDD commits, 15 files (13 created), suite 455→504 (+49; 502 pass / 0 fail / 2 skip) |
| Plan 04-02 | ~12 min, 7 commits (6 TDD + 1 deviation fix), 8 files (5 created), suite 762→767 (+5; 765 pass / 0 fail / 2 skip) |
| Plan 04-03 | ~7 min, 7 commits (6 TDD + 1 wiring), 7 files (6 created), suite 767→798 (+31; 796 pass / 0 fail / 2 skip) |
| Plan 04.1-01 | 3 tasks across 2 sessions (Task 1 autonomous build + Task 2 Eric Countermoves live drill 4 min + Task 3 continuation lock), 4 commits `9703dbe..db29504`, 3 files created (probe + findings + traceability test), 3 modified (REQUIREMENTS + STATE + ROADMAP), 9 new tests RED→GREEN; Phase 4.1 Gate Verdict GO |

## Accumulated Context

### Locked Decisions (carry across phases)

1. **Plugin form factor** - one TypeScript package, one manifest, one UI bundle exporting many React components by name, one out-of-process Node worker over JSON-RPC stdio. Not four plugins per surface.
2. **Hybrid chat persistence** - real-time UI but durable as ordinary `public.issue_comments`; attachments as Paperclip work-products. Single source of truth = `issue_comments`.
3. **Editor-Agent governance parity** - declared in manifest `agents[]`, reconciled per-company via `ctx.agents.managed.reconcile()`. Inherits Paperclip heartbeat + budget caps + pause/terminate + audit log automatically. No custom `setInterval` daemon.
4. **Default landing = Paperclip classic dashboard** - Clarity views are opt-in clicks, never overrides.
5. **v1 audience = Eric on BEAAA only** - Clipmart submission deferred; multi-tenant work out of scope.
6. **Bulletin cadence = 06:30 ET scheduled** + Situation Room on-view recompute every 60s (configurable via `instanceConfigSchema`).
7. **Pre-install backup + rollback discipline before any production action** - Phase 1 ships snapshot/restore scripts and a working rollback drill before any feature code touches BEAAA. Bookended-by-snapshots rule applies forever.
8. **Stack pins are forced by the plugin contract** - React 19 (peer-only, never bundled), TypeScript ^5.7.3, esbuild ^0.27.3, ESM-only, Node >=20, shadcn `new-york`/neutral/lucide. Tailwind inherited from host CSS.
9. **Paperclip default branch is `master`, not `main`** - all doc URLs and CI references must use `/blob/master/...`.
10. **Plugin UI runs as same-origin trusted JS** (not iframed) - manifest capabilities gate worker RPC but NOT UI HTTP fetch. Day-1 mitigations (bridge-only, ESLint rule on raw fetch, pinned lockfile, no postinstall scripts) ship in Phase 2.
11. **Bulletin scheduling = worker-managed `next_due_at`, not the manifest cron** (Plan 03-01 / D-12) - the `jobs[]` cron string `*/1 * * * *` is a heartbeat hint only; `bulletins.next_due_at` (computed via `date-fns-tz` `computeNextDueAt` in `America/New_York`) is the DST-safe source of truth. The compile-bulletin job fires only when `now >= next_due_at`. date-fns-tz@3.2.0 chosen over luxon (tree-shakeable ESM; 10.34 KB gz worker bundle).
12. **Bulletin-compile circuit-breaker `recordSuccess` is pipeline-scoped, not pass-scoped** (Plan 03-02) - `recordSuccess(BULLETIN_COMPILE_AGENT_KEY)` fires exactly once after a *verified publish*, never after pass-1's parse. A draft that pass-1 accepts but the pass-2 verifier rejects must accumulate toward the 3-rejection circuit-breaker trip; resetting the shared counter on pass-1 success would let verifier-rejected drafts escape the trip wire. `BULLETIN_COMPILE_AGENT_KEY = 'bulletin-compile'` keeps bulletin failures isolated from compile-tldr's counter.
13. **Managed-agent result readback = an issue-document poll, not a tool call and not a comment poll** (Plan 03-08, Option B) - a `claude_local` managed agent's session never receives a plugin-declared tool (Option C live-disproven on the 2026-05-16 drill). `deliverAgentTask`'s PRIMARY readback is `ctx.issues.documents.get(operationIssueId, 'compile-result', companyId)` at a 5s cadence; an off-key `documents.list` scan and a legacy `listComments` scan are lower-priority fallbacks. The agent files its `BulletinDraft`/TL;DR as an issue document keyed `compile-result` — its proven, observed behaviour.
14. **Per-operation agent instructions ride the operation-issue DESCRIPTION, not the static manifest** (Plan 03-08) - `reconcile()` sets `agents[].instructions.content` at agent CREATION only; it does NOT propagate to an already-existing managed agent. Any instruction the agent must follow per-compile (e.g. "store the result as a document keyed `compile-result`" — `RESULT_DELIVERY_INSTRUCTION`) is appended to the operation-issue description, which `deliverAgentTask` creates fresh every compile and the agent provably reads.
16. **`chat_messages` is a mandatory id-map side table, never a content store** (Plan 04-02 / D-09) - `ctx.issues.createComment` accepts no metadata field and `public.issue_comments` has no supersedes column, so the `message_uuid -> comment_id` idempotency map (CHAT-06), the D-11 supersedes link and the D-13 pin flag live in `plugin_clarity_pack_cdd6bda4bd.chat_messages`. That table has NO `body` column — message content lives only in `public.issue_comments` (CHAT-02). The Phase-2 COEXIST-05 stub (forbade any `chat_messages` table) was corrected to enforce the real invariant: side table allowed, `body` column forbidden.
17. **Phase 4 chat handlers need no new manifest capability strings** (Plan 04-02) - posting a chat message uses `issue.comments.create`, the stream bridge uses `events.subscribe`, the roster uses `agents.read`, `+ New topic` uses `issues.create`, and D-06 auto-reopen calls `ctx.issues.update` — all covered by capabilities Phase 2/3 declared and proved live on Countermoves (`bulletin-action-approve` exercises `ctx.issues.update` with the current set). An unrecognized capability string would risk the host install validator, so `issues.update` is deliberately NOT added.

18. **Chat send/edit/realtime contract** (Plan 04-03) - `chat.send` is the canonical-write path: dedup on `message_uuid` (a resend returns the original `commentId`, never re-posts — CHAT-06), then `ctx.issues.createComment` writes the body to `public.issue_comments` (CHAT-02), then `insertChatMessage` records only the id-map. D-06 auto-reopen flips a `done` topic to `in_progress` for UX/status only and is **best-effort** (its own try/catch — a failed flip must not fail a landed send); `requestWakeup` is NOT called (04-01 OQ-3 STATUS-FLIP-NOT-NEEDED — a posted comment alone wakes the agent). `chat.edit` is append-with-supersedes (D-11/CHAT-05): a NEW comment + a `chat_messages` row whose `supersedes_uuid` points at the prior message; the original comment is never mutated, and a server-side ownership re-check rejects agent/unknown messages (`NOT_OWNED`). Realtime (D-08) is a worker stream bridge: `ctx.events.on('issue.comment.created')` re-emits chat-topic comments on the `chat:<companyId>` plugin SSE channel via `ctx.streams.emit`; the `issue.comment.created` payload is opaque (04-01 OQ-2) so the bridge re-fetches via `listComments` and emits the newest comment id. `userId` missing on `chat.send`/`chat.edit` short-circuits to `OPT_IN_REQUIRED` (opt-in-guard consumes it before the inner handler), NOT a throw.

19. **Chat true-task wake mechanism = native, not requestWakeup** (Plan 04.1-01) - the SDK's `ctx.issues.requestWakeup` has NO public REST surface on the host version installed on Countermoves (all three legal `reason` values return HTTP 404 "API route not found"). It does NOT matter, because multi-turn native re-wake works: a bare comment posted on a chat-topic issue re-wakes the assigned employee-agent on turn N>1 (PROBE-OQ3 PASS-NATIVE, 2026-05-20). Plan 04.1-03's `ensureTopicWakeable` therefore DROPS the wake-nudge call entirely and keeps only the defensive D-11 status-flip-off-done check; topic issues are created at `in_progress`; `chat.send` does not call `requestWakeup`. `issues.wakeup` capability stays declared but unused.

20. **Chat runtime-noise discriminator = dual-keyed** (Plan 04.1-01) - `classifyComment` (Plan 04.1-04) is primary on `authorType === 'system'` (RESEARCH HIGH-confidence prediction, host-stamped, would-have-to-change-public-API to defeat), secondary on `presentation.kind === 'system_notice'` (correlated; provides the structured envelope D-16 diagnostics view renders). Body-pattern fallback list = 5 phrases: RESEARCH.md's 4 existing runtime phrases PLUS the new disposition phrase `"Paperclip needs a disposition before this issue can continue"` captured verbatim from the live provoked notice `fa25ef4d-78ee-4143-a527-c23227721eec`. The structured `metadata.sections` envelope (typed `issue_link` / `agent_link` / `key_value` / `run_link` rows) is the preferred D-16 render path (Plan 04.1-06), not raw body parsing.

21. **Chat active-tasks query path = side table, not issues.list filter** (Plan 04.1-01) - the REST `issues.list` surface silently ignores `originId`/`originIdPrefix` filters on this host version (returns 500-row cap regardless of filter; exact-match returns 0 even when the row exists — verified 2026-05-20 against Countermoves). Plan 04.1-05 ships `migrations/0007_chat_topic_tasks.sql` as the defensive default (additive, plugin-namespace, race-safe `topic_issue_id → task_issue_id` map). `chat.taskOwned` data handler queries the side table, NOT `issues.list`. Client-side `originId.startsWith(...)` filter kept as belt-and-braces fallback for upgrade-path topics that pre-date the migration. `createTrueTask` (Plan 04.1-02) MUST insert into `chat_topic_tasks` immediately after `ctx.issues.create`.

22. **Chat-topic watchdog is defensive-only** (Plan 04.1-01) - the assigned employee-agent leaves chat-topic issues at `in_progress` after a successful run (PROBE-OQ1-STATUS AGENT-LEAVES-IN-PROGRESS, 2026-05-20); there is no agent-set status the watchdog must override on every poll. Plan 04.1-04's `topic-watchdog.ts` is a defensive sweep that flips status from `done`/`cancelled`/`blocked` back to `in_progress` ONLY when something else (the host's disposition-recovery service per the OQ3 attempt-2 evidence) has parked the topic terminally. `topicStuck` (Plan 04.1-04) triggers ONLY when the watchdog has attempted N≥2 flips in the last M poll cycles without success — CTT-05 is the steady-state path; CTT-06 banner is last-resort only.

15. **Standing-number SQL is column-bound to a live-introspected schema** (Plan 03-10) - the 5 `STANDING_NUMBER_SLOTS` are agent-operations metrics (`open_issues`, `completed_7d`, `blocked_issues`, `agent_spend_mtd`, `budget_used_pct`) over `public.issues`/`public.companies`; every column is verified present by a live `\d` introspection capture (`03-10-SCHEMA-FINDINGS.md §2`), never extrapolated from the host repo or a CRM mental model. Paperclip has no customer/revenue/sales data — the original CRM-model slots (MRR, cold-email reply rate, refunds) referenced columns that do not exist. Per 03-CONTEXT.md line 92 only the registry SHAPE + BULL-05 (SQL-derived, grep-able, never LLM-generated) are locked; the specific numbers are planner's discretion. The local host-faithful test suite returns canned `db.query` results and CANNOT catch schema drift — a live Countermoves drill is the only valid proof.

### Open Todos

- [x] Run `/gsd:plan-phase 1` to decompose Phase 1 into executable plans.
- [x] Plan 01-01 — Safety CLI core (snapshot/restore/list/prune). Done 2026-05-07.
- [x] Plan 01-02 — Smoke + Verify. Done 2026-05-07.
- [x] Plan 01-03 — Pre-flight gate + runbook (Tasks 1 + 2). Done 2026-05-07.
- [x] Plan 01-03 Task 3 — First rehearsal-drill attempt (Eric, 2026-05-12 against Hostinger Countermoves). FAILED at Step 5 with two real defects surfaced (recorded in REHEARSAL.md § Failed Drill Attempts). Defect 1 fixed in commit 9506a91; Plan 01-04 covers defect 2 + re-rehearsal.
- [ ] **Plan 01-04 — Safety CLI cleanup + re-rehearsal (Eric).** Execute Task 1 (snapshot cache-exclusion) + Task 2 (restore symlink-bifurcation tests) autonomously, then Task 3 (re-rehearsal against Hostinger). On `approved — drill clean`, Phase 1 closes.
- [ ] Resolve 3 conflicts in Phase 2 SPEC.md (slot identity, migrations, refresh cadence) before Phase 2 planning.
- [ ] Verify install command form (`pnpm paperclipai plugin install` vs `pnpm paperclipai install`) by running `pnpm paperclipai plugin --help` against a fresh clone in Phase 2.0 smoke spike.
- [ ] Verify `usePluginStream` direct host-event subscription (for `issue.comment.created`) before Phase 4 design is locked.
- [ ] Verify `comment.updated` event existence in PLUGIN_SPEC §16 before Phase 4 (currently absent in documented minimum set; chat edits modeled as append-with-supersedes).
- [ ] Verify cron timezone interpretation in PLUGIN_SPEC §17 before Phase 3 (use worker-managed `next_due_at` regardless).

### Active Blockers

- **OPTION-C-TOOL-NOT-EXPOSED (OPEN 2026-05-16 — Phase-3-blocking, DECISIVE finding)** — the Plan 03-07 live diagnostic answered research Open Question 1: a plugin `tools[]` declaration + `agents[].permissions.pluginTools` does NOT expose the tool on a `claude_local` managed agent's surface. With the correct tool-directed instructions hand-applied, the live Editor-Agent explicitly searched for `submit-compile-result`, could not find it ("not in the deferred tools registry", "no Clarity Pack MCP server listed"), and fell back to storing the `BulletinDraft` as an issue document keyed `compile-result` + marking the issue done. **Option C — "the agent calls a declared plugin tool" — is not viable for `claude_local`.** Plan 03-07's whole premise is invalid against this host. Fix: gap-closure Plan 03-08 adopts Option B — `deliverAgentTask` reads the agent's issue document via the issues-documents API. Full write-up: `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (Plan 03-07 diagnostic-follow-up section).
- **AGENT-INSTRUCTIONS-NO-PROPAGATE (OPEN 2026-05-16 — secondary)** — manifest `agents[].instructions.content` does NOT propagate to an already-existing managed agent; `reconcile()` sets it at creation only. The Instructions tab IS hand-editable as a workaround (confirmed). Plan 03-08 must deliver any agent-facing instruction via the operation-issue DESCRIPTION (created fresh every compile), not the static manifest.
- **BULLETIN-READBACK-VALIDATOR-MISUSE (RESOLVED 2026-05-17 by Plan 03-09)** — `agent-task-delivery.ts`'s Option B readback called `validateDraftSchema(parsed, {})` with an empty facts table; `validateDraftSchema` resolves `{{NUMBER:key}}` slots via `replaceSlots`, which threw `UNKNOWN_SLOT` for every placeholder → every flawless agent draft rejected ~36× → `deliverAgentTask` 300s timeout. Plan 03-09 split out an exported structure-only `validateDraftStructure` and re-pointed the readback at it. CONFIRMED FIXED on the 2026-05-17 Countermoves drill — worker log `agent-task-delivery: result DOCUMENT received ... (key=compile-result)`; the readback accepted the placeholder-bearing draft with no timeout.
- **BULLETIN-STANDING-NUMBER-SCHEMA-DRIFT (OPEN 2026-05-17 — Phase-3-blocking, surfaced by the Plan 03-09 closure drill)** — `verifyDraft` pass-2's 5 standing-number `ctx.db.query` calls ALL fail at the Paperclip host RPC layer: `mrr` → `column "active_subscription_cents" does not exist`; `briefs_sent_week`/`reply_rate_7d`/`discoveries_7d`/`refund_rate_30d` → `column "tags" does not exist`. The standing-number SQL (`src/worker/bulletin/standing-numbers.ts`) and almost certainly the facts-table SQL (`src/worker/bulletin/facts-table.ts`) reference columns that DO NOT EXIST in the live Paperclip schema — `active_subscription_cents` and an `issues.tags` column are both invented/wrong. The local 690-test suite is green because host-faithful fakes return canned `db.query` results and never execute the SQL against a real schema. Fix: gap-closure Plan 03-10 — correct the standing-number / facts-table SQL to the actual Countermoves schema (discover real columns via `\d` on the live tables; a `gsd-debugger` pass against the live schema is the natural first step), re-pack 0.5.0→0.6.0, re-drill. The Option B document-handoff (03-08) + structure-only readback (03-09) are PROVEN — do not re-open. Full write-up: `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (Plan 03-09 closure re-drill section).
- **BULLETIN-COMPILE-FALLBACK-POLL-MISS (DIAGNOSED 2026-05-17, Plan 03-08 Task 1)** — VERDICT: the 03-07 miss was STRUCTURAL, not an API-shape bug. The 03-07 readback DID code a `documents.list`+`.get` scan keyed to the correct `operationIssueId` (the poll and the create shared one `issue.id` variable; the SDK `list(issueId,companyId)`/`get(issueId,key,companyId)` arity matched research Q1 verbatim). But the document scan ran only as a never-primary ~15s belt-and-suspenders backstop inside a `Promise.race` whose other branches were the dead Option-C tool promise and a 300s timeout — a slow backstop racing a multi-minute `claude_local` compile, with the architecture's *designed* winner being the tool channel that never fired. Plan 03-08 promotes the document poll to the PRIMARY 5s readback (`documents.get` at key `compile-result`); the `Promise.race` + `PENDING_DELIVERIES` registry are removed.
- **OPTION-C-TOOL-NOT-EXPOSED (CLOSED 2026-05-17 by Plan 03-08)** — the dead Option C surface (manifest `tools[]`, `agent.tools.register` cap, `agents[].permissions.pluginTools`, `compile-result-tool.ts`, `worker.ts` wiring) is fully removed; the plugin declares nothing about plugin tools. Superseded by Option B (document readback).
- **AGENT-INSTRUCTIONS-NO-PROPAGATE (MITIGATED 2026-05-17 by Plan 03-08)** — the document-delivery instruction is now carried in the operation-issue DESCRIPTION (`RESULT_DELIVERY_INSTRUCTION`, appended by `deliverAgentTask` every compile) — the channel that provably propagates to a live managed agent. The static manifest `agents[].instructions.content` is informational only. Task 4's live drill confirms the live agent reads the description-borne instruction.
- **DURABLE-BREAKER-TRIPPED-0.3.0 (OPEN 2026-05-16 — must clear before re-drill)** — the 3 `deliverAgentTask` timeouts wrote 3 `editor_agent_failures` rows stamped `plugin_version='0.3.0'`, which now trips the v0.3.0 durable breaker. `DELETE` them before any re-drill: `DELETE FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE plugin_version='0.3.0';`
- **DURABLE-BREAKER-STALE-HISTORY (RESOLVED 2026-05-16)** — fixed by Plan 03-07 migration 0005 + version-scoped `isCircuitOpenDurable`; CONFIRMED on the 03-07 drill (3 pre-fix NULL rows did not suppress the fresh install).
- **SAFE-02 Part B (rehearsed at least once)** — pending Eric's drill against the fresh local Paperclip clone. Not a code blocker; the gate, runbook, and CLI are all green. The acceptance grep `^\| 20[0-9]{2}-` over `runbook/REHEARSAL.md` flips to PASS the moment Eric appends his first dated drill row.
- **BULLETIN-COMPILE-SESSION (RESOLVED 2026-05-16)** — root cause was NOT sync-vs-async; it was the host taskKey namespace contract. `sessions.create` stores a caller `taskKey` verbatim, but `sendMessage`/`close`/`list` only find sessions whose taskKey is `LIKE 'plugin:<pluginKey>:session:%'`. The adapter passed `clarity-pack:bulletin:cycle-N:<ts>` → every lookup filtered it out → permanent "Session not found". Fix: omit `taskKey` so the host generates a conforming one (`f0ff821`/`4a904e4`). Confirmed fixed on the 2026-05-16 Countermoves re-drill. Full investigation: `.planning/debug/bulletin-compile-session-not-found.md`.
- **DEFECT-B (RESOLVED 2026-05-16, quick task 260516-gx4)** — `compilePass1` rejected valid `BulletinDraft` JSON as `LLM output was not valid JSON` whenever the Editor-Agent wrapped it in a ```json fence or a prose preamble. Fixed by `extractJsonObject` (pure fenced-block peel → brace-balanced quote-aware scan) wired into `compilePass1` (commit `4ed04b1`); genuinely-non-JSON output still hits `recordFailure` with the identical rejection. 15 TDD tests. A confirming Countermoves drill still pending for BULL-05/06/09 live verification — but it now confirms rather than discovers, since the whole compile path is host-faithful-testable locally.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260516-gx4 | Compile-path host-faithful test-hardening pass + Defect B JSON-extraction fix | 2026-05-16 | 4ed04b1 | [260516-gx4-compile-path-host-faithful-test-hardenin](./quick/260516-gx4-compile-path-host-faithful-test-hardenin/) |

### Phase History

- **Phase 1 — Pre-Install Safety** (2026-05-07, ongoing pending rehearsal):
  - Plan 01-01: 48 tests, 8 lib modules, snapshot+restore+list+prune CLI, CVE-2026-31802 mitigated, sibling-staging restore. Commits: 620ec0b, e93169e, bac5b84, 9c3148d.
  - Plan 01-02: 33 tests, smoke + verify with deadline-AbortSignal composition + atomic manifest write-back. Commits: 2c2b444, a5d413e, d1bc2db, f5e52c4.
  - Plan 01-03: 22 tests, gate refuse-or-run wrapper + 8-file runbook + 2 launchers. Commits: 8eb37bd (RED), 04c3412 (GREEN), d73485a (runbook).

## Session Continuity

**Last session:** 2026-05-20T00:00:00.000Z — Plan 04.1-01 Tasks 2 + 3 continuation. Eric ran the falsify-first spike probe on Countermoves and pasted the JSON summary; continuation agent replaced the STUB findings doc with the locked findings (status: locked, verdict: GO), wrote the traceability test (`test/phases/04.1-01-spike-findings.test.mjs`, 9 tests RED→GREEN), and produced the SUMMARY. Phase 4.1 Wave 1 CLOSED with Gate Verdict GO. Plans 04.1-02 / 04.1-03 / 04.1-04 (Wave 2, autonomous TDD) unblocked. 4 commits `9703dbe..db29504` (Task 1 build `9703dbe`, Task 2 lock findings `eb44303`, Task 3 test `30cba12`, Task 3 SUMMARY `db29504`).

**Stopped at:** Completed Plan 04.1-01 (Wave 1, falsify-first spike). Next: Plan 04.1-02 (createTrueTask shared helper + chat.createTrueTask handler + chat.promote D-04 unification rewrite — Wave 2, autonomous TDD).

**Last session (prior):** 2026-05-19T21:35:31.176Z

**Last session (extended):** 2026-05-14 evening through 2026-05-15 early morning — Plan 02-08 Task 4 drill against Countermoves Hostinger. 12 of 14 Phase 2 reqs proven; Situation Room visual fidelity APPROVED on /COU/situation-room (side-by-side with sketches/paperclip-fix-situation-room.html); OPTIN-01..05 all proven. Reader tab on /COU/issues/COU-4 stays stuck in loading state — DEV-15-STRUCTURAL diagnosed: `useHostContext().userId` returns null in detail-tab slots, exact-shape replay of the 02-03c companyId issue. opt-in-guard fails closed for every wrapped Reader handler (issue.reader / flatten-blocker-chain / editor.pause-status / resolve-refs) when params.userId is missing → bridge returns `{error:'OPT_IN_REQUIRED'}` → Reader can't render its data branch. 12 mid-drill defect-fix commits landed (aa70e82 → f1d911d): DEV-04 migration validator + regression test, DEV-06 CSS chrome (theme.css 353→755 lines), DEV-07/08/10/13 polish cluster, DEV-11 humanizeChain helper, DEV-12 now_doing fallback, DEV-14 runtime CSS injection (host doesn't auto-load sibling CSS), DEV-15 partial UI defense-in-depth (AnchoredToCards/AcChecklist/ActivityTimeline null-safety) and structural opt-in-guard accepts viewerUserId fallback + Reader threads userId. Test count 269→365 (+96; 363 pass / 0 fail / 2 skipped). Tarball shasum 7b8ecc3f at 30.7 KB. Plan 02-09 FILED with full Task 1-4 breakdown for useResolvedUserId resolver hook + DEV-16 issue-reader degradation contract tightening.

**Current session:** 2026-05-15 — Plan 02-09 Tasks 1-3 executed end-to-end (orchestrator dispatched gsd-executor). SDK pre-flight verification confirmed the plan's proposed worker `get-viewer` handler is structurally INFEASIBLE: PluginContext has no users/user/session accessor; GetDataParams has no envelope userId; ctx.http.fetch is outbound Node fetch without browser cookies; UI cannot bootstrap a worker get-viewer call without already knowing userId (circular dependency). Per plan's explicit escape hatch ("TBD by handler author"; "STOP if neither path works"), implementation deviated to UI-side fetch of Better Auth's `/api/auth/get-session` (plugin UI is same-origin trusted JS per Decision #10; Better Auth confirmed via 02-03c-HOST-CONTEXT.md:44). 6 commits a49e720..7b5f1be: Task 1 (resolver hook + opt-in-guard empty-string regression test + EXEMPT_HANDLER_KEYS negative-assertion), Task 2 (4 call-site rewires: ref-chip + reader/index + pause-banner + live-blocker-panel), Task 3 (issue-reader.ts degradation contract locked with 8 per-sub-step tests). Suite 365→422 (+57; 420 pass / 0 fail / 2 skip). Typecheck clean. dist/ui/index.js 64.3→67.8 KB. Finding #11 appended to 02-03b-API-SHAPES.md.

**Current session (Phase 3 start):** 2026-05-15 — Plan 03-01 (Daily Bulletin Foundation) executed end-to-end, 3 TDD commits ab217b0..e059d8b. Task 1 RED: 4 new test files (next-due-at 8 DST/determinism tests, self-loop-filter-bulletin 8 tests, 0004-bulletin-schema 11 DDL-contract tests, compile-bulletin-noop 5 tests). Task 2 GREEN: installed date-fns-tz@3.2.0 + date-fns@4.1.0; shipped `src/worker/bulletin/next-due-at.ts` (pure `computeNextDueAt` via toZonedTime/fromZonedTime), `migrations/0004_bulletin.sql` (4 namespace-qualified tables incl. bulletins.draft_json jsonb + UNIQUE(next_due_at,content_hash)), `src/worker/db/bulletins-repo.ts` (8 typed CRUD fns), extended self-loop-filter with `BULLETIN_TAG_PREFIX`, extended `src/shared/types.ts` with 10 bulletin type contracts. Task 3: `src/worker/jobs/compile-bulletin.ts` Wave-1 no-op skeleton + manifest extension (issues.create + issue.comments.create caps, compile-bulletin jobs[] entry, bulletinDepartments + bulletinTimezone config) + worker.ts wiring. 2 Rule-1 auto-fixes (both CI-tooling regex false positives — schema test comment-stripping; COEXIST-02 string-literal reword). Suite 422→455 (+33; 453 pass / 0 fail / 2 skip). Typecheck + build green. Worker bundle 30.6 KB min / 10.34 KB gz (date-fns-tz within budget). SUMMARY: `03-01-SUMMARY.md`.

**Current session (Phase 3 Plan 03-02):** 2026-05-15 — Plan 03-02 (Compile Pipeline) executed end-to-end, 4 TDD commits 9fe85b2..85c84fb. Task 1 RED: 7 new test files / ~49 tests (facts-table 6, standing-numbers 7, verifier 8, compile-pass-1 8, publish 9, end-to-end 6, bulletin-rendering 5). Task 2 GREEN: 3 pure helpers — facts-table.ts (computeFactsTable + format-aware replaceSlots, throws tagged UNKNOWN_SLOT), standing-numbers.ts (STANDING_NUMBER_SLOTS readonly 5-slot registry, static parameterized SQL $1=companyId only, computeStandingNumbers per-slot catch-and-default-0), bulletin-verifier.ts (pure-async verifyDraft, ±0.01 pct/ratio tolerance, typed VerifierResult). Task 3 GREEN: compile-pass-1.ts (cap-then-call LLM kernel mirroring compile-tldr.ts, MAX_BULLETIN_TOKENS=6000, validateDraftSchema), bulletin-rendering.ts (pure renderBulletinIssueBody markdown), publish.ts (two-phase write INSERT attempting → ctx.issues.create → UPDATE published, draft_json persists verified BulletinDraft per W3/W4, UNIQUE(next_due_at,content_hash) idempotency, orphan-safe), circuit-breaker.ts +BULLETIN_COMPILE_AGENT_KEY. Task 4: compile-bulletin.ts Wave-1 stub replaced with the real pipeline (reconcile → cycle number → computeStandingNumbers → computeFactsTable → compilePass1 → verifyDraft → publishBulletin → advance next_due_at; per-company isolation; 3-verifier-rejection circuit-breaker trip). 2 Rule-1 auto-fixes: (a) pass-1 recordSuccess was resetting the shared bulletin-compile counter so verifier rejections couldn't accumulate — moved recordSuccess to the job's post-publish path; (b) e2e test fixture had a wrong INSERT param index + `.`-based UPDATE regex that missed multiline SQL. Suite 455→504 (+49; 502 pass / 0 fail / 2 skip). Typecheck + build green. Worker bundle 136 KB unminified / 63.4 KB min / 19.76 KB gz (gz within RESEARCH.md budget; the `du -k ≤ 60` criterion measures the unminified artifact — measurement-basis note carried from 03-01). BULL-05/06/09 delivered. SUMMARY: `03-02-SUMMARY.md`.

**Current session (Phase 3 Plan 03-05):** 2026-05-15 — Plan 03-05 (LLM-Adapter Gap Closure) Tasks 1-3 executed end-to-end, 3 TDD commits 993b8fe..f6da35c. Closes the production-LLM-wiring gap surfaced by the 03-03 Countermoves drill: the bulletin + TL;DR compile pipelines were built against an injectable synchronous `LlmAdapter` wired in production to `ctx.llm` — which does not exist on SDK 2026.512.0 `PluginContext`. Task 1 RED: `test/worker/agents/session-llm-adapter.test.mjs` (11 tests). Task 2 GREEN: `src/worker/agents/session-llm-adapter.ts` — `sessionLlmAdapter` is a real LlmAdapter over `ctx.agents.sessions.*` (Mechanism 1 from 03-LLM-INVOCATION-RESEARCH.md; the plugin-llm-wiki `startWikiQuerySession` pattern): opens a session, sends the prompt, accumulates `chunk.message` (skip stderr) through `onEvent`, resolves the accumulated string on the terminal `done` event, rejects on `error`, enforces `SESSION_TIMEOUT_MS` (120s) so a stuck session never hangs, closes the session in a `finally`; a paused/terminated/pending_approval/null Editor-Agent rejects with a tagged `AGENT_NOT_INVOKABLE` error BEFORE any session opens. Task 3: compile-bulletin job builds the adapter per-company and resumes the manifest-`paused` Editor-Agent before the first compile; editor heartbeat path builds the same adapter for `compileTldr`; `ctx.llm` fiction + `as unknown as CompileBulletinCtx` cast removed; manifest gains 4 `agent.sessions.*` caps. The synchronous `LlmAdapter` interface is byte-identical so `compilePass1`/`verifyDraft`/`publishBulletin`/`compileTldr` and every stub test are untouched. Suite 565→582 (+17; 580 pass / 0 fail / 2 skip). Typecheck + worker (149.0 KB)/UI (97.5 KB)/manifest builds clean. 0 deviations. SUMMARY: `03-05-SUMMARY.md`.

**Current session (Phase 3 Countermoves production drill):** 2026-05-15 evening — `/gsd:execute-phase 3` ran Waves 1-3 + Plan 03-05; Eric drilled the build on the live Countermoves Hostinger instance. The drill shook out 6 compile-path defects (all the same root cause — the compile path was only stub-tested, so every real host constraint surfaced live), all fixed + committed `cc8bf62..e8f1a01` (see the "Compile-path defects fixed" list under Current Position). Test fakes hardened host-faithful via `test/helpers/host-faithful-db.mjs` (wired into 12 worker test files). The plugin now installs clean on Countermoves and the `compile-bulletin` job runs end-to-end through reconcile → Editor-Agent resume → standing-numbers → facts, failing only at the LLM call. Suite 565→584 (582 pass / 0 fail / 2 skip). One open blocker remains (below). Plan 03-03's visual drill: empty-state PASSED (page renders, no regression); populated verification deferred behind the blocker.

**Current session (Phase 3 Plan 03-04 build):** 2026-05-16 — Plan 03-04 (Errata + Failed-Compile Banner + DST CI + Coexistence) auto Tasks 1-2 executed RED→GREEN, 2 TDD commits ec9c08c..e65088a. Task 1 RED: 5 test files (errata 10, failed-compile-banner 9, dst-ci-matrix 10, idempotency 6, coexistence-bulletin-disable 5). Task 2 GREEN: errata first-class (`bulletin-errata.ts` two-handler file, T-03-22 server-side published-check, append-only), errata-as-comment snapshot in `publish.ts` (non-fatal, `applied_to_issue_comment_id` replay-guard), failed-compile banner (`bulletin-latest-status.ts` + `FailedCompileBanner`/`ErrataFooter` components + settings composer + `bulletin.css`), one-row-per-retry accounting in `compile-bulletin.ts` (attempt_n + 15-min spacing + attempt_n≥3 circuit-breaker), 7th coexistence check `07-bulletin-disable.mjs`. Suite 626→660 (+34; 658 pass / 0 fail / 2 skip). Typecheck + builds clean; 7/7 coexistence. `03-04-SUMMARY.md` filed (status AWAITING-CHECKPOINT) during a `/gsd:resume-work` reconstruction — the executor's auto-checkpoint interrupted before SUMMARY write.

**Current session (Phase 3 closure drill — BLOCKER found):** 2026-05-16 — Eric ran the Plan 03-04 Task 3 closure drill on Countermoves. Tarball-transfer install of the v0.2.0 (03-04) build was clean (`✓ Installed clarity-pack v0.2.0`). The bulletin page showed the empty state; the `*/1` compile job was already looping (bootstrap `next_due_at=2020-01-01`). `bulletin_compile_failures` showed the v0.2.0 build fixed the old UUID-tag bug (`76bd28a`) but failed pass-1 every fire with `compilePass1: LLM output was not valid JSON`. Root cause confirmed from the Editor-Agent dashboard: the agent runs its heartbeat loop and emits prose, never processing the compile prompt — the BULLETIN-COMPILE-AGENT-HEARTBEAT blocker above. Plugin uninstalled to halt the loop. Finding written to `.planning/debug/bulletin-compile-agent-heartbeat-gap.md`. Per Eric's decision: research → gap-closure plan. `gsd-phase-researcher` dispatched to write `03-AGENT-INVOCATION-GAP-RESEARCH.md`.

**Current session (Phase 3 Plan 03-06 — research → plan → execute):** 2026-05-16 — the 03-04 closure drill found the agent-invocation defect; root cause researched (`gsd-phase-researcher` → `03-AGENT-INVOCATION-GAP-RESEARCH.md`: the host discards the session prompt, upstream PR #3106 open; 03-05's Mechanism 1 misread `plugin-llm-wiki`, which uses a scoped-issue handoff). Plan 03-06 drafted (`gsd-planner`), plan-checked (`gsd-plan-checker` → PASS-WITH-CONCERNS, 1 blocker + 4 warnings), revised (Revision 1 — B-1 `includePluginOperations:true` + W-1..W-4), re-checked → PASS. Executed Tasks 1-4 (`gsd-executor`): new `src/worker/agents/agent-task-delivery.ts` (`deliverAgentTask`/`deliveryLlmAdapter` — scoped-issue handoff), durable `isCircuitOpen`/`isCircuitOpenDurable`, both compile paths rewired, issue-driven Editor-Agent manifest instructions + `issues.wakeup` cap, `sessionLlmAdapter` deprecated. 4 TDD commits `3810bf6..9076f1e`; suite 660→676 (674 pass / 0 fail / 2 skip); typecheck + builds clean. 6 minor deviations, all documented in `03-06-SUMMARY.md`. Plan docs committed `c3746a2`/`623b200`; Tasks 1-4 are the 4 feat/test commits.

**Current session (Plan 03-06 closure re-drill):** 2026-05-16 — Plan 03-06 built (commits `3810bf6..9076f1e`), packed, and drilled on Countermoves. Pre-drill: had to clear 518 stale `editor_agent_failures` + 482 `bulletin_compile_failures` rows (old-build noise that the new durable breaker read as an open circuit, silently suppressing the compile). The re-drill PROVED the architecture: `deliverAgentTask` created operation issue COU-5 (`Compile Daily Bulletin — cycle 1`) assigned to the Editor-Agent; the agent ran SCOPED to it (`PAPERCLIP_TASK_ID` — primary risk — confirmed), read the compile prompt, and produced a flawless `BulletinDraft`. Gap found: the agent put the JSON in an issue *document* + commented prose; `deliverAgentTask` reads comments for JSON → no publish. Routed: `gsd-phase-researcher` dispatched to write `03-RESULT-READBACK-RESEARCH.md` (Option A: instruct agent → pure-JSON comment / Option B: worker reads the document / Option C: agent calls a plugin tool).

**Current session (Phase 3 Plan 03-08 — Option B build):** 2026-05-17 — `gsd-executor` ran Plan 03-08 auto Tasks 1-3, 3 commits `d50fda2..ae529f5`. Task 1 diagnosed the 03-07 fallback-poll miss (structural — never-primary 15s backstop racing a 300s timeout, not an API-shape bug) and rewrote `deliverAgentTask` steps 4-5 to Option B (PRIMARY `documents.get` at key `compile-result`; off-key `documents.list` + legacy `listComments` fallbacks; `Promise.race`/`PENDING_DELIVERIES` removed; delivery instruction rides the operation-issue description). Task 2 stripped the dead Option C surface (deleted `compile-result-tool.ts`+test; removed manifest `tools[]`/`agent.tools.register`/`permissions`; rewrote instructions; version 0.3.0→0.4.0). Task 3 rebuilt + packed `clarity-pack-0.4.0.tgz` (sha256 `0a7891e6...`). Suite 696→689 (687 pass/0 fail/2 skip); typecheck + 3 builds clean; Self-Check PASSED. SUMMARY: `03-08-SUMMARY.md`.

**Next session resume point (set 2026-05-17 — Plan 03-09 closure re-drill DID NOT PASS):** Create gap-closure **Plan 03-10** — the standing-number / facts-table SQL schema-drift fix. The Plan 03-09 closure re-drill (`clarity-pack-0.5.0.tgz`) PROVED the structure-only readback works live (worker log `agent-task-delivery: result DOCUMENT received ... (key=compile-result)` — no timeout), but `verifyDraft` pass-2's 5 standing-number `ctx.db.query` calls ALL failed against the live Paperclip schema: `mrr` → `column "active_subscription_cents" does not exist`; `briefs_sent_week`/`reply_rate_7d`/`discoveries_7d`/`refund_rate_30d` → `column "tags" does not exist`. The SQL in `src/worker/bulletin/standing-numbers.ts` (and almost certainly `src/worker/bulletin/facts-table.ts`) references columns that do not exist on Countermoves. Plan 03-10: a `gsd-debugger` pass against the live `paperclip_countermoves` schema (`\d` on the relevant tables) to discover the real columns, correct the standing-number + facts-table SQL, re-pack 0.5.0→0.6.0, re-drill from the compile step. The Option B document-handoff (03-08) + the structure-only readback (03-09) are PROVEN — Plan 03-10 must NOT re-open them; scope is the standing-number/facts-table SQL only. Pre-re-drill: the breaker is version-scoped so a fresh 0.6.0 install is not DOA on the three `0.5.0` `editor_agent_failures` rows; clear them belt-and-suspenders if desired. Resume signal `approved — phase 3 closed` (after a future passing drill) closes Phase 3 — only a live drill that publishes a `Bulletin No. N` issue closes it; a green local suite does not.

**Superseded resume point (2026-05-16 earlier):** The compile-path host-faithful test-hardening pass + Defect B fix — DONE as quick task 260516-gx4 (see Quick Tasks Completed). Kept for history.

Build a comprehensive host-faithful `ctx` fake covering every surface `src/worker/jobs/compile-bulletin.ts` touches (reconcileDepartments → lineage → computeStandingNumbers → computeFactsTable → compilePass1→sessionLlmAdapter → verifyDraft → publishBulletin), plus an end-to-end test that runs `registerCompileBulletinJob` against it and fails locally on any host-contract violation. Extend the two existing precedents — `test/helpers/host-faithful-db.mjs` and `test/helpers/host-faithful-sessions.mjs`. Surfaces to model: `ctx.companies.list`, `ctx.agents.managed.reconcile`, `ctx.agents.get/resume/pause`, `ctx.agents.sessions.*`, `ctx.db.query/execute`, `ctx.issues.list/create/createComment`, `ctx.logger`, `ctx.jobs.register`. Use TDD.

**Host-constraint catalogue the fakes must encode** (each was a live-drill defect):

1. `ctx.db.query` SELECT-only / one statement; `ctx.db.execute` DML-in-namespace-only, returns `{rowCount}`, never rows. *(host-faithful-db.mjs has this.)*
2. `ctx.agents.sessions` — a caller `taskKey` is stored verbatim; `sendMessage`/`close`/`list` only find `taskKey LIKE 'plugin:<pluginKey>:session:%'`; omit `taskKey` → host generates a conforming one. *(host-faithful-sessions.mjs has this.)*
3. `ctx.agents.pause/get/resume` — `agentId` MUST be a real UUID; a non-UUID → host `invalid input syntax for type uuid`. **Not yet in a reusable fake — add it.**
4. `ctx.agents.sessions.sendMessage` throws `Agent wakeup was skipped by heartbeat policy` (≠ "Session not found") if the agent is not invokable. Model it.
5. The host drops arbitrary plugin-log metadata — evidence must be in the message string.
6. Migration SQL validator: apostrophe-in-`--`-comment breaks the string-stripper; `CREATE INDEX` rejected.
7. `bulletins` PK: `cycle_number 0` is the bootstrap sentinel; real cycles start at 1.
8. Editor-Agent: manifest agentKey is `editor-agent`; `EDITOR_AGENT_ID_TAG` (`clarity-pack-editor-agent`) is a TEXT attribution tag only.
9. SDK `Issue` has no `lastActorId`/`lastActorName` — lineage uses `assigneeUserId`.

Then **Defect B** (compilePass1 `LLM output was not valid JSON` — almost certainly the agent wraps JSON in prose/```json fences; TDD a JSON-extraction fix against the host-faithful sessions fake), then **Plan 03-04**, then **Phase 3 verification**.

**Environment:** pnpm is NOT on PATH — build with `node scripts/build-worker.mjs` / `node scripts/build-ui.mjs` / `npx tsc --project tsconfig.manifest.json`; typecheck `npx tsc --noEmit`; suite `node --test "test/**/*.test.mjs"`. Private GitHub backup: `github.com/erezgewgl3/clarity-pack` (remote `origin`, `gh` authed with `workflow` scope — push freely). Plugin page routes are `/<companyPrefix>/<routePath>` (e.g. `/COU/bulletin`). Countermoves psql: `sudo -u postgres psql -d paperclip_countermoves`.

**Phase 2 prior-session note:** Plan 02-09 closed Phase 2 (Countermoves COU-4 re-drill APPROVED 2026-05-15). 14 of 14 verifiable Phase 2 reqs Implemented. Deferred polish plans 02-05/02-06/02-07/02-10 remain non-blocking and can interleave with Phase 3.

**Files of record:**

- `.planning/PROJECT.md` - core value, locked decisions, constraints
- `.planning/REQUIREMENTS.md` - 79 v1 requirements + traceability to phases
- `.planning/ROADMAP.md` - 5-phase roadmap with success criteria
- `.planning/STATE.md` - this file
- `.planning/research/SUMMARY.md` - research synthesis
- `.planning/research/ARCHITECTURE.md` - build order, shared primitives, contribution-point mechanics
- `.planning/research/FEATURES.md` - table-stakes per surface
- `.planning/research/STACK.md` - forced stack pins
- `.planning/research/PITFALLS.md` - 18 pitfalls with phase assignments

---
*State initialized: 2026-05-07*
