-- 0015_action_cards.sql
-- Phase 13 Plan 13-01 Task 1 (D-01, D-02) -- Editor-Agent named-action card cache.
--
-- ADDITIVE-ONLY. This migration creates exactly one new table inside the
-- deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd. It performs
-- NO mutation of any core (host-owned) schema object (coexistence guarantee
-- #3): a plugin disable leaves this table and its data fully intact, and a
-- clean uninstall preserves it (purge is opt-in only).
--
-- Validator legality mirrors 0002_tldrs_and_editor.sql + 0014_bulletins_multicompany.sql:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- the Paperclip host validator
--     (server/src/services/plugin-database.ts) requires fully qualified schema
--     names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / index key is an INLINE UNIQUE (...) inside CREATE TABLE.
--     The host extractQualifiedRefs regex does NOT recognize a standalone
--     create-index statement as a qualified ref, so non-unique indexes are
--     forbidden here; the inline UNIQUE produces the btree index the
--     most-recent-card read needs.
--   - The validator allows create / alter / comment statements only -- no
--     procedural blocks, no standalone create-index statement, no standalone
--     schema-removal statement.
--   - COMMENT ON body text is apostrophe-free (the host stripSqlForKeywordScan
--     greedily pairs a lone apostrophe across statements and swallows the
--     leading keyword -- see 0004 / the ddl-prefix-validator regression test).

-- ---------------------------------------------------------------------------
-- action_cards -- Editor-Agent action-card cache (ACT-01 / ACT-02).
-- ---------------------------------------------------------------------------
-- One row per distinct source/leaf issue per company (D-03 per-leaf dedup).
-- source_issue_id is the leaf issue UUID the card grounds in -- it is a
-- key / dispatch field only and is NEVER rendered (NO_UUID_LEAK). The display
-- fields are named_action / awaited_party / est_bucket / action_kind /
-- decision_options.
--
-- UNIQUE (company_id, source_issue_id, content_hash) is the EDITOR-03-style
-- idempotency key, company-scoped per the 0014 multi-company lesson: the same
-- (company, leaf, content) compiled twice resolves to the same row, so
-- ON CONFLICT DO-NOTHING dedupes server-side without a read-then-write race.
-- The constraint also produces a btree index covering the most-recent-card
-- read (WHERE company_id = $1 AND source_issue_id = $2 ORDER BY generated_at DESC).
--
-- text[] columns (source_revisions, tags) match tldr_cache and are bound from
-- the worker via the toPgTextArrayLiteral + $N::text[] cast pattern (v0.6.5
-- Bug 2 fix) -- declared here as text[] NOT NULL DEFAULT '{}'.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards (
  id                   bigserial PRIMARY KEY,
  company_id           text NOT NULL,
  source_issue_id      text NOT NULL,
  named_action         text NOT NULL,
  awaited_party        text NOT NULL,
  est_bucket           text NOT NULL CHECK (est_bucket IN ('quick', 'focused', 'deep')),
  action_kind          text NOT NULL CHECK (action_kind IN ('answer', 'decide', 'assign', 'none')),
  decision_options     jsonb,
  content_hash         text NOT NULL,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  compiled_by_agent_id text NOT NULL,
  source_revisions     text[] NOT NULL DEFAULT '{}',
  tags                 text[] NOT NULL DEFAULT '{}',
  UNIQUE (company_id, source_issue_id, content_hash)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.action_cards IS
  'Editor-Agent action-card cache (ACT-01/ACT-02). One row per leaf issue per company. UNIQUE(company_id, source_issue_id, content_hash) = EDITOR-03 idempotency; ON CONFLICT DO-NOTHING. Additive plugin-namespace table -- plugin disable leaves data intact. source_issue_id is key/dispatch only, never rendered.';
