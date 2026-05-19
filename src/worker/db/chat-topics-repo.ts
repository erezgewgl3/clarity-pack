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

const CHAT_TOPIC_COLS =
  'topic_id, company_id, issue_id, parent_issue_id, employee_agent_id, ' +
  'title, last_activity_at, archived, created_at';

const CHAT_MESSAGE_COLS =
  'message_uuid, company_id, topic_issue_id, comment_id, sender_kind, ' +
  'supersedes_uuid, pinned, sent_at';

const CHAT_EMPLOYEE_PARENT_COLS =
  'company_id, employee_agent_id, parent_issue_id, created_at';

// ---------------------------------------------------------------------------
// chat_topics
// ---------------------------------------------------------------------------

/**
 * Insert a chat_topics row, then read it back. The INSERT carries
 * `ON CONFLICT (company_id, issue_id) DO NOTHING` so a re-fired topic create
 * is a server-side no-op; the read-back is keyed on (company_id, issue_id) and
 * always returns a row.
 */
export async function insertChatTopic(
  ctx: ChatTopicsRepoCtx,
  row: ChatTopicRow,
): Promise<ChatTopicRow> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.chat_topics
       (${CHAT_TOPIC_COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
 */
export async function listChatTopicsForEmployee(
  ctx: ChatTopicsRepoCtx,
  companyId: string,
  employeeAgentId: string,
): Promise<ChatTopicRow[]> {
  return ctx.db.query<ChatTopicRow>(
    `SELECT ${CHAT_TOPIC_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_topics
     WHERE company_id = $1 AND employee_agent_id = $2
     ORDER BY last_activity_at DESC`,
    [companyId, employeeAgentId],
  );
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
