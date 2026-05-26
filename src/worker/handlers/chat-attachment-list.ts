// src/worker/handlers/chat-attachment-list.ts
//
// Plan 05-11 Task 2 -- chat.attachment.list DATA handler (CHAT-07 gap closure).
//
// Returns the newest-N chat-uploaded attachments for one chat topic. Powers
// the right-rail Recent Attachments panel (limit=5 by default; the panel
// caller may request larger N for an "all attachments" drill-down view).
// Each row in the response carries enough metadata for the UI to mount an
// AttachmentChip + dispatch the Plan 05-04 DIST-04 DeliverablePreview popover
// on click (mime icon + filename + size + documentKey for the previewer).
//
// CTT-07 invariant by construction: this handler reads from the plugin-
// namespace chat_message_attachments table only. It NEVER calls
// ctx.issues.update. Test 6 in chat-attachment-list.test.mjs is the source-
// grep regression guard (paired with the ctt07 cross-handler test).
//
// Data-handler convention (mirrors chat-active-tasks.ts):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//     (never throw -- data handlers carry structured errors)
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }
//     (via wrapDataHandler -- T-04-15; fires BEFORE the body)
//   - repo failure                  -> RETURN { error: 'ATTACHMENTS_FAILED' }
//                                       + warn log

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listChatMessageAttachmentsForTopic,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

const DEFAULT_LIST_LIMIT = 5;
const MAX_LIST_LIMIT = 100;

export type ChatAttachmentListCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

/** A chat attachment as the UI consumes it. camelCase from the snake_case repo row. */
type ChatAttachmentEntry = {
  id: string;
  chatMessageId: string;
  commentId: string | null;
  documentKey: string;
  mimeType: string;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
};

export function registerChatAttachmentList(ctx: ChatAttachmentListCtx): void {
  wrapDataHandler(ctx, 'chat.attachment.list', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId
        ? params.userId
        : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!topicIssueId) return { error: 'TOPIC_ISSUE_ID_REQUIRED' as const };

    // Limit: default 5 (right-rail), clamped to MAX_LIST_LIMIT for
    // defense-in-depth (an opted-in but malicious / buggy UI cannot request
    // a runaway listing).
    const rawLimit = params?.limit;
    let limit = DEFAULT_LIST_LIMIT;
    if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0) {
      limit = Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT);
    }

    let rows;
    try {
      rows = await listChatMessageAttachmentsForTopic(
        ctx,
        companyId,
        topicIssueId,
        limit,
      );
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.list: SELECT failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'ATTACHMENTS_FAILED' as const };
    }

    const attachments: ChatAttachmentEntry[] = rows.map((r) => ({
      id: r.id,
      chatMessageId: r.chat_message_id,
      commentId: r.comment_id ?? null,
      documentKey: r.document_key,
      mimeType: r.mime_type,
      originalFilename: r.original_filename,
      byteSize: Number(r.byte_size),
      createdAt: r.created_at,
    }));

    return {
      kind: 'attachments' as const,
      topicIssueId,
      attachments,
    };
  });
}
