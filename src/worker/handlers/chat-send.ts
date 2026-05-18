// src/worker/handlers/chat-send.ts
//
// Plan 04-03 Task A — CHAT-02 / CHAT-06 / D-06 — the chat.send action handler.
//
// "Send a chat message" = create a comment on the topic issue. Posting a
// comment on an agent-assigned issue natively wakes that agent (D-01, proven
// live by the 04-01 spike) — Phase 4 builds ZERO agent-delivery code.
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
//   4. Auto-reopen (D-06): if the topic issue is 'done', flip it back to
//      'in_progress'. Per 04-01-SPIKE-FINDINGS OQ-3 = STATUS-FLIP-NOT-NEEDED,
//      the flip is for UX/status correctness ONLY — `requestWakeup` is NOT
//      called; a posted comment alone wakes the assigned agent.
//   5. A createComment host failure returns { error: 'SEND_FAILED' } and does
//      NOT insert a chat_messages row — no orphan map entry.
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

    // 4. Auto-reopen (D-06) — a 'done' topic flips to 'in_progress' for
    //    UX/status correctness. OQ-3 STATUS-FLIP-NOT-NEEDED: no requestWakeup.
    try {
      const issue = (await ctx.issues.get(topicIssueId, companyId)) as {
        status?: string;
      } | null;
      if (issue && issue.status === 'done') {
        await ctx.issues.update(
          topicIssueId,
          { status: 'in_progress' } as Parameters<PluginIssuesClient['update']>[1],
          companyId,
        );
      }
    } catch (e) {
      // Auto-reopen is best-effort — the comment already landed and wakes the
      // agent natively. A failed status flip must not fail the send.
      ctx.logger?.warn?.('chat.send: auto-reopen check failed', {
        topicIssueId,
        err: (e as Error).message,
      });
    }

    return { ok: true, commentId: comment.id };
  });
}
