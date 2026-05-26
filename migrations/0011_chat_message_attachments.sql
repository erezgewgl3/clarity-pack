-- 0011_chat_message_attachments.sql
-- Plan 05-11 -- CHAT-07 gap closure (chat composer attachments).
--
-- Additive plugin-namespace table linking each chat message to one or more
-- attachment documents stored in the plugin-owned issue_documents store
-- (ctx.issues.documents.upsert). Each row carries the document_key the host
-- assigned plus a denormalized topic_issue_id (saves a join on the hot
-- list-by-topic path), mime metadata, original filename, and byte_size.
--
-- Upload-on-send semantics (Option B, locked 2026-05-26): the chat composer
-- stages files in browser memory on pick; the upload chain fires only when
-- the operator clicks Send. chat.send persists the chat_messages row FIRST;
-- per-file chat.attachment.upload calls fire AFTER with the just-committed
-- message_uuid. The FK on chat_message_id always points at a real, already-
-- committed chat_messages row -- standard FK (NOT DEFERRABLE) is sufficient.
--
-- All DDL targets the deterministic plugin namespace
-- plugin_clarity_pack_cdd6bda4bd literally per 02-01 SMOKE-FINDINGS.md
-- Finding #4 (no template substitution).
--
-- Validator constraints honored (matches 0006_chat.sql + 0007 + 0008 + 0009 + 0010):
--   - apostrophe-free comments (greedy string-literal strip hazard);
--   - no anonymous procedural blocks (DO dollar-quoted patterns rejected);
--   - NO standalone CREATE INDEX -- the host extractQualifiedRefs has no
--     pattern for CREATE INDEX ... ON schema.table, so a standalone index
--     statement yields zero qualified refs and is rejected at install. The
--     PRIMARY KEY + FK indexes are auto-created inside CREATE TABLE; the
--     list-by-topic SELECT is single-operator-scale + company-scoped, so no
--     extra index is needed (mirrors 0006/0007/0008/0009/0010 pattern).
--   - file ends on a semicolon-terminated statement (no trailing comment).
--
-- Additive-only per CLAUDE.md coexistence guarantee #3: only CREATE TABLE
-- IF NOT EXISTS in the plugin namespace; the host-owned schema is never
-- touched. Coexistence guarantee #6 (clean uninstall preserves data): the
-- table lives in the plugin namespace and survives a disable; --purge is
-- opt-in only. Idempotent -- re-running the migration is a no-op.
--
-- CASCADE on chat_message_id: if a chat_messages row is ever deleted
-- (extremely unlikely -- the chat_messages table is append-only by design),
-- the orphaned attachment rows go too. Plugin-namespace cleanup keeps the
-- additive-only guarantee.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_message_attachments (
  id                  text PRIMARY KEY,
  company_id          text NOT NULL,
  topic_issue_id      text NOT NULL,
  chat_message_id     text NOT NULL,
  comment_id          text,
  document_key        text NOT NULL,
  mime_type           text NOT NULL,
  original_filename   text NOT NULL,
  byte_size           bigint NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- standard FK -- chat_messages row is committed before any chat_message_attachments
  -- insert per Option B upload-on-send semantics (chat.send fires first; the
  -- per-file chat.attachment.upload calls fire after with the just-returned
  -- message_uuid). The FK at insert time always references a real, already-
  -- committed row -- no DEFERRABLE gymnastics needed.
  CONSTRAINT chat_message_attachments_message_fk
    FOREIGN KEY (chat_message_id)
    REFERENCES plugin_clarity_pack_cdd6bda4bd.chat_messages (message_uuid)
    ON DELETE CASCADE
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.chat_message_attachments IS
  'Plan 05-11 CHAT-07 gap closure -- links each chat_messages row to one or more attachment documents in the plugin-owned ctx.issues.documents store. Upload-on-send semantics (Option B): chat.send commits the chat_messages row first; chat.attachment.upload commits the attachment row second with the just-returned message_uuid -- standard FK is sufficient.';
