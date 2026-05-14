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
--
-- Paperclip's plugin-SQL validator rejects anonymous procedural blocks
-- (case-insensitive match on the keyword that opens a PL/pgSQL anonymous
-- block followed by a dollar-quote start or LANGUAGE clause). Discovered
-- during Plan 02-04 install on Countermoves, 2026-05-14. A defensive
-- existence-guard for 0001_init.sql.clarity_user_prefs was therefore
-- removed; the migration runner guarantees order 0001 -> 0002 -> 0003,
-- and if the namespace schema somehow does not exist by the time 0003
-- runs, the namespace-qualified DDL below will fail naturally with
-- `schema does not exist` -- the same loud failure mode the guard was
-- trying to provide.
-- Regression test: test/migrations/no-procedural-blocks.test.mjs scans
-- every migration with the same regex the host enforces.

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
