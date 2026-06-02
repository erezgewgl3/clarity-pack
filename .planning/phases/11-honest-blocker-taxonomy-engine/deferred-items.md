# Phase 11 — Deferred / Out-of-Scope Items

Discoveries surfaced during execution that are NOT directly caused by this phase's
changes. Logged per the executor scope boundary; NOT fixed here.

## Pre-existing test failures (unrelated to Phase 11 / TAX requirements)

Surfaced by the Plan 11-04 full-suite green gate. None of these touch the blocker
taxonomy engine, the verdict, or any file Phase 11 modified — they read
`.planning/REQUIREMENTS.md`, which contains no CHAT-01..CHAT-11 or CTT-01..CTT-08
traceability rows in its current form (last touched by Plan 11-01, not 11-04).

- `test/phases/04-traceability.test.mjs`
  - "REQUIREMENTS.md has a traceability row for every CHAT-01..CHAT-11" — FAIL (no CHAT rows)
  - "every CHAT-01..CHAT-11 row is marked Implemented" — FAIL
  - "every CHAT-01..CHAT-11 row carries a Phase 4 plan reference" — FAIL
- `test/phases/04.1-traceability.test.mjs`
  - "REQUIREMENTS.md has a traceability row for every CTT-01..CTT-08" — FAIL (no CTT rows)
  - "every CTT-01..CTT-08 row is marked Implemented" — FAIL
  - "every CTT-01..CTT-08 row carries a Phase 4.1 plan reference" — FAIL
  - "every CTT-01..CTT-08 row is on Phase 4.1" — FAIL

**Root cause:** REQUIREMENTS.md does not carry the Phase 4 / 4.1 chat + CTT
traceability rows these tests expect. This is a REQUIREMENTS.md bookkeeping gap,
not a code defect. Fix belongs in a REQUIREMENTS.md backfill / a Phase 4 closure
task, not in the blocker-taxonomy phase.

## Flaky timing test (passes deterministically in isolation)

- `test/worker/chat/chat-messages.test.mjs` —
  "U7 WATCHDOG-FIRE-AND-FORGET: a slow watchdog does NOT delay the chat.messages response"
  - Intermittently fails under full-suite parallel load; passes 2/2 in isolation
    (`node --test test/worker/chat/chat-messages.test.mjs`). Timing-sensitive,
    unrelated to Phase 11. Candidate for a fake-timer rewrite.
