---
phase: 19-action-cards-async-re-architecture-last-flag-gated
plan: 01
subsystem: worker / action-cards safety primitive
tags: [kill-switch, runtime-flag, additive-migration, degrade-safe, action-cards]
requires:
  - "migrations 0001..0018 (highest on disk before this plan)"
  - "src/worker/db/wake-kill-switch-repo.ts (clone template)"
  - "migrations/0017_loop_governor.sql (legality header + wake_kill_switch block)"
provides:
  - "migrations/0019_action_cards_flag.sql — additive plugin-namespace flag table (default OFF, NOT version-scoped)"
  - "isActionCardsEnabled / setActionCardsEnabled — degrade-to-OFF runtime flag repo"
  - "runtime flag reads at editor.ts heartbeat guard + situation-room.ts compile guard"
affects:
  - "src/worker/agents/editor.ts (compile decision)"
  - "src/worker/handlers/situation-room.ts (snapshot compile guard)"
  - "src/worker/agents/action-cards.ts (ACTION_CARDS_ENABLED const now legacy/no-op)"
tech-stack:
  added: []
  patterns:
    - "degrade-to-OFF runtime kill-switch (inverted polarity vs wake_kill_switch)"
    - "additive plugin-namespace migration (validator-legal, apostrophe-free comment)"
    - "parameterized-only SQL ($1/$2/$3 binds, no identifier interpolation)"
key-files:
  created:
    - migrations/0019_action_cards_flag.sql
    - src/worker/db/action-cards-flag-repo.ts
    - test/worker/db/action-cards-flag-repo.test.mjs
    - test/migrations/0019-validator.test.mjs
  modified:
    - src/worker/agents/editor.ts
    - src/worker/handlers/situation-room.ts
    - src/worker/agents/action-cards.ts
decisions:
  - "D-01: flag is NOT version-scoped — dropped the plugin_version filter/column so the operator's ON survives a two-source version bump."
  - "D-02: default OFF (absent row => OFF) and degrade-safe (read throw => OFF, inverted polarity vs wake-kill-switch fail-open)."
  - "Wave-1 scope: situation-room got the minimal flag-read swap only; the on-request compile block deletion (CARD-01) is deferred to Plan 19-02 by design."
  - "ACTION_CARDS_ENABLED const retained as a legacy/no-op export (no longer consulted at either call site); removal is Plan 19-02."
metrics:
  duration: "~25 min"
  completed: "2026-06-15"
  tasks: 2
  files_changed: 7
requirements: [CARD-02, CARD-03]
---

# Phase 19 Plan 01: Action-cards runtime kill-switch (flag-gated, inert at OFF) Summary

Shipped the safety foundation every later Phase-19 wave gates on: an additive plugin-namespace flag table (`0019_action_cards_flag`), a degrade-to-OFF runtime flag repo cloned from `wake-kill-switch-repo.ts` with inverted polarity and **no** version-scoping, and the swap of the two compile-time `ACTION_CARDS_ENABLED` const reads to runtime `isActionCardsEnabled` reads. At default OFF the change is behaviorally INERT — the room renders exactly as it does today (deterministic floor) — while establishing the live-flippable OFF/ON control that makes the two-step enablement (D-08) reversible with no redeploy.

## What Was Built

### Task 1 — Additive migration 0019 + flag repo + tests (commit fe6aa1c)
- **`migrations/0019_action_cards_flag.sql`** — `CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards_flag` (`id bigserial PK`, `company_id text NOT NULL`, `enabled boolean NOT NULL DEFAULT false`, `set_at timestamptz`, `set_by text`, `UNIQUE (company_id)`). Cloned the 0017 legality header verbatim (additive-only, zero `public.*` DDL, fully-qualified namespace literal, `CREATE TABLE IF NOT EXISTS`, inline `UNIQUE`, apostrophe-free `COMMENT`). **No `plugin_version` column** — the D-01 divergence so ON survives a version bump.
- **`src/worker/db/action-cards-flag-repo.ts`** — `isActionCardsEnabled(ctx, companyId)` SELECTs `enabled` with **no** `plugin_version` predicate, returns `!!rows[0]?.enabled`, and the catch returns `false` (degrade-to-OFF, inverted vs `isEngaged`'s fail-open). `setActionCardsEnabled(ctx, companyId, enabled, setBy)` is an atomic `INSERT ... ON CONFLICT (company_id) DO UPDATE` upsert with parameterized `$1/$2/$3` binds only.
- **`test/worker/db/action-cards-flag-repo.test.mjs`** — 8 assertions: absent-row→OFF, throw→OFF (never rejects), `{enabled:true}`→true, `{enabled:false}`→false, read SQL contains no `plugin_version` filter, upsert is `INSERT...ON CONFLICT...DO UPDATE` with bound params, OFF-flip binds `enabled=false`.
- **`test/migrations/0019-validator.test.mjs`** — ports the host validator (same tokenizer/classifier as `ddl-prefix-validator.test.mjs`) against 0019: DDL-classification, fully-qualified namespace-only refs (zero `public.*`), and the D-01 no-`plugin_version` property (scanned on comment-stripped SQL).

### Task 2 — Swap compile-time const reads to runtime flag reads (commit 27380ed)
- **`editor.ts`** — dropped the `ACTION_CARDS_ENABLED` import; the heartbeat guard at the action-card trigger now reads `if (!(await isActionCardsEnabled(ctx, payload.companyId))) return;`. The compile-and-dispatch body (the governed pull path) is unchanged.
- **`situation-room.ts`** — dropped the `ACTION_CARDS_ENABLED` import; the compile-block guard now reads `if ((await isActionCardsEnabled(ctx, companyId)) && needsYouRows.length > 0)`. The on-request compile block is **not** deleted here — that is Plan 19-02 (CARD-01). At default OFF the guard is false so the block is inert exactly as today.
- **`action-cards.ts`** — kept the `ACTION_CARDS_ENABLED` const export (avoids churn with 19-02); updated its header to document that both call sites now read the runtime flag and the const is a legacy/no-op export pending 19-02 removal.

## Verification

- `node --test test/worker/db/action-cards-flag-repo.test.mjs test/migrations/0019-validator.test.mjs test/worker/agents/action-cards.test.mjs` — **31/31 pass**.
- `node --test test/migrations/ddl-prefix-validator.test.mjs` (broad sweep over all migrations incl. 0019) — **18/18 pass**.
- `npx tsc --noEmit -p tsconfig.json` — **exit 0** (clean).
- `src/shared/blocker-chain.ts` untouched (determinism floor preserved); no source file imports `ACTION_CARDS_ENABLED` any longer (only the retained const definition + comments reference the name).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with their planned files, the const was retained per the plan's explicit instruction (removal deferred to 19-02), and all acceptance criteria were met.

## Known Stubs

None. The flag write handler (operator RPC, `set-action-cards-flag.ts`) is intentionally a separate plan (19-05) per the threat model; the repo's `setActionCardsEnabled` is fully implemented and unit-proven here. No UI-facing placeholders introduced.

## Notes for Downstream Plans

- **19-02 (CARD-01):** owns deleting the on-request compile block in `situation-room.ts` (the `:606` site) and removing the now-legacy `ACTION_CARDS_ENABLED` const. The runtime guard is already in place; 19-02 should also add the SWR serve-path flag strip (Pitfall 4) and the batch `getActionCardsBySources` read.
- **19-05 (operator flip):** ship `src/worker/handlers/set-action-cards-flag.ts` over the existing `setActionCardsEnabled` upsert (BEAAA has no `psql` on the box, so the Step-2 ON-flip and panic-OFF must be RPC, not shell).
- **Deploy (D-12):** the v1.7.5 → v1.8.0 two-source version bump is NOT done in this plan (no behavior change at default OFF); it belongs to the phase deploy step.

## Self-Check: PASSED

- migrations/0019_action_cards_flag.sql — FOUND
- src/worker/db/action-cards-flag-repo.ts — FOUND
- test/worker/db/action-cards-flag-repo.test.mjs — FOUND
- test/migrations/0019-validator.test.mjs — FOUND
- commit fe6aa1c — FOUND
- commit 27380ed — FOUND
