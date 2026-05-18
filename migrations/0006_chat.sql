-- 0006_chat.sql
-- Plan 04-02 -- Employee Chat data layer: chat_topics maps each CHT-NN topic
-- to exactly one Paperclip issue (metadata only, never message content per
-- CHAT-02); chat_messages is the D-09 side table mapping the client
-- message_uuid to the host comment_id, carrying the D-11 supersedes link and
-- the D-13 pin flag (no body column -- content lives only in
-- public.issue_comments); chat_employee_parents maps each employee-agent to
-- its single Chat parent issue so the first-ever topic create resolves the
-- parent in O(1) (D-05, BLOCKER-3 discovery mechanism).
--
-- All DDL targets the deterministic plugin namespace
-- plugin_clarity_pack_cdd6bda4bd literally per 02-01 SMOKE-FINDINGS.md
-- Finding #4. The Paperclip host validator requires fully-qualified schema
-- names -- there is NO template substitution. COMMENT ON statements may be
-- unqualified; all other DDL must be qualified.
--
-- The Paperclip plugin-SQL validator rejects anonymous procedural blocks
-- (case-insensitive match on a DO dollar-quoted pattern), discovered during
-- the Plan 02-04 install on Countermoves 2026-05-14. No procedural blocks
-- are used here; CREATE TABLE IF NOT EXISTS provides idempotency.
--
-- APOSTROPHE HAZARD: the host validator strips SQL string literals with a
-- greedy regex before classifying each statement. An odd apostrophe inside
-- a line comment pairs with the opening quote of the first real string
-- literal and swallows the leading CREATE keyword, so the statement is
-- rejected as non-DDL. Keep migration comments apostrophe-free.
--
-- NO STANDALONE CREATE INDEX: the host extractQualifiedRefs has no pattern
-- for a standalone CREATE INDEX, so it yields zero qualified refs and is
-- rejected with the fully-qualified-schema-names error. The access paths
-- that matter are indexed by the inline PRIMARY KEY / UNIQUE constraints
-- (validator-supported inside CREATE TABLE); at chat scale no extra indexes
-- are needed.
--
-- NO TRAILING COMMENTS: the host splitSqlStatements treats any non-empty
-- text after the final semicolon as a statement; a comment-only trailing
-- block normalizes to empty and is rejected. The file must end on a
-- semicolon-terminated statement.
--
-- Regression test: test/migrations/0006-chat-schema.test.mjs +
-- test/migrations/no-procedural-blocks.test.mjs +
-- test/migrations/ddl-prefix-validator.test.mjs.

-- ---------------------------------------------------------------------------
-- chat_topics -- CHAT-03 topic metadata.
-- ---------------------------------------------------------------------------
-- Each CHT-NN topic is a child issue under a per-employee parent issue
-- (D-05). This table holds metadata ONLY -- the topic id, the child issue
-- id, the parent issue id, the assigned employee-agent, the title, the
-- last-activity timestamp, and an archived flag. Message content never
-- lives here (CHAT-02); it lives in public.issue_comments on issue_id.
-- UNIQUE (company_id, issue_id) keeps one topic row per issue and is the
-- key the stream-bridge isChatTopicIssue filter looks up.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_topics (
  topic_id          text PRIMARY KEY,
  company_id        text NOT NULL,
  issue_id          text NOT NULL,
  parent_issue_id   text NOT NULL,
  employee_agent_id text NOT NULL,
  title             text NOT NULL,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, issue_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics IS
  'CHAT-03 topic metadata. Maps each CHT-NN topic to one child topic issue (D-05); metadata only, never message content (CHAT-02). UNIQUE (company_id, issue_id) is the isChatTopicIssue lookup key.';

-- ---------------------------------------------------------------------------
-- chat_messages -- D-09 idempotency / supersedes / pin side table.
-- ---------------------------------------------------------------------------
-- The Phase 4 spike (RESEARCH D-09) resolved that ctx.issues.createComment
-- accepts no metadata field and public.issue_comments has no supersedes
-- column. This side table is therefore MANDATORY, not a fallback. It maps
-- the client-generated message_uuid (CHAT-06 idempotency key) to the host
-- comment_id, carries the D-11 edit-chain supersedes_uuid link and the D-13
-- pin flag. It has NO body column -- message content lives only in
-- public.issue_comments (CHAT-02 invariant). Dedup on send keys on the
-- message_uuid PRIMARY KEY with ON CONFLICT DO NOTHING so a half-succeeded
-- optimistic-send retry returns the original row instead of double-posting.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_messages (
  message_uuid      text PRIMARY KEY,
  company_id        text NOT NULL,
  topic_issue_id    text NOT NULL,
  comment_id        text,
  sender_kind       text NOT NULL CHECK (sender_kind IN ('user','agent')),
  supersedes_uuid   text,
  pinned            boolean NOT NULL DEFAULT false,
  sent_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.chat_messages IS
  'D-09 idempotency side table. Maps message_uuid (CHAT-06 key) to the host comment_id; carries the D-11 supersedes link and D-13 pin flag. NO body column -- content lives only in public.issue_comments (CHAT-02).';

-- ---------------------------------------------------------------------------
-- chat_employee_parents -- D-05 per-employee parent-issue map.
-- ---------------------------------------------------------------------------
-- Each employee-agent has exactly one Chat parent issue; every CHT-NN topic
-- is a child issue under it. This table is the O(1) discovery mechanism the
-- chat.topic.create flow uses (BLOCKER-3): resolve the parent issue id for
-- (company_id, employee_agent_id) before creating the child topic issue.
-- The composite PRIMARY KEY guarantees one parent issue per employee per
-- company; an ON CONFLICT DO NOTHING insert makes the first-ever-topic
-- create race-safe -- two concurrent first creates both end up pointing at
-- the same parent issue.

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_employee_parents (
  company_id        text NOT NULL,
  employee_agent_id text NOT NULL,
  parent_issue_id   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_agent_id)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.chat_employee_parents IS
  'D-05 per-employee parent-issue map. Composite PK (company_id, employee_agent_id) gives each employee exactly one Chat parent issue; ON CONFLICT DO NOTHING insert makes first-ever-topic creation race-safe (BLOCKER-3).';
