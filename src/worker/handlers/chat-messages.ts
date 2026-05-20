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
// errors; they never throw. The opt-in gate fires BEFORE any host call so an
// opted-out user can never trigger a watchdog wake or a thread read.
//
// ---------------------------------------------------------------------------
// Plan 04.1-04 EXTENSIONS (2026-05-20) — conversation / lifecycle separation
// ---------------------------------------------------------------------------
//
// 1. D-14 / D-15 — runtime-noise filter. Every host comment is run through
//    `classifyComment` (src/worker/chat/comment-classify.ts). Rows that
//    classify as 'runtime-noise' (disposition / recovery-owner / finish_
//    successful_run_handoff system notices) are silently filtered from the
//    UI thread. The discriminator order is locked by 04.1-01-SPIKE-FINDINGS
//    PROBE-D14-DISCRIM: PRIMARY authorType==='system', SECONDARY
//    presentation.kind==='system_notice', FALLBACK 5-phrase body match.
//
// 2. D-16 diagnostics opt-in. Callers passing `includeDiagnostics: true` (the
//    Plan 04.1-06 UI toggle) receive the unfiltered list — runtime notices
//    are NOT destroyed at the host, just hidden by default. Default OFF.
//
// 3. D-11 watchdog cadence. Every poll fires `ensureTopicWakeable` (Plan
//    04.1-03) fire-and-forget at the head of the handler. The helper does
//    its own try/catch; a slow / failing watchdog NEVER delays or fails the
//    messages response. Per the spike findings the watchdog is defensive-
//    only (no requestWakeup call — multi-turn native re-wake works on this
//    host version).
//
// 4. D-13 host-stuck signal. The response shape grows `topicStuck: boolean`
//    + `recoveryOwner: string | null` read once from the topic issue's
//    `activeRecoveryAction` / `successfulRunHandoff.exhausted` via
//    `isTopicStuck` (Plan 04.1-03). Plan 04.1-06's HostStuckBanner renders
//    when topicStuck===true; recoveryOwner provides the named human action.
//    A failed stuck-read degrades to `topicStuck:false, recoveryOwner:null`
//    so the messages response is still returned.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx, ChatMessageRow } from '../db/chat-topics-repo.ts';
import { classifyComment } from '../chat/comment-classify.ts';
import { ensureTopicWakeable, isTopicStuck } from '../chat/topic-watchdog.ts';

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
  // Plan 04.1-06 cross-plan retrofit — D-16 diagnostics view. Always
  // populated (or null) so the UI can branch on system-classified rows
  // without a second host round-trip.
  authorType: string | null;
  presentation: {
    kind: string | null;
    title: string | null;
    tone: string | null;
  } | null;
  metadata: {
    sections: Array<{
      title: string | null;
      rows: Array<Record<string, unknown>>;
    }>;
  } | null;
};

/**
 * The subset of IssueComment this handler reads. The Plan 04.1-04
 * extensions add `authorType` (D-14 PRIMARY discriminator) +
 * `presentation.kind` (D-14 SECONDARY) so `classifyComment` has the host
 * fields it needs.
 *
 * Plan 04.1-06 cross-plan retrofit — the D-16 diagnostics view
 * (RuntimeNoiseRow) renders structured `metadata.sections` envelopes when
 * the host populates them on system_notice comments (Wave 1 spike capture
 * 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM). Pulled through into the
 * response shape so the UI does not need a second host round-trip.
 */
type CommentLike = {
  id?: string;
  body?: string;
  createdAt?: Date | string;
  authorUserId?: string | null;
  authorAgentId?: string | null;
  authorType?: string | null;
  presentation?: {
    kind?: string | null;
    title?: string | null;
    tone?: string | null;
  } | null;
  metadata?: {
    version?: number;
    sections?: Array<{
      title?: string;
      rows?: Array<Record<string, unknown>>;
    }>;
  } | null;
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

    // Plan 04.1-04 — D-16 diagnostics opt-in. OFF by default.
    const includeDiagnostics = (params as { includeDiagnostics?: unknown })?.includeDiagnostics === true;

    // Plan 04.1-04 — D-11 watchdog cadence. Fire-and-forget at the head of
    // the handler. The helper handles its own try/catch internally and
    // NEVER throws back to the caller (chat.messages must not fail because
    // of a watchdog mishap). A `void` discards the returned promise so the
    // handler does not await the slow path.
    void ensureTopicWakeable(ctx, topicIssueId, companyId);

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

    // Plan 04.1-04 — D-13 host-stuck signal. Read the topic issue once for
    // activeRecoveryAction / successfulRunHandoff.exhausted. Best-effort:
    // a failure degrades to the safe defaults (topicStuck:false,
    // recoveryOwner:null) so the messages response is still returned.
    let topicStuck = false;
    let recoveryOwner: string | null = null;
    try {
      const topicIssue = (await ctx.issues.get(topicIssueId, companyId)) as
        | {
            status?: string;
            activeRecoveryAction?:
              | { recoveryOwnerName?: string | null }
              | null;
            successfulRunHandoff?: { exhausted?: boolean } | null;
          }
        | null;
      topicStuck = isTopicStuck(topicIssue);
      if (topicStuck && topicIssue?.activeRecoveryAction) {
        const rec = topicIssue.activeRecoveryAction as {
          recoveryOwnerName?: string | null;
        };
        recoveryOwner = rec.recoveryOwnerName ?? null;
      }
    } catch (e) {
      ctx.logger?.warn?.('chat.messages: topic-stuck read failed', {
        topicIssueId,
        err: (e as Error).message,
      });
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
      // Plan 04.1-04 — D-14/D-15 runtime-noise filter. The diagnostics opt-in
      // bypasses the filter so D-16 can render the unfiltered list.
      .filter((c) => includeDiagnostics || classifyComment(c) === 'conversation')
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
        // Plan 04.1-06 retrofit — pass through host's authorType +
        // presentation + metadata.sections so the D-16 diagnostics view
        // can render the structured envelope without a second round-trip.
        // Defensive copy: only fields we know the shape of land in the
        // response; unknown nested keys are dropped.
        const presentation = c.presentation
          ? {
              kind: c.presentation.kind ?? null,
              title: c.presentation.title ?? null,
              tone: c.presentation.tone ?? null,
            }
          : null;
        const sections = c.metadata?.sections;
        const metadata =
          Array.isArray(sections) && sections.length > 0
            ? {
                sections: sections.map((s) => ({
                  title: s.title ?? null,
                  rows: Array.isArray(s.rows) ? s.rows : [],
                })),
              }
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
          authorType: c.authorType ?? null,
          presentation,
          metadata,
        };
      });

    return {
      kind: 'messages' as const,
      topicIssueId,
      messages,
      topicStuck,
      recoveryOwner,
    };
  });
}
