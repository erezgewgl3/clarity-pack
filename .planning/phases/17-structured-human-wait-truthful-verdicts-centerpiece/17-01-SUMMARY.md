---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
plan: 01
subsystem: structured-human-wait
tags: [wait-01, wait-02, wait-03, migration, plugin-namespace, blocker-chain, founder-resolution, d-07, d-08, additive-schema]
requires:
  - migration 0017 applied (latest on disk; 0018 is the next sequential number)
  - plugin_clarity_pack_cdd6bda4bd namespace (existing)
  - clarity_agent_owners table (migration 0013) populated for founder resolution
provides:
  - "plugin_clarity_pack_cdd6bda4bd.clarity_human_waits — additive table, one live row per (company, issue)"
  - "upsertClarityHumanWait / listClarityHumanWaitsForCompany / deleteClarityHumanWait (clarity-human-wait-repo.ts)"
  - "nodeMeta.structuredWaitOwnerUserId + nodeMeta.structuredWaitOneLiner (optional engine fields)"
  - "priority-0 AWAITING_HUMAN leaf branch in flattenBlockerChain (D-07: structured wait beats agent + native awaiting)"
  - "resolveFounderUserId(ctx, companyId) — instance-agnostic founder resolution (founder-resolution.ts)"
affects:
  - src/shared/blocker-chain.ts (two optional nodeMeta fields + one leaf branch)
  - "downstream 17-02 (SC5 write-site merge), 17-03 (Editor-Agent populator), 17-05 (full matrix) consume these contracts"
tech-stack:
  added: []
  patterns:
    - "additive plugin-namespace cache table (mirrors 0015_action_cards: inline UNIQUE, DDL-only, apostrophe-free COMMENT, fully-qualified namespace literal)"
    - "ON CONFLICT (company_id, issue_id) DO UPDATE upsert (one live row per issue, D-04 self-clear) — diverges from 0015's 3-col DO NOTHING"
    - "text[] bound via toPgTextArrayLiteral + $N::text[] (v0.6.5 Bug 2, reused from tldr-cache.ts)"
    - "producer/consumer split: AI writes the data row, the pure engine reads it (keeps blocker-chain.ts AI-free, SC4)"
    - "degrade-safe null: no owner row → resolveFounderUserId null → caller skips → conservative Watch floor"
key-files:
  created:
    - migrations/0018_structured_human_wait.sql
    - src/worker/db/clarity-human-wait-repo.ts
    - src/worker/situation/founder-resolution.ts
    - test/worker/structured-human-wait-verdict.test.mjs
  modified:
    - src/shared/blocker-chain.ts
decisions:
  - "D-04 self-clear: upsert is ON CONFLICT DO UPDATE (one live row/issue); delete is DML in the repo, NEVER in the migration"
  - "D-07: structured wait ranks at priority 0 — wins over BOTH status==='awaiting' AND assigneeAgentId"
  - "D-08: REUSE AWAITING_HUMAN terminal kind (no 9th kind); classifyVerdict / pickTopChains / Terminal union byte-unchanged"
  - "Founder tie-break: lexicographically smallest distinct owner_user_id (set_at not projected by listClarityAgentOwnersForCompany; documented in code)"
metrics:
  duration: ~25m
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  tests_passing: 28
  completed: 2026-06-11
---

# Phase 17 Plan 01: Structured human-wait foundation Summary

Laid the Phase 17 foundation contracts: an additive plugin-namespace `clarity_human_waits` table + typed repo, an instance-agnostic founder resolver, and the single surgical engine change that turns a persisted structured-wait row into an `AWAITING_HUMAN` (needs-you) verdict that wins over a nominally-assigned agent (the core BEAAA-972 fix), with engine purity and determinism guards preserved.

## What Was Built

### Task 1 — Migration 0018 + repo (commit 1de5f0b)
- `migrations/0018_structured_human_wait.sql`: one `CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_human_waits` with `(id bigserial PK, company_id, issue_id, owner_user_id, decision_one_liner, content_hash, generated_at timestamptz default now(), compiled_by_agent_id, source_revisions text[] default '{}')` and an INLINE `UNIQUE (company_id, issue_id)`. Mirrors 0015's validator discipline: DDL-only, fully-qualified namespace literal, no standalone `CREATE INDEX`, no `UPDATE`, no `public.`, apostrophe-free `COMMENT ON`. Divergence from 0015: 2-col UNIQUE for upsert-in-place (D-04) vs 0015's 3-col DO NOTHING; dropped the enum CHECK columns and `decision_options jsonb`.
- `src/worker/db/clarity-human-wait-repo.ts`: `ClarityHumanWaitRow` + `ClarityHumanWaitRepoCtx` types; `upsertClarityHumanWait` (INSERT ... `ON CONFLICT (company_id, issue_id) DO UPDATE SET` all non-key columns = EXCLUDED.*), `listClarityHumanWaitsForCompany` (all live rows, `WHERE company_id = $1`), `deleteClarityHumanWait` (self-clear, repo-side DML). `source_revisions` bound via `toPgTextArrayLiteral` + `$8::text[]` reused from tldr-cache.ts.

### Task 2 — Engine fields + priority-0 branch + verdict test (TDD: RED 14c221c, GREEN d4cad98)
- `src/shared/blocker-chain.ts`: added optional `structuredWaitOwnerUserId?: string | null` and `structuredWaitOneLiner?: string | null` to the nodeMeta value type. Inserted ONE leaf-cascade branch immediately after the two EXTERNAL guards and before the `status==='awaiting'` branch — when `meta?.structuredWaitOwnerUserId != null`, emit `AWAITING_HUMAN` with `userId = structuredWaitOwnerUserId` and a `"<owner> to decide: <one-liner>"` label (fallback when no one-liner). This wins over both native awaiting AND agent ownership (D-07).
- `test/worker/structured-human-wait-verdict.test.mjs`: 7 self-contained `node:test` cases proving D-07 (beats agent assignee; beats native awaiting+owner), D-05 (one-liner in label), D-08 (needs-you/reply/needsYou:true via existing kind), determinism (100× JSON.stringify-equal), and no-regression (agent path unchanged without a wait).

### Task 3 — Founder resolution (commit 3ac0f35)
- `src/worker/situation/founder-resolution.ts`: `resolveFounderUserId(ctx, companyId)` reuses `listClarityAgentOwnersForCompany` (no new SQL), takes the distinct `owner_user_id`, returns null on zero owners (degrade-safe skip), and tie-breaks deterministically on the lexicographically smallest distinct id (documented in code; `set_at` is not projected by the existing list query).

## Verification Results
- `node --test test/worker/structured-human-wait-verdict.test.mjs` → 7/7 pass.
- `node --test test/shared/blocker-chain.test.mjs` → 21/21 pass (100-run determinism guard + AI-token grep guard both green).
- Combined run: 28/28 pass.
- `node --check` clean on both new `.ts` files.
- Migration negatives confirmed: zero `CREATE INDEX`, zero `UPDATE`, zero `public.`, apostrophe-free COMMENT body.
- Purity: `grep -niE 'openai|anthropic|claude_local|llm|gpt|completion'` on blocker-chain.ts (non-comment) → NONE.
- D-08 byte-unchanged: `git diff` shows `src/shared/types.ts` unchanged; the only `classifyVerdict` line touched is a new comment (function body intact).
- Founder resolver instance-agnostic: `grep -niE 'BEAAA|Eric|companyPrefix|prepareForName'` → NONE (reworded comments to avoid the "gen**eric**ally" substring false-positive).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Acceptance-grep substring false positive in founder-resolution.ts**
- **Found during:** Task 3 verification.
- **Issue:** The plan's acceptance grep `BEAAA|Eric|companyPrefix|prepareForName` is case-insensitive and unbounded; the documentation word "generically"/"GENERICALLY" matched on the `eric` substring, falsely flagging an instance literal where none existed.
- **Fix:** Reworded the comments to "in an instance-agnostic way" / "no operator name string", removing the substring while preserving the documented intent. No code-path change.
- **Files modified:** src/worker/situation/founder-resolution.ts
- **Commit:** 3ac0f35

Otherwise: plan executed as written. No architectural changes, no auth gates, no checkpoints (fully autonomous plan).

## Threat Model Compliance
- T-17-01 (tampering, write path): mitigated — all writes parameterized `ctx.db.execute` ($1..$8 binds); `source_revisions` via `toPgTextArrayLiteral` + `$N::text[]`, no string interpolation.
- T-17-02 (info disclosure): mitigated — every read/write carries `WHERE company_id = $1`; `UNIQUE(company_id, issue_id)` scopes rows per company; `resolveFounderUserId` reads only the requested company's owners.
- T-17-03 (engine purity): mitigated — engine change is pure field reads; AI-token grep guard green.
- T-17-SC (installs): N/A — zero packages installed this plan.

## Known Stubs
None. No empty-value placeholders or unwired data sources introduced — all three artifacts are fully functional contracts consumed by 17-02/03/05.

## Notes for Downstream Plans
- **SC5 parity trap (17-02):** the structured wait must be merged into `nodeMeta[rootId]` identically on all THREE root-meta write sites (`flatten-blocker-chain.ts`, `build-employees-rollup.ts`, `org-blocked-backlog.ts`) via the shared `applyStructuredWait` helper, fed by ONE `waitMap` built in the `situation-room.ts` prefetch. A wait merged on one path but not the others reproduces BEAAA-972 cross-surface divergence.
- The `deleteClarityHumanWait` self-clear (D-04) is the path the 17-03 populator calls when comments no longer show an open wait or the issue leaves blocked status.
- `resolveFounderUserId` returns null when no owner is claimed — the 17-03 populator MUST skip writing the wait in that case (degrade-safe).

## Self-Check: PASSED
- migrations/0018_structured_human_wait.sql — FOUND
- src/worker/db/clarity-human-wait-repo.ts — FOUND
- src/worker/situation/founder-resolution.ts — FOUND
- test/worker/structured-human-wait-verdict.test.mjs — FOUND
- src/shared/blocker-chain.ts (modified) — FOUND
- Commit 1de5f0b — FOUND
- Commit 14c221c — FOUND
- Commit d4cad98 — FOUND
- Commit 3ac0f35 — FOUND
