---
phase: quick-260516-gx4
plan: 01
status: complete
date: 2026-05-16
commits:
  - 6c73a52  # Task 1 — host-faithful agents fake + sessions extension
  - ced4209  # Task 2 — assembled host-faithful ctx + compile-bulletin host-contract net
  - 4ed04b1  # Task 3 — Defect B JSON-extraction fix
requirements: [BULL-05, BULL-06, BULL-09]
---

# Quick Task 260516-gx4 — Compile-path host-faithful test-hardening pass + Defect B

## Goal

Stop discovering compile-path defects one Countermoves VPS reinstall at a time
(Eric's 2026-05-16 decision). Make the whole bulletin compile path testable
locally in `node --test` so host-contract violations fail in CI — then close
Defect B (`compilePass1` rejecting valid JSON as "LLM output was not valid
JSON").

## What shipped

### Task 1 — Host-faithful `ctx.agents` fake (commit `6c73a52`)

- `test/helpers/host-faithful-agents.mjs` (174 lines) — reusable host-faithful
  `ctx.agents` fake. Encodes catalogue items 3, 4, 8:
  - **Item 3:** `get/resume/pause` reject a non-UUID `agentId` with the live
    host's `invalid input syntax for type uuid` error.
  - **Item 4:** `sessions.sendMessage` throws `Agent wakeup was skipped by
    heartbeat policy` (≠ "Session not found") when the agent is not invokable.
  - **Item 8:** distinguishes the manifest agentKey `editor-agent` from the
    `EDITOR_AGENT_ID_TAG` text attribution tag.
- `test/helpers/host-faithful-sessions.mjs` (+22 lines) — heartbeat-policy
  session opt extension so the sessions fake composes with the agents fake.
- `test/helpers/host-faithful-agents.test.mjs` (137 lines) — fake self-tests.

### Task 2 — Assembled host-faithful ctx + e2e host-contract net (commit `ced4209`)

- `test/helpers/host-faithful-ctx.mjs` (305 lines) — assembled host-faithful
  `ctx` covering every surface `compile-bulletin.ts` touches: `companies.list`,
  `agents.managed.reconcile`, `agents.get/resume/pause`, `agents.sessions.*`,
  `db.query/execute`, `issues.list/create/createComment`, `logger`,
  `jobs.register`. Encodes catalogue items 1, 2, 3, 4, 5, 7, 9.
- `test/worker/bulletin/compile-bulletin-host-faithful.test.mjs` (220 lines) —
  end-to-end test running `registerCompileBulletinJob` against the assembled
  ctx; fails locally on any host-contract violation.

Catalogue item 6 (migration SQL validator) is out of scope at job runtime —
already covered by `ddl-prefix-validator.test.mjs`; no compile-job ctx surface
exercises it. Items 1 and 2 were reused verbatim from the two pre-existing
precedent helpers.

### Task 3 — Defect B JSON-extraction fix (commit `4ed04b1`)

- `src/worker/bulletin/compile-pass-1.ts` — new pure `extractJsonObject(raw)`:
  peels a ```json (or bare ```) fenced block first, then does a
  brace-balanced, quote-aware scan (respecting `"`-strings and `\"` escapes)
  for the first complete `{...}` object. Wired into `compilePass1` inside the
  existing try/catch — a genuinely non-JSON output still throws into the
  `recordFailure` path with the byte-identical "LLM output was not valid JSON"
  rejection.
- `test/worker/bulletin/compile-pass-1-json-extraction.test.mjs` (205 lines,
  15 tests) — 10 unit tests for `extractJsonObject` + 5 `compilePass1`
  integration tests (fenced / prose-preamble / raw JSON → parsed BulletinDraft;
  non-JSON prose / fenced non-JSON → still rejected).

## Verification

- Task 3 targeted suite: **15/15 pass**.
- Full suite: **626 tests / 624 pass / 0 fail / 2 skip** (591 → 626, +35).
- `npx tsc --noEmit`: clean (exit 0).
- `node scripts/build-worker.mjs`: clean — `dist/worker.js` 151.5 KB.

All five `must_haves` truths verified; all four `must_haves` artifacts present
above their `min_lines` thresholds.

## Deviations

None. The plan executed as written. One execution interruption: the agent was
disconnected mid-Task-3 after writing the code but before verifying/committing;
the orchestrator resumed, ran the suite + typecheck + build (all green) and
committed Task 3 as `4ed04b1`.

## Follow-ups

- **Defect B is now resolved locally** but BULL-05/06/09 still need a live
  Countermoves drill to confirm end-to-end — that drill now only *confirms*
  rather than *discovers*, which was the point of the hardening pass.
- Plan 03-04 (errata, failed-compile banner, DST CI matrix, coexistence) and
  Phase 3 verification remain.
