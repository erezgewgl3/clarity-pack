// src/worker/handlers/chat-promote.ts
//
// Plan 04.1-02 — D-04 unification: chat.promote (the agent-message Promote
// path) now produces the SAME assigned, top-level true task as the operator-
// composer chat.createTrueTask path. Both delegate to createTrueTask
// (src/worker/chat/true-task.ts). The old behaviour (nesting the new task
// under the topic issue + leaving it unassigned in `todo`) is REMOVED, not
// kept alongside — the Phase 4 followup bug ("orphan task nested under
// plugin plumbing, nobody acts on it") is impossible by construction.
//
// chat.promote turns a single agent chat message into a real Paperclip task
// issue. The UI now threads two NEW required params through PromoteActions:
// `assigneeAgentId` (the chatted employee-agent — D-06 wake contract) and
// `employeeName` (the marker-comment copy — D-07). The pre-helper steps are
// KEPT verbatim:
//   1. The UI supplies `commentId` + `topicIssueId` (PromoteActions holds both).
//   2. The canonical comment body is re-fetched from the topic thread via
//      ctx.issues.listComments(topicIssueId, companyId) and the matching
//      comment located by id. The caller never supplies the body — it is read
//      from public.issue_comments (CHAT-02).
//   3. createTrueTask creates the top-level assigned issue + posts the D-07
//      marker comment on the topic issue.
//
// GAP 12 — host-contract audit fix (still applies). The promote button sits
// on AGENT messages. PITFALL #4: the chat_messages side table is operator-
// write-only — an agent comment has NO chat_messages row. Resolving by
// comment id straight from the thread (NOT via getChatMessageByUuid) is the
// fix. KEPT.
//
// Ownership scoping (T-04-16): ctx.issues.listComments is company-scoped by
// the host, so a comment on another company's topic is not reachable. A
// commentId not present in the named topic thread → { error: 'NOT_FOUND' }.
//
// Wrapped via opt-in-guard's wrapActionHandler — THROWS on missing required
// params (action-handler convention), RETURNS structured errors on a host
// call failure or a not-found resolution.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';
import { createTrueTask, titleFromBody } from '../chat/true-task.ts';

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

export function registerChatPromote(ctx: ChatPromoteCtx): void {
  wrapActionHandler(ctx, 'chat.promote', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const commentId = reqStr(params, 'commentId');
    const topicIssueId = reqStr(params, 'topicIssueId');
    // Plan 04.1-02 — NEW required params (D-06 wake contract + D-07 marker).
    const assigneeAgentId = reqStr(params, 'assigneeAgentId');
    const employeeName = reqStr(params, 'employeeName');
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

    // 2. Delegate to the shared helper — D-04 single mechanism. Produces a
    //    top-level (NOT nested under the topic) assigned issue plus a D-07 marker comment
    //    on the topic.
    try {
      const result = await createTrueTask(ctx, {
        companyId,
        title: titleFromBody(body),
        description: `Promoted from a chat message.\n\nOriginal message:\n${body}`,
        assigneeAgentId,
        topicIssueId,
        sourceCommentId: commentId,
        employeeName,
      });
      return { ok: true, issueId: result.issueId, topicIssueId };
    } catch (e) {
      ctx.logger?.warn?.('chat.promote: createTrueTask failed', {
        companyId,
        commentId,
        err: (e as Error).message,
      });
      return { error: 'PROMOTE_FAILED' };
    }
  });
}
