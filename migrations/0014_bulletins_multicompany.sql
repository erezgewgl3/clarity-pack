-- 0014_bulletins_multicompany.sql
-- 2026-05-28 -- make the bulletins table multi-company-correct.
--
-- BUG (live on BEAAA, which runs two companies): the bulletins INSERT failed
-- on every compile-bulletin cycle for both companies, so no bulletin ever
-- published. Two root causes, both because the table keys were designed for a
-- single company:
--
--   1. ON CONFLICT (next_due_at, content_hash) needs a matching unique index.
--      0004 declared UNIQUE (next_due_at, content_hash) inside CREATE TABLE,
--      but on the live install that constraint is absent (schema drift) -- so
--      every INSERT throws "no unique or exclusion constraint matching the
--      ON CONFLICT specification". Even where it exists, it is GLOBAL: two
--      companies share the same next_due_at and the same bootstrap
--      content_hash, so the second company collides with the first.
--   2. cycle_number was a GLOBAL PRIMARY KEY, but the bootstrap writes
--      cycle_number 0 for EVERY company, so the second company collides on the
--      primary key (ON CONFLICT on the unique does not catch a PK conflict).
--
-- FIX: scope both keys by company_id. The worker already derives cycle numbers
-- per company (MAX(cycle_number)+1 WHERE company_id), and publish.ts already
-- checks the cycle per company; this migration plus the matching ON CONFLICT /
-- read-back changes in bulletins-repo.ts + publish.ts complete the scoping.
--
-- Idempotent and validator-legal: only ALTER statements (the host plugin SQL
-- validator allows create / alter / comment only -- no DO blocks, no standalone
-- DROP, no CREATE INDEX), fully-qualified schema names, apostrophe-free
-- comments. Safe on the drifted live table (the old global unique is absent --
-- DROP IF EXISTS is a no-op) and on fresh installs (0004 created it -- DROP
-- removes it). The bulletins table holds no rows on installs where the INSERT
-- never succeeded, so the primary-key swap is a trivial rewrite.

-- Remove the single-company global unique (present on fresh installs from
-- 0004 as the auto-named bulletins_next_due_at_content_hash_key; absent on the
-- drifted live table). Replaced by the company-scoped key below.
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.bulletins
  DROP CONSTRAINT IF EXISTS bulletins_next_due_at_content_hash_key;

-- Company-scoped idempotency key. This is the ON CONFLICT arbiter the worker
-- inserts against; per-company so two companies compiling at the same
-- next_due_at (including the shared __bootstrap__ sentinel) never collide.
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.bulletins
  ADD CONSTRAINT bulletins_company_due_content_uq
  UNIQUE (company_id, next_due_at, content_hash);

-- Per-company cycle numbering: the primary key was cycle_number alone, which
-- made the bootstrap cycle 0 collide across companies. Move it to
-- (company_id, cycle_number) so each company owns its own cycle sequence.
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.bulletins
  DROP CONSTRAINT IF EXISTS bulletins_pkey;
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.bulletins
  ADD PRIMARY KEY (company_id, cycle_number);

COMMENT ON CONSTRAINT bulletins_company_due_content_uq
  ON plugin_clarity_pack_cdd6bda4bd.bulletins IS
  'Company-scoped bulletin idempotency key (2026-05-28 multi-company fix): replaces the single-company UNIQUE (next_due_at, content_hash). The worker ON CONFLICT target.';
