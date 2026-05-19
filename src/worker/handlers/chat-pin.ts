// src/worker/handlers/chat-pin.ts
//
// Plan 04-04 Task C / 04-05 audit — CHAT-09 / D-13 — the chat.pin action.
//
// "Pin a message" is a Clarity Pack concept only — Paperclip has no host pin
// primitive (D-13). chat.pin sets the `pinned` boolean on the chat_messages
// side table.
//
// GAP 12 — host-contract audit fix. The pin buttons sit on AGENT messages.
// PITFALL #4: the chat_messages side table is operator-write-only — chat.send
// inserts a row for every OPERATOR message, but an AGENT comment has NO row.
// The old handler resolved the target via getChatMessageByUuid (a chat_messages
// lookup) and was additionally passed the comment id as `messageUuid` by the
// UI — so pinning an agent message was a guaranteed 0-row UPDATE no-op.
//
// The fix: chat.pin now takes `commentId` + `topicIssueId` (both already held
// by the UI's PromoteActions). pinChatMessageByCommentId UPDATEs an existing
// operator-message row, or — when the comment is an agent reply with no row —
// UPSERTs a pin-only chat_messages row (generated message_uuid, sender_kind
// 'agent', the pin flag; no body, CHAT-02). It then reads the row back and
// returns it so the UI can confirm the pin landed.
//
// Wrapped via opt-in-guard's wrapActionHandler — an opted-out caller gets
// { error: 'OPT_IN_REQUIRED' } before the inner handler runs (T-04-15).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import {
  pinChatMessageByCommentId,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatPinCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

export function registerChatPin(ctx: ChatPinCtx): void {
  wrapActionHandler(ctx, 'chat.pin', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const commentId =
      typeof params?.commentId === 'string' && params.commentId
        ? params.commentId
        : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;
    const pinned = params?.pinned;

    if (!commentId) {
      throw new Error('chat.pin: commentId required');
    }
    if (!topicIssueId) {
      throw new Error('chat.pin: topicIssueId required');
    }
    if (!companyId) {
      throw new Error('chat.pin: companyId required');
    }
    if (typeof pinned !== 'boolean') {
      throw new Error('chat.pin: pinned (boolean) required');
    }

    try {
      const row = await pinChatMessageByCommentId(
        ctx,
        companyId,
        topicIssueId,
        commentId,
        pinned,
      );
      return { ok: true, commentId, pinned: row.pinned };
    } catch (e) {
      ctx.logger?.warn?.('chat.pin: pin failed', {
        companyId,
        commentId,
        err: (e as Error).message,
      });
      return { error: 'PIN_FAILED' };
    }
  });
}
