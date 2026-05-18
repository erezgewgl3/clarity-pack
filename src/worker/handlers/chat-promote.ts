// src/worker/handlers/chat-promote.ts
//
// Plan 04-04 Task B — CHAT-09 / D-13 — the chat.promote action handler.
//
// chat.promote turns a single chat message into a real Paperclip task issue:
//   1. Resolve the source message via getChatMessageByUuid → its comment_id
//      and topic_issue_id.
//   2. Re-verify the caller can see the message (T-04-16): getChatMessageByUuid
//      is company-scoped, so a message in another company simply does not
//      resolve — { error: 'NOT_FOUND' }. The comment body is then re-fetched
//      from the canonical thread via ctx.issues.listComments; if the comment is
//      not present in that thread the request is also { error: 'NOT_FOUND' }.
//   3. ctx.issues.create makes a real issue pre-filled from the message body,
//      linked back to the topic issue via parentId (D-13 — the new task hangs
//      under the topic so its provenance is greppable).
//   4. Return the new issue id.
//
// Wrapped via opt-in-guard's wrapActionHandler — THROWS on missing required
// params (action-handler convention), RETURNS structured errors on a host-call
// failure or an ownership-check rejection.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  getChatMessageByUuid,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatPromoteCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

type CommentLike = {
  id?: string;
  body?: string;
};

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.promote: ${key} required`);
}

/** Derive a concise issue title from a (possibly long) message body. */
function titleFromBody(body: string): string {
  const firstLine = body.split('\n')[0].trim();
  if (firstLine.length <= 80) return firstLine || 'Promoted chat message';
  return `${firstLine.slice(0, 77)}...`;
}

export function registerChatPromote(ctx: ChatPromoteCtx): void {
  wrapActionHandler(ctx, 'chat.promote', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const messageUuid = reqStr(params, 'messageUuid');
    const userId = reqStr(params, 'userId');
    void userId;

    // 1 + 2. Resolve the source message — company-scoped (T-04-16). An unknown
    // uuid, or one belonging to another company, does not resolve.
    const message = await getChatMessageByUuid(ctx, companyId, messageUuid);
    if (!message || !message.comment_id) {
      return { error: 'NOT_FOUND' };
    }

    // Re-fetch the canonical comment body from the topic thread. The caller
    // never supplies the body — it is read from public.issue_comments.
    let comments: CommentLike[];
    try {
      comments = (await ctx.issues.listComments(
        message.topic_issue_id,
        companyId,
      )) as unknown as CommentLike[];
    } catch (e) {
      ctx.logger?.warn?.('chat.promote: listComments failed', {
        topicIssueId: message.topic_issue_id,
        err: (e as Error).message,
      });
      return { error: 'NOT_FOUND' };
    }

    const sourceComment = (comments ?? []).find((c) => c.id === message.comment_id);
    if (!sourceComment) {
      // The mapped comment is no longer in the thread — treat as not found.
      return { error: 'NOT_FOUND' };
    }
    const body = sourceComment.body ?? '';

    // 3. Create the real task issue, linked back to the topic issue (D-13).
    let issue: { id: string };
    try {
      issue = await ctx.issues.create({
        companyId,
        parentId: message.topic_issue_id,
        title: titleFromBody(body),
        description:
          `Promoted from a chat message.\n\n` +
          `Original message:\n${body}`,
        status: 'todo',
        originKind: 'plugin:clarity-pack',
        originId: `chat-promote-${messageUuid}`,
      });
    } catch (e) {
      ctx.logger?.warn?.('chat.promote: issues.create failed', {
        companyId,
        messageUuid,
        err: (e as Error).message,
      });
      return { error: 'PROMOTE_FAILED' };
    }

    return { ok: true, issueId: issue.id, topicIssueId: message.topic_issue_id };
  });
}
