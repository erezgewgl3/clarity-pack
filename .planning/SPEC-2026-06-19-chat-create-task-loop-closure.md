# SPEC — Chat create-task topic-linkage redesign + agent-feedback loop closure

**Date:** 2026-06-19 · **Status:** LOCKED (brainstormed + approved by Eric) · **Build via:** `/gsd:quick --validate`
**Scope:** Local code only. NOTHING deploys to Countermoves (CM) or BEAAA without Eric's explicit go-ahead.
**Source of truth:** MemPalace `clarity_pack/decisions` drawers
`locked-design-2026-06-19-chat-create-task-topic-linkage` (base, pieces 1–2) and
`locked-design-2026-06-19-chat-agent-feedback-loop-closure` (addendum, piece 3). This file consolidates both for the planner.

---

## Problem

The chat surface exists so the operator (Eric) can check in with an agent and have them report: **what's going on, what they did, what they're doing, did they complete, did they NOT complete.** Two failures break that:

1. The prominent **"+ Create task"** opens a COLD dialog (`topicIssueId: null`) → the task is topic-UNLINKED: no thread marker, absent from the rail. It runs and completes but is invisible from inside chat (COU-56).
2. Even when topic-linked, the agent's **response lands on the issue, not back in the chat thread** — so Eric sees his question with no visible reply (COU-57: correctly linked to CHT-2/COU-43 Counterkit, CTO did it → `in_review`, CTO idle/healthy; the silence was purely surface).

## Coexistence / hard invariants (do NOT violate)

- **READ-TIME ONLY for loop closure.** Zero new writes, zero `requestWakeup`, zero event subscriptions, zero `ctx.issues.list`. All host reads run INSIDE an existing dispatch (the 15s thread poll / the data-handler call) → invocation-scope-safe (PR #6547). This is what makes the Phase-16.1 wake-storm structurally impossible. **Anti-storm guard tests are mandatory.**
- Additive-only Postgres (plugin namespace `plugin_clarity_pack_cdd6bda4bd`); never touch `public.*` except SELECT-only reads via `ctx.db.query` / `ctx.issues.*`. CTT-07: plugin actions never mutate `public.issues.updated_at`.
- Opt-in gated (`wrapDataHandler`). NO_UUID_LEAK scrub on all read-time display strings.
- Host `issues.list` silently ignores `originId` filters (PROBE-OQ2-FILTER) → the `chat_topic_tasks` side table is the enumeration source. Do NOT reintroduce originId filtering.

---

## Piece 1 — Topic-required create-task dialog

**Files:** `src/ui/surfaces/chat/true-task/true-task-dialog.tsx`, `src/worker/handlers/chat-true-task.ts`, `src/worker/chat/true-task.ts`.

1. **Default linkage:** "+ Create task" defaults the Topic dropdown to the CURRENTLY-OPEN topic (preselected). **DELETE the "Standalone (not linked to any topic)" option entirely.** Relabel `TOPIC (OPTIONAL)` → `TOPIC`. Topic becomes REQUIRED.
2. **Dropdown order:** [current topic first], then the employee's other (non-archived) topics, then an inline **"+ New topic"** affordance that reveals a new-topic-name text input.
3. **No-open-topic fallback:** if the employee has zero topics, the dialog REQUIRES naming a NEW topic (NO "General" catch-all — Eric rejected that). The **Create button is disabled** until an existing topic is selected OR a new-topic name is non-empty.
4. **Atomic new-topic:** the worker `chat.createTrueTask` gains a `newTopicTitle` param. When set (no existing `topicIssueId`), the worker atomically (best-effort, existing patterns): allocate `CHT-N` (`allocateChtNumber`), ensure/insert the per-employee parent issue, create the topic issue, insert the `chat_topics` row, THEN create the task linked to that new topic (marker comment + `chat_topic_tasks` back-link). Mirror the existing `chat.topic.create` flow; do not duplicate it carelessly.
5. **Remove/repurpose the cold path** in `src/worker/chat/true-task.ts` (`isCold` / `cold-task:` originId branch). After this change every operator-created task is topic-linked → always writes the `chat_topic_tasks` back-link → always visible in chat. (This is the COU-56 fix.)

**Out of scope:** existing orphans NOT retro-linked (stay normal issues; new creations only). The bare-conversation "+ New Topic" button UNCHANGED. The per-message "↗ Promote to task" UNCHANGED (already topic-linked).

## Piece 2 — Assignee-scoped, company-wide "Active tasks owned" rail (ratified data path)

**Files:** `src/worker/handlers/chat-active-tasks.ts`, `src/worker/db/chat-topics-repo.ts`, `src/ui/surfaces/chat/active-tasks-owned.tsx`.

- Currently TOPIC-scoped ("tasks created from this chat") — which is why CTO-assigned COU-56 never showed under the CTO. **New behavior:** show all chat-created tasks owned by the selected employee, **grouped by their LIVE assignee** (read live assignee via `ctx.issues.get` so a task reassigned in the dialog OR later in classic Paperclip FOLLOWS the owner and never silently disappears).
- **Data path:** enumerate company-wide `chat_topic_tasks` back-links → enrich each (`ctx.issues.get`) → group by live assignee. Needs a NEW company-scoped repo query (the current `listChatTopicTasksForTopic` is topic-scoped). The side table is the enumeration source (host `issues.list` originId filter is broken).
- **Bound + never-silently-incomplete (Eric's no-rabbit-holes rule):** company-wide cap **M = 100**; render a visible **scope label** + **"showing N of M"** line when capped. Enrich failures surface as a LABELED count, never a silent drop. Bounded parallel enrich (not the current sequential `for…await`).

## Piece 3 — In-thread live task-update cards (loop closure) — Approach A

**Files:** `src/ui/surfaces/chat/true-task/inline-task-card.tsx`, `src/ui/surfaces/chat/message-thread.tsx`, a **per-topic** read (new bounded handler e.g. `chat.topicTaskUpdates`, OR a topic-scoped read in `chat-messages.ts` — planner's call, but keep it a SEPARATE bounded read from the company-wide rail), `src/worker/db/chat-topics-repo.ts`, `src/worker/chat/topic-watchdog.ts` (reuse `isTopicStuck`).

- **Mechanism = READ-TIME REFLECTION** (chosen over a dedicated parallel handler and over folding into `chat.messages`). No writes/wakes. Runs in the existing 15s thread poll dispatch.
- **Upgrade the existing in-thread marker:** every chat-created task already drops a `Task created — COU-NN, assigned to <name>` marker into the thread. Upgrade that marker's rendering into a **live task-update card** (reuse `inline-task-card.tsx`), at its existing chronological spot.
- **Card content (per linked task of THIS topic):** `{assignee} · {COU-NN} · {live status}` + the agent's **latest** comment (newest agent-authored, from `ctx.issues.listComments(taskIssueId)`, 1–2 line clamp, expand → open issue), polished via existing `polishTldr` (operator-authored text NEVER polished). Relative time. Refreshes each poll.
  - **Depth = latest update + status only** (NOT full running narrative). No comment yet → status line only ("Working…").
  - **Blocked / did-NOT-complete:** ride existing structured-human-wait machinery (`isTopicStuck` / `recoveryOwner`, Phase 17). Card shows **"Blocked — needs you: ⟨named action⟩"** (amber) instead of a status pill.
  - NO_UUID_LEAK scrub applied.
- **Cost/bound:** per card 1 `issues.get` + 1 `listComments` (latest agent comment only), bounded + parallelizable; per-row failure degrades to status-only or drops with a labeled count. Cap ~20 cards/topic with "showing N of M" if exceeded.
- **Scope:** per-THIS-topic (`chat_topic_tasks` for the open topic). Kept independent of the company-wide rail (Piece 2) so the two scopes do not entangle.

---

## Testing (per piece + cross-cutting)

- **Piece 1:** dialog states — default-to-current-topic, Standalone gone, Topic required, create disabled until topic|new-name, inline new-topic reveal; worker `newTopicTitle` atomic create (topic + linked task + marker + back-link in one flow); cold-path removal (no `cold-task:` originId emitted).
- **Piece 2:** company-wide enumerate query, group-by-live-assignee, reassignment-follows-owner, cap + "showing N of M", per-row failure labeled, bounded parallel enrich.
- **Piece 3:** card render states (working / in-review / done / blocked-needs-you / no-comment-yet / uuid-scrub); per-topic enrich + cap + showing-N-of-M + per-row failure tolerance.
- **CROSS-CUTTING ANTI-STORM PINS (mandatory, mirror existing guard tests):** assert ZERO `ctx.issues.list`, ZERO writes (`createComment`/`update`/`create`), ZERO `requestWakeup` across all new read paths (populated AND empty). These are the load-bearing safety tests.
- **Live drill — GATED on Eric's go-ahead, do NOT run unprompted:** create a task from chat → watch the in-thread card walk `in_progress → in_review → done`; reassign → rail follows owner.

## Build packaging

One coherent feature, one validated quick build: Piece 1 (dialog) → Piece 2 (rail) → Piece 3 (cards). Atomic commits per task. Bump version in BOTH `package.json` and `src/manifest.ts` if shipping a labeled build (memory: plugin-version-bump-two-sources). No deploy.
