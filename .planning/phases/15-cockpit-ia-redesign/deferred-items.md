# Phase 15 — Deferred / Out-of-Scope Items

## Pre-existing test failure (NOT caused by 15-03)

**File:** `test/ui/surfaces/situation-room/employee-row-actions.test.mjs`
**Test:** `09-04/14-03 — the backlog OwnerPickerPopover (assign) mount still sends the UUID via the fallback`

**Status:** PRE-EXISTING failure, confirmed by stashing the 15-03 `employee-row.tsx` change and re-running (still 1 fail). The assertion reads `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx` and expects the OwnerPickerPopover assign mount to pass `leafIssueId={row.issueId}` with NO `leafIssueUuid` prop. The actual expander code (untouched by Phase 15) passes `leafIssueId={row.identifier}` and `leafIssueUuid={row.leafIssueUuid ?? row.issueId}` — a stale test from a prior phase's WR-02 rework.

**Why out of scope:** Plan 15-03 modifies tier-strip.tsx, index.tsx, employee-row.tsx, theme.css, and two test files. It does NOT touch `blocked-backlog-expander.tsx`. Fixing this stale assertion belongs to the surface that owns the expander, not the IA-redesign capstone.

This is in addition to the 7 known pre-existing CHAT/CTT traceability failures noted in the 15-03 execution brief.
