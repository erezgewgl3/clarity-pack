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
import type {
  ChatTopicsRepoCtx,
  ChatMessageRow,
  ChatMessageAttachmentRow,
} from '../db/chat-topics-repo.ts';
import { listChatMessageAttachmentsForTopic } from '../db/chat-topics-repo.ts';
import { classifyComment } from '../chat/comment-classify.ts';
// Plan 250530 v1.1.11 — apply the v1.1.9/v1.1.10 polish pipeline to AGENT-
// authored chat comments on read so chat reads with the same voice as the
// TL;DRs (ISO→human dates, restated-paren strip, lone-ref-paren strip,
// jargon glossary). Operator-authored messages (meta.sender_kind === 'user')
// bypass — operator's voice is sacred.
import { polishTldr } from '../agents/compile-tldr.ts';
import { isTopicStuck } from '../chat/topic-watchdog.ts';

/**
 * Plan 05-11 (CHAT-07) -- one attachment as the chat thread UI consumes it.
 * camelCase; one row in the chat_message_attachments side table maps to
 * one entry.
 */
export type ChatAttachmentEntry = {
  id: string;
  documentKey: string;
  mimeType: string;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
};

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
  // Plan 05-11 (CHAT-07) -- chat-uploaded attachments inline per message.
  // Always present (default []) so the UI can branch on length without a
  // second host round-trip. Populated by a SINGLE bulk lookup per thread
  // read (PRIM-01 spirit -- never an N+1 per-message query).
  attachments: ChatAttachmentEntry[];
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

    // (v1.8.7) The per-poll `void ensureTopicWakeable(...)` watchdog is REMOVED.
    // Fired fire-and-forget at the head of the handler, its scoped `ctx.issues.get`
    // ran after the dispatch returned → scope-denied (PR #6547), logging a warn per
    // poll and doing nothing. The helper was vestigial anyway: the host's
    // disposition-recovery owns status restoration, and the host-stuck banner uses
    // isTopicStuck over the comments/issue this handler already fetches in-scope.

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

    // Plan 05-11 (CHAT-07) -- bulk attachment lookup. ONE round-trip across
    // the whole topic; we map by chat_message_id and resolve the comment_id
    // per-message via metaByCommentId. PRIM-01 spirit -- never an N+1 query.
    // Limit 1000 is defense-in-depth: single-operator scale + a single topic
    // is realistically <100 attachments; 1000 keeps the SELECT bounded.
    let attachmentRows: ChatMessageAttachmentRow[] = [];
    try {
      attachmentRows = await listChatMessageAttachmentsForTopic(
        ctx,
        companyId,
        topicIssueId,
        1000,
      );
    } catch (e) {
      ctx.logger?.warn?.('chat.messages: chat_message_attachments lookup failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      attachmentRows = [];
    }
    // Index attachments by chat_message_id (the FK target). For each message
    // we then resolve via metaByCommentId.get(commentId)?.message_uuid -- the
    // operator's optimistic-send dedup row carries the (message_uuid,
    // comment_id) bridge. Within a single chat_message_id we sort by
    // created_at ASC so the UI renders attachments in upload order.
    const attachmentsByMessageUuid = new Map<string, ChatAttachmentEntry[]>();
    const sortedAttachmentRows = attachmentRows
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    for (const row of sortedAttachmentRows) {
      const entry: ChatAttachmentEntry = {
        id: row.id,
        documentKey: row.document_key,
        mimeType: row.mime_type,
        originalFilename: row.original_filename,
        byteSize: Number(row.byte_size),
        createdAt: row.created_at,
      };
      const list = attachmentsByMessageUuid.get(row.chat_message_id) ?? [];
      list.push(entry);
      attachmentsByMessageUuid.set(row.chat_message_id, list);
    }

    const messages: ThreadMessage[] = (comments ?? [])
      .filter((c) => typeof c?.id === 'string' && c.id)
      // Plan 04.1-04 — D-14/D-15 runtime-noise filter. The diagnostics opt-in
      // bypasses the filter so D-16 can render the unfiltered list.
      //
      // rc.8 Phase B 2026-05-26 — operator-message visibility fix. The
      // Paperclip host stamps every plugin-worker ctx.issues.createComment
      // call with authorType:'system' (Plan 04.1-11 captured this for the
      // Task-created marker; production drill 2026-05-26 confirms it applies
      // to operator chat.send too). classifyComment correctly returns
      // 'runtime-noise' for authorType:'system' — but operator-initiated
      // chat sends are NOT runtime noise; they're the very messages the
      // operator just typed. The chat_messages side table is the
      // authoritative record: rows with sender_kind:'user' link an operator
      // send to its comment_id. Allowlist those comments so they pass the
      // filter regardless of how the host stamped them.
      .filter((c) => {
        if (includeDiagnostics) return true;
        const meta = metaByCommentId.get(c.id as string);
        if (meta?.sender_kind === 'user') return true;
        return classifyComment(c) === 'conversation';
      })
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
        // Plan 05-11 (CHAT-07) -- resolve attachments by message_uuid
        // (the FK target). meta?.message_uuid is the bridge: the operator-
        // composer side-table dedup row links comment_id -> message_uuid.
        // For agent comments (no row) attachments is []. Always present.
        const attachments: ChatAttachmentEntry[] =
          meta?.message_uuid
            ? (attachmentsByMessageUuid.get(meta.message_uuid) ?? [])
            : [];
        // Plan 250530 v1.1.11 — polish agent-authored bodies only. Operator
        // messages (sender_kind === 'user') skip polish so their literal
        // voice is preserved. The host stamps every plugin-worker
        // ctx.issues.createComment with authorType:'system' (per rc.8 Phase
        // B), which makes the chat_messages side table the authoritative
        // discriminator. Empty/null body short-circuits to '' (polishTldr
        // contract).
        const rawBody = c.body ?? '';
        const isOperatorAuthored = meta?.sender_kind === 'user';
        const body = isOperatorAuthored ? rawBody : polishTldr(rawBody);
        return {
          commentId: c.id as string,
          body,
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
          attachments,
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
