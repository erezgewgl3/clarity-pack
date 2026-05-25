// src/worker/handlers/chat-topic-bulk-unarchive.ts
//
// Plan 05-08 Task 2 -- chat.topic.bulkUnarchive ACTION handler (D-16).
//
// Bulk-unarchive is the archive full-view's primary action: an operator
// selects N archived topics, clicks Unarchive, and every selected row's
// `chat_topics.archived` flips false in a single DB round-trip. No
// confirmation modal regardless of N -- the action is reversible (CTT-07
// invariant: host issue untouched).
//
// This handler ONLY un-archives. The archive direction stays single-row
// via the existing chat.topic.archive handler with its PIN_EXEMPT guard
// (Task 3). A future bulk-ARCHIVE variant would benefit from the
// bulkSetChatTopicArchived helper's SQL guard
// `pinned_at IS NULL OR $1 = false` (Task 1) -- pinned topics excluded by
// construction.
//
// CTT-07 invariant: bulk-unarchive flips a plugin-side column only. The
// host issue is NEVER touched. Test 12 in
// chat-topic-bulk-unarchive.test.mjs spies on ctx.issues.update and
// asserts zero invocations.
//
// Action-handler convention:
//   - missing required string param          -> THROW with "<key> required"
//   - missing/wrong-typed topicIssueIds      -> THROW with "(string[]) required"
//   - opted-out caller                       -> RETURN { error: 'OPT_IN_REQUIRED' }
//   - repo failure                           -> RETURN { error: 'BULK_UNARCHIVE_FAILED' }
//                                               + warn log

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import {
  bulkSetChatTopicArchived,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatTopicBulkUnarchiveCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

export function registerChatTopicBulkUnarchive(ctx: ChatTopicBulkUnarchiveCtx): void {
  wrapActionHandler(ctx, 'chat.topic.bulkUnarchive', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const raw = params?.topicIssueIds;
    const topicIssueIds: string[] | null =
      Array.isArray(raw) && raw.every((x) => typeof x === 'string' && x.length > 0)
        ? (raw as string[])
        : null;

    if (!companyId) {
      throw new Error('chat.topic.bulkUnarchive: companyId required');
    }
    if (topicIssueIds === null) {
      throw new Error('chat.topic.bulkUnarchive: topicIssueIds (string[]) required');
    }

    try {
      const result = await bulkSetChatTopicArchived(
        ctx,
        companyId,
        topicIssueIds,
        false,
      );
      return { ok: true, updated: result.updated };
    } catch (e) {
      ctx.logger?.warn?.('chat.topic.bulkUnarchive: failed', {
        companyId,
        count: topicIssueIds.length,
        err: (e as Error).message,
      });
      return { error: 'BULK_UNARCHIVE_FAILED' };
    }
  });
}
