// src/worker/handlers/chat-active-tasks.ts
//
// Plan 04.1-05 Task 2 -- chat.taskOwned DATA handler (D-08).
//
// Returns every true task spawned from one chat topic with live status,
// for Plan 04.1-06's ActiveTasksOwned context-rail extension.
//
// Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER (REST returns
// the 500-row cap regardless of originId; exact-match returns 0 even
// when the row exists): the active-tasks query CANNOT depend on
// `ctx.issues.list({originKind, originId})`. The handler reads the
// `chat_topic_tasks` plugin-namespace side table -- populated by
// createTrueTask's retrofit best-effort write (Plan 04.1-02 helper
// extended in Plan 04.1-05 Task 2 wiring) -- and enriches each row via
// `ctx.issues.get` for current { identifier, title, status, createdAt }.
//
// This pattern bounds the host RPC fan-out: listChatTopicTasksForTopic
// has LIMIT 50 in the repo, so a runaway topic cannot blow up the rail
// or the host's RPC budget. Per-row failures are skipped (a deleted-out-
// of-band task does NOT fail the whole response). A side-table SELECT
// failure returns { error: 'TASKS_FAILED' } + warn-log.
//
// Pitfall 5 anti-regression: this handler does NOT call ctx.issues.list
// (Test 10 in chat-active-tasks.test.mjs pins zero invocations across
// the populated and empty paths).
//
// Data-handler convention (mirrors chat-topics.ts):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//     (never throw -- data handlers carry structured errors)
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }
//     (via wrapDataHandler -- T-04-15; fires BEFORE the body)

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listChatTopicTasksForTopic,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatActiveTasksCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

type ActiveTaskEntry = {
  issueId: string;
  identifier: string;
  title: string;
  status: string;
  createdAt: string | null;
};

/**
 * Coerce the host's createdAt (Date | string | null | undefined) to a
 * stable string|null shape the UI can render without re-parsing. A Date
 * becomes its ISO string; a string passes through; anything else is null.
 */
function coerceCreatedAt(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

export function registerChatActiveTasks(ctx: ChatActiveTasksCtx): void {
  wrapDataHandler(ctx, 'chat.taskOwned', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!topicIssueId) return { error: 'TOPIC_ISSUE_ID_REQUIRED' as const };

    // Side-table SELECT -- the steady-state D-08 path (Wave 1 lock per
    // 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER).
    let taskIssueIds: string[];
    try {
      taskIssueIds = await listChatTopicTasksForTopic(ctx, companyId, topicIssueId);
    } catch (e) {
      ctx.logger?.warn?.('chat.taskOwned: side-table SELECT failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'TASKS_FAILED' as const };
    }

    if (taskIssueIds.length === 0) {
      return { kind: 'taskOwned' as const, topicIssueId, tasks: [] };
    }

    // Per-row enrich via ctx.issues.get. Failures + null returns are
    // silently skipped so a deleted-out-of-band task does NOT fail the
    // whole response (the rail still renders the surviving tasks).
    const tasks: ActiveTaskEntry[] = [];
    for (const taskIssueId of taskIssueIds) {
      let row: {
        id?: string;
        identifier?: string;
        title?: string;
        status?: string;
        createdAt?: Date | string | null;
      } | null;
      try {
        row = (await ctx.issues.get(taskIssueId, companyId)) as {
          id?: string;
          identifier?: string;
          title?: string;
          status?: string;
          createdAt?: Date | string | null;
        } | null;
      } catch (e) {
        ctx.logger?.warn?.('chat.taskOwned: per-row issues.get failed -- skipping', {
          taskIssueId,
          err: (e as Error).message,
        });
        continue;
      }
      if (!row) {
        ctx.logger?.warn?.('chat.taskOwned: per-row issues.get returned null -- skipping', {
          taskIssueId,
        });
        continue;
      }
      tasks.push({
        issueId: row.id ?? taskIssueId,
        identifier: row.identifier ?? taskIssueId,
        title: row.title ?? '(untitled task)',
        status: row.status ?? 'todo',
        createdAt: coerceCreatedAt(row.createdAt),
      });
    }

    return { kind: 'taskOwned' as const, topicIssueId, tasks };
  });
}
