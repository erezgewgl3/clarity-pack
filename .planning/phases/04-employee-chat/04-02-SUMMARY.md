---
phase: 04-employee-chat
plan: 02
subsystem: database
tags: [postgres, migration, plugin-namespace, repo, chat, idempotency, tdd]

# Dependency graph
requires:
  - phase: 04-employee-chat
    provides: "04-01 spike GO verdict — native issue_commented agent wake proven; D-09 chat_messages side table mandated"
  - phase: 03-daily-bulletin
    provides: "bulletins-repo.ts CRUD template; 0004_bulletin.sql validator-hazard header; host query/execute contract"
provides:
  - "migrations/0006_chat.sql — chat_topics + chat_messages + chat_employee_parents plugin-namespace tables, additive-only"
  - "src/worker/db/chat-topics-repo.ts — typed CRUD, CHT-NN allocator, message_uuid dedup lookup, parent-issue resolution"
  - "manifest version 0.7.0 — Phase 4 opened"
  - "corrected COEXIST-05 coexistence check: chat_messages side table allowed, body column forbidden (CHAT-02)"
affects: [04-03-realtime-persistence, 04-04-read-crud-handlers, 04-05-ui-surface, 04-06-coexistence-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chat data layer mirrors the Phase 3 bulletins-repo shape exactly: fully-qualified plugin-namespace SQL, query/execute host contract, ON CONFLICT DO NOTHING + read-back idiom"
    - "chat_messages side table maps IDs only (message_uuid -> comment_id), never message body — CHAT-02 invariant enforced by schema test + coexistence check"
    - "Composite-PK + ON CONFLICT DO NOTHING parent-issue map gives race-safe O(1) first-ever-topic resolution"

key-files:
  created:
    - migrations/0006_chat.sql
    - src/worker/db/chat-topics-repo.ts
    - test/migrations/0006-chat-schema.test.mjs
    - test/worker/chat-topics-repo.test.mjs
    - test/manifest/chat-capabilities.test.mjs
  modified:
    - src/manifest.ts
    - scripts/coexistence-checks/05-chat-comment-coexistence-stub.mjs
    - test/ci/coexistence-checklist.test.mjs

key-decisions:
  - "chat-topics-repo test placed at test/worker/chat-topics-repo.test.mjs (the runner globs test/**/*.test.mjs) rather than the src/ .test.ts path in plan frontmatter — a src/ .test.ts would never run in CI"
  - "No new manifest capability strings: the chat worker handlers' host calls (createComment, issues.update, events.on, agents) are all covered by capabilities Phase 2/3 declared and proved live on Countermoves; adding an unverified issues.update string would risk the host install validator"
  - "COEXIST-05 check rewritten: the Phase 2 stub forbade any chat_messages table; D-09 made the side table mandatory, so the real CHAT-02 invariant is now no body column"

patterns-established:
  - "TDD RED/GREEN/REFACTOR per task with test(...) before feat(...) commits"
  - "Migration schema tests live in test/migrations/; the ddl-prefix-validator auto-scans every migrations/*.sql so a new migration is validated for free"

requirements-completed: [CHAT-03]

# Metrics
duration: 12min
completed: 2026-05-18
---

# Phase 4 Plan 02: Employee Chat Data Layer Summary

**The additive 0006_chat.sql migration (chat_topics + chat_messages + chat_employee_parents in the plugin namespace) and the typed chat-topics-repo with the CHT-NN allocator and message_uuid dedup lookup — the foundation every 04-03 chat handler reads from.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-18T21:24:02Z
- **Completed:** 2026-05-18T21:35:41Z
- **Tasks:** 3 (TDD: 7 task commits)
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `0006_chat.sql` — three plugin-namespace tables, additive-only, validator-clean (fully-qualified, no CREATE INDEX, no DO $$, apostrophe-free, ;-terminated). `chat_messages` has NO body column — the CHAT-02 invariant holds at the schema level.
- `chat-topics-repo.ts` — typed CRUD for all three tables: `insertChatTopic`, `getChatTopicByIssueId`, `listChatTopicsForEmployee`, `allocateChtNumber` (CHT-NN per-company allocator), `insertChatMessage` (ON CONFLICT message_uuid dedup), `getChatMessageByUuid` (dedup-on-send lookup), `updateChatMessagePinned`, `getEmployeeParentIssueId`, `insertEmployeeParent` (race-safe parent resolution).
- Manifest bumped to 0.7.0, opening Phase 4, with the chat-capability rationale documented inline.
- The stale Phase 2 COEXIST-05 stub corrected to enforce the real CHAT-02 invariant.
- Full suite: 767 tests, 765 pass, 0 fail, 2 skipped (pre-existing); typecheck clean.

## Task Commits

Each task committed atomically (TDD test -> feat):

1. **Task A: 0006_chat.sql migration**
   - `5549206` test(04-02): failing DDL-contract test for 0006_chat.sql
   - `147e5ed` feat(04-02): add 0006_chat.sql chat data-layer migration
2. **Task B: chat-topics-repo.ts**
   - `7d66858` test(04-02): failing CRUD test for chat-topics-repo
   - `d4cafcb` feat(04-02): add chat-topics-repo typed CRUD + CHT-NN allocator
3. **Task C: manifest 0.7.0**
   - `d9e8b05` test(04-02): failing manifest version + chat-capability test
   - `319e965` feat(04-02): bump manifest to 0.7.0 for Phase 4 Employee Chat

**Deviation fix:** `6b251fa` fix(04-02): correct COEXIST-05 check for the D-09 chat_messages side table

## Files Created/Modified

- `migrations/0006_chat.sql` - chat_topics (CHT-NN metadata), chat_messages (D-09 id-map side table), chat_employee_parents (D-05 parent-issue map)
- `src/worker/db/chat-topics-repo.ts` - typed CRUD + CHT-NN allocator + dedup lookup + parent-issue resolution
- `test/migrations/0006-chat-schema.test.mjs` - DDL-contract regression test (column set, CHAT-02 no-body, validator hazards)
- `test/worker/chat-topics-repo.test.mjs` - repo CRUD test against the host-faithful db wrapper
- `test/manifest/chat-capabilities.test.mjs` - manifest version + chat-capability pin
- `src/manifest.ts` - version 0.6.6 -> 0.7.0; Phase 4 changelog + capability rationale
- `scripts/coexistence-checks/05-chat-comment-coexistence-stub.mjs` - COEXIST-05 rewritten for the D-09 side table
- `test/ci/coexistence-checklist.test.mjs` - updated COEXIST-05 fixtures

## Decisions Made

- **Repo test location:** the plan frontmatter listed `src/worker/db/chat-topics-repo.test.ts`, but the test runner globs only `test/**/*.test.mjs`. A `.test.ts` under `src/` would never execute in CI. Placed at `test/worker/chat-topics-repo.test.mjs` to match the established convention (tldr-cache, bulletins tests).
- **No new manifest capabilities:** the plan said "verify issues.update is in the list; if missing add it." `issues.update` is not a declared string, yet Phase 3's `bulletin-action-approve` calls `ctx.issues.update` and installed live on Countermoves with the current set — so the existing capabilities already permit it. Adding an unrecognized capability string risks the host install validator. Not added; documented inline in the manifest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the stale COEXIST-05 coexistence check**
- **Found during:** Task A (after the migration landed, the full-suite run flagged it)
- **Issue:** The Phase 2 `05-chat-comment-coexistence-stub.mjs` rejected ANY migration creating a `chat_messages` table. Phase 4 RESEARCH D-09 resolved decisively that a plugin-namespace `chat_messages` side table is MANDATORY (the comment-create API has no metadata field). The stub's own header said "Phase 4 replaces this with a real integration check." Two test failures (`run-all.mjs` clean-tree + the COEXIST-05 fixture test) resulted from the now-obsolete rule.
- **Fix:** Rewrote the check to enforce the actual CHAT-02 invariant — `chat_messages` may exist but must NOT declare a `body` column (message content stays in `public.issue_comments`). Updated the coexistence-checklist test: a `body` column is rejected, an ID-mapping side table without `body` passes.
- **Files modified:** `scripts/coexistence-checks/05-chat-comment-coexistence-stub.mjs`, `test/ci/coexistence-checklist.test.mjs`
- **Verification:** stub exits 0 against real `migrations/`; coexistence suite 31/31 pass; full suite 765 pass / 0 fail.
- **Committed in:** `6b251fa`

**2. [Rule 1 - Bug] Fixed an apostrophe-scan bug in the RED migration test**
- **Found during:** Task A (GREEN run)
- **Issue:** My `0006-chat-schema.test.mjs` apostrophe check used a naive `indexOf('--')` that matched the `--` substring INSIDE a `COMMENT ON` SQL string literal, falsely flagging a clean migration.
- **Fix:** Made the scan quote-aware — a `--` only starts a real line comment when not inside a `'...'` literal.
- **Files modified:** `test/migrations/0006-chat-schema.test.mjs`
- **Verification:** 0006 migration tests 17/17 pass; the authoritative apostrophe gate (`ddl-prefix-validator.test.mjs`, host-tokenizer port) also passes.
- **Committed in:** `147e5ed` (folded into the Task A GREEN commit — test-code bug)

---

**Total deviations:** 2 auto-fixed (2 bugs, Rule 1)
**Impact on plan:** Both fixes were necessary for correctness — one corrected an obsolete CI gate that contradicted the design this plan implements, the other fixed a bug in test code written this session. No scope creep; no production behavior changed beyond what the plan specified.

## Issues Encountered

None beyond the deviations above. The migration, repo, and manifest tasks executed as the plan specified.

## User Setup Required

None - no external service configuration required. The migration applies inside the host Drizzle pipeline at the next plugin install/upgrade; no manual DB action is needed.

## Next Phase Readiness

- 04-03 (realtime persistence) has its typed data layer: the chat-send handler can `insertChatMessage` (dedup-on-send), the stream bridge can `getChatTopicByIssueId` for the `isChatTopicIssue` filter, and the topic-create flow can `getEmployeeParentIssueId` / `insertEmployeeParent` for O(1) race-safe parent resolution.
- The migration has not yet been applied against the live Countermoves box — that happens at the Phase 4 install/upgrade drill, bookended by a verified snapshot per the bookended-by-snapshots rule.
- No blockers.

## Self-Check: PASSED

- FOUND: `migrations/0006_chat.sql`
- FOUND: `src/worker/db/chat-topics-repo.ts`
- FOUND: `test/migrations/0006-chat-schema.test.mjs`
- FOUND: `test/worker/chat-topics-repo.test.mjs`
- FOUND: `test/manifest/chat-capabilities.test.mjs`
- FOUND: commit `5549206`, `147e5ed`, `7d66858`, `d4cafcb`, `d9e8b05`, `319e965`, `6b251fa`

---
*Phase: 04-employee-chat*
*Completed: 2026-05-18*
