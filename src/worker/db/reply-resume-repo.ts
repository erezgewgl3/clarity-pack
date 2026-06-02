// src/worker/db/reply-resume-repo.ts
//
// Plan 14-01 Task 1 (DO-01 / DO-02) — the situation.replyAndResume dedup
// id-map repo. A 1:1 structural mirror of the chat_messages id-map in
// src/worker/db/chat-topics-repo.ts (getChatMessageByUuid / insertChatMessage):
// same ctx shape (db: PluginDatabaseClient), same client-messageUuid
// idempotency discipline (UNIQUE + ON CONFLICT DO NOTHING), same host-faithful
// ctx.db contract (query = SELECT-only single statement; execute = DML-only,
// returns rowCount, NEVER rows).
//
// IDEMPOTENCY is company-scoped (the 0014 multi-company lesson): the
// UNIQUE (company_id, message_uuid) constraint (migration 0016) +
// ON CONFLICT DO NOTHING means a lost-ACK retry with the same client
// messageUuid is a server-side no-op — the dedup happens in Postgres, there is
// no read-then-write race. The handler still reads first (getReplyResumeByUuid)
// to short-circuit BEFORE any host mutation (no double-post, no double-flip).
//
// NO_UUID_LEAK: comment_id (the host public.issue_comments id) and
// leaf_issue_id (the human display key, e.g. BEAAA-43) are dispatch / echo keys
// only. They are stored here and echoed in the action result, but NEVER
// rendered to the operator. No raw issue UUID is stored in this table.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type ReplyResumeRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * One persisted reply-resume dedup row — maps a client message_uuid to the
 * host comment_id that the original reply produced. durable records whether the
 * Shape-B {status:'in_progress'} flip was applied (so a replay does not
 * re-attempt the flip).
 */
export type ReplyResumeRow = {
  company_id: string;
  message_uuid: string;
  leaf_issue_id: string;
  comment_id: string;
  durable: boolean;
};

/**
 * Read the dedup row by (company_id, message_uuid). This is the dedup-on-reply
 * lookup the handler runs FIRST (before any createComment / update): if a row
 * exists the reply already landed — return its { comment_id, durable } so the
 * handler returns the ORIGINAL commentId WITHOUT re-posting or re-flipping.
 * Returns null when no row matches. Company-scoped so a reply never leaks
 * across companies.
 */
export async function getReplyResumeByUuid(
  ctx: ReplyResumeRepoCtx,
  companyId: string,
  messageUuid: string,
): Promise<{ comment_id: string; durable: boolean } | null> {
  const rows = await ctx.db.query<{ comment_id: string; durable: boolean }>(
    `SELECT comment_id, durable
     FROM plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup
     WHERE company_id = $1 AND message_uuid = $2
     LIMIT 1`,
    [companyId, messageUuid],
  );
  return rows[0] ?? null;
}

/**
 * Insert a reply-resume dedup row. The INSERT carries
 * `ON CONFLICT (company_id, message_uuid) DO NOTHING` (client-messageUuid
 * idempotency): a duplicate insert — e.g. a racing replay — is a server-side
 * no-op. No array columns here, so no toPgTextArrayLiteral cast. The host
 * ctx.db.execute returns rowCount only (no RETURNING), so this returns void.
 */
export async function insertReplyResume(
  ctx: ReplyResumeRepoCtx,
  row: ReplyResumeRow,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup
       (company_id, message_uuid, leaf_issue_id, comment_id, durable)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, message_uuid) DO NOTHING`,
    [row.company_id, row.message_uuid, row.leaf_issue_id, row.comment_id, row.durable],
  );
}
