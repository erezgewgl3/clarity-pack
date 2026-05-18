---
phase: 04-employee-chat
plan: 03
subsystem: realtime-persistence
tags: [chat, worker, action-handler, idempotency, supersedes, stream-bridge, tdd, sse]

# Dependency graph
requires:
  - phase: 04-employee-chat
    provides: "04-02 chat-topics-repo — insertChatMessage / getChatMessageByUuid / getChatTopicByIssueId; 0006_chat.sql side tables"
  - phase: 04-employee-chat
    provides: "04-01 spike GO verdict — OQ-2 opaque comment payload, OQ-3 STATUS-FLIP-NOT-NEEDED, D-01 native agent wake proven live"
  - phase: 03-daily-bulletin
    provides: "bulletin-action-approve.ts action-handler template; opt-in-guard wrapActionHandler; worker.ts register/event-subscription idioms"
provides:
  - "src/worker/handlers/chat-send.ts — chat.send action: message_uuid dedup -> createComment -> chat_messages id-map insert -> auto-reopen"
  - "src/worker/handlers/chat-edit.ts — chat.edit action: append-with-supersedes, server-side ownership re-check"
  - "src/worker/streams/chat-stream-bridge.ts — issue.comment.created -> ctx.streams.emit('chat:<companyId>') re-emit bridge"
  - "worker.ts wiring — chat.send + chat.edit registered (opt-in-guarded), chat-stream-bridge subscribed"
affects: [04-04-read-crud-handlers, 04-05-ui-surface, 04-06-coexistence-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chat action handlers mirror bulletin-action-approve.ts exactly: wrapActionHandler(ctx, key, fn), THROW on missing required params, return { ok } | { error } envelopes"
    - "Stream bridge is a worker event subscription (ctx.events.on) re-emitting on a plugin SSE channel — the realtime spine for usePluginStream (D-08)"
    - "OQ-2 opaque-payload pattern: an event that names entityId but not the new row id is resolved by a host re-fetch (listComments) that selects the newest row"

key-files:
  created:
    - src/worker/handlers/chat-send.ts
    - src/worker/handlers/chat-edit.ts
    - src/worker/streams/chat-stream-bridge.ts
    - test/worker/chat/chat-send.test.mjs
    - test/worker/chat/chat-edit.test.mjs
    - test/worker/chat/chat-stream-bridge.test.mjs
  modified:
    - src/worker.ts

key-decisions:
  - "chat.send auto-reopen flips a done topic to in_progress for UX/status only — requestWakeup is NOT called (04-01 OQ-3 STATUS-FLIP-NOT-NEEDED; a posted comment alone wakes the agent)"
  - "chat.send missing-userId does NOT throw — the opt-in-guard wrapper consumes userId first and short-circuits with OPT_IN_REQUIRED; the test asserts the real behavior, not the plan's literal throw"
  - "auto-reopen is best-effort: a failed issues.get/update is caught and logged — the comment already landed and wakes the agent, so a status-flip failure must not fail the send"
  - "stream bridge emits via listComments re-fetch (04-01 OQ-2 — the event payload is opaque); a failed re-fetch returns without emitting (the UI poll-fallback covers the gap)"
  - "no new manifest capabilities — createComment/listComments/issues.update/events.on/streams.emit are all covered by the capability set Phase 2/3 declared and proved live"

patterns-established:
  - "src/worker/streams/ is the home for worker-side realtime bridges"
  - "TDD RED/GREEN per task: test(...) commit before feat(...) commit, three task pairs"

requirements-completed: [CHAT-02, CHAT-04, CHAT-05, CHAT-06]

# Metrics
duration: 7min
completed: 2026-05-18
---

# Phase 4 Plan 03: Chat Realtime + Persistence Spine Summary

**The chat send/edit/realtime contract — `chat.send` (message_uuid dedup -> `createComment` canonical write -> `chat_messages` id-map insert -> auto-reopen), `chat.edit` (append-with-supersedes), and the worker stream bridge re-emitting `issue.comment.created` onto a per-company `chat:<companyId>` SSE channel — all tested before any UI consumes them.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-18T21:40:40Z
- **Completed:** 2026-05-18T21:47:28Z
- **Tasks:** 4 (TDD: 6 task commits + 1 wiring commit)
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- `chat-send.ts` — the canonical-write path. A fresh `message_uuid` calls `ctx.issues.createComment` (writes the body to `public.issue_comments`, CHAT-02) then `insertChatMessage` (records only the `message_uuid -> comment_id` map). A resend with a stored `message_uuid` returns the original `commentId` without re-posting (CHAT-06 / D-10). A `done` topic is flipped to `in_progress` (D-06); a host `createComment` failure returns `{ error: 'SEND_FAILED' }` with no orphan side-table row.
- `chat-edit.ts` — append-with-supersedes (D-11 / CHAT-05). An edit writes a NEW comment and inserts a `chat_messages` row whose `supersedes_uuid` points at the prior message; the original comment is never mutated. A server-side ownership re-check rejects edits of agent messages or unknown uuids with `{ error: 'NOT_OWNED' }` (T-04-09).
- `chat-stream-bridge.ts` — the D-08 realtime spine. Subscribes `issue.comment.created`, and for chat-topic issues only (`getChatTopicByIssueId`, T-04-11) re-emits `{ type:'comment.created', issueId, commentId, occurredAt }` on `chat:<companyId>`. Null `entityId`/`companyId` are guarded; the whole body is try/catch wrapped so a throwing handler never crashes the worker (T-04-12).
- `worker.ts` — three register calls wired: `chat.send` + `chat.edit` after the exempt-key handlers (opt-in-guarded), the stream bridge near the existing `ctx.events.on` block.
- Full suite: 798 tests, 796 pass, 0 fail, 2 skipped (pre-existing); typecheck clean; worker bundle builds clean (192.1kb).

## Task Commits

Each task committed atomically (TDD test -> feat):

1. **Task A: chat-send.ts**
   - `d6d143d` test(04-03): add failing test for chat.send action handler
   - `22efe6e` feat(04-03): implement chat.send action handler
2. **Task B: chat-edit.ts**
   - `e1809a6` test(04-03): add failing test for chat.edit action handler
   - `a1e9c2b` feat(04-03): implement chat.edit action handler
3. **Task C: chat-stream-bridge.ts**
   - `63fa49b` test(04-03): add failing test for chat stream bridge
   - `5e8bc41` feat(04-03): implement chat stream bridge
4. **Task D: worker.ts wiring**
   - `dede91a` feat(04-03): wire chat.send, chat.edit, and stream bridge into worker.ts

## Decisions Made

- **`chat.send` missing-userId returns `OPT_IN_REQUIRED`, not a throw.** The plan said "missing topicIssueId / body / companyId / userId throws." But `userId` is consumed by the `opt-in-guard` wrapper FIRST — `extractUserId` treats a missing/empty userId as opted-out and short-circuits with `{ error: 'OPT_IN_REQUIRED' }` before the inner handler ever runs. The other four params do reach the inner handler and throw. The test asserts the real layered behavior (4 throw cases + 1 OPT_IN_REQUIRED case), not the plan's literal wording.
- **Auto-reopen is best-effort.** The D-06 status flip is wrapped in its own try/catch. The comment has already landed at that point and natively wakes the agent (04-01 D-01); a failed `issues.get` or `issues.update` must not fail an otherwise-successful send. OQ-3 (`STATUS-FLIP-NOT-NEEDED`) confirms `requestWakeup` is not called — the flip is purely for UX/status correctness.
- **Stream bridge does not emit on a failed re-fetch.** Per 04-01 OQ-2 the `issue.comment.created` payload is opaque, so the bridge re-fetches via `listComments`. If that re-fetch throws, the bridge returns without emitting — the UI's `usePoll` fallback (D-08) covers the gap rather than emitting a useless null-commentId event.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `IssueComment.createdAt` is a `Date`, not a `string`**
- **Found during:** Task C (typecheck after the GREEN commit)
- **Issue:** The bridge's `newestCommentId` helper compared `createdAt` as strings; the SDK's `IssueComment` type declares `createdAt: Date`, so `tsc` rejected the `as { createdAt?: string }` cast (TS2352 — non-overlapping types).
- **Fix:** Added a `createdAtMs` helper that coerces `Date | string | undefined` to epoch ms via `new Date(raw).getTime()` (NaN-guarded), and compared numbers.
- **Files modified:** `src/worker/streams/chat-stream-bridge.ts`
- **Verification:** `tsc --noEmit` clean; all 7 bridge tests still pass.
- **Committed in:** `dede91a` (folded into the Task D wiring commit — the fix was discovered while wiring)

---

**Total deviations:** 1 auto-fixed (1 blocking type issue, Rule 3)
**Impact on plan:** No scope change; the fix only made the newest-comment selection type-correct against the real SDK shape. No production behavior changed.

## Issues Encountered

None beyond the deviation above. The three handlers and the wiring executed as the plan specified.

## User Setup Required

None — no external service configuration. The handlers register inside the worker `setup()` at the next plugin install/upgrade. The 0006_chat.sql migration (Plan 04-02) still applies at the Phase 4 install drill bookended by a verified snapshot.

## Verification

- `node --test` on all three chat test files — 31 tests, 31 pass, 0 fail.
- `tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 192.1kb).
- Full suite — 798 tests, 796 pass, 0 fail, 2 skipped (pre-existing).
- `grep createComment src/worker/handlers/chat-send.ts` — 4 hits (canonical-write path present).
- `grep streams.emit src/worker/streams/chat-stream-bridge.ts` — 2 hits (bridge present).
- `grep listComments src/worker/streams/chat-stream-bridge.ts` — 3 hits (OQ-2 opaque-payload re-fetch wired).
- `worker.ts` registers `chat.send`, `chat.edit`, and `registerChatStreamBridge`.

## Next Phase Readiness

- 04-04 (read + CRUD handlers) can build the thread-read handler and topic-create flow on top of `chat.send`'s established send contract; `chat_messages.supersedes_uuid` gives it the edit chain to fold when rendering a thread.
- 04-05 (UI surface) consumes `chat.send` / `chat.edit` via `usePluginAction` and subscribes `usePluginStream('chat:<companyId>')` for realtime — the bridge channel name is fixed.
- No blockers.

## Self-Check: PASSED

- FOUND: `src/worker/handlers/chat-send.ts`
- FOUND: `src/worker/handlers/chat-edit.ts`
- FOUND: `src/worker/streams/chat-stream-bridge.ts`
- FOUND: `test/worker/chat/chat-send.test.mjs`
- FOUND: `test/worker/chat/chat-edit.test.mjs`
- FOUND: `test/worker/chat/chat-stream-bridge.test.mjs`
- FOUND: commit `d6d143d`, `22efe6e`, `e1809a6`, `a1e9c2b`, `63fa49b`, `5e8bc41`, `dede91a`

---
*Phase: 04-employee-chat*
*Completed: 2026-05-18*
