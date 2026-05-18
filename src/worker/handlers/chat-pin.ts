// src/worker/handlers/chat-pin.ts
//
// Plan 04-04 Task C — CHAT-09 / D-13 — the chat.pin action handler.
//
// "Pin a message" is a Clarity Pack concept only — Paperclip has no host pin
// primitive (D-13). chat.pin flips the `pinned` boolean on the chat_messages
// id-map side table via updateChatMessagePinned. The repo function is
// company-scoped (WHERE message_uuid=$2 AND company_id=$3), so a pin never
// crosses companies (T-04-16).
//
// Minimal action-handler shape — mirrors active-viewer-ping.ts: validate the
// params, run one ctx.db.execute UPDATE, return { ok: true }.
//
// Wrapped via opt-in-guard's wrapActionHandler — an opted-out caller gets
// { error: 'OPT_IN_REQUIRED' } before the inner handler runs (T-04-15).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import {
  updateChatMessagePinned,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatPinCtx = OptInGuardActionCtx & ChatTopicsRepoCtx;

export function registerChatPin(ctx: ChatPinCtx): void {
  wrapActionHandler(ctx, 'chat.pin', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const messageUuid =
      typeof params?.messageUuid === 'string' && params.messageUuid
        ? params.messageUuid
        : null;
    const pinned = params?.pinned;

    if (!messageUuid) {
      throw new Error('chat.pin: messageUuid required');
    }
    if (!companyId) {
      throw new Error('chat.pin: companyId required');
    }
    if (typeof pinned !== 'boolean') {
      throw new Error('chat.pin: pinned (boolean) required');
    }

    await updateChatMessagePinned(ctx, companyId, messageUuid, pinned);

    return { ok: true };
  });
}
