-- 0017_loop_governor.sql
-- Phase 16.1 Plan 16.1-01 Task 1 (D-03 / D-06 / D-08 / D-09) -- the durable
-- foundation for the Editor-Agent loop fix + wake governor.
--
-- ADDITIVE-ONLY. This migration creates exactly three new tables inside the
-- deterministic plugin namespace plugin_clarity_pack_cdd6bda4bd. It performs
-- NO mutation of any core (host-owned) schema object (coexistence guarantee
-- #3): a plugin disable leaves these tables and their data fully intact, and a
-- clean uninstall preserves them (purge is opt-in only). ZERO public.* DDL.
--
-- Validator legality mirrors 0016_reply_resume_dedup.sql + 0015_action_cards.sql:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- the Paperclip host validator
--     (server/src/services/plugin-database.ts) requires fully qualified schema
--     names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / lookup key is an INLINE UNIQUE (...) inside CREATE
--     TABLE. The host extractQualifiedRefs regex does NOT recognize a standalone
--     create-index statement as a qualified ref, so non-unique indexes are
--     forbidden here; the inline UNIQUE produces the btree index the lookups
--     need.
--   - The validator allows create / alter / comment statements only -- no
--     procedural blocks, no DO blocks, no standalone create-index statement.
--   - COMMENT ON body text is apostrophe-free (the host stripSqlForKeywordScan
--     greedily pairs a lone apostrophe across statements and swallows the
--     leading keyword -- see 0004 / the ddl-prefix-validator regression test).
--
-- Next number is 0017 (highest on disk is 0016; 0012 is absent on disk -- that
-- gap is harmless and is NOT reused here).

-- ---------------------------------------------------------------------------
-- own_operation_issues (D-03) -- durable own-operation provenance table.
-- ---------------------------------------------------------------------------
-- One row per (company_id, issue_id) for every issue Clarity itself authored
-- (operation issues, op-issue plumbing). The ingress event gate reads this row
-- BEFORE any wake/enqueue so that the plugin never reacts to its own writes --
-- the durable backstop for the in-memory op-issue set that empties on every
-- worker restart (op-issue-set.ts) and caused the 2026-06-04 loop storm.
-- UNIQUE (company_id, issue_id) is the idempotency key and produces the btree
-- index covering the provenance lookup (WHERE company_id = $1 AND issue_id = $2).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.own_operation_issues (
  id          bigserial PRIMARY KEY,
  company_id  text NOT NULL,
  issue_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, issue_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.own_operation_issues IS
  'Durable own-operation provenance (D-03). One row per (company_id, issue_id) for every issue Clarity itself authored. The ingress event gate reads this BEFORE any wake so the plugin never reacts to its own writes -- the restart-safe backstop for the in-memory op-issue set that empties on worker restart (2026-06-04 loop incident). UNIQUE(company_id, issue_id) = idempotency + provenance lookup index. Additive plugin-namespace table -- plugin disable leaves data intact.';

-- ---------------------------------------------------------------------------
-- wake_ledger (D-06) -- sliding-window wake ledger (throughput governor source).
-- ---------------------------------------------------------------------------
-- One row per recorded wake. The trailing-60s row count for a company IS the
-- current wake rate. The repo prunes rows older than the window alongside each
-- append, so with a ceiling of a handful of wakes per minute the table stays a
-- few dozen rows at most -- self-draining, no cron, no extra index needed (a
-- seq scan over a tiny self-pruned table is fine; an inline index would violate
-- the host validator standalone-create-index rule anyway).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.wake_ledger (
  id          bigserial PRIMARY KEY,
  company_id  text NOT NULL,
  woke_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.wake_ledger IS
  'Sliding-window wake ledger (D-06). One row per recorded wake; the trailing-60s row count per company is the current wake rate. The repo prunes rows older than the window beside each append so the table self-drains to a few dozen rows -- no cron, no index. Additive plugin-namespace table -- plugin disable leaves data intact.';

-- ---------------------------------------------------------------------------
-- wake_kill_switch (D-08) -- durable, version-scoped, operator-clear-only switch.
-- ---------------------------------------------------------------------------
-- One row per company. When the wake rate exceeds the ceiling the governor
-- engages the switch (engaged = true) and it persists across a worker restart
-- (the failure mode the in-memory guards had). plugin_version scopes the read so
-- a corrected build is NOT dead-on-arrival against a row that a pre-fix build
-- tripped (Open Question #3 = YES). There is NO auto-clear path in worker code:
-- clearing is an explicit operator gesture only (governance parity with the
-- circuit breaker, coexistence #4). UNIQUE (company_id) is the ON CONFLICT
-- DO UPDATE target for the atomic engage upsert.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.wake_kill_switch (
  id             bigserial PRIMARY KEY,
  company_id     text NOT NULL,
  engaged        boolean NOT NULL DEFAULT false,
  engaged_at     timestamptz,
  reason         text,
  plugin_version text,
  UNIQUE (company_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.wake_kill_switch IS
  'Durable wake kill-switch (D-08). One row per company; engaged persists across worker restart (the failure mode the in-memory guards had). plugin_version scopes the read so a corrected build is not DOA against a pre-fix tripped row (Open Q #3 = YES). No auto-clear in worker code -- clearing is an operator gesture only (governance parity, coexistence #4). UNIQUE(company_id) is the ON CONFLICT DO UPDATE atomic-engage target. Additive plugin-namespace table -- plugin disable leaves data intact.';
