-- 0019_action_cards_flag.sql
-- Phase 19 Plan 19-01 Task 1 (D-01 / D-02) -- the runtime action-cards
-- enablement kill-switch (default OFF; flippable live with no redeploy).
--
-- ADDITIVE-ONLY. This migration creates exactly one new table inside the
-- deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd. It performs
-- NO mutation of any core (host-owned) schema object (coexistence guarantee
-- #3): a plugin disable leaves this table and its data fully intact, and a
-- clean uninstall preserves it (purge is opt-in only). ZERO public.* DDL.
--
-- Validator legality mirrors 0017_loop_governor.sql + 0018_structured_human_wait.sql:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- the Paperclip host validator
--     (server/src/services/plugin-database.ts) requires fully qualified schema
--     names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / lookup key is an INLINE UNIQUE (...) inside CREATE
--     TABLE. The host extractQualifiedRefs regex does NOT recognize a standalone
--     create-index statement as a qualified ref, so non-unique indexes are
--     forbidden here; the inline UNIQUE produces the btree index the lookups
--     need.
--   - The validator allows create / alter / comment statements only -- no
--     procedural blocks, no DO blocks, no standalone create-index statement.
--   - COMMENT ON body text is apostrophe-free (the host stripSqlForKeywordScan
--     greedily pairs a lone apostrophe across statements and swallows the
--     leading keyword -- see 0004 / the ddl-prefix-validator regression test).
--
-- Next number is 0019 (highest on disk is 0018; 0012 is absent on disk -- that
-- gap is harmless and is NOT reused here).
--
-- D-01 DIVERGENCE from wake_kill_switch (0017): this flag is NOT version-scoped.
-- There is intentionally NO plugin_version column. The operator flips ON once
-- and a later two-source version bump (for example v1.8.1) must NOT silently
-- revert the flag to OFF -- the ON state must survive the bump. The
-- wake_kill_switch is the OPPOSITE (version-scoped so a pre-fix tripped row does
-- not leave a corrected build dead-on-arrival).

-- ---------------------------------------------------------------------------
-- action_cards_flag (D-01) -- runtime action-cards enablement flag.
-- ---------------------------------------------------------------------------
-- One row per company. Default OFF (an absent row OR enabled = false both mean
-- OFF, the deterministic floor). The operator flips ON live via the set handler
-- (no redeploy) the instant the re-architecture is proven quiet; a panic OFF
-- (enabled = false) returns the room to the known-good floor with zero deploy
-- latency. The read is degrade-safe -- an unreadable flag reads as OFF. NOT
-- version-scoped (the D-01 divergence above). UNIQUE (company_id) is the
-- ON CONFLICT DO UPDATE target for the atomic flip upsert.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards_flag (
  id          bigserial PRIMARY KEY,
  company_id  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  set_at      timestamptz,
  set_by      text,
  UNIQUE (company_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.action_cards_flag IS
  'Runtime action-cards enablement flag (Phase 19 D-01). One row per company; default OFF (absent row or enabled=false). Operator flips ON live with no redeploy; read degrade-safe (unreadable then OFF). NOT version-scoped -- the ON state survives a two-source version bump. UNIQUE(company_id) is the ON CONFLICT DO UPDATE atomic-flip target. Additive plugin-namespace table -- plugin disable leaves data intact.';
