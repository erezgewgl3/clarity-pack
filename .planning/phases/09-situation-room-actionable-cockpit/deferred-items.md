# Phase 09 — Deferred Items (out-of-scope discoveries)

Logged per the executor SCOPE BOUNDARY rule: discoveries NOT directly caused by
the current task's changes are recorded here, not fixed.

## 09-04 (R3 leaf-UUID gap-closure)

### D1 — `U7 WATCHDOG-FIRE-AND-FORGET` is a wall-clock timing flake (pre-existing)

- **File:** `test/worker/chat/chat-messages.test.mjs` (test at line ~451).
- **Symptom:** Asserts `chat.messages must not await the watchdog get
  (elapsed < 85ms)`. Under full-suite parallel CPU load on Windows the
  fire-and-forget path measured ~94ms and the assert tripped. In ISOLATION the
  file is 41/41 green (the watchdog returns well under threshold), so the
  behavior under test is correct — only the fixed 85ms wall-clock budget is
  fragile when the box is busy.
- **Why deferred:** Unrelated to 09-04 (chat tier, not the Situation Room
  assign-owner path); 09-04 touched zero chat files. It is a pre-existing
  timing-assertion fragility, not a regression — `git diff 6f2c2e0..HEAD` shows
  no change to `chat-messages.test.mjs` or any chat worker source.
- **Suggested fix (future):** widen the threshold or replace the wall-clock
  budget with `mock.timers` so the assertion is deterministic. Do NOT address
  inside 09-04.
- **09-04 full-suite tally with this flake present:** 2323 tests, 2320 pass,
  1 fail (this flake), 2 skipped. All other gates (tsc, css-scope, bundle-size,
  worker/ui/manifest builds) green; the 10 leafIssueUuid test files are green.
