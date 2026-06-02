-- 0016_reply_resume_dedup.sql
-- Phase 14 Plan 14-01 Task 1 (DO-01 / DO-02) -- situation.replyAndResume dedup map.
--
-- ADDITIVE-ONLY. This migration creates exactly one new table inside the
-- deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd. It performs
-- NO mutation of any core (host-owned) schema object (coexistence guarantee
-- #3): a plugin disable leaves this table and its data fully intact, and a
-- clean uninstall preserves it (purge is opt-in only). ZERO public.* DDL.
--
-- Validator legality mirrors 0015_action_cards.sql + 0014_bulletins_multicompany.sql:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- the Paperclip host validator
--     (server/src/services/plugin-database.ts) requires fully qualified schema
--     names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / dedup-read key is an INLINE UNIQUE (...) inside CREATE
--     TABLE. The host extractQualifiedRefs regex does NOT recognize a standalone
--     create-index statement as a qualified ref, so non-unique indexes are
--     forbidden here; the inline UNIQUE produces the btree index the dedup read
--     (WHERE company_id = $1 AND message_uuid = $2) needs.
--   - The validator allows create / alter / comment statements only -- no
--     procedural blocks, no standalone create-index statement, no standalone
--     schema-removal statement.
--   - COMMENT ON body text is apostrophe-free (the host stripSqlForKeywordScan
--     greedily pairs a lone apostrophe across statements and swallows the
--     leading keyword -- see 0004 / the ddl-prefix-validator regression test).

-- ---------------------------------------------------------------------------
-- reply_resume_dedup -- situation.replyAndResume client-messageUuid dedup map.
-- ---------------------------------------------------------------------------
-- One row per (company_id, message_uuid). The handler dedups on this row BEFORE
-- any host mutation: a lost-ACK retry with the same client messageUuid returns
-- the ORIGINAL comment_id WITHOUT re-posting a comment or re-applying the
-- Shape-B durability flip (T-14-01 idempotent replay).
--
-- comment_id is the host public.issue_comments id returned by createComment;
-- leaf_issue_id is the HUMAN display key (e.g. BEAAA-43). BOTH are dispatch /
-- echo keys only and are NEVER rendered to the operator (NO_UUID_LEAK).
-- durable records whether the Shape-B {status:'in_progress'} flip was applied,
-- so a replay does not re-attempt the flip.
--
-- UNIQUE (company_id, message_uuid) is the idempotency key, company-scoped per
-- the 0014 multi-company lesson: it dedupes server-side via ON CONFLICT
-- DO NOTHING (no read-then-write race) and produces the btree index covering
-- the dedup read.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup (
  id            bigserial PRIMARY KEY,
  company_id    text NOT NULL,
  message_uuid  text NOT NULL,
  leaf_issue_id text NOT NULL,
  comment_id    text NOT NULL,
  durable       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, message_uuid)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup IS
  'situation.replyAndResume dedup map (DO-01/DO-02). One row per (company_id, message_uuid). UNIQUE(company_id, message_uuid) = client-messageUuid idempotency; ON CONFLICT DO-NOTHING. durable records whether the Shape-B in_progress flip was applied. Additive plugin-namespace table -- plugin disable leaves data intact. comment_id and leaf_issue_id are key/echo only, never rendered.';
