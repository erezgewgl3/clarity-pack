// src/worker/handlers/chat-send.ts
//
// Plan 04-03 Task A — CHAT-02 / CHAT-06 / D-06 — the chat.send action handler.
// Plan 04.1-03 Task 2 — auto-reopen REPLACED with ensureTopicWakeable.
//
// "Send a chat message" = create a comment on the topic issue. Posting a
// comment on an agent-assigned issue natively wakes that agent (D-01, proven
// live by the 04-01 spike AND multi-turn N>1 by 04.1-01 PROBE-OQ3 PASS-NATIVE)
// — Phase 4.1 builds ZERO agent-delivery code, and DROPS the requestWakeup
// nudge the original D-12 design contemplated (the REST surface returns 404
// on this host version; native wake is sufficient and reliable for N>1).
//
// chat.send is the canonical-write path:
//   1. Dedup on message_uuid via getChatMessageByUuid — a resend (an
//      optimistic-send Retry whose round-trip ack was lost, D-10) returns the
//      ORIGINAL comment_id WITHOUT re-posting (CHAT-06 idempotent replay).
//   2. ctx.issues.createComment writes the message body to
//      public.issue_comments — the single source of truth (CHAT-02). Message
//      content NEVER lives in a Clarity Pack table.
//   3. insertChatMessage records only the message_uuid -> comment_id map (the
//      side table maps IDs, never body).
//   4. D-09 / D-11 — ensureTopicWakeable(ctx, topicIssueId, companyId) runs
//      fire-and-forget after the comment lands. The shared helper REPLACES
//      the prior inline auto-reopen block: a single source of truth for the
//      flip-off-done sweep used here AND in Plan 04.1-04's chat.messages
//      poll handler. RESEARCH §Pitfall 3 closed by 04.1-01-SPIKE-FINDINGS
//      PROBE-OQ3 PASS-NATIVE: native wake works for N>1; no requestWakeup.
//      A slow / failing watchdog NEVER delays or fails the send (void call).
//   5. A createComment host failure returns { error: 'SEND_FAILED' } and does
//      NOT insert a chat_messages row — no orphan map entry. The watchdog is
//      NOT invoked: no comment landed, nothing to wake on.
//
// Wrapped via opt-in-guard's wrapActionHandler: an opted-out (or
// unidentifiable) caller gets { error: 'OPT_IN_REQUIRED' } before the inner
// handler runs — server-side enforcement under the same-origin trust model
// (T-04-08, OPTIN-04).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  getChatMessageByUuid,
  insertChatMessage,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatSendCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.send: ${key} required`);
}

export function registerChatSend(ctx: ChatSendCtx): void {
  wrapActionHandler(ctx, 'chat.send', async (params) => {
    const topicIssueId = reqStr(params, 'topicIssueId');
    const body = reqStr(params, 'body');
    const messageUuid = reqStr(params, 'messageUuid');
    const companyId = reqStr(params, 'companyId');
    // userId is enforced by the opt-in-guard wrapper; re-read for completeness.
    const userId = reqStr(params, 'userId');
    void userId;

    // 1. Dedup — a resend with an already-stored message_uuid is idempotent.
    const existing = await getChatMessageByUuid(ctx, companyId, messageUuid);
    if (existing && existing.comment_id) {
      return { ok: true, commentId: existing.comment_id };
    }

    // 2. Canonical write — the message body lives in public.issue_comments.
    let comment: { id: string };
    try {
      comment = await ctx.issues.createComment(topicIssueId, body, companyId);
    } catch (e) {
      ctx.logger?.warn?.('chat.send: createComment failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'SEND_FAILED' };
    }

    // 3. Side-table id-map insert (CHAT-06 dedup key; never stores body).
    await insertChatMessage(ctx, {
      message_uuid: messageUuid,
      company_id: companyId,
      topic_issue_id: topicIssueId,
      comment_id: comment.id,
      sender_kind: 'user',
      supersedes_uuid: null,
      pinned: false,
      sent_at: new Date().toISOString(),
    });

    // 4. (v1.8.7) The two fire-and-forget post-return calls that used to live here
    //    are REMOVED, because both ran AFTER this handler returned, where the host
    //    has cleared the invocation scope (PR #6547) → both were DENIED and did
    //    nothing:
    //      - `void ensureTopicWakeable(...)` (its scoped `ctx.issues.get` was
    //        scope-denied; the helper is vestigial anyway — the host's
    //        disposition-recovery owns status restoration, and the host-stuck
    //        banner uses chat.messages' own in-handler fetch via isTopicStuck).
    //      - `void Promise.then(() => ctx.issues.requestWakeup(...))` (the prior
    //        comment claimed it "fires in a valid action scope" — FALSE on this
    //        host: a detached microtask runs post-settle, so it was scope-denied).
    //    The operator's reply is delivered by the NATIVE trigger: the canonical
    //    comment posted above, which the assignee's heartbeat picks up. Removing
    //    the dead calls only drops log noise + tests that asserted a fiction. No
    //    behavior change (they never ran in prod). A scoped RPC cannot run after
    //    the dispatch returns on this host.

    return { ok: true, commentId: comment.id };
  });
}
