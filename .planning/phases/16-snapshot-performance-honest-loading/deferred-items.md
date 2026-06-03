# Phase 16 — Deferred Items (out-of-scope discoveries)

Logged per the executor SCOPE BOUNDARY rule: pre-existing failures in files NOT
touched by this plan. NOT fixed here (out of scope for 16-02).

## Pre-existing test failures observed during 16-02 (full-suite run)

Baseline (16-02 changes stashed) shows **15** full-suite failures; the 16-02
working tree shows **8** (a strict subset — 16-02 introduces NO new failures and
in fact the count is lower run-to-run due to timing flakiness). None touch the
situation-room / snapshot / prefetch path.

| Failing test | File area | Nature | Disposition |
|--------------|-----------|--------|-------------|
| REQUIREMENTS.md traceability rows for CHAT-01..CHAT-11 (3 tests) | REQUIREMENTS.md doc-traceability | doc-sync, not code | Defer — REQUIREMENTS.md upkeep, unrelated to Phase 16 |
| REQUIREMENTS.md traceability rows for CTT-01..CTT-08 (4 tests) | REQUIREMENTS.md doc-traceability | doc-sync, not code | Defer — same |
| U7 WATCHDOG-FIRE-AND-FORGET: slow watchdog does not delay chat.messages response | chat-messages watchdog | timing-sensitive flake (real-clock assertion) | Defer — flaky timing test, passes in isolation; not a 16-02 regression |

These are not caused by Phase 16 Wave A (SQL-prefetch / shared edge graph). The
chat REQUIREMENTS rows and the watchdog timing test live in surfaces 16-02 does
not modify.
