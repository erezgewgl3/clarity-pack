-- 0001_init.sql
-- Plugin-namespace migration. The host (Paperclip server/src/services/plugin-database.ts)
-- requires migration objects to use FULLY QUALIFIED schema names; it does NOT substitute
-- a placeholder. The schema name is deterministic from the plugin manifest `id`:
--   namespace = `plugin_${slug}_${hash10}`
--   slug      = id.toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').replace(/_+/g,'_')
--   hash10    = sha256(id).hex.slice(0, 10)
-- For id="clarity-pack" → slug="clarity_pack", hash10="cdd6bda4bd",
-- so namespace = "plugin_clarity_pack_cdd6bda4bd".
-- If the manifest `id` ever changes, regenerate this and every subsequent migration.
-- Empirically verified against Paperclip master@b947a7d7 (2026-05-13).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs (
  user_id            text PRIMARY KEY,
  opted_in_at        timestamptz,
  default_landing    text NOT NULL DEFAULT 'classic',
  schema_version     integer NOT NULL DEFAULT 1
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs IS
  'Per-user opt-in toggle (OPTIN-01). Absence of row = opted-OUT.';
