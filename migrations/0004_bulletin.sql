-- 0004_bulletin.sql
-- Plan 03-01 — Daily Bulletin foundation: bulletins metadata (canonical
-- body lives in public.issues per D-16); bulletin_errata first-class
-- append-only (D-18); clarity_department_membership reconciled at cycle
-- start (D-20); bulletin_compile_failures for the failed-compile banner
-- state machine (D-22).
--
-- All DDL targets the deterministic plugin namespace
-- plugin_clarity_pack_cdd6bda4bd literally per 02-01 SMOKE-FINDINGS.md
-- Finding #4. The Paperclip host validator requires fully-qualified schema
-- names -- there is NO template substitution. COMMENT ON statements may be
-- unqualified; all other DDL must be qualified.
--
-- The Paperclip plugin-SQL validator rejects anonymous procedural blocks
-- (case-insensitive match on `DO $$ ... $$` patterns), discovered during
-- the Plan 02-04 install on Countermoves 2026-05-14. No procedural blocks
-- are used here; CREATE TABLE IF NOT EXISTS provides idempotency.
--
-- APOSTROPHE HAZARD: the host validator strips SQL string literals with a
-- greedy regex before classifying each statement. An odd apostrophe inside
-- a `--` comment pairs with the opening quote of the first real string
-- literal and swallows the leading CREATE keyword, so the statement is
-- rejected as non-DDL. Keep migration comments apostrophe-free.
--
-- NO STANDALONE CREATE INDEX: the host extractQualifiedRefs has no pattern
-- for `CREATE INDEX ... ON schema.table`, so a standalone CREATE INDEX
-- yields zero qualified refs and is rejected with `Plugin migration objects
-- must use fully qualified schema names`. The access paths that matter are
-- indexed by the inline PRIMARY KEY / UNIQUE constraints (validator-supported
-- inside CREATE TABLE); at Daily Bulletin scale (~365 bulletins rows a year)
-- no extra indexes are needed.
--
-- NO TRAILING COMMENTS: the host splitSqlStatements treats any non-empty
-- text after the final `;` as a statement; a comment-only trailing block
-- normalizes to empty and is rejected. The file must end on a `;`-terminated
-- statement.
--
-- Both CREATE INDEX removal + the apostrophe fix surfaced in the Plan 03-03
-- Countermoves drill 2026-05-15.
-- Regression test: test/migrations/0004-bulletin-schema.test.mjs +
-- test/migrations/no-procedural-blocks.test.mjs +
-- test/migrations/ddl-prefix-validator.test.mjs.

-- ---------------------------------------------------------------------------
-- bulletins — D-17 bulletin metadata.
-- ---------------------------------------------------------------------------
-- The canonical bulletin BODY lives in public.issues (D-16) so a plugin
-- disable leaves every prior bulletin searchable in classic Paperclip. This
-- table holds metadata only: cycle number, the worker-managed next_due_at,
-- compile/verify/publish timestamps, the published-issue FK, the compile
-- status, the idempotency content_hash, and two structured-data columns
-- (lineage_thread_json + draft_json). draft_json is the W3/W4 contract: it
-- holds the verified structured BulletinDraft so the bulletin UI reads typed
-- props with no markdown re-parser.
-- UNIQUE (next_due_at, content_hash) is the D-13 idempotency key: re-firing
-- the same next_due_at with the same input hash is a server-side no-op.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletins (
  cycle_number          bigint PRIMARY KEY,
  company_id            text NOT NULL,
  next_due_at           timestamptz NOT NULL,
  compiled_at           timestamptz,
  verified_at           timestamptz,
  published_at          timestamptz,
  published_issue_id    text,
  compile_status        text NOT NULL CHECK (compile_status IN ('pending','attempting','verified','published','failed')),
  content_hash          text NOT NULL,
  lineage_thread_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (next_due_at, content_hash)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.bulletins IS
  'D-17 bulletin metadata. Canonical body lives in the host issues table (D-16); draft_json holds the verified structured BulletinDraft (W3/W4). UNIQUE (next_due_at, content_hash) is the D-13 idempotency key.';

-- ---------------------------------------------------------------------------
-- bulletin_errata — D-18 first-class append-only errata.
-- ---------------------------------------------------------------------------
-- Errata never rewrite a published bulletin issue body. They are stored
-- here and rendered as a footer block; on the NEXT cycle compile, the prior
-- cycle errata are appended to the prior issue as a comment (the
-- applied_to_issue_comment_id back-reference is set at that point).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_errata (
  id                          bigserial PRIMARY KEY,
  bulletin_cycle_number       bigint NOT NULL,
  added_at                    timestamptz NOT NULL DEFAULT now(),
  added_by_user_id            text NOT NULL,
  body_md                     text NOT NULL,
  applied_to_issue_comment_id text
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.bulletin_errata IS
  'D-18 first-class append-only errata. Footer-render only; appended as an issue comment on the next compile cycle, never inline-rewriting the body.';

-- ---------------------------------------------------------------------------
-- clarity_department_membership — D-20 department reconcile.
-- ---------------------------------------------------------------------------
-- Maps a Paperclip employee to a Daily Bulletin department section. Populated
-- by an idempotent reconcile pass on the first compile of each cycle (role-
-- label regex; Builder fallback). The source column lets manual overrides
-- survive a reconcile re-run -- the reconcile path UPSERTs with
-- ON CONFLICT DO NOTHING so a manual-source row is never clobbered.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_department_membership (
  company_id            text NOT NULL,
  employee_user_id      text NOT NULL,
  department            text NOT NULL,
  source                text NOT NULL CHECK (source IN ('reconcile','manual')),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_user_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.clarity_department_membership IS
  'D-20 department membership for the Daily Bulletin. Reconciled at cycle start by role-label regex; manual-source rows survive reconcile.';

-- ---------------------------------------------------------------------------
-- bulletin_compile_failures — D-22 failed-compile banner state.
-- ---------------------------------------------------------------------------
-- Every compile failure (LLM threw, verifier rejected 3x, SQL error in a
-- standing number) writes a row here. The bulletin UI reads the most recent
-- row and renders the failed-compile banner when next_retry_at is still in
-- the future. After 3 retries the Editor-Agent circuit breaker pauses.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures (
  id                    bigserial PRIMARY KEY,
  cycle_number          bigint NOT NULL,
  failed_at             timestamptz NOT NULL DEFAULT now(),
  reason                text NOT NULL,
  attempt_n             int NOT NULL,
  next_retry_at         timestamptz NOT NULL
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures IS
  'D-22 failed-compile banner state. UI reads the latest row; banner shows while next_retry_at > now.';
