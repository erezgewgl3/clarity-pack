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
  listChatTopicTasksForCompany,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';
import { UUID_RE } from '../../shared/scrub-human-action.ts';
// Phase 19 Plan 19-03 (CARD-02 / D-09) — read-cached-only action-card attach for
// the Chat needs-you rail. Flag-gated (degrade-to-OFF), batch read, liveness-
// armed, projected to DISPLAY-only fields (rowToCardDisplay drops sourceIssueUuid
// — NO_UUID_LEAK). NEVER compiles (no driveActionCardsStep — the 19-02 static
// gate covers this handler).
import { isActionCardsEnabled } from '../db/action-cards-flag-repo.ts';
import { getActionCardsBySources } from '../db/action-cards-repo.ts';
import {
  rowToCardDisplay,
  isActionCardLive,
  type ActionCardDisplay,
} from '../agents/action-cards.ts';

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
  // Phase 19 Plan 19-03 (CARD-02 / D-09) — the Editor named-action card for this
  // task's leaf, attached read-only ONLY when the flag is ON and a FRESH cached
  // card exists; null otherwise → the rail floors to its deterministic line.
  // DISPLAY-only (sourceIssueUuid omitted, NO_UUID_LEAK, D-10).
  actionCard?: ActionCardDisplay | null;
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

/** quick-260619-r4v Piece 2 — company-wide enumerate cap (SPEC M=100). */
const COMPANY_TASK_CAP = 100;

/** quick-260619-r4v Piece 2 — the "Unassigned" bucket label. NO_UUID_LEAK:
 *  an assignee whose name strips to empty or is a bare UUID falls here. */
const UNASSIGNED_LABEL = 'Unassigned';

/**
 * quick-260619-r4v Piece 2 — resolve a LIVE assignee display label from an
 * issues.get row, NO_UUID_LEAK-safe. Prefers a human name; never returns a
 * raw UUID (falls back to "Unassigned"). Reads whatever assignee shape the
 * host returns (assignee.name / assigneeName), degrading defensively.
 */
function resolveAssigneeLabel(row: Record<string, unknown> | null): string {
  if (!row) return UNASSIGNED_LABEL;
  const assignee = row.assignee as { name?: unknown; id?: unknown } | null | undefined;
  const candidates: unknown[] = [
    assignee?.name,
    (row as { assigneeName?: unknown }).assigneeName,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed.length > 0 && !UUID_RE.test(trimmed)) return trimmed;
    }
  }
  return UNASSIGNED_LABEL;
}

export function registerChatActiveTasks(ctx: ChatActiveTasksCtx): void {
  wrapDataHandler(ctx, 'chat.taskOwned', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    // quick-260619-r4v Piece 2 — topicIssueId is accepted-and-ignored for
    // back-compat. The rail is now COMPANY-WIDE: it enumerates every chat-
    // created task and groups by LIVE assignee so a reassigned task follows
    // its owner. companyId + userId stay required.
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };

    // Company-wide side-table SELECT -- the steady-state path (Wave 1 lock per
    // 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER; NEVER ctx.issues.list). Bounded
    // at M=100 so a busy company cannot blow up the rail or the RPC budget.
    let taskIssueIds: string[];
    try {
      taskIssueIds = await listChatTopicTasksForCompany(ctx, companyId, COMPANY_TASK_CAP);
    } catch (e) {
      ctx.logger?.warn?.('chat.taskOwned: company-wide side-table SELECT failed', {
        companyId,
        err: (e as Error).message,
      });
      return { error: 'TASKS_FAILED' as const };
    }

    const total = taskIssueIds.length;
    const capped = total >= COMPANY_TASK_CAP;

    if (total === 0) {
      return {
        kind: 'taskOwned' as const,
        topicIssueId,
        tasks: [],
        groups: [],
        total: 0,
        shown: 0,
        capped: false,
        skipped: 0,
      };
    }

    // Bounded-PARALLEL enrich via ctx.issues.get (NOT sequential for…await).
    // Each row is wrapped so a single failure/null degrades to a counted skip
    // rather than failing the whole response or silently disappearing.
    type EnrichResult =
      | { ok: true; entry: ActiveTaskEntry; assignee: string }
      | { ok: false };
    const enriched = await Promise.all(
      taskIssueIds.map(async (taskIssueId): Promise<EnrichResult> => {
        let row: Record<string, unknown> | null;
        try {
          row = (await ctx.issues.get(taskIssueId, companyId)) as Record<string, unknown> | null;
        } catch (e) {
          ctx.logger?.warn?.('chat.taskOwned: per-row issues.get failed -- counted as skipped', {
            taskIssueId,
            err: (e as Error).message,
          });
          return { ok: false };
        }
        if (!row) {
          ctx.logger?.warn?.('chat.taskOwned: per-row issues.get returned null -- counted as skipped', {
            taskIssueId,
          });
          return { ok: false };
        }
        return {
          ok: true,
          entry: {
            issueId: (row.id as string) ?? taskIssueId,
            identifier: (row.identifier as string) ?? taskIssueId,
            title: (row.title as string) ?? '(untitled task)',
            status: (row.status as string) ?? 'todo',
            createdAt: coerceCreatedAt(row.createdAt),
          },
          assignee: resolveAssigneeLabel(row),
        };
      }),
    );

    const tasks: ActiveTaskEntry[] = [];
    // Preserve enumerate order (newest-first) inside each assignee group.
    const groupMap = new Map<string, ActiveTaskEntry[]>();
    let skipped = 0;
    for (const r of enriched) {
      if (!r.ok) {
        skipped += 1;
        continue;
      }
      tasks.push(r.entry);
      const bucket = groupMap.get(r.assignee) ?? [];
      bucket.push(r.entry);
      groupMap.set(r.assignee, bucket);
    }

    // Phase 19 Plan 19-03 (CARD-02 / D-09) — flag-gated, READ-ONLY cached-card
    // attach per active task (the task's `issueId` IS the action_cards
    // source_issue_id leaf). Degrade-safe: OFF / stale / absent / any read throw
    // → actionCard stays null → the rail floors to its deterministic line. NEVER
    // compiles (no driveActionCardsStep — CARD-01 static gate).
    try {
      if (tasks.length > 0 && (await isActionCardsEnabled(ctx, companyId))) {
        const leafUuids = tasks.map((t) => t.issueId).filter((x): x is string => !!x);
        if (leafUuids.length > 0) {
          const nowMs = Date.now();
          const rowsBySource = await getActionCardsBySources(ctx, companyId, leafUuids);
          for (const t of tasks) {
            const cardRow = rowsBySource[t.issueId];
            t.actionCard = cardRow && isActionCardLive(cardRow, nowMs) ? rowToCardDisplay(cardRow) : null;
          }
        }
      }
    } catch (e) {
      ctx.logger?.warn?.('chat.taskOwned: action-card cached read failed (floor)', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
    }

    // quick-260619-r4v Piece 2 — grouped-by-live-assignee response. `tasks`
    // stays flat (the action-card attach above + the inline-card title lookup
    // in message-thread.tsx both consume it; the grouped entries share the
    // same object references so the actionCard attach is reflected in both).
    const groups = Array.from(groupMap.entries()).map(([assignee, groupTasks]) => ({
      assignee,
      tasks: groupTasks,
    }));

    return {
      kind: 'taskOwned' as const,
      topicIssueId,
      tasks,
      groups,
      total,
      shown: tasks.length,
      capped,
      skipped,
    };
  });
}
