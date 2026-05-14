-- 0003_situation_and_optin.sql
-- Plan 02-04 Task 1 + Task 2 — Situation Room snapshot cache, active-viewer
-- gating table, and an idempotent guard for the prior clarity_user_prefs
-- table.
--
-- All DDL targets the deterministic plugin namespace
-- `plugin_clarity_pack_cdd6bda4bd` literally. The Paperclip host validator
-- (server/src/services/plugin-database.ts) requires fully qualified schema
-- names — there is NO template substitution. If the manifest id ever
-- changes, regenerate this and every other migration. (Empirically verified
-- against Paperclip master@b947a7d7 per 02-01 SMOKE-FINDINGS.md Finding #4.)
--
-- COMMENT ON statements may remain unqualified per the validator logic
-- (skips lines starting with `comment `); all other DDL is qualified.

-- Idempotent guard: assert 0001_init.sql already created clarity_user_prefs.
-- If a future migration ever renames the plugin id, this guard surfaces the
-- mismatch loudly instead of silently letting a wrong-namespace schema slip
-- through.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'plugin_clarity_pack_cdd6bda4bd'
      AND table_name = 'clarity_user_prefs'
  ) THEN
    RAISE EXCEPTION 'plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs missing — 0001_init.sql must run first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- situation_snapshots — ROOM-05 60s materialized cache.
-- ---------------------------------------------------------------------------
-- The 60s job (worker/jobs/situation-snapshot.ts) inserts one row per company
-- per minute when ≥1 active viewer is present. UI reads the most recent row.
-- content_hash + ON CONFLICT DO NOTHING is the idempotency key: identical
-- snapshots deduplicate server-side without a read-then-write race.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.situation_snapshots (
  id                       bigserial PRIMARY KEY,
  taken_at                 timestamptz NOT NULL DEFAULT now(),
  computed_for_company_id  text NOT NULL,
  payload                  jsonb NOT NULL,
  content_hash             text NOT NULL,
  UNIQUE (computed_for_company_id, content_hash)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.situation_snapshots IS
  'ROOM-05 60s materialized snapshot cache for the Situation Room. The 60s job inserts; UI reads most-recent.';

-- ---------------------------------------------------------------------------
-- active_viewers — ROOM-05 gating table.
-- ---------------------------------------------------------------------------
-- UI pings here every poll-tick via 'situation.active-viewer-ping'. The 60s
-- job no-ops when no row has last_seen_at within the last 90 seconds — so the
-- expensive recompute only runs when at least one user has the page open.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.active_viewers (
  user_id        text NOT NULL,
  surface        text NOT NULL,
  tab_id         text NOT NULL,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surface, tab_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.active_viewers IS
  'ROOM-05 active-viewer table. The 60s snapshot job skips when no row in the last 90s.';
