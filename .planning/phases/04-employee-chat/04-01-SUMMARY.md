---
phase: 04-employee-chat
plan: 01
subsystem: spike
tags: [spike, falsify-first, agent-wake, issue-comments, attachments, gate-verdict]

# Dependency graph
requires:
  - phase: 02-scaffold-and-surfaces
    provides: "installed clarity-pack plugin on live Countermoves; safety CLI snapshot/gate; paperclip-api REST client pattern"
  - phase: 03-daily-bulletin
    provides: "Editor-Agent under standard governance; proven snapshot/restore path on the live box"
provides:
  - "04-01-SPIKE-FINDINGS.md -- empirical verdicts for D-01/OQ-4, OQ-2, OQ-3, OQ-1 from live Countermoves"
  - "Phase 4 Gate Verdict: GO -- Plans 04-02..04-06 cleared to proceed"
  - "scripts/spike/chat-spike-probe.mjs -- throwaway probe harness (Task 1; not bundled, not under src/)"
  - "verified REST route fact: per-issue sub-routes are flat (/api/issues/{id}/...), collections are company-scoped"
  - "design inputs: reply-channel instruction needed in topic descriptions; requestWakeup NOT needed for reply; stream bridge derives comment via listComments re-fetch; CHAT-07 ships degraded"
affects: [04-02-data-layer, 04-03-realtime-persistence, 04-04-read-crud-handlers, 04-05-ui-surface, 04-06-coexistence-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Falsify-first spike: probe the live host before building, per Plan 02-01 discipline"
    - "Throwaway probe lives in scripts/spike/ -- never under src/, never bundled"
    - "Findings doc with one-word verdict per question, gating downstream plans"

key-files:
  created:
    - .planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md
    - test/phases/04-01-spike-findings.test.mjs
    - scripts/spike/chat-spike-probe.mjs
  modified: []

key-decisions:
  - "Phase 4 Gate Verdict = GO -- D-01 native issue_commented agent wake PROVEN live on Countermoves"
  - "04-03 must fold a reply-channel instruction (reply by posting a comment, not a document) into every new topic issue description"
  - "04-03 auto-reopen flips done to in_progress for UX/status only -- requestWakeup is NOT needed; a comment alone wakes the agent"
  - "04-03 stream bridge derives the comment from event.entityId + a listComments re-fetch (the comment row carries issueId + body)"
  - "CHAT-07 ships as the steady-state degraded path -- no plugin-accessible upload route exists; attach button permanently disabled"
  - "GET /api/issues/{id}/attachments returns 200 -- a read-side lead 04-04 should inspect"

patterns-established:
  - "Falsify-first live spike gates a UI-heavy phase before any feature code"
  - "test/phases/ holds gate-verdict regression tests pinning a findings doc's contract"

requirements-completed: [CHAT-07]

# Metrics
duration: 3 tasks across multiple sessions (Task 1 build, Task 2 live probe drill, Task 3 desk work)
completed: 2026-05-18
---

# Phase 4 Plan 01: Falsify-First Spike Summary

The Phase 4 falsify-first spike proved on live Countermoves that an employee-agent natively
wakes on a posted comment and replies as an `issue_comments` row -- the load-bearing assumption
the entire Employee Chat phase rests on. Phase 4 Gate Verdict: **GO**.

## What Was Done

This plan built ZERO chat code. It is a probe plus a findings document.

- **Task 1 (committed b91d887, route fix d36c81c)** -- built `scripts/spike/chat-spike-probe.mjs`,
  a throwaway Node ESM probe that, against the live host, creates a parent + child topic issue
  assigned to an employee-agent, posts comments, and probes all four open questions
  (D-01/OQ-4, OQ-2, OQ-3, OQ-1). Each probe step is wrapped so one failure does not abort the
  others. The probe is not under `src/` and is never bundled.
- **Task 2 (committed 9555aac, 5f49c38)** -- Eric ran the probe on live Countermoves, bookended
  by verified snapshot `2026-05-18T20-15-56Z`. The route-fixed run (probe-output.txt run 2)
  produced a clean PASS/GO result.
- **Task 3 (committed 6c0d6ef)** -- wrote `04-01-SPIKE-FINDINGS.md` with a structured verdict
  per question, added `test/phases/04-01-spike-findings.test.mjs` (5 tests, all pass) pinning
  the findings doc's required headers and gate verdict, and produced this summary.

## Spike Results

| Question | Verdict | Finding |
|----------|---------|---------|
| D-01 / OQ-4 -- native agent wake + reply form | **PASS** | CEO employee-agent woke on a posted comment and replied `"2 + 2 = **4**."` as an `issue_comments` row (`authorType: "agent"`, `authorAgentId` set, 0 documents filed). |
| OQ-2 -- comment row / event payload shape | **Recorded** | Comment row keys: `id, companyId, issueId, authorAgentId, authorUserId, authorType, createdByRunId, body, presentation, metadata, createdAt, updatedAt`. Row carries `issueId` + full `body`. |
| OQ-3 -- auto-reopen re-wake | **STATUS-FLIP-NOT-NEEDED** | A comment posted on a `done` topic alone re-woke the agent -- no status flip, no `requestWakeup` required. |
| OQ-1 -- attachment upload path | **NO-PATH** | No plugin-accessible upload/write route. `POST /issues/{id}/documents` and `POST /companies/{id}/assets` both 404. `GET /api/issues/{id}/attachments` returns 200 -- a read-side lead for 04-04. |

**Phase 4 Gate Verdict: GO** -- Plans 04-02..04-06 are cleared.

## Design Inputs for Downstream Plans

- **04-03** must fold an explicit "reply by posting a comment on this issue (not a document)"
  instruction into every new topic issue's description (alongside D-14's reasoning-block).
- **04-03** auto-reopen path flips a `done` topic to `in_progress` for UX/status correctness
  only -- it does NOT need `ctx.issues.requestWakeup`; a comment alone wakes the agent.
- **04-03** stream bridge derives the comment from `event.entityId` + a `listComments` re-fetch.
- **04-04** builds the disabled-attach UI (CHAT-07 degraded steady state) and should inspect the
  `GET /api/issues/{id}/attachments` 200 route as a possible read-only display affordance.
- **REST route fact**: per-issue sub-routes are FLAT (`/api/issues/{id}/...`); collection routes
  are company-scoped (`/api/companies/{id}/issues|agents`). Honour this split in any plan that
  touches the REST surface directly.

## Deviations from Plan

None for Task 3 -- the findings doc and test were written exactly as the Task 3 spec required.

Tasks 1 and 2 (executed in prior sessions) had one route-shape correction folded in before the
valid probe run: per-issue REST sub-routes are flat, not company-scoped. Fixed in commit d36c81c
before the route-fixed probe run. This is recorded as a verified live fact in the findings doc.

## Authentication Gates

Task 2 was a `checkpoint:human-action` -- Eric ran the probe on the live VPS, bookended by a
verified snapshot, and pasted the JSON summary back. This is normal flow for a live spike, not
a deviation. Resolved before this continuation session.

## Verification

- `node --test test/phases/04-01-spike-findings.test.mjs` -- 5 tests, 5 pass, 0 fail.
- `node --check scripts/spike/chat-spike-probe.mjs` -- passed (Task 1 verification).
- Findings doc carries the explicit GO gate verdict that 04-02..04-06 reference.
- Countermoves was snapshotted before the probe run (`2026-05-18T20-15-56Z`, operator-confirmed).

## Self-Check: PASSED

- FOUND: `.planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md`
- FOUND: `test/phases/04-01-spike-findings.test.mjs`
- FOUND: `scripts/spike/chat-spike-probe.mjs`
- FOUND: commit `b91d887` (Task 1)
- FOUND: commit `d36c81c` (Task 1 route fix)
- FOUND: commit `9555aac` (Task 2)
- FOUND: commit `5f49c38` (Task 2)
- FOUND: commit `6c0d6ef` (Task 3)
