// src/worker/handlers/chat-messages.ts
//
// Plan 04-04 Task A — CHAT-01 — the chat.messages data handler.
//
// chat.messages returns the message thread for one chat-topic issue. The
// canonical body lives in public.issue_comments (CHAT-02) — read via
// ctx.issues.listComments. The plugin-namespace chat_messages side table is
// JOINed in (by comment_id) for the supersedes link (D-11 / CHAT-05 edit
// chains) and the pin flag (D-13).
//
// Ordering: the thread is ORDERED by the SERVER-side comment created_at, never
// a client-supplied timestamp (PITFALLS 11.4 — a client clock cannot be
// trusted to order a thread). createdAt may arrive as a Date or an ISO string
// depending on the host serialization path — coerced to epoch ms before sort.
//
// Superseded marking: a comment whose message_uuid appears as another row's
// supersedes_uuid is the OLD version of an edit. It is marked { superseded:
// true } so the UI collapses the edit chain (CHAT-05). The newest comment in
// the chain is the live one.
//
// Wrapped via opt-in-guard's wrapDataHandler. Data handlers RETURN structured
// errors; they never throw.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx, ChatMessageRow } from '../db/chat-topics-repo.ts';

export type ChatMessagesCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

/** A thread message as the chat UI consumes it. */
type ThreadMessage = {
  commentId: string;
  body: string;
  createdAt: string | null;
  authorUserId: string | null;
  authorAgentId: string | null;
  senderKind: 'user' | 'agent' | null;
  pinned: boolean;
  superseded: boolean;
  supersedesUuid: string | null;
};

/** The subset of IssueComment this handler reads. */
type CommentLike = {
  id?: string;
  body?: string;
  createdAt?: Date | string;
  authorUserId?: string | null;
  authorAgentId?: string | null;
};

/** Coerce a Date | ISO string | undefined to epoch ms (NaN-guarded). */
function createdAtMs(raw: Date | string | undefined): number {
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const CHAT_MESSAGE_COLS =
  'message_uuid, company_id, topic_issue_id, comment_id, sender_kind, ' +
  'supersedes_uuid, pinned, sent_at';

/**
 * Read every chat_messages id-map row for one topic issue, company-scoped.
 * SELECT-only — issued through ctx.db.query.
 */
async function listChatMessagesForTopic(
  ctx: ChatTopicsRepoCtx,
  topicIssueId: string,
  companyId: string,
): Promise<ChatMessageRow[]> {
  return ctx.db.query<ChatMessageRow>(
    `SELECT ${CHAT_MESSAGE_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.chat_messages
     WHERE topic_issue_id = $1 AND company_id = $2`,
    [topicIssueId, companyId],
  );
}

export function registerChatMessages(ctx: ChatMessagesCtx): void {
  wrapDataHandler(ctx, 'chat.messages', async (params) => {
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;

    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!topicIssueId) {
      return { error: 'TOPIC_ISSUE_ID_REQUIRED' };
    }
    if (!userId) {
      return { error: 'USER_ID_REQUIRED' };
    }

    let comments: CommentLike[];
    try {
      comments = (await ctx.issues.listComments(topicIssueId, companyId)) as unknown as CommentLike[];
    } catch (e) {
      ctx.logger?.warn?.('chat.messages: listComments failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'THREAD_FAILED' };
    }

    // Side-table metadata — supersedes / pin / sender_kind. A failure here
    // degrades to "no metadata" rather than failing the whole thread read.
    let metaRows: ChatMessageRow[] = [];
    try {
      metaRows = await listChatMessagesForTopic(ctx, topicIssueId, companyId);
    } catch (e) {
      ctx.logger?.warn?.('chat.messages: chat_messages lookup failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      metaRows = [];
    }

    // Index the side table by comment_id, and collect the set of message_uuids
    // that have been superseded by a later edit.
    const metaByCommentId = new Map<string, ChatMessageRow>();
    const supersededUuids = new Set<string>();
    for (const row of metaRows) {
      if (row.comment_id) metaByCommentId.set(row.comment_id, row);
      if (row.supersedes_uuid) supersededUuids.add(row.supersedes_uuid);
    }

    const messages: ThreadMessage[] = (comments ?? [])
      .filter((c) => typeof c?.id === 'string' && c.id)
      .slice()
      .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt))
      .map((c) => {
        const meta = metaByCommentId.get(c.id as string);
        const createdAt =
          c.createdAt instanceof Date
            ? c.createdAt.toISOString()
            : typeof c.createdAt === 'string'
              ? c.createdAt
              : null;
        return {
          commentId: c.id as string,
          body: c.body ?? '',
          createdAt,
          authorUserId: c.authorUserId ?? null,
          authorAgentId: c.authorAgentId ?? null,
          senderKind: meta?.sender_kind ?? null,
          pinned: meta?.pinned ?? false,
          superseded: !!(meta && supersededUuids.has(meta.message_uuid)),
          supersedesUuid: meta?.supersedes_uuid ?? null,
        };
      });

    return { kind: 'messages' as const, topicIssueId, messages };
  });
}
