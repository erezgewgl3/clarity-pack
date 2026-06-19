---
phase: quick-260619-r4v
verified: 2026-06-19T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Create task from chat dialog — Standalone option is absent at runtime"
    expected: "The Topic dropdown shows [current topic] + other topics + '+ New topic…' with no 'Standalone (not linked to any topic)' option"
    why_human: "The option element was verified absent in JSX source, but only a live browser render confirms it is absent in the compiled bundle serving the actual DOM"
  - test: "In-thread task-update card shows live status + latest agent comment after a real task cycles in_progress → in_review"
    expected: "The InlineTaskCard for an existing topic-linked task refreshes within 15s to show the agent's latest comment text (polished, relative time) and current status"
    why_human: "The wiring (message-thread polls chat.topicTaskUpdates and feeds liveCard into InlineTaskCard) is verified in source, but live behavior across an actual LLM agent write → poll → render cycle cannot be confirmed programmatically"
  - test: "Reassigned task follows new owner in the Active-tasks-owned rail"
    expected: "After a task is reassigned in classic Paperclip UI, the rail re-groups it under the new assignee's name rather than keeping it under the old owner"
    why_human: "Group-by-live-assignee logic is verified in source and tested in the handler test suite, but the live reassignment → 15s poll → re-group cycle requires a real Paperclip instance"
---

# Quick Task 260619-r4v — Verification Report

**Phase Goal:** Chat create-task topic-linkage redesign + agent-feedback loop closure — (1) topic-required create-task dialog with atomic new-topic + cold-path removed; (2) company-wide assignee-scoped Active-tasks-owned rail with showing-N-of-M; (3) in-thread live task-update cards via READ-TIME reflection. HARD INVARIANT: zero writes, zero requestWakeup, zero event subscriptions, zero ctx.issues.list; all host reads in-dispatch.
**Verified:** 2026-06-19
**Status:** HUMAN_NEEDED (all 7 truths verified in codebase; 3 live-behavior items need Eric's go-ahead drill)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every operator-created task from chat is topic-linked (no cold/standalone path remains); it always writes the chat_topic_tasks back-link | ✓ VERIFIED | `src/worker/chat/true-task.ts`: no `isCold` branch, no `cold-task:` originId in executable code. Handler returns `TOPIC_REQUIRED` when neither `topicIssueId` nor `newTopicTitle` is supplied (line 63-65 of `chat-true-task.ts`). The `cold-task:` string appears ONLY in a comment in `chat-open-for-issue.ts` (line 18 — not executable). |
| 2 | The create-task dialog requires a topic: defaults to open topic, Standalone option gone, Create disabled until topic or new-name | ✓ VERIFIED | `src/ui/surfaces/chat/true-task/true-task-dialog.tsx`: label is `TOPIC` (line 389 — not "OPTIONAL"); no `<option>` with "Standalone" text anywhere in file; `hasTopic` guard at line 237-238 (`canSubmit` requires `hasTopic`); `initialTopicIssueId` defaults to `currentTopic.issueId` in create mode (line 172-176). |
| 3 | newTopicTitle atomically creates topic (CHT-N + parent + chat_topics row) AND the topic-linked task (marker + back-link) | ✓ VERIFIED | `src/worker/chat/true-task.ts`: `createTopicForTask()` (lines 213-284) mirrors `chat.topic.create` — `getEmployeeParentIssueId` → bootstrap parent → `allocateChtNumber` → `ctx.issues.create` child topic at `NON_TERMINAL_CONVERSATION_STATUS` → `insertChatTopic`. Then the standard topic-linked task create runs (originId `chat-task:${topicIssueId}:...`, marker comment, `insertChatTopicTask`). |
| 4 | Active tasks owned rail shows ALL chat-created tasks owned by selected employee company-wide, grouped by LIVE assignee, reassigned task follows owner | ✓ VERIFIED | `src/worker/handlers/chat-active-tasks.ts`: uses `listChatTopicTasksForCompany(ctx, companyId, 100)` (line 137); enriches via `ctx.issues.get` per row; groups by `resolveAssigneeLabel(row)` (live assignee from `issues.get` response, not stored); `groups` array in response. UI in `active-tasks-owned.tsx` renders per-assignee group headers (lines 224-234). |
| 5 | Rail is bounded (M=100) with visible scope label + "showing N of M" when capped; enrich failures surface as labeled count | ✓ VERIFIED | `COMPANY_TASK_CAP = 100` (line 84 of `chat-active-tasks.ts`); `capped: total >= COMPANY_TASK_CAP` in response; `skipped` counter for failed enriches. UI: scope label at line 223 (`active-tasks-owned-scope`), "showing N of M" at line 237-239 when `capped`, labeled skipped line at line 241-243 when `skipped > 0`. |
| 6 | Each in-thread Task-created marker renders as a live task-update card showing assignee · COU-NN · live status + latest agent comment (polished); blocked shows "Blocked — needs you: <action>"; refreshes on 15s poll | ✓ VERIFIED | `src/ui/surfaces/chat/message-thread.tsx`: polls `chat.topicTaskUpdates` at 15s via `usePoll` (lines 336-351); builds `taskUpdateCards` Map keyed by `issueId` (lines 353-364); feeds `liveCard` into `<InlineTaskCard>` props `latestComment`, `blocked`, `blockedAction` (lines 622-624). `inline-task-card.tsx`: renders amber `.inline-task-card-blocked` span (line 180-182), latest-comment div with relative time (lines 193-217), "Working…" when null (line 214). |
| 7 | All new read paths perform ZERO writes, ZERO requestWakeup, ZERO event subscriptions, ZERO ctx.issues.list across populated AND empty inputs | ✓ VERIFIED | Handler source: `chat-active-tasks.ts` mentions "NEVER ctx.issues.list" in comments with no `issues.list` call anywhere in the file body; `chat-topic-task-updates.ts` same. Dedicated anti-storm guard tests in `test/worker/chat/chat-active-tasks.test.mjs` (lines 538-558) and `test/worker/chat/chat-topic-task-updates.test.mjs` (lines 354-374) each assert `issueListCalls.length === 0`, `executes.length === 0`, `wakeCalls.length === 0`, `eventSubs.length === 0` for BOTH populated AND empty inputs. |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/surfaces/chat/true-task/true-task-dialog.tsx` | Topic-required dialog: default-to-open-topic, Standalone removed, inline +New topic, Create gated | ✓ VERIFIED | All four requirements confirmed in source: `currentTopic` default, no Standalone option, `__new__` sentinel revealing name input, `canSubmit = hasTopic && ...` |
| `src/worker/handlers/chat-true-task.ts` | chat.createTrueTask handler accepting newTopicTitle; cold-path branch removed | ✓ VERIFIED | `newTopicTitle` param accepted (lines 58-61); `TOPIC_REQUIRED` error when neither supplied (line 63-65); no cold-task originId generation |
| `src/worker/chat/true-task.ts` | createTrueTask helper with atomic new-topic creation; isCold/cold-task branch removed | ✓ VERIFIED | `newTopicTitle` in `CreateTrueTaskInput` (line 92); `createTopicForTask()` atomic helper (lines 213-284); no `isCold` or `cold-task:` in executable code |
| `src/worker/db/chat-topics-repo.ts` | listChatTopicTasksForCompany + listChatTopicTasksForTopicAll | ✓ VERIFIED | `listChatTopicTasksForCompany` (lines 809-824): DISTINCT by task, company-scoped, LIMIT param. `listChatTopicTasksForTopicAll` (lines 831-846): per-topic with caller-supplied limit. Both SELECT-only plugin-namespace. |
| `src/worker/handlers/chat-active-tasks.ts` | chat.taskOwned re-scoped company-wide, grouped by live assignee, M=100 cap | ✓ VERIFIED | `listChatTopicTasksForCompany` enumeration; `Promise.all` bounded-parallel enrich; `resolveAssigneeLabel` NO_UUID_LEAK; `groups` Map; full `{groups, total, shown, capped, skipped}` response |
| `src/ui/surfaces/chat/active-tasks-owned.tsx` | Rail UI grouped by assignee with scope label + showing-N-of-M + labeled-skipped | ✓ VERIFIED | `active-tasks-owned-scope` label (line 223); per-assignee group headers (lines 224-234); cap line (lines 236-239); skipped line (lines 241-243) |
| `src/worker/handlers/chat-topic-task-updates.ts` | chat.topicTaskUpdates per-topic read-time-reflection handler; exports registerChatTopicTaskUpdates | ✓ VERIFIED | Full handler present (263 lines); exports `registerChatTopicTaskUpdates`; per-task `issues.get` + `listComments`; `isTopicStuck` + `polishTldr` reused; NO_UUID_LEAK `stripUuids`; TOPIC_CARD_CAP=20 |
| `src/ui/surfaces/chat/true-task/inline-task-card.tsx` | Card upgraded: latest agent comment line, blocked-needs-you amber state, relative time | ✓ VERIFIED | `latestComment`, `blocked`, `blockedAction` props added; amber `.inline-task-card-blocked` span (line 180); `relativeTime()` helper (lines 46-58); "Working…" fallback (line 214); "open" expand link when `hasTitleLink` (lines 203-210) |
| `test/worker/chat/chat-topic-task-updates.test.mjs` | Card-handler render-state tests + anti-storm guard (zero list/write/wake) on populated AND empty | ✓ VERIFIED | 10 tests covering: registration, opt-in, params, working state, agent-comment-only selection, operator-only → null, blocked+named-action, UUID scrub, cap/shown/capped, per-row failure, empty topic (zero enrich calls), and the dedicated anti-storm guard test asserting all 4 zeros |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `true-task-dialog.tsx` | `chat.createTrueTask` | `usePluginAction` with `newTopicTitle` param | ✓ WIRED | Line 148: `const createTrueTask = usePluginAction('chat.createTrueTask')`. Line 258: `newTopicTitle: creatingNewTopic ? trimmedNewTopic : undefined` passed in `createTrueTask({...})` call |
| `chat-active-tasks.ts` | `listChatTopicTasksForCompany` | company-wide side-table SELECT then per-row `ctx.issues.get` | ✓ WIRED | Line 137: `taskIssueIds = await listChatTopicTasksForCompany(ctx, companyId, COMPANY_TASK_CAP)`; then `Promise.all(taskIssueIds.map(async (taskIssueId) => ctx.issues.get(...)))` |
| `message-thread.tsx` | `chat.topicTaskUpdates` | per-topic poll feeding InlineTaskCard live status + latest comment | ✓ WIRED | Lines 336-351: `usePluginData('chat.topicTaskUpdates', {...topicIssueId})` + `usePoll` at 15s. Lines 353-364: `taskUpdateCards` Map. Lines 599-624: `liveCard = taskUpdateCards.get(parsedIssueId)` fed into `<InlineTaskCard latestComment={liveCard?.latestComment} blocked={liveCard?.blocked} blockedAction={liveCard?.blockedAction}>` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `active-tasks-owned.tsx` | `groups` / `tasks` | `listChatTopicTasksForCompany` → `ctx.issues.get` per row → response serialized to UI | Yes — side-table SELECT DISTINCT + per-row host RPC | ✓ FLOWING |
| `inline-task-card.tsx` | `latestComment`, `blocked`, `blockedAction` | `chat.topicTaskUpdates` → `listChatTopicTasksForTopicAll` + `ctx.issues.get` + `ctx.issues.listComments` per task | Yes — live host reads per poll cycle | ✓ FLOWING |
| `true-task-dialog.tsx` | `topicIssueId` / `newTopicTitle` | User selection → `usePluginAction('chat.createTrueTask')` → `createTrueTask` helper → host `ctx.issues.create` chain | Yes — all writes are real host RPC calls | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — this task produced local code only; no live Paperclip instance is expected. Live behavioral checks are captured in the Human Verification section below.

---

### Probe Execution

No probes declared in PLAN.md for this quick task. SKIPPED.

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|---------|
| SPEC-CHAT-LOOP-PIECE-1 | Topic-required dialog + cold-path removal + atomic new-topic | ✓ SATISFIED | Dialog: Standalone absent, label TOPIC, `currentTopic` default, `__new__` sentinel. Worker: `TOPIC_REQUIRED` guard, `newTopicTitle` atomic create, no `isCold` in executable code |
| SPEC-CHAT-LOOP-PIECE-2 | Company-wide assignee-scoped rail, bounded M=100, showing-N-of-M, enrich failures labeled | ✓ SATISFIED | `listChatTopicTasksForCompany`, group-by-live-assignee, cap/shown/capped/skipped in response + UI |
| SPEC-CHAT-LOOP-PIECE-3 | In-thread live task-update cards: status + latest agent comment (polished) + blocked-needs-you; per-topic, read-time | ✓ SATISFIED | `chat.topicTaskUpdates` handler + `InlineTaskCard` upgrades + 15s message-thread poll + liveCard wiring |
| SPEC-CHAT-LOOP-ANTISTORM | Zero ctx.issues.list / writes / requestWakeup / event subs across populated AND empty | ✓ SATISFIED | Both handlers confirmed zero in source; dedicated guard tests assert all 4 zeros for populated AND empty in both handlers |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned modified files for TBD/FIXME/XXX/placeholder/not yet implemented markers. None found. The `cold-task:` and `isCold` strings found by grep are all in comments documenting the removal, not in executable code paths.

---

### Human Verification Required

#### 1. Standalone option absent at runtime

**Test:** Open the "+ Create task" dialog from the Chat surface in a live browser with the plugin enabled
**Expected:** The Topic dropdown shows only [currently open topic] (marked "current"), any other non-archived topics, and "+ New topic…" — no "Standalone (not linked to any topic)" option exists
**Why human:** Option element verified absent in JSX source, but only a live render confirms the compiled bundle serves the right DOM

#### 2. In-thread live task-update card cycles with agent

**Test:** With a topic open and a task previously created from that topic, let an agent post a comment on the task issue, then wait up to 15s
**Expected:** The InlineTaskCard for that task refreshes to show the agent's comment text (polished, truncated, with relative time like "2m ago") and the updated status; if the task is stuck, an amber "Blocked — needs you: <action>" label appears instead of the status pill
**Why human:** The poll wiring and prop feeding are verified in source, but the actual 15s poll → `listComments` → `pickLatestAgentComment` → card render cycle requires a real agent write and browser session

#### 3. Reassigned task follows new owner in rail

**Test:** In classic Paperclip UI, reassign an existing chat-created task from one agent to another; then open Chat and wait up to 15s for the rail to refresh
**Expected:** The task disappears from the old assignee's group in the Active-tasks-owned rail and appears under the new assignee's group name
**Why human:** Group-by-live-assignee is proven in the test suite using mock `issues.get` responses, but the live reassignment → host data update → 15s rail poll → re-group render requires a real instance

---

### Gaps Summary

No gaps found. All 7 must-have truths are verified in the codebase. The 3 human-verification items are live-drill confirmations of behavior already proven correct in code and tests — they are gated on Eric's explicit go-ahead (no deploy has been run per the plan's deliberate scope).

---

_Verified: 2026-06-19_
_Verifier: Claude (gsd-verifier)_
