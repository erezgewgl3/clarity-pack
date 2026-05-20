// src/worker/handlers/chat-archived-topics.ts
//
// Plan 04.1-08 — NEW data handler. Lists every ARCHIVED chat topic for an
// employee+company, sorted newest-archived-first. Powers the archive panel
// (src/ui/surfaces/chat/archive-panel.tsx).
//
// Behavior:
//   1. wrapDataHandler — opted-out callers get { error: 'OPT_IN_REQUIRED' }
//      before any DB call (T-04-15, OPTIN-04). The data-handler convention
//      RETURNS errors (does not throw).
//   2. Required params (companyId, userId, employeeAgentId) are validated via
//      a missing-required-string check that RETURNS the error (data-handler
//      convention; throwing would surface a CALL_FAILED to the UI).
//   3. The DB SELECT runs via listArchivedChatTopicsForEmployee — it
//      ORDER BY archived_at DESC NULLS LAST so panel rows render
//      newest-archived-first AND any rows archived before migration 0008
//      (archived_at is NULL) still appear (they sort last by last_activity_at).
//   4. Best-effort `messageCount`: a count of conversation comments on the
//      topic issue would require a JOIN we can do via a second query, but
//      the host's ctx.issues.listComments is one-issue-at-a-time and an N+1
//      panel-open call is expensive at scale. Plan 04.1-08 ships
//      messageCount=0 by default; a future plan can populate it via the
//      side-table chat_messages count or via a host-supplied summary view.
//
// SECURITY: namespace-scoped SELECT only (no DML); no raw fetch.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listArchivedChatTopicsForEmployee,
  type ChatTopicsRepoCtx,
  type ChatTopicRow,
} from '../db/chat-topics-repo.ts';

export type ChatArchivedTopicsCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    issues?: PluginIssuesClient;
    logger?: PluginLogger;
  };

/** Shape the archive-panel UI consumes. */
export type ArchivedTopicEntry = {
  topicIssueId: string;
  topicId: string;
  title: string;
  /** The employee-agent id (UI looks up display name via chat.roster). */
  employeeAgentId: string;
  messageCount: number;
  lastActiveAt: string;
  archivedAt: string | null;
};

function mapArchivedTopic(row: ChatTopicRow): ArchivedTopicEntry {
  return {
    topicIssueId: row.issue_id,
    topicId: row.topic_id,
    title: row.title,
    employeeAgentId: row.employee_agent_id,
    // Plan 04.1-08 — messageCount is best-effort 0 in v1; a future plan can
    // join against chat_messages or host listComments to populate it.
    messageCount: 0,
    lastActiveAt: row.last_activity_at,
    archivedAt: row.archived_at ?? null,
  };
}

function readStr(params: Record<string, unknown> | undefined, key: string): string | null {
  const v = params?.[key];
  return typeof v === 'string' && v ? v : null;
}

export function registerChatArchivedTopics(ctx: ChatArchivedTopicsCtx): void {
  wrapDataHandler(ctx, 'chat.archivedTopics', async (params) => {
    const companyId = readStr(params, 'companyId');
    const userId = readStr(params, 'userId');
    const employeeAgentId = readStr(params, 'employeeAgentId');

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' };
    if (!userId) return { error: 'USER_ID_REQUIRED' };
    if (!employeeAgentId) return { error: 'EMPLOYEE_AGENT_ID_REQUIRED' };

    try {
      const rows = await listArchivedChatTopicsForEmployee(
        ctx,
        companyId,
        employeeAgentId,
      );
      return {
        kind: 'archivedTopics' as const,
        topics: rows.map(mapArchivedTopic),
      };
    } catch (e) {
      ctx.logger?.warn?.('chat.archivedTopics: query failed', {
        companyId,
        employeeAgentId,
        err: (e as Error).message,
      });
      return { error: 'ARCHIVED_TOPICS_FAILED' };
    }
  });
}
