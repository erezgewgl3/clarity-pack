// src/worker/streams/chat-stream-bridge.ts
//
// Plan 04-03 Task C — CHAT-04 / D-08 — the chat realtime stream bridge.
//
// usePluginStream is a PLUGIN-defined SSE channel, not a native event feed.
// The realtime wiring is: the worker subscribes to the core
// `issue.comment.created` event (PLUGIN_SPEC.md §16), and for events that
// belong to a CHAT TOPIC issue, re-emits onto a per-company plugin stream
// channel `chat:<companyId>` via ctx.streams.emit. The UI consumes the
// relayed channel via usePluginStream(`chat:<companyId>`). CHAT-04's literal
// "usePluginStream subscribed to issue.comment.created" is satisfied by this
// bridge — the worker subscribes to the native event, the UI to the channel.
//
// T-04-11 — the bridge emits ONLY when getChatTopicByIssueId returns a row,
// so comments on ordinary (non-chat) issues are never relayed; the channel is
// company-scoped so a tab subscribes only to its own company's stream.
//
// OQ-2 (04-01-SPIKE-FINDINGS): the issue.comment.created event payload is
// opaque — it carries entityId but not the new comment id. Per the spike
// design input the bridge derives the comment via a ctx.issues.listComments
// re-fetch and emits the NEWEST comment id (RESEARCH Assumption A1).
//
// T-04-12 — the entire handler body is wrapped in try/catch + logger.warn; a
// throwing event handler must never crash the worker process.

import type {
  PluginEventsClient,
  PluginStreamsClient,
  PluginIssuesClient,
  PluginLogger,
  IssueComment,
} from '@paperclipai/plugin-sdk';
import { getChatTopicByIssueId, type ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

export type ChatStreamBridgeCtx = ChatTopicsRepoCtx & {
  events: PluginEventsClient;
  streams: PluginStreamsClient;
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

/** Coerce a host createdAt (Date | string | undefined) to an epoch ms. */
function createdAtMs(comment: IssueComment): number {
  const raw = (comment as { createdAt?: Date | string }).createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Return the id of the most-recently-created comment, or null. */
function newestCommentId(comments: IssueComment[]): string | null {
  if (!comments || comments.length === 0) return null;
  let newest = comments[0];
  for (const c of comments) {
    if (createdAtMs(c) > createdAtMs(newest)) newest = c;
  }
  return (newest as { id?: string }).id ?? null;
}

export function registerChatStreamBridge(ctx: ChatStreamBridgeCtx): void {
  ctx.events.on('issue.comment.created', async (event) => {
    // Guard nulls FIRST — a malformed event must not throw or emit.
    if (!event.entityId || !event.companyId) return;
    const issueId = event.entityId;
    const companyId = event.companyId;

    try {
      // Relay only chat-topic comments (T-04-11).
      const topic = await getChatTopicByIssueId(ctx, companyId, issueId);
      if (!topic) return;

      // OQ-2: the event payload is opaque — re-fetch to derive the comment id.
      let commentId: string | null = null;
      try {
        const comments = await ctx.issues.listComments(issueId, companyId);
        commentId = newestCommentId(comments);
      } catch (e) {
        // A failed re-fetch still lets the UI know something changed; emit
        // with a null commentId so the UI can fall back to a poll refresh.
        ctx.logger?.warn?.('chat-stream-bridge: listComments re-fetch failed', {
          issueId,
          err: (e as Error).message,
        });
        return;
      }

      ctx.streams.emit(`chat:${companyId}`, {
        type: 'comment.created',
        issueId,
        commentId,
        occurredAt: event.occurredAt,
      });
    } catch (err) {
      // T-04-12 — never let a throwing handler crash the worker.
      ctx.logger?.warn?.('chat-stream-bridge: handler threw', {
        issueId,
        err: (err as Error).message,
      });
    }
  });
}
