// src/worker/handlers/chat-true-task.ts
//
// Plan 04.1-02 — D-01 / D-02 / D-05 / D-06 / D-07 — the chat.createTrueTask
// action handler. The operator-composer entry point onto the shared
// createTrueTask helper (src/worker/chat/true-task.ts). One mechanism;
// chat.promote (rewritten in Plan 04.1-02 Task 3) delegates to the same
// helper for the agent-message Promote variant.
//
// Behaviour:
//   1. Wrapped via opt-in-guard's wrapActionHandler — opted-out callers get
//      { error: 'OPT_IN_REQUIRED' } before any host call (T-04-15, OPTIN-04).
//   2. Required params validated via reqStr — THROWS on a missing required
//      string param (the action-handler convention, same shape as chat.send /
//      chat.promote).
//   3. sourceCommentId is optional and defaults to null — null is the
//      "operator typed a task directly into the composer with no source
//      message" path (originId tail "composer"). A string sourceCommentId is
//      the "operator promoted an existing message" path (originId tail is
//      that comment id; supports the future operator-message Promote UX —
//      Plan 04.1-06 Task 1).
//   4. ctx.issues.create failure → { error: 'CREATE_FAILED' } AND a warn log.
//      Marker-comment failure after a successful create is non-fatal (the
//      helper swallows + warn-logs); the handler still returns
//      { ok: true, issueId } because the issueId via originId is the
//      authoritative back-link.
//
// No new capability strings — issues.create + issue.comments.create are
// already declared in the manifest (Plan 04 chat handlers established).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';
import { createTrueTask } from '../chat/true-task.ts';

export type ChatTrueTaskCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.createTrueTask: ${key} required`);
}

export function registerChatTrueTask(ctx: ChatTrueTaskCtx): void {
  wrapActionHandler(ctx, 'chat.createTrueTask', async (params) => {
    const companyId = reqStr(params, 'companyId');
    // quick-260619-r4v Piece 1 — topicIssueId is no longer COLD-accepting.
    // Every operator task is topic-linked. We accept:
    //   - topicIssueId string: link to that existing topic.
    //   - newTopicTitle non-empty (topicIssueId null/absent): atomic new-topic.
    //   - NEITHER: return { error: 'TOPIC_REQUIRED' } (cold path removed).
    const rawTopicIssueId = params?.topicIssueId;
    const topicIssueId: string | null =
      typeof rawTopicIssueId === 'string' && rawTopicIssueId ? rawTopicIssueId : null;
    const newTopicTitle =
      typeof params?.newTopicTitle === 'string' && params.newTopicTitle.trim()
        ? params.newTopicTitle.trim()
        : null;

    if (!topicIssueId && !newTopicTitle) {
      return { error: 'TOPIC_REQUIRED' };
    }

    const title = reqStr(params, 'title');
    const body = reqStr(params, 'body');
    const assigneeAgentId = reqStr(params, 'assigneeAgentId');
    const employeeName = reqStr(params, 'employeeName');
    // userId is enforced by the opt-in-guard wrapper; re-read defensively.
    const userId = reqStr(params, 'userId');

    // sourceCommentId is OPTIONAL — null when the operator composes a task
    // directly (no source message) — gives the originId tail "composer".
    const sourceCommentId =
      typeof params?.sourceCommentId === 'string' && params.sourceCommentId
        ? params.sourceCommentId
        : null;

    const description = 'Created from a chat composer message.\n\n' + 'Message body:\n' + body;

    try {
      const result = await createTrueTask(ctx, {
        companyId,
        title,
        description,
        assigneeAgentId,
        topicIssueId,
        newTopicTitle,
        sourceCommentId,
        employeeName,
        userId,
      });
      // Backwards-compatible response shape: existing chat-true-task tests
      // assert deepEqual on { ok, issueId, topicIssueId } — preserve that.
      // Plan 04.1-08: distinguishing cold vs chat-anchored is observable
      // via topicIssueId === null in the response.
      return { ok: true, issueId: result.issueId, topicIssueId };
    } catch (e) {
      ctx.logger?.warn?.('chat.createTrueTask: createTrueTask failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'CREATE_FAILED' };
    }
  });
}
