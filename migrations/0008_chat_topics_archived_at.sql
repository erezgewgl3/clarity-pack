-- 0008_chat_topics_archived_at.sql
-- Plan 04.1-08 -- additive: track WHEN a chat_topic was archived.
--
-- The archive panel (Plan 04.1-08) needs to render archived topics sorted
-- newest-archived-first. Plan 04.1-05 added the `archived` boolean column;
-- it does NOT carry a timestamp. This migration adds an `archived_at`
-- timestamptz column to the existing chat_topics table.
--
-- Additive-only per CLAUDE.md coexistence guarantee #3: only ADD COLUMN
-- IF NOT EXISTS, no destructive change. The default is NULL (not now())
-- so the migration does NOT backfill existing archived rows with a fake
-- archive-time; the chat-topics-repo helper setChatTopicArchived stamps
-- archived_at = now() on every fresh archive write going forward and
-- archived_at = NULL on every un-archive write.
--
-- Validator constraints honored (matches 0006_chat.sql + 0007_chat_topic_tasks.sql):
--   - apostrophe-free comments (greedy string-literal strip hazard);
--   - no anonymous procedural blocks (DO dollar-quoted patterns rejected);
--   - file ends on a semicolon-terminated statement (no trailing comment);
--   - all DDL targets the deterministic plugin namespace
--     plugin_clarity_pack_cdd6bda4bd literally per 02-01 SMOKE-FINDINGS.md
--     Finding #4 (no template substitution).

ALTER TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;
