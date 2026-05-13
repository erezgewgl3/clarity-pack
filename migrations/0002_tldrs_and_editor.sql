-- 0002_tldrs_and_editor.sql
-- Plan 02-03 Task 1 — TL;DR cache + Editor-Agent failure audit + AC checklist.
--
-- Every DDL statement targets the deterministic plugin namespace
-- `plugin_clarity_pack_cdd6bda4bd` literally. Paperclip's host validator
-- (server/src/services/plugin-database.ts:187-203) requires fully qualified
-- schema names — there is NO template substitution. If the manifest `id`
-- ever changes, regenerate this migration and every prior + subsequent
-- migration. Empirically verified against Paperclip master@b947a7d7 per
-- 02-01 SMOKE-FINDINGS.md Finding #4.
--
-- COMMENT ON statements may remain unqualified per validator logic
-- (skips lines starting with `comment `); all other DDL is qualified.

-- ---------------------------------------------------------------------------
-- tldr_cache — EDITOR-03 idempotency table.
-- ---------------------------------------------------------------------------
-- UNIQUE (surface, scope_id, content_hash) is the idempotency key: the same
-- (issue, content) compiled twice resolves to the same row, so ON CONFLICT
-- DO NOTHING dedupes server-side without a read-then-write race. Index on
-- (surface, scope_id, generated_at DESC) speeds the "most-recent TL;DR for
-- this issue" lookup the Reader view performs on every mount.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.tldr_cache (
  id                   bigserial PRIMARY KEY,
  surface              text NOT NULL CHECK (surface IN ('issue', 'situation', 'bulletin')),
  scope_id             text NOT NULL,
  content_hash         text NOT NULL,
  body                 text NOT NULL,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  source_revisions     text[] NOT NULL DEFAULT '{}',
  compiled_by_agent_id text NOT NULL,
  tags                 text[] NOT NULL DEFAULT '{}',
  UNIQUE (surface, scope_id, content_hash)
);

CREATE INDEX IF NOT EXISTS tldr_cache_scope_idx
  ON plugin_clarity_pack_cdd6bda4bd.tldr_cache (surface, scope_id, generated_at DESC);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.tldr_cache IS
  'Editorial Desk TL;DRs (Reader / Situation / Bulletin). UNIQUE(surface, scope_id, content_hash) = EDITOR-03 idempotency. ON CONFLICT DO NOTHING.';

-- ---------------------------------------------------------------------------
-- editor_agent_failures — durable audit log for D-06 circuit breaker.
-- ---------------------------------------------------------------------------
-- Every failure (LLM throw, token-cap breach, schema-validation failure)
-- appends a row regardless of whether the in-memory counter has hit
-- MAX_CONSECUTIVE_FAILURES yet. v2 will read the last MAX_CONSECUTIVE_FAILURES
-- rows on worker boot to rebuild counter state across restarts.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.editor_agent_failures (
  id           bigserial PRIMARY KEY,
  agent_key    text NOT NULL,
  failed_at    timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL,
  consecutive  int NOT NULL
);

CREATE INDEX IF NOT EXISTS editor_failures_agent_time_idx
  ON plugin_clarity_pack_cdd6bda4bd.editor_agent_failures (agent_key, failed_at DESC);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.editor_agent_failures IS
  'Audit log for D-06 circuit breaker. Every Editor-Agent failure appends a row.';

-- ---------------------------------------------------------------------------
-- ac_checklist_items — manual AC checklist for READER-07.
-- ---------------------------------------------------------------------------
-- v1 ships manual checkboxes (operator clicks to toggle). Auto-status from
-- acceptance-criteria text is Phase 5 DIST-03 work. Row-per-AC-item shape
-- supports drag-to-reorder later (display_order is the sort key).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.ac_checklist_items (
  id            bigserial PRIMARY KEY,
  issue_id      text NOT NULL,
  label         text NOT NULL,
  checked       boolean NOT NULL DEFAULT false,
  checked_by    text,
  checked_at    timestamptz,
  display_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ac_checklist_issue_idx
  ON plugin_clarity_pack_cdd6bda4bd.ac_checklist_items (issue_id, display_order);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.ac_checklist_items IS
  'Manual acceptance-criteria checklist per issue (READER-07). Auto-status = Phase 5 DIST-03.';
