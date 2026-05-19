// src/worker/handlers/chat-promote.ts
//
// Plan 04-04 Task B / 04-05 audit — CHAT-09 / D-13 — the chat.promote action.
//
// chat.promote turns a single chat message into a real Paperclip task issue:
//   1. The UI supplies `commentId` + `topicIssueId` (PromoteActions holds both).
//   2. The canonical comment body is re-fetched from the topic thread via
//      ctx.issues.listComments(topicIssueId, companyId) and the matching
//      comment located by id. The caller never supplies the body — it is read
//      from public.issue_comments (CHAT-02).
//   3. ctx.issues.create makes a real issue pre-filled from the message body,
//      linked back to the topic issue via parentId (D-13 — the new task hangs
//      under the topic so its provenance is greppable).
//   4. Return the new issue id.
//
// GAP 12 — host-contract audit fix. The promote button sits on AGENT messages.
// PITFALL #4: the chat_messages side table is operator-write-only — an agent
// comment has NO chat_messages row. The old handler resolved the target via
// getChatMessageByUuid (a chat_messages lookup) and was passed the comment id
// as `messageUuid` by the UI, so promoting an agent message ALWAYS returned
// NOT_FOUND. The fix drops the getChatMessageByUuid dependency entirely and
// resolves the comment straight from the topic thread by comment id — which
// works for an agent reply and an operator message alike.
//
// Ownership scoping (T-04-16): ctx.issues.listComments is company-scoped by the
// host, so a comment on another company's topic is not reachable. A comment id
// that is not present in the named topic thread returns { error: 'NOT_FOUND' }.
//
// Wrapped via opt-in-guard's wrapActionHandler — THROWS on missing required
// params (action-handler convention), RETURNS structured errors on a host-call
// failure or a not-found resolution.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

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
    const commentId = reqStr(params, 'commentId');
    const topicIssueId = reqStr(params, 'topicIssueId');
    const userId = reqStr(params, 'userId');
    void userId;

    // 1. Re-fetch the canonical comment body straight from the topic thread.
    //    Works for an agent comment (no chat_messages row) and an operator
    //    message alike — there is NO getChatMessageByUuid dependency.
    let comments: CommentLike[];
    try {
      comments = (await ctx.issues.listComments(
        topicIssueId,
        companyId,
      )) as unknown as CommentLike[];
    } catch (e) {
      ctx.logger?.warn?.('chat.promote: listComments failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'NOT_FOUND' };
    }

    const sourceComment = (comments ?? []).find((c) => c.id === commentId);
    if (!sourceComment) {
      // The comment is not in this topic thread (or another company's) —
      // structurally not reachable, treat as not found (T-04-16).
      return { error: 'NOT_FOUND' };
    }
    const body = sourceComment.body ?? '';

    // 2. Create the real task issue, linked back to the topic issue (D-13).
    let issue: { id: string };
    try {
      issue = await ctx.issues.create({
        companyId,
        parentId: topicIssueId,
        title: titleFromBody(body),
        description:
          `Promoted from a chat message.\n\n` +
          `Original message:\n${body}`,
        status: 'todo',
        originKind: 'plugin:clarity-pack',
        originId: `chat-promote-${commentId}`,
      });
    } catch (e) {
      ctx.logger?.warn?.('chat.promote: issues.create failed', {
        companyId,
        commentId,
        err: (e as Error).message,
      });
      return { error: 'PROMOTE_FAILED' };
    }

    return { ok: true, issueId: issue.id, topicIssueId };
  });
}
