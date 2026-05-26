-- 0013_clarity_agent_owners.sql
-- Phase 6.1 ROOM-09 -- operator-claimed agent ownership side table.
--
-- Additive plugin-namespace table holding operator-claimed agent ownership.
-- The recompute-situation owner-resolution path consults this table FIRST
-- and falls back to public.agents.owner_user_id only when no row exists.
-- The fix is owner-resolution at the chain leaf, NOT a smarter chain walk;
-- src/shared/blocker-chain.ts ships byte-identical.
--
-- Schema (D-01 / D-08) -- flat upsert; ON CONFLICT (agent_id) DO UPDATE in
-- the worker repo (NOT in this migration; the host validator rejects UPDATE
-- statements with "Plugin migrations may contain DDL statements only" --
-- see test/migrations/ddl-prefix-validator.test.mjs):
--   agent_id       text PRIMARY KEY
--   owner_user_id  text NOT NULL
--   company_id     text NOT NULL  -- multi-company discriminator (D-08)
--   set_at         timestamptz NOT NULL DEFAULT now()
--
-- Validator constraints honored (matches 0006_chat.sql + 0007 + 0008 + 0009
-- + 0010 + 0011):
--   - apostrophe-free comments (greedy string-literal strip hazard;
--     test/migrations/ddl-prefix-validator.test.mjs is the regression guard)
--   - no standalone CREATE INDEX (host extractQualifiedRefs has no pattern
--     for CREATE INDEX ... ON schema.table)
--   - PK on agent_id + idx-via-PK is sufficient for the bulk SELECT scan
--     (v1.0 bounded N; v1.1+ may add a company_id index when profiled)
--   - file ends on a semicolon-terminated statement (no trailing comment)
--
-- Additive-only per CLAUDE.md coexistence guarantee #3.
-- Coexistence guarantee #6: clean uninstall preserves data; --purge is
-- opt-in only. Idempotent -- re-running the migration is a no-op.
--
-- Ownership history / audit trail (replaced_by + audit table) explicitly
-- deferred to v1.1+ as an additive migration; v1.0 does not need the audit
-- trail and a 4-column table is the cheapest write path.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners (
  agent_id       text PRIMARY KEY,
  owner_user_id  text NOT NULL,
  company_id     text NOT NULL,
  set_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners IS
  'Phase 6.1 ROOM-09 -- operator-claimed agent ownership. The recompute-situation owner-resolution path consults this table FIRST and falls back to public.agents.owner_user_id only when no row exists. v1.0 = flat upsert (last write wins); v1.1+ may add ownership history as an additive migration.';
