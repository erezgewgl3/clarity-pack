// src/worker/handlers/chat-topic-archive.ts
//
// Plan 04.1-05 Task 1 -- chat.topic.archive ACTION handler (D-10).
//
// D-10 invariant (Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ3 attempt 2):
// archiving a chat topic flips a plugin-side `chat_topics.archived` flag.
// The host issue's status MUST stay at `in_progress` -- never `done`,
// `cancelled`, or `blocked`. The OQ3 attempt 2 probe captured the
// fa25ef4d-... missing-disposition system_notice the host's
// disposition-recovery service writes when a chat-topic issue parks at a
// terminal status post-run. Phase 4's classic close-on-archive model
// (Phase 4 D-06) is SUPERSEDED by Phase 4.1's D-09 / D-10: archive is a
// chat-UI concept; the host knows nothing about it.
//
// This file deliberately does NOT import or call the host issue-mutation
// API (no `issues.update` here). Test 6 in chat-topic-archive.test.mjs
// pins zero invocations of `ctx.issues.update` across both archive and
// un-archive paths (regression guard, by construction).
//
// Plan 05-08 (D-20) — PIN_EXEMPT guard. A topic whose chat_topics.pinned_at
// IS NOT NULL is EXEMPT from archive: archive=true on a pinned topic
// short-circuits with { error: 'PIN_EXEMPT', topicIssueId } BEFORE the
// setChatTopicArchived call. The un-archive direction is unchanged
// (archive=false runs setChatTopicArchived unconditionally). isChatTopicPinned
// is a SELECT-only round-trip against the plugin namespace; CTT-07 invariant
// preserved.
//
// Action-handler convention (mirrors chat-pin.ts):
//   - missing required string param  -> THROW with "<key> required"
//   - missing/wrong-typed boolean    -> THROW with "(boolean) required"
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapActionHandler -- T-04-15)
//   - pinned topic + archive=true    -> RETURN { error: 'PIN_EXEMPT' } (D-20)
//   - repo failure                   -> RETURN { error: 'ARCHIVE_FAILED' }
//                                       + warn log

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import {
  setChatTopicArchived,
  isChatTopicPinned,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatTopicArchiveCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

export function registerChatTopicArchive(ctx: ChatTopicArchiveCtx): void {
  wrapActionHandler(ctx, 'chat.topic.archive', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;
    const archived = params?.archived;

    if (!companyId) {
      throw new Error('chat.topic.archive: companyId required');
    }
    if (!topicIssueId) {
      throw new Error('chat.topic.archive: topicIssueId required');
    }
    if (typeof archived !== 'boolean') {
      throw new Error('chat.topic.archive: archived (boolean) required');
    }

    try {
      // Plan 05-08 (D-20) — PIN_EXEMPT short-circuit. Archive is denied
      // while pinned; un-archive proceeds unconditionally (pinned topics
      // are already not archived in steady-state, but un-archiving a pinned
      // row is a safe no-op upstream).
      if (archived === true) {
        const pinned = await isChatTopicPinned(ctx, companyId, topicIssueId);
        if (pinned) {
          return { error: 'PIN_EXEMPT' as const, topicIssueId };
        }
      }
      await setChatTopicArchived(ctx, companyId, topicIssueId, archived);
      return { ok: true, topicIssueId, archived };
    } catch (e) {
      ctx.logger?.warn?.('chat.topic.archive: failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'ARCHIVE_FAILED' };
    }
  });
}
