// src/worker/handlers/chat-edit.ts
//
// Plan 04-03 Task B — CHAT-05 / D-11 — the chat.edit action handler.
//
// Paperclip exposes issue.comment.created but NO issue.comment.updated event
// (PLUGIN_SPEC.md §16) — comments are effectively append-only at the host. An
// "edit" therefore writes a NEW comment carrying a supersedes link to the
// prior message; the original comment is NEVER mutated. The chat UI renders
// the superseding comment; classic Paperclip shows both as ordinary threaded
// comments — an acceptable divergence, not a defect.
//
// Server-side ownership re-check (T-04-09 / ASVS V4): under the same-origin
// trust model the UI-supplied priorMessageUuid cannot be trusted. Before
// appending, the handler looks up the prior chat_messages row and confirms it
// exists AND has sender_kind === 'user'. Editing an agent reply — or a message
// that does not exist — returns { error: 'NOT_OWNED' }. (chat_messages rows
// are company-scoped, so a cross-company edit is already blocked by the
// company_id filter in getChatMessageByUuid.)
//
// Wrapped via opt-in-guard's wrapActionHandler.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  getChatMessageByUuid,
  insertChatMessage,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatEditCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.edit: ${key} required`);
}

export function registerChatEdit(ctx: ChatEditCtx): void {
  wrapActionHandler(ctx, 'chat.edit', async (params) => {
    const topicIssueId = reqStr(params, 'topicIssueId');
    const priorMessageUuid = reqStr(params, 'priorMessageUuid');
    const newMessageUuid = reqStr(params, 'newMessageUuid');
    const newBody = reqStr(params, 'newBody');
    const companyId = reqStr(params, 'companyId');
    const userId = reqStr(params, 'userId');
    void userId;

    // Ownership re-check (T-04-09) — the prior message must exist and be a
    // user message. An agent reply or an unknown uuid is not editable.
    const prior = await getChatMessageByUuid(ctx, companyId, priorMessageUuid);
    if (!prior || prior.sender_kind !== 'user') {
      return { error: 'NOT_OWNED' };
    }

    // Append-with-supersedes (D-11, CHAT-05) — write the edited body as a NEW
    // comment. The original comment is never touched.
    let comment: { id: string };
    try {
      comment = await ctx.issues.createComment(topicIssueId, newBody, companyId);
    } catch (e) {
      ctx.logger?.warn?.('chat.edit: createComment failed', {
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'EDIT_FAILED' };
    }

    await insertChatMessage(ctx, {
      message_uuid: newMessageUuid,
      company_id: companyId,
      topic_issue_id: topicIssueId,
      comment_id: comment.id,
      sender_kind: 'user',
      supersedes_uuid: priorMessageUuid,
      pinned: false,
      sent_at: new Date().toISOString(),
    });

    return { ok: true, commentId: comment.id };
  });
}
