// src/worker/handlers/chat-topic-pin.ts
//
// Plan 05-08 Task 2 -- chat.topic.pin ACTION handler (D-20).
//
// D-20 invariant: storage-pin marks a chat topic EXEMPT from archive. A
// pinned topic returns { error: 'PIN_EXEMPT' } from chat.topic.archive
// (the reverse read of this invariant lives in chat-topic-archive.ts's
// PIN_EXEMPT guard, added in Plan 05-08 Task 3). Pinning DOES NOT change
// topic sort order; this is NOT pin-to-top. Pinned topics are purely
// archive-exempt per CONTEXT.md D-20.
//
// CTT-07 invariant (preserved from chat-topic-archive.ts): pinning a topic
// flips a plugin-side `chat_topics.pinned_at` column. The host issue is
// NEVER touched -- no `ctx.issues.update` call, by construction. Test 6 in
// chat-topic-pin.test.mjs is the regression guard: it spies on
// `ctx.issues.update` across both pin=true and pin=false paths and asserts
// zero invocations.
//
// Action-handler convention (mirrors chat-topic-archive.ts byte-for-byte):
//   - missing required string param  -> THROW with "<key> required"
//   - missing/wrong-typed boolean    -> THROW with "(boolean) required"
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapActionHandler -- T-04-15)
//   - repo failure                   -> RETURN { error: 'PIN_FAILED' }
//                                       + warn log

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import { setChatTopicPinned, type ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

export type ChatTopicPinCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

export function registerChatTopicPin(ctx: ChatTopicPinCtx): void {
  wrapActionHandler(ctx, 'chat.topic.pin', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;
    const pinned = params?.pinned;

    if (!companyId) {
      throw new Error('chat.topic.pin: companyId required');
    }
    if (!topicIssueId) {
      throw new Error('chat.topic.pin: topicIssueId required');
    }
    if (typeof pinned !== 'boolean') {
      throw new Error('chat.topic.pin: pinned (boolean) required');
    }

    try {
      await setChatTopicPinned(ctx, companyId, topicIssueId, pinned);
      return { ok: true, topicIssueId, pinned };
    } catch (e) {
      ctx.logger?.warn?.('chat.topic.pin: failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'PIN_FAILED' };
    }
  });
}
