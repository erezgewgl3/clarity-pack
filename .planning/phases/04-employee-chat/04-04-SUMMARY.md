---
phase: 04-employee-chat
plan: 04
subsystem: chat-read-crud-handlers
tags: [chat, worker, data-handler, action-handler, ilike-search, promote, pin, tdd]

# Dependency graph
requires:
  - phase: 04-employee-chat
    provides: "04-02 chat-topics-repo — listChatTopicsForEmployee / allocateChtNumber / insertChatTopic / getEmployeeParentIssueId / insertEmployeeParent / getChatMessageByUuid / updateChatMessagePinned; 0006_chat.sql side tables"
  - phase: 04-employee-chat
    provides: "04-03 chat-send/chat-edit handler template; worker.ts chat register block; opt-in-guard wrapDataHandler/wrapActionHandler"
  - phase: 03-daily-bulletin
    provides: "bulletin-by-cycle.ts data-handler template; bulletin-action-approve.ts action-handler template; department-reconcile.ts agents.list cast pattern"
provides:
  - "src/worker/handlers/chat-roster.ts — chat.roster data handler: employee list, Editor-Agent excluded by id (D-03)"
  - "src/worker/handlers/chat-topics.ts — chat.topics data handler + chat.topic.create action: O(1) parent resolve-or-create, child issue assigned to employee-agent"
  - "src/worker/handlers/chat-messages.ts — chat.messages data handler: server-ordered thread with supersedes/pin metadata"
  - "src/worker/handlers/chat-search.ts — chat.search data handler: ILIKE over public.issue_comments JOIN chat_topics, escapeLike wildcard-safe"
  - "src/worker/handlers/chat-promote.ts — chat.promote action: real linked issue from canonical comment body"
  - "src/worker/handlers/chat-pin.ts — chat.pin action: toggles chat_messages.pinned"
  - "worker.ts wiring — all six handlers registered (opt-in-guarded), 7 handler keys total"
affects: [04-05-ui-surface, 04-06-coexistence-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chat data handlers mirror bulletin-by-cycle.ts: wrapDataHandler, typeof-string param validation, RETURN structured errors"
    - "Chat action handlers mirror bulletin-action-approve.ts / active-viewer-ping.ts: wrapActionHandler, THROW on missing required params via reqStr"
    - "escapeLike(term) backslash-escapes \\, %, _ (backslash first) — the user term reaches the DB only as a $N bound parameter against module-constant SQL"
    - "chat-topics.ts registers BOTH a data key (chat.topics) and an action key (chat.topic.create) in one registration function — one cohesive module"

key-files:
  created:
    - src/worker/handlers/chat-roster.ts
    - src/worker/handlers/chat-topics.ts
    - src/worker/handlers/chat-messages.ts
    - src/worker/handlers/chat-search.ts
    - src/worker/handlers/chat-promote.ts
    - src/worker/handlers/chat-pin.ts
    - test/worker/chat/chat-roster.test.mjs
    - test/worker/chat/chat-topics.test.mjs
    - test/worker/chat/chat-messages.test.mjs
    - test/worker/chat/chat-search.test.mjs
    - test/worker/chat/chat-promote.test.mjs
    - test/worker/chat/chat-pin.test.mjs
  modified:
    - src/worker.ts

key-decisions:
  - "chat-topics.ts implemented as one file covering both the chat.topics data handler and the chat.topic.create action; the plan's Task A/B split is a context-window measure, not a commit-granularity rule, and splitting one file across two commits would leave an uncompilable intermediate state"
  - "Handler tests placed at test/worker/chat/*.test.mjs (the runner globs test/**/*.test.mjs) rather than the src/ .test.ts paths in the plan frontmatter — a src/ .test.ts never runs in CI (confirmed convention from 04-02/04-03)"
  - "chat.roster degrades gracefully on a managed.get failure — it returns the full roster (Editor-Agent simply unfiltered) rather than a 500; a degraded roster beats an outage"

patterns-established:
  - "TDD RED/GREEN per task: test(...) commit before feat(...) commit"
  - "Test-mock SQL matchers must match the real repo query's WHERE clause precisely — two mock bugs this session were fixed by tightening the matcher to the exact predicate"

requirements-completed: [CHAT-01, CHAT-08, CHAT-09]

# Metrics
duration: 10min
completed: 2026-05-18
---

# Phase 4 Plan 04: Chat Read + CRUD Handlers Summary

**The six worker handlers the 04-05 chat UI consumes — chat.roster (employee list, Editor-Agent excluded), chat.topics + chat.topic.create (CHT-NN topic strip + O(1) parent resolve-or-create), chat.messages (server-ordered thread with supersedes/pin metadata), chat.search (wildcard-safe ILIKE over chat comments), chat.promote (real linked issue) and chat.pin — all opt-in-guarded server-side, all tested before any UI exists.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-18T21:53:05Z
- **Completed:** 2026-05-18T22:03:29Z
- **Tasks:** 4 (TDD: 8 task commits)
- **Files modified:** 13 (12 created, 1 modified)

## Accomplishments

- `chat-roster.ts` — `chat.roster` data handler. `ctx.agents.list({companyId})` is the source; the Editor-Agent is excluded by id (D-03), resolved via `ctx.agents.managed.get('editor-agent', companyId)`. A failed managed-resolution degrades to the full roster rather than a 500. Each employee is shaped `{ id, name, role, status }` for the rail.
- `chat-topics.ts` — TWO keys in one module. `chat.topics` (data) lists `chat_topics` rows for a selected employee, company-scoped, most-recently-active first. `chat.topic.create` (action) resolves the per-employee `Chat — <employee>` parent issue O(1) via `getEmployeeParentIssueId` (BLOCKER-3 — no issue-tree scan); on the first-ever topic it creates the parent issue and records it via the race-safe `insertEmployeeParent`, then allocates a CHT-NN and creates the child topic issue **assigned to the employee-agent** (D-02 — assignment is the wake contract) with the D-14 reasoning block + reply-channel instruction in its description.
- `chat-messages.ts` — `chat.messages` data handler. Reads the canonical thread via `ctx.issues.listComments` (CHAT-02), JOINs the `chat_messages` side table by `comment_id` for supersedes/pin metadata, and orders strictly by the **server-side** comment `created_at` (PITFALLS 11.4 — never a client clock). A comment whose `message_uuid` appears as another row's `supersedes_uuid` is marked `superseded: true` so the UI collapses the edit chain (CHAT-05).
- `chat-search.ts` — `chat.search` data handler (CHAT-08). The verbatim RESEARCH query: `ILIKE` over `public.issue_comments` JOINed THROUGH `chat_topics` with `t.company_id = $1` (T-04-14 cross-company isolation, T-04-17 non-chat-comment exclusion), `LIMIT 50`. The exported `escapeLike` helper backslash-escapes `\`, `%`, `_` (backslash first) so a user term containing a wildcard char matches it literally (T-04-13); the term reaches the DB only as the `$2` bound parameter against module-constant SQL.
- `chat-promote.ts` — `chat.promote` action handler (CHAT-09 / D-13). Resolves the source message via the company-scoped `getChatMessageByUuid` (a cross-company uuid simply does not resolve — the ownership re-check, T-04-16), re-fetches the canonical comment body from the topic thread, and creates a real Paperclip issue pre-filled from that body, linked back to the topic issue via `parentId`.
- `chat-pin.ts` — `chat.pin` action handler (CHAT-09 / D-13). Minimal shape; toggles `chat_messages.pinned` via the company-scoped `updateChatMessagePinned`.
- `worker.ts` — all six register calls wired after the 04-03 chat block (chat-topics contributes two handler keys); all non-exempt, all opt-in-guard wrapped.
- Full suite: 856 tests, 854 pass, 0 fail, 2 skipped (pre-existing); typecheck clean; worker bundle builds clean (207.1kb).

## Task Commits

Each task committed atomically (TDD test -> feat):

1. **Task A+B (chat-roster, chat-messages, chat-topics):**
   - `c203c54` test(04-04): add failing tests for chat read handlers (roster, messages, topics)
   - `2eb2dd4` feat(04-04): implement chat read handlers — roster, messages, topics
2. **Task B remainder (chat-search, chat-promote):**
   - `fbc5ae8` test(04-04): add failing tests for chat.search and chat.promote
   - `299acd7` feat(04-04): implement chat.search and chat.promote handlers
3. **Task C (chat-pin):**
   - `1158881` test(04-04): add failing test for chat.pin action handler
   - `fce30cd` feat(04-04): implement chat.pin action handler
4. **Task D (worker.ts wiring):**
   - `ff9ad5a` feat(04-04): wire six chat read/CRUD handlers into worker.ts

## Decisions Made

- **`chat-topics.ts` is one file, one feat commit.** The plan splits its data half (Task A) and action half (Task B) for executor context budgeting, but the handler is a single cohesive module — both keys register in one `registerChatTopics` function. Splitting the file across two commits would leave an uncompilable intermediate state, so the full module landed in the Task A+B GREEN commit. Both test halves (data + action) were authored in one test file and committed in the Task A RED.
- **Test files at `test/worker/chat/*.test.mjs`.** The plan frontmatter lists `src/worker/handlers/*.test.ts` paths; the runner globs only `test/**/*.test.mjs`, so a `.test.ts` under `src/` never runs in CI. Followed the established 04-02/04-03 convention.
- **`chat.roster` degrades on a managed-resolution failure.** If `ctx.agents.managed.get('editor-agent', ...)` throws, the handler returns the full roster (Editor-Agent unfiltered) instead of a 500 — the roster rail still works, the Editor-Agent is simply not hidden. A degraded result beats an outage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test-mock SQL matcher missed the `listChatTopicsForEmployee` query**
- **Found during:** Task A+B (GREEN run — one test failed)
- **Issue:** The `chat-topics.test.mjs` in-memory `db.query` mock branched the `chat_topics` SELECT on `/employee_agent_id = \$2/i && !/issue_id/i` — but the real `listChatTopicsForEmployee` query SELECTs `issue_id` among its columns, so the `!/issue_id/` guard rejected the legitimate list query and the handler saw zero rows.
- **Fix:** Matched the exact WHERE clause instead — `/WHERE company_id = \$1 AND employee_agent_id = \$2/i`.
- **Files modified:** `test/worker/chat/chat-topics.test.mjs`
- **Verification:** all 31 chat-topics tests pass.
- **Committed in:** `2eb2dd4` (folded into the Task A+B GREEN commit — test-code bug)

**2. [Rule 1 - Bug] `chat-promote.test.mjs` mock ignored the `company_id` param**
- **Found during:** Task B remainder (GREEN run — the cross-company test failed)
- **Issue:** The `chat_messages` query mock keyed only on `params[0]` (the message uuid), ignoring `params[1]` (company_id). The real `getChatMessageByUuid` query is `WHERE message_uuid = $1 AND company_id = $2`; the test seeded a `co-1` message and queried as `co-OTHER` expecting no resolution, but the permissive mock returned the row anyway.
- **Fix:** Made the mock honor `company_id` — `row.company_id === params[1]` — matching the real query's scoping. This also hardens the test for the very security property it asserts (T-04-16 cross-company isolation).
- **Files modified:** `test/worker/chat/chat-promote.test.mjs`
- **Verification:** all 9 chat-promote tests pass; the cross-company NOT_FOUND case now exercises the real predicate.
- **Committed in:** `299acd7` (folded into the Task B GREEN commit — test-code bug)

---

**Total deviations:** 2 auto-fixed (2 bugs, Rule 1 — both in test-mock code written this session)
**Impact on plan:** No scope change, no production behavior changed. Both fixes tightened test mocks to match the real repo query predicates — a permissive mock would have masked a real cross-company-isolation regression.

## Authentication Gates

None — no external service auth was required. All six handlers run against the host `ctx` (db / issues / agents) inside the worker process.

## Issues Encountered

None beyond the two test-mock deviations above. The six handlers and the wiring executed as the plan specified.

## User Setup Required

None — no external service configuration. The handlers register inside the worker `setup()` at the next plugin install/upgrade. The 0006_chat.sql migration (Plan 04-02) still applies at the Phase 4 install drill, bookended by a verified snapshot per the bookended-by-snapshots rule.

## Verification

- `node --test` on all six new chat handler test files — 59 tests, all pass.
- Full suite — 856 tests, 854 pass, 0 fail, 2 skipped (pre-existing).
- `tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 207.1kb).
- `grep ILIKE src/worker/handlers/chat-search.ts` — 4 hits; `grep escapeLike` — 3 hits (the security helper is applied).
- `grep assigneeAgentId src/worker/handlers/chat-topics.ts` — 1 hit (D-02 wake contract).
- `grep getEmployeeParentIssueId src/worker/handlers/chat-topics.ts` — 3 hits (BLOCKER-3 O(1) parent discovery, no issue-tree scan).
- `worker.ts` registers all six chat handlers (`registerChatRoster/Topics/Messages/Search/Promote/Pin` — grep count 6).

## Next Phase Readiness

- 04-05 (UI surface) is now pure UI — every chat region has its data/action handler: `chat.roster` feeds the roster rail, `chat.topics`/`chat.topic.create` the topic strip, `chat.messages` the thread, `chat.search` the global search box, `chat.promote`/`chat.pin` the message context actions. The UI consumes them via `usePluginData`/`usePluginAction` and subscribes `usePluginStream('chat:<companyId>')` (04-03 bridge) for realtime.
- All seven chat handler keys are opt-in-guarded — the UI must thread `companyId` + `userId` per the 02-03c resolver convention.
- The chat handlers have not yet run against the live Countermoves box — that happens at the Phase 4 install/upgrade drill, bookended by a verified snapshot.
- No blockers.

## Self-Check: PASSED

- FOUND: `src/worker/handlers/chat-roster.ts`
- FOUND: `src/worker/handlers/chat-topics.ts`
- FOUND: `src/worker/handlers/chat-messages.ts`
- FOUND: `src/worker/handlers/chat-search.ts`
- FOUND: `src/worker/handlers/chat-promote.ts`
- FOUND: `src/worker/handlers/chat-pin.ts`
- FOUND: `test/worker/chat/chat-roster.test.mjs`, `chat-topics.test.mjs`, `chat-messages.test.mjs`, `chat-search.test.mjs`, `chat-promote.test.mjs`, `chat-pin.test.mjs`
- FOUND: commit `c203c54`, `2eb2dd4`, `fbc5ae8`, `299acd7`, `1158881`, `fce30cd`, `ff9ad5a`

---
*Phase: 04-employee-chat*
*Completed: 2026-05-18*
