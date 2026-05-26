// src/worker/db/chat-topics-repo.ts
//
// Plan 04-02 — typed CRUD repo for the three 0006_chat.sql tables
// (chat_topics, chat_messages, chat_employee_parents). Mirrors the
// src/worker/db/bulletins-repo.ts shape exactly: every function takes a
// `ChatTopicsRepoCtx` ({ db }) as its first argument, and every SQL string is
// fully-qualified against the deterministic plugin namespace
// plugin_clarity_pack_cdd6bda4bd (02-01 Finding #4 — no template substitution).
//
// HOST CONTRACT (SDK PluginDatabaseClient): ctx.db.query is SELECT-only;
// ctx.db.execute returns only { rowCount } — no rows, so RETURNING is
// unavailable. Every write is `execute` an INSERT/UPDATE, then `query` a
// SELECT to read the row back. wrapHostFaithfulDb enforces this in tests.
//
// Idempotency: inserts that must dedupe use `ON CONFLICT ... DO NOTHING` keyed
// on the table's PK/UNIQUE constraint, so a half-succeeded optimistic-send
// retry (CHAT-06 / D-10) returns the original row instead of double-posting,
// and a racing first-ever-topic create resolves to the same parent issue
// (D-05 / BLOCKER-3).
//
// CHAT-02 invariant: chat_messages stores ID-mapping metadata ONLY (the
// message_uuid -> comment_id map, the supersedes link, the pin flag). It never
// stores message `body` — message content lives only in public.issue_comments.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type ChatTopicsRepoCtx = {
  db: PluginDatabaseClient;
};

/** A chat_topics row — CHT-NN topic metadata. snake_case mirrors the SQL. */
export type ChatTopicRow = {
  topic_id: string; // CHT-NN, per-company sequential
  company_id: string;
  issue_id: string; // the child topic issue
  parent_issue_id: string; // the per-employee Chat parent issue
  employee_agent_id: string;
  title: string;
  last_activity_at: string; // ISO
  archived: boolean;
  created_at: string; // ISO
  /** Plan 04.1-08 — when this topic was archived. NULL when never archived
   *  or when actively unarchived. Powers the archive panel's
   *  ORDER BY archived_at DESC sort. Added by migration 0008. */
  archived_at?: string | null;
  /** Plan 04.2-01 (RCB-04) — the Paperclip issue this topic was started from
   *  via the Reader-view Continue-in-chat -> new-topic flow. NULL for topics
   *  created the ordinary way (pre-0009 rows + button-less Readers). Added by
   *  migration 0009. The repo writes it via insertChatTopic's OPTIONAL
   *  `originIssueId` field; listChatTopicsByOriginIssue reads it. */
  origin_issue_id?: string | null;
  /** Plan 05-08 (D-20) — non-NULL when the topic is PINNED (Storage-pin =
   *  exempt from archive). Added by migration 0010. The repo writes it via
   *  setChatTopicPinned; isChatTopicPinned reads it; the chat.topic.archive
   *  handler returns { error: 'PIN_EXEMPT' } when a caller tries to archive
   *  a pinned topic. NULL for every pre-0010 row. */
  pinned_at?: string | null;
};

/**
 * Plan 04.2-01 (RCB-04 / RCB-06) — a chat topic as the Reader reverse-topics
 * list consumes it (issue-reader.ts `topicsForIssue` + the ReverseTopicsLink
 * popover). camelCase shape; mapped from a ChatTopicRow.
 *
 * Plan 04.2-07 (D-02) — extended with optional `employeeAgentId` so the
 * popover's same-assignee filter (`filterToAssignee`) can match without a
 * second round-trip. Field is optional so pre-04.2-07 cached payloads still
 * type-check; the filter degrades to "show all" when absent.
 */
export type ChatTopicByOriginEntry = {
  topicIssueId: string;
  topicId: string;
  title: string;
  lastActivityAt: string;
  employeeAgentId?: string;
};

/** A chat_messages row — D-09 idempotency / supersedes / pin side table. */
export type ChatMessageRow = {
  message_uuid: string; // client-generated idempotency key (CHAT-06)
  company_id: string;
  topic_issue_id: string;
  comment_id: string | null; // host issue_comments.id; null until confirmed
  sender_kind: 'user' | 'agent';
  supersedes_uuid: string | null; // D-11 edit chain; null = original
  pinned: boolean;
  sent_at: string; // ISO
};

/** A chat_employee_parents row — D-05 per-employee parent-issue map. */
export type ChatEmployeeParentRow = {
  company_id: string;
  employee_agent_id: string;
  parent_issue_id: string;
  created_at: string; // ISO
};

/**
 * Plan 05-11 (CHAT-07 gap closure) -- one chat_message_attachments row.
 *
 * Links a chat_messages row (FK on chat_message_id -> message_uuid) to a
 * single attachment document in the plugin-owned issue_documents store
 * (document_key returned by ctx.issues.documents.upsert). The denormalized
 * topic_issue_id saves a join on the list-by-topic hot path. Upload-on-send
 * semantics (Option B): chat.send persists chat_messages first; the per-file
 * chat.attachment.upload commits this row after with the just-returned
 * message_uuid -- the FK always references a real, already-committed row,
 * so standard (non-DEFERRABLE) FK is sufficient (migration 0011).
 */
export type ChatMessageAttachmentRow = {
  id: string;
  company_id: string;
  topic_issue_id: string;
  chat_message_id: string;
  comment_id: string | null;
  document_key: string;
  mime_type: string;
  original_filename: string;
  byte_size: number;
  created_at: string; // ISO
};

const CHAT_TOPIC_COLS =
  'topic_id, company_id, issue_id, parent_issue_id, employee_agent_id, ' +
  'title, last_activity_at, archived, created_at';

const CHAT_MESSAGE_COLS =
  'message_uuid, company_id, topic_issue_id, comment_id, sender_kind, ' +
  'supersedes_uuid, pinned, sent_at';

const CHAT_EMPLOYEE_PARENT_COLS =
  'company_id, employee_agent_id, parent_issue_id, created_at';

const CHAT_MESSAGE_ATTACHMENT_COLS =
  'id, company_id, topic_issue_id, chat_message_id, comment_id, ' +
  'document_key, mime_type, original_filename, byte_size, created_at';

// ---------------------------------------------------------------------------
// chat_topics
// ---------------------------------------------------------------------------

/**
 * Insert a chat_topics row, then read it back. The INSERT carries
 * `ON CONFLICT (company_id, issue_id) DO NOTHING` so a re-fired topic create
 * is a server-side no-op; the read-back is keyed on (company_id, issue_id) and
 * always returns a row.
 *
 * Plan 04.2-01 (RCB-04) — the `row` argument may carry an OPTIONAL
 * `originIssueId` field. When present it is written into the migration-0009
 * `origin_issue_id` column; when absent (every pre-04.2-01 call site) the
 * column is written NULL. The field is optional on `ChatTopicRow` so existing
 * callers compile unchanged (RCB-07 back-compat).
 */
export async function insertChatTopic(
  ctx: ChatTopicsRepoCtx,
  row: ChatTopicRow & { originIssueId?: string | null },
): Promise<ChatTopicRow> {
  const originIssueId =
    typeof row.originIssueId === 'string' && row.originIssueId
      ? row.originIssueId
      : row.origin_issue_id ?? null;
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_topics
       (${CHAT_TOPIC_COLS}, origin_issue_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (company_id, issue_id) DO NOTHING`,
    [
      row.topic_id,
      row.company_id,
      row.issue_id,
      row.parent_issue_id,
      row.employee_agent_id,
      row.title,
      row.last_activity_at,
      row.archived,
      row.created_at,
      originIssueId,
    ],
  );

  const existing = await getChatTopicByIssueId(ctx, row.company_id, row.issue_id);
  return existing ?? row;
}

/**
 * Read a single chat_topics row by (company_id, issue_id). This is the
 * `isChatTopicIssue` lookup the 04-03 stream bridge uses to decide whether a
 * comment event belongs to a chat topic. Returns null when no row matches.
 */
export async function getChatTopicByIssueId(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  issueId: string,
): Promise<ChatTopicRow | null> {
  const rows = await ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1 AND issue_id = $2
     LIMIT 1`,
    [companyId, issueId],
  );
  return rows[0] ?? null;
}

/**
 * List every chat topic for one employee-agent, company-scoped, most-recently
 * active first. Powers the topic strip in the chat surface.
 *
 * Plan 04.2-01 (RCB-05) — the SELECT also pulls the migration-0009
 * `origin_issue_id` column so the topic strip can render the
 * `About <COU-NNNN> ↗` backlink chip on the active topic. Topics created the
 * ordinary way (and every pre-0009 row) carry NULL there — the chip is then
 * simply not rendered.
 *
 * Plan 05-08 (D-20 carrier) — the SELECT also pulls the migration-0010
 * `pinned_at` column so the chat.topics handler can surface pinnedAt on
 * every returned topic. The right-rail Storage pin card reads it.
 */
export async function listChatTopicsForEmployee(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  employeeAgentId: string,
): Promise<ChatTopicRow[]> {
  return ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}, origin_issue_id, pinned_at
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1 AND employee_agent_id = $2
     ORDER BY last_activity_at DESC`,
    [companyId, employeeAgentId],
  );
}

/**
 * Plan 04.2-01 (RCB-04 / RCB-06) — list every chat topic that was started
 * from one source Paperclip issue (origin_issue_id match), company-scoped,
 * most-recently-active first. Mirrors listChatTopicTasksForTopic's
 * newest-first SELECT shape. Powers issue-reader.ts's `topicsForIssue`
 * field and, through it, the Reader header's `<N> conversations about this
 * issue` reverse list. Returns the camelCase ChatTopicByOriginEntry shape so
 * the handler can ship it to the UI without a second mapping pass.
 */
export async function listChatTopicsByOriginIssue(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  originIssueId: string,
): Promise<ChatTopicByOriginEntry[]> {
  const rows = await ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}, origin_issue_id
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1 AND origin_issue_id = $2
     ORDER BY last_activity_at DESC`,
    [companyId, originIssueId],
  );
  return rows.map((r) => ({
    topicIssueId: r.issue_id,
    topicId: r.topic_id,
    title: r.title,
    lastActivityAt: r.last_activity_at,
    employeeAgentId: r.employee_agent_id,
  }));
}

/**
 * Plan 04.2-07 (D-01 step 2) — list every chat topic that was started from
 * one source Paperclip issue AND is owned by one specific employee-agent,
 * company-scoped. INCLUDES archived rows (D-04: the resolver silently
 * unarchives on single-match resume; the candidate-picker shows archived
 * topics with their archived flag so the operator can choose deliberately).
 *
 * D-05 sort order: most recent activity DESC, tiebroken with the latest
 * message timestamp from `chat_messages` so a topic with a fresh inbound
 * comment beats a topic whose `last_activity_at` is stale. Column is
 * `chat_messages.sent_at` per CHAT_MESSAGE_COLS — NOT `created_at`.
 *
 * No new migration — schema already has both `origin_issue_id`
 * (migration 0009) and `employee_agent_id` (migration 0006). Read-only.
 */
export async function listTopicsForIssueAndAssignee(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  originIssueId: string,
  employeeAgentId: string,
): Promise<
  Array<{
    topicIssueId: string;
    topicId: string;
    title: string;
    lastActivityAt: string;
    archived: boolean;
  }>
> {
  const rows = await ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}, origin_issue_id
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1
       AND origin_issue_id = $2
       AND employee_agent_id = $3
     ORDER BY GREATEST(
       chat_topics.last_activity_at,
       COALESCE(
         (SELECT MAX(m.sent_at)
            FROM plugin_clarity_pack_cdd6bda4bd.chat_messages m
           WHERE m.topic_issue_id = chat_topics.issue_id
             AND m.company_id = chat_topics.company_id),
         chat_topics.last_activity_at
       )
     ) DESC`,
    [companyId, originIssueId, employeeAgentId],
  );
  return rows.map((r) => ({
    topicIssueId: r.issue_id,
    topicId: r.topic_id,
    title: r.title,
    lastActivityAt: r.last_activity_at,
    archived: r.archived === true,
  }));
}

/**
 * Allocate the next per-company sequential CHT-NN topic id. Mirrors
 * upsertBulletin's `MAX(...) + 1` allocator: the numeric suffix of every
 * `topic_id` for the company is taken, MAX is computed, and the result is
 * `CHT-<max + 1>` (first ever = `CHT-1`). The SELECT is company-scoped so
 * another company's topics never bump this counter.
 *
 * NOTE: this is not transactionally race-free on its own — two concurrent
 * allocations could pick the same number. The `chat_topics` UNIQUE
 * (company_id, issue_id) + the topic_id PRIMARY KEY are the backstop; the
 * 04-03 topic-create handler retries on a collision.
 */
export async function allocateChtNumber(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
): Promise<string> {
  const rows = await ctx.db.query<{ max_n: number | string | null }>(
    `SELECT MAX(CAST(substring(topic_id FROM 5) AS bigint)) AS max_n
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1`,
    [companyId],
  );
  // GAP 5 — the SELECT CASTs to `bigint`, and the node-postgres driver returns
  // bigint columns as STRINGS. A bare `(rows[0]?.max_n ?? 0) + 1` then does
  // string concatenation: "1" + 1 = "11", "11" + 1 = "111" — CHT-1, CHT-11,
  // CHT-111 instead of CHT-1, CHT-2, CHT-3. Number(...) coerces the
  // string-or-number-or-null max into a real number before the increment.
  const next = Number(rows[0]?.max_n ?? 0) + 1;
  return `CHT-${next}`;
}

// ---------------------------------------------------------------------------
// chat_messages — D-09 idempotency / supersedes / pin side table
// ---------------------------------------------------------------------------

/**
 * Insert a chat_messages id-map row, then read it back. The INSERT carries
 * `ON CONFLICT (message_uuid) DO NOTHING` (CHAT-06 dedup): a duplicate send —
 * e.g. an optimistic-send Retry whose round-trip ack was lost (D-10) — is a
 * server-side no-op, and the read-back returns the ORIGINAL row so callers
 * dedupe instead of double-posting.
 */
export async function insertChatMessage(
  ctx: ChatTopicsRepoCtx,
  row: ChatMessageRow,
): Promise<ChatMessageRow> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_messages
       (${CHAT_MESSAGE_COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_uuid) DO NOTHING`,
    [
      row.message_uuid,
      row.company_id,
      row.topic_issue_id,
      row.comment_id,
      row.sender_kind,
      row.supersedes_uuid,
      row.pinned,
      row.sent_at,
    ],
  );

  const existing = await getChatMessageByUuid(ctx, row.company_id, row.message_uuid);
  return existing ?? row;
}

/**
 * Read a chat_messages row by (company_id, message_uuid). This is the
 * dedup-on-send lookup: if a row exists the send already landed (or
 * half-landed) — return that row, do not re-createComment. Returns null when
 * no row matches. Company-scoped so a message never leaks across companies.
 */
export async function getChatMessageByUuid(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  messageUuid: string,
): Promise<ChatMessageRow | null> {
  const rows = await ctx.db.query<ChatMessageRow>(
    `SELECT ${CHAT_MESSAGE_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_messages
     WHERE message_uuid = $1 AND company_id = $2
     LIMIT 1`,
    [messageUuid, companyId],
  );
  return rows[0] ?? null;
}

/**
 * Flip the pin flag on a chat_messages row (D-13 — pin is a chat-metadata
 * flag, not a host concept). Company-scoped so a pin never crosses companies.
 */
export async function updateChatMessagePinned(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  messageUuid: string,
  pinned: boolean,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.chat_messages
     SET pinned = $1
     WHERE message_uuid = $2 AND company_id = $3`,
    [pinned, messageUuid, companyId],
  );
}

/**
 * Plan 04.1-05 / D-10 — plugin-side archive. Sets `chat_topics.archived` for
 * ONE topic; does NOT touch host issue status (that would re-engage the
 * disposition machinery via the host's recovery service — see PROBE-OQ3
 * attempt 2 in 04.1-01-SPIKE-FINDINGS). Company-scoped so an archive never
 * crosses companies.
 *
 * Plan 04.1-08 — also stamps `archived_at` so the archive panel can sort
 * newest-archived-first. SET archived_at = now() on archive; NULL on
 * un-archive. The column was added by migration 0008
 * (additive-only per CLAUDE.md coexistence guarantee #3).
 */
export async function setChatTopicArchived(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
  archived: boolean,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.chat_topics
     SET archived = $1,
         archived_at = CASE WHEN $1 = true THEN now() ELSE NULL END
     WHERE issue_id = $2 AND company_id = $3`,
    [archived, topicIssueId, companyId],
  );
}

/**
 * Plan 04.1-08 — list every ARCHIVED chat topic for one employee-agent,
 * company-scoped, sorted by archive time DESC (newest-archived first).
 *
 * Powers the archive panel (chat.archivedTopics data handler). Returns the
 * full ChatTopicRow shape so the handler can shape an ArchivedTopic for the
 * UI without a second round-trip; the message-count is computed separately
 * (the handler joins against public.issue_comments via a count subquery — or
 * uses 0 if the count query can't run).
 */
export async function listArchivedChatTopicsForEmployee(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  employeeAgentId: string,
): Promise<ChatTopicRow[]> {
  // ORDER BY: prefer archived_at DESC when available; fall back to
  // last_activity_at DESC (covers any rows archived before migration 0008
  // ran — their archived_at is NULL so they sort last).
  return ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}, archived_at
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1
       AND employee_agent_id = $2
       AND archived = true
     ORDER BY archived_at DESC NULLS LAST, last_activity_at DESC`,
    [companyId, employeeAgentId],
  );
}

/**
 * Plan 05-08 (D-20) — flip the pinned_at flag on one chat topic.
 *
 * Mirrors setChatTopicArchived byte-for-byte except the column written is
 * pinned_at (migration 0010). pinned=true stamps `now()`; pinned=false
 * clears to NULL. Company-scoped so a pin never crosses companies.
 *
 * Pinning makes a topic EXEMPT from archive: the chat.topic.archive
 * handler reads via isChatTopicPinned and returns { error: 'PIN_EXEMPT' }
 * when archive=true on a pinned row. This helper itself NEVER touches the
 * host issue — CTT-07 invariant (plugin actions never modify
 * public.issues.updated_at) holds by construction.
 */
export async function setChatTopicPinned(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
  pinned: boolean,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.chat_topics
     SET pinned_at = CASE WHEN $1 = true THEN now() ELSE NULL END
     WHERE issue_id = $2 AND company_id = $3`,
    [pinned, topicIssueId, companyId],
  );
}

/**
 * Plan 05-08 (D-20) — read the pinned state of one chat topic. Returns true
 * when the row's pinned_at IS NOT NULL; false when NULL OR the row is
 * absent. Used by the chat.topic.archive PIN_EXEMPT guard. SELECT-only,
 * single round-trip, company-scoped.
 */
export async function isChatTopicPinned(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
): Promise<boolean> {
  const rows = await ctx.db.query<{ pinned_at: string | null }>(
    `SELECT pinned_at
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE issue_id = $1 AND company_id = $2
     LIMIT 1`,
    [topicIssueId, companyId],
  );
  return rows[0]?.pinned_at != null;
}

/**
 * Plan 05-08 (D-16) — bulk-flip chat_topics.archived for an array of
 * topicIssueIds in a single round-trip. Used by the archive full-view's
 * bulk-unarchive button.
 *
 * The SQL guard `pinned_at IS NULL OR $1 = false` enforces the D-20
 * invariant inside the UPDATE itself: pinned topics CAN be UN-archived
 * (rare race; harmless), but a future bulk-ARCHIVE variant can never sweep
 * up a pinned row. This plan only ships bulk-UNARCHIVE (archived=false);
 * the archive direction stays single-row via the existing chat.topic.archive
 * handler with its own PIN_EXEMPT guard (Task 3).
 *
 * Empty input array short-circuits: returns { updated: 0 } without a DB
 * round-trip. Returns the host's reported rowCount (the number of rows the
 * UPDATE actually mutated).
 *
 * Plugin-namespace UPDATE only; CTT-07 invariant preserved by construction.
 */
export async function bulkSetChatTopicArchived(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueIds: string[],
  archived: boolean,
): Promise<{ updated: number }> {
  if (!Array.isArray(topicIssueIds) || topicIssueIds.length === 0) {
    return { updated: 0 };
  }
  const result = await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.chat_topics
     SET archived = $1,
         archived_at = CASE WHEN $1 = true THEN now() ELSE NULL END
     WHERE company_id = $2
       AND issue_id = ANY($3::text[])
       AND (pinned_at IS NULL OR $1 = false)`,
    [archived, companyId, topicIssueIds],
  );
  return { updated: result?.rowCount ?? 0 };
}

/**
 * Plan 05-08 (D-15) — list every ARCHIVED chat topic for one company,
 * across all employees. Powers the archive full-view page at
 * `/<companyPrefix>/archive`. Mirrors listArchivedChatTopicsForEmployee but
 * drops the employee_agent_id filter. Sort order is identical:
 * ORDER BY archived_at DESC NULLS LAST, last_activity_at DESC.
 *
 * SELECT also pulls the migration-0010 pinned_at column so the archive
 * full-view can render a 📌 indicator on pinned rows (D-20 carrier).
 */
export async function listAllArchivedChatTopics(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
): Promise<ChatTopicRow[]> {
  return ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}, archived_at, origin_issue_id, pinned_at
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1
       AND archived = true
     ORDER BY archived_at DESC NULLS LAST, last_activity_at DESC`,
    [companyId],
  );
}

/**
 * Read a chat_messages row by (company_id, comment_id). PITFALL #4: the
 * chat_messages side table is operator-write-only — chat.send inserts a row for
 * every operator message, but AGENT comments have NO row. So this lookup
 * returns null for an agent comment. Used by chat.pin / chat.promote which
 * resolve a message from the UI-supplied comment_id, not a message_uuid.
 */
export async function getChatMessageByCommentId(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  commentId: string,
): Promise<ChatMessageRow | null> {
  const rows = await ctx.db.query<ChatMessageRow>(
    `SELECT ${CHAT_MESSAGE_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_messages
     WHERE comment_id = $1 AND company_id = $2
     LIMIT 1`,
    [commentId, companyId],
  );
  return rows[0] ?? null;
}

/**
 * Pin (or un-pin) a chat message identified by its host comment_id, host-
 * faithfully across BOTH message kinds (GAP 12):
 *
 *   - OPERATOR comment — chat.send already inserted a chat_messages row, so an
 *     UPDATE WHERE comment_id flips its pin flag.
 *   - AGENT comment — has NO chat_messages row (PITFALL #4). The UPDATE matches
 *     0 rows, so we UPSERT a fresh row: a generated message_uuid, the comment_id,
 *     sender_kind 'agent', and the pin flag. The row exists only to carry the
 *     D-13 pin metadata — it stores no body (CHAT-02).
 *
 * Returns the surviving row so the caller can confirm the pin landed.
 */
export async function pinChatMessageByCommentId(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
  commentId: string,
  pinned: boolean,
): Promise<ChatMessageRow> {
  // 1. Try to update an existing row (the operator-message path).
  const updated = await ctx.db.execute(
    `UPDATE plugin_clarity_pack_cdd6bda4bd.chat_messages
     SET pinned = $1
     WHERE comment_id = $2 AND company_id = $3`,
    [pinned, commentId, companyId],
  );

  if (!updated || (updated.rowCount ?? 0) === 0) {
    // 2. No row — an agent comment. Insert a pin-only side-table row.
    const row: ChatMessageRow = {
      message_uuid: `pin-${commentId}`,
      company_id: companyId,
      topic_issue_id: topicIssueId,
      comment_id: commentId,
      sender_kind: 'agent',
      supersedes_uuid: null,
      pinned,
      sent_at: new Date().toISOString(),
    };
    await ctx.db.execute(
      `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_messages
         (${CHAT_MESSAGE_COLS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (message_uuid) DO UPDATE SET pinned = EXCLUDED.pinned`,
      [
        row.message_uuid,
        row.company_id,
        row.topic_issue_id,
        row.comment_id,
        row.sender_kind,
        row.supersedes_uuid,
        row.pinned,
        row.sent_at,
      ],
    );
  }

  const surviving = await getChatMessageByCommentId(ctx, companyId, commentId);
  return (
    surviving ?? {
      message_uuid: `pin-${commentId}`,
      company_id: companyId,
      topic_issue_id: topicIssueId,
      comment_id: commentId,
      sender_kind: 'agent',
      supersedes_uuid: null,
      pinned,
      sent_at: new Date().toISOString(),
    }
  );
}

// ---------------------------------------------------------------------------
// chat_employee_parents — D-05 / BLOCKER-3 parent-issue resolution
// ---------------------------------------------------------------------------

/**
 * Read the single Chat parent issue id for an employee-agent. This is the O(1)
 * discovery the 04-03 `chat.topic.create` flow uses before creating a child
 * topic issue. Returns null when the employee has no parent issue yet (the
 * first-ever-topic bootstrap signal).
 */
export async function getEmployeeParentIssueId(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  employeeAgentId: string,
): Promise<string | null> {
  const rows = await ctx.db.query<{ parent_issue_id: string }>(
    `SELECT parent_issue_id
     FROM plugin_clarity_pack_cdd6bda4bd.chat_employee_parents
     WHERE company_id = $1 AND employee_agent_id = $2
     LIMIT 1`,
    [companyId, employeeAgentId],
  );
  return rows[0]?.parent_issue_id ?? null;
}

/**
 * Insert the per-employee parent-issue map row, then read back the SURVIVING
 * parent_issue_id. The INSERT carries `ON CONFLICT (company_id,
 * employee_agent_id) DO NOTHING`: if two concurrent first-ever-topic creates
 * race, the second insert is a no-op and the read-back returns the FIRST
 * winner — both creates then attach their child topic issues to the same
 * parent issue (D-05 / BLOCKER-3 race safety).
 */
export async function insertEmployeeParent(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  employeeAgentId: string,
  parentIssueId: string,
): Promise<string> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_employee_parents
       (${CHAT_EMPLOYEE_PARENT_COLS})
     VALUES ($1, $2, $3, now())
     ON CONFLICT (company_id, employee_agent_id) DO NOTHING`,
    [companyId, employeeAgentId, parentIssueId],
  );

  const surviving = await getEmployeeParentIssueId(ctx, companyId, employeeAgentId);
  return surviving ?? parentIssueId;
}

// ---------------------------------------------------------------------------
// chat_topic_tasks — Plan 04.1-05 D-08 active-tasks lookup side table
// ---------------------------------------------------------------------------
//
// Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER: the host REST
// `issues.list` surface silently ignores `originKind` + `originId` /
// `originIdPrefix` filters (returns the 500-row cap; exact-match returns 0
// even when the row exists). The active-tasks-per-topic query therefore
// CANNOT depend on origin-based filtering — the side table is the
// steady-state path. createTrueTask (Plan 04.1-02) writes a row here on
// every successful task create (best-effort, never bubbles); chat.taskOwned
// reads via listChatTopicTasksForTopic and enriches per-row via ctx.issues.get.
//
// The table is plugin-namespace-only (`migrations/0007_chat_topic_tasks.sql`)
// so coexistence guarantee #3 (additive-only) holds.

/**
 * Plan 04.1-05 D-08 — write the topic -> task back-link. The INSERT carries
 * `ON CONFLICT (company_id, topic_issue_id, task_issue_id) DO NOTHING` so a
 * cross-plan retrofit re-run (or a race with the createTrueTask helper's
 * best-effort write) is a server-side no-op. Race-safe, idempotent.
 */
export async function insertChatTopicTask(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
  taskIssueId: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_topic_tasks
       (company_id, topic_issue_id, task_issue_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, topic_issue_id, task_issue_id) DO NOTHING`,
    [companyId, topicIssueId, taskIssueId],
  );
}

/**
 * Plan 04.1-05 D-08 — list task issue ids spawned from one chat topic,
 * newest-first. Bounded by LIMIT 50 so a runaway topic cannot blow up the
 * UI. The caller is chat.taskOwned, which then fetches per-row metadata
 * via ctx.issues.get; this query is O(1) on the index `(company_id,
 * topic_issue_id, created_at DESC)`.
 */
export async function listChatTopicTasksForTopic(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
): Promise<string[]> {
  const rows = await ctx.db.query<{ task_issue_id: string }>(
    `SELECT task_issue_id
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topic_tasks
     WHERE company_id = $1 AND topic_issue_id = $2
     ORDER BY created_at DESC
     LIMIT 50`,
    [companyId, topicIssueId],
  );
  return rows.map((r) => r.task_issue_id);
}

// ---------------------------------------------------------------------------
// chat_message_attachments -- Plan 05-11 (CHAT-07 gap closure)
// ---------------------------------------------------------------------------
//
// Upload-on-send semantics (Option B, locked 2026-05-26): chat.send commits
// the chat_messages row FIRST; chat.attachment.upload commits one
// chat_message_attachments row per file AFTER, with the just-returned
// message_uuid as the FK target. The FK on chat_message_id is standard
// (NOT DEFERRABLE) -- the chat_messages row always exists at insert time.

/**
 * Insert one chat_message_attachments row, then SELECT it back. Mirrors
 * insertChatMessage's host-contract pattern (execute returns only rowCount,
 * no RETURNING -- so we read back via SELECT). No ON CONFLICT clause -- the
 * `id` PK is freshly generated by the caller (chat.attachment.upload uses
 * crypto.randomUUID) so collisions are not expected; if one ever happens,
 * the surface error is the right answer.
 */
export async function insertChatMessageAttachment(
  ctx: ChatTopicsRepoCtx,
  row: ChatMessageAttachmentRow,
): Promise<ChatMessageAttachmentRow> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
       (${CHAT_MESSAGE_ATTACHMENT_COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.id,
      row.company_id,
      row.topic_issue_id,
      row.chat_message_id,
      row.comment_id,
      row.document_key,
      row.mime_type,
      row.original_filename,
      row.byte_size,
      row.created_at,
    ],
  );

  const rows = await ctx.db.query<ChatMessageAttachmentRow>(
    `SELECT ${CHAT_MESSAGE_ATTACHMENT_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [row.id, row.company_id],
  );
  return rows[0] ?? row;
}

/**
 * List attachments for one topic, newest-first, bounded by `limit`. Powers
 * the right-rail Recent Attachments panel (limit=5) AND the chat-messages
 * handler's per-thread enrichment (limit=1000 defense-in-depth bulk
 * lookup). Company-scoped + topic-scoped so cross-topic isolation is
 * structural.
 */
export async function listChatMessageAttachmentsForTopic(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  topicIssueId: string,
  limit: number,
): Promise<ChatMessageAttachmentRow[]> {
  return ctx.db.query<ChatMessageAttachmentRow>(
    `SELECT ${CHAT_MESSAGE_ATTACHMENT_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
     WHERE company_id = $1 AND topic_issue_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [companyId, topicIssueId, limit],
  );
}

/**
 * List every attachment for one chat_messages row, oldest-first (ORDER BY
 * created_at ASC) so the UI renders them in upload order. Used by callers
 * that want a per-message lookup (e.g. composer Retry on a failed chip).
 * Company-scoped.
 */
export async function listChatMessageAttachmentsForMessage(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  chatMessageId: string,
): Promise<ChatMessageAttachmentRow[]> {
  return ctx.db.query<ChatMessageAttachmentRow>(
    `SELECT ${CHAT_MESSAGE_ATTACHMENT_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
     WHERE company_id = $1 AND chat_message_id = $2
     ORDER BY created_at ASC`,
    [companyId, chatMessageId],
  );
}

/**
 * Sum the byte_size of every attachment already linked to one
 * chat_messages row, company-scoped. Used by the per-message 50 MB cap in
 * chat.attachment.upload. COALESCE keeps the return shape numeric even
 * when no rows exist.
 */
export async function sumChatMessageAttachmentBytesByMessage(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  chatMessageId: string,
): Promise<number> {
  const rows = await ctx.db.query<{ sum_bytes: number | string | null }>(
    `SELECT COALESCE(SUM(byte_size), 0) AS sum_bytes
     FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
     WHERE company_id = $1 AND chat_message_id = $2`,
    [companyId, chatMessageId],
  );
  // The node-postgres driver returns bigint columns (including SUM(bigint))
  // as strings; Number() coerces the string-or-number-or-null to a number.
  return Number(rows[0]?.sum_bytes ?? 0);
}
