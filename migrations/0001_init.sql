-- 0001_init.sql
-- Single-table smoke migration. Lives in plugin namespace (host substitutes the real schema name
-- via ctx.db.namespace); we never write `public.` here. PK is (user_id) per D-02 / OPTIN-01.

CREATE TABLE IF NOT EXISTS clarity_user_prefs (
  user_id            text PRIMARY KEY,
  opted_in_at        timestamptz,
  default_landing    text NOT NULL DEFAULT 'classic',
  schema_version     integer NOT NULL DEFAULT 1
);

COMMENT ON TABLE clarity_user_prefs IS
  'Per-user opt-in toggle (OPTIN-01). Absence of row = opted-OUT.';
