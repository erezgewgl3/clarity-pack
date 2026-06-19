---
quick_id: 260619-r4v
title: Chat create-task topic-linkage redesign + agent-feedback loop closure
status: complete
date: 2026-06-19
branch: quick/chat-loop-closure-260619
version: 1.8.10
deployed: false
---

# Quick Task 260619-r4v — SUMMARY

Built locally per the locked contract `.planning/SPEC-2026-06-19-chat-create-task-loop-closure.md`. **Local code only — NOT deployed to CM/BEAAA; no live drill run.** On branch `quick/chat-loop-closure-260619` (forked from master), 5 atomic commits.

## Commits
- `d5d5aa0` feat: topic-required create-task dialog + atomic new-topic worker create; cold path removed (Piece 1)
- `0ab1232` feat: company-wide assignee-scoped Active-tasks-owned rail (Piece 2)
- `85c2ef3` feat: chat.topicTaskUpdates per-topic read-time-reflection handler (Piece 3 worker)
- `9feb68c` feat: live in-thread task-update cards / loop closure (Piece 3 UI)
- `46d705d` test: anti-storm guards + dialog/thread contract updates + bundle ceiling + v1.8.10

## What shipped
**Piece 1 — Topic-required dialog + cold-path removal.** `createTrueTask` lost its `isCold`/`cold-task:` branch; added `newTopicTitle` that atomically creates parent (if first-ever) + `CHT-N` + `chat_topics` row + the topic-linked task. Handler returns `TOPIC_REQUIRED` when neither a topic nor a new-topic name is given. Dialog: Standalone deleted, label `TOPIC`, defaults to the open topic, inline `+ New topic` input, Create gated on `topic || new-name`. (Fixes COU-56 — every operator-created task is now topic-linked + visible in chat.)

**Piece 2 — Company-wide rail.** New `listChatTopicTasksForCompany` (M=100). `chat.taskOwned` re-scoped company-wide, grouped by LIVE assignee (reassigned task follows its owner), bounded-parallel enrich, `total/shown/capped/skipped`, NO_UUID_LEAK assignee labels. `tasks` kept flat (index.tsx/message-thread shape unchanged). Rail UI: grouped sections + scope label + showing-N-of-M + labeled skipped line.

**Piece 3 — Live in-thread cards (loop closure).** New `chat.topicTaskUpdates` handler (cap 20): per-task `issues.get` + latest AGENT comment (`polishTldr`; operator text never polished), `isTopicStuck` → blocked + named action, NO_UUID_LEAK. `InlineTaskCard` upgraded with latest-comment line (Working… when none) + amber "Blocked — needs you: <action>"; `message-thread` polls the handler per-topic at 15s and feeds each marker card by issueId.

## Invariant verification (independently re-checked by orchestrator)
- **Anti-storm (load-bearing):** dedicated guard tests for `chat.taskOwned (company-wide)` and `chat.topicTaskUpdates` each assert ZERO `issues.list` / `db.execute` / `requestWakeup` / event-subs across populated AND empty inputs — **pass** (re-run by orchestrator, not just executor-reported).
- Full suite: 2992 tests, 2990 pass, 0 fail (2 skipped). `tsc --noEmit` clean (re-run by orchestrator). UI bundle builds (792,377 B, under bumped 777 kB ceiling, zero SheetJS sentinels). Worker builds clean.
- Version bumped to `1.8.10` in BOTH `package.json` and `src/manifest.ts`.

## Deviations (both Rule 1)
- Three source-grep contract tests updated to the new topic-required + live-card-precedence behavior (not weakened; still pin the real contract).
- UI bundle +8.8 kB legitimate feature surface → raised ceiling 766→777 kB per the established empirical-recalibration precedent; the SheetJS sentinel guard (real bloat protection) unchanged.

## Not done (deliberately, gated on Eric)
- No deploy to CM/BEAAA. No live drill (create-from-chat → card walks in_progress→in_review→done; reassign → rail follows owner). Both await Eric's explicit go-ahead.
