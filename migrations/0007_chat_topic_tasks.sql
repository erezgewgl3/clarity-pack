-- 0007_chat_topic_tasks.sql
-- Plan 04.1-05 -- D-08 active-tasks lookup side table.
--
-- Wave 1 lock per .planning/phases/04.1-chat-true-task/04.1-01-SPIKE-FINDINGS.md
-- PROBE-OQ2-FILTER (verdict WEAK / REST-LIMIT): the host REST issues.list
-- surface silently ignores originId / originIdPrefix filters (returns the
-- 500-row cap regardless; exact-match returns 0 even when the row exists).
-- The active-tasks-per-topic query therefore CANNOT depend on origin-based
-- filtering -- this side table is the steady-state lookup path.
--
-- createTrueTask (Plan 04.1-02) writes a row here on every successful task
-- create (best-effort retrofit per the Plan 04.1-05 prompt scope refinement;
-- the write is wrapped try/catch + warn-log and NEVER bubbles, consistent
-- with the marker-comment best-effort discipline). chat.taskOwned reads via
-- listChatTopicTasksForTopic + per-row ctx.issues.get for current metadata.
--
-- All DDL targets the deterministic plugin namespace
-- plugin_clarity_pack_cdd6bda4bd literally per 02-01 SMOKE-FINDINGS.md
-- Finding #4 (the Paperclip host validator requires fully-qualified schema
-- names; no template substitution).
--
-- Validator constraints honored (matches 0006_chat.sql):
--   - apostrophe-free comments (greedy string-literal strip hazard);
--   - no anonymous procedural blocks (DO dollar-quoted patterns rejected);
--   - no standalone CREATE INDEX (host extractQualifiedRefs has no pattern);
--     necessary index lives inline as a column constraint;
--   - file ends on a semicolon-terminated statement (no trailing comment).
--
-- Additive-only per CLAUDE.md coexistence guarantee #3: only CREATE TABLE IF
-- NOT EXISTS in the plugin namespace; NEVER touches public.*.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_topic_tasks (
  id              bigserial PRIMARY KEY,
  company_id      text NOT NULL,
  topic_issue_id  text NOT NULL,
  task_issue_id   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, topic_issue_id, task_issue_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.chat_topic_tasks IS
  'Plan 04.1-05 D-08 -- chat topic to true-task back-link side table. Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ2: REST originId filters do not work, so this side table is the steady-state active-tasks lookup path. UNIQUE (company_id, topic_issue_id, task_issue_id) supports the createTrueTask retrofit ON CONFLICT DO NOTHING write and serves the listChatTopicTasksForTopic query (company-scoped, newest-first, LIMIT 50).';
