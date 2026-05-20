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
// Action-handler convention (mirrors chat-pin.ts):
//   - missing required string param  -> THROW with "<key> required"
//   - missing/wrong-typed boolean    -> THROW with "(boolean) required"
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapActionHandler -- T-04-15)
//   - repo failure                   -> RETURN { error: 'ARCHIVE_FAILED' }
//                                       + warn log

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import { setChatTopicArchived, type ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

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
