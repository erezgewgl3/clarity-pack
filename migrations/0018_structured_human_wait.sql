-- 0018_structured_human_wait.sql
-- Phase 17 Plan 17-01 Task 1 (WAIT-01, D-04, D-05, D-06) -- Editor-Agent
-- structured human-wait cache.
--
-- ADDITIVE-ONLY. This migration creates exactly one new table inside the
-- deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd. It performs
-- NO mutation of any core (host-owned) schema object (coexistence guarantee
-- #3): a plugin disable leaves this table and its data fully intact, and a
-- clean uninstall preserves it (purge is opt-in only).
--
-- Validator legality mirrors 0013_clarity_agent_owners.sql + 0015_action_cards.sql:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- the Paperclip host validator
--     (server/src/services/plugin-database.ts) requires fully qualified schema
--     names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / index key is an INLINE UNIQUE (...) inside CREATE TABLE.
--     The host extractQualifiedRefs regex does NOT recognize a standalone
--     create-index statement as a qualified ref, so non-unique indexes are
--     forbidden here; the inline UNIQUE produces the btree index the
--     one-live-wait-per-issue read needs.
--   - The validator allows create / alter / comment statements only -- no
--     procedural blocks, no standalone create-index statement, no UPDATE.
--   - COMMENT ON body text is apostrophe-free (the host stripSqlForKeywordScan
--     greedily pairs a lone apostrophe across statements and swallows the
--     leading keyword -- see 0004 / the ddl-prefix-validator regression test).

-- ---------------------------------------------------------------------------
-- clarity_human_waits -- Editor-Agent structured human-wait cache (WAIT-01).
-- ---------------------------------------------------------------------------
-- One LIVE row per (company, issue). issue_id is the blocked (root) issue the
-- wait grounds in -- a key / dispatch field only, NEVER rendered (NO_UUID_LEAK).
-- owner_user_id is the company primary human (founder, D-06) resolved
-- generically. decision_one_liner is the polishTldr-voiced "what" (D-05).
--
-- DIVERGENCE vs 0015: 0015 uses a 3-col idempotency key
-- (company_id, source_issue_id, content_hash) with ON CONFLICT DO NOTHING
-- (append-on-change). This phase wants ONE LIVE row per issue (D-04 self-clear
-- SWR re-derive each compile), so the key is the 2-col UNIQUE
-- (company_id, issue_id) with ON CONFLICT DO UPDATE (upsert-in-place) in the
-- repo. The 0015 enum CHECK columns and decision_options jsonb are dropped --
-- not needed here.
--
-- content_hash carries SWR idempotency (skip a re-write when the comments have
-- not changed). source_revisions text[] mirrors tldr_cache / action_cards and
-- is bound from the worker via the toPgTextArrayLiteral + $N::text[] cast
-- pattern (v0.6.5 Bug 2 fix) -- declared here as text[] NOT NULL DEFAULT '{}'.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_human_waits (
  id                   bigserial PRIMARY KEY,
  company_id           text NOT NULL,
  issue_id             text NOT NULL,
  owner_user_id        text NOT NULL,
  decision_one_liner   text NOT NULL,
  content_hash         text NOT NULL,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  compiled_by_agent_id text NOT NULL,
  source_revisions     text[] NOT NULL DEFAULT '{}',
  UNIQUE (company_id, issue_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.clarity_human_waits IS
  'Editor-Agent structured human-wait cache (WAIT-01). One live row per issue per company. UNIQUE(company_id, issue_id) = upsert idempotency key with ON CONFLICT DO UPDATE (D-04 self-clear). Additive plugin-namespace table -- plugin disable leaves data intact. issue_id is key/dispatch only, never rendered.';
