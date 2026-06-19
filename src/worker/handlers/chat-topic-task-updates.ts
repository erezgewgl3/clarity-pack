// src/worker/handlers/chat-topic-task-updates.ts
//
// quick-260619-r4v Piece 3 — chat.topicTaskUpdates DATA handler.
//
// In-thread live task-update cards (loop closure, Approach A = read-time
// reflection). For the OPEN topic only, enumerate its linked tasks
// (chat_topic_tasks side table, cap ~20), enrich each via ctx.issues.get for
// { identifier, status, assignee }, and read the latest AGENT-authored comment
// via ctx.issues.listComments(taskIssueId). The agent comment is polished via
// polishTldr (operator-authored comments are NEVER selected/polished). A
// stuck task (isTopicStuck) carries blocked:true + the named recovery action.
//
// HARD INVARIANT (anti-storm, load-bearing — pinned by the test's anti-storm
// guard across populated AND empty inputs): this handler performs
//   - ZERO ctx.issues.list   (the side table is the enumeration source;
//                              the host silently ignores originId filters)
//   - ZERO writes            (no create / update / createComment / db.execute)
//   - ZERO requestWakeup
//   - ZERO event subscriptions
// All host reads (issues.get / listComments / db.query) run INSIDE the
// existing data-handler dispatch → invocation-scope-safe (PR #6547). This is
// what makes the Phase-16.1 wake-storm structurally impossible.
//
// Scope: this handler is INDEPENDENT of chat.messages and the company-wide
// rail (chat.taskOwned). It is per-THIS-topic and read-only.
//
// NO_UUID_LEAK scrub applied to every returned display string (assignee,
// latest-comment text, named action).

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listChatTopicTasksForTopicAll,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';
import { isTopicStuck } from '../chat/topic-watchdog.ts';
import { polishTldr } from '../agents/compile-tldr.ts';
import { UUID_RE, UUID_RE_G } from '../../shared/scrub-human-action.ts';

export type ChatTopicTaskUpdatesCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

/** Per-topic card cap (independent of the rail's 50). */
const TOPIC_CARD_CAP = 20;

const UNASSIGNED_LABEL = 'Unassigned';

/** Belt-and-suspenders NO_UUID_LEAK strip for any rendered string. */
function stripUuids(s: string): string {
  return s.replace(UUID_RE_G, '').replace(/\s{2,}/g, ' ').trim();
}

type CommentLike = {
  id?: string;
  body?: string;
  createdAt?: Date | string;
  authorUserId?: string | null;
  authorAgentId?: string | null;
};

type IssueLike = {
  id?: string;
  identifier?: string;
  status?: string;
  assignee?: { id?: unknown; name?: unknown } | null;
  assigneeName?: unknown;
  activeRecoveryAction?: { recoveryOwnerName?: string | null } | null;
  successfulRunHandoff?: { exhausted?: boolean } | null;
};

type TaskUpdateCard = {
  issueId: string;
  identifier: string;
  status: string;
  assignee: string;
  latestComment: { text: string; createdAt: string } | null;
  blocked: boolean;
  blockedAction: string | null;
};

/** Resolve a NO_UUID_LEAK-safe LIVE assignee display label. */
function resolveAssigneeLabel(row: IssueLike): string {
  const candidates: unknown[] = [row.assignee?.name, row.assigneeName];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed.length > 0 && !UUID_RE.test(trimmed)) return trimmed;
    }
  }
  return UNASSIGNED_LABEL;
}

/** Coerce a host createdAt to a stable string the UI can render. */
function coerceCreatedAt(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.length > 0) return v;
  return '';
}

/**
 * Pick the NEWEST AGENT-authored comment from a task's comment list. For task
 * issues there is no operator chat-row, so an agent comment is one with
 * authorAgentId set and no authorUserId. Operator comments are never selected.
 * Returns the polished + scrubbed text + its createdAt, or null when none.
 */
function pickLatestAgentComment(
  comments: CommentLike[],
): { text: string; createdAt: string } | null {
  let best: CommentLike | null = null;
  let bestMs = -Infinity;
  for (const c of comments) {
    const isAgent = !!c.authorAgentId && !c.authorUserId;
    if (!isAgent) continue;
    if (typeof c.body !== 'string' || c.body.trim().length === 0) continue;
    const ms = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    const safeMs = Number.isNaN(ms) ? 0 : ms;
    if (safeMs >= bestMs) {
      bestMs = safeMs;
      best = c;
    }
  }
  if (!best || typeof best.body !== 'string') return null;
  const text = stripUuids(polishTldr(best.body));
  if (text.length === 0) return null;
  return { text, createdAt: coerceCreatedAt(best.createdAt) };
}

export function registerChatTopicTaskUpdates(ctx: ChatTopicTaskUpdatesCtx): void {
  wrapDataHandler(ctx, 'chat.topicTaskUpdates', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const topicIssueId =
      typeof params?.topicIssueId === 'string' && params.topicIssueId
        ? params.topicIssueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!topicIssueId) return { error: 'TOPIC_ISSUE_ID_REQUIRED' as const };

    // Side-table SELECT — per-topic enumeration source. NEVER ctx.issues.list.
    let taskIssueIds: string[];
    try {
      taskIssueIds = await listChatTopicTasksForTopicAll(
        ctx,
        companyId,
        topicIssueId,
        TOPIC_CARD_CAP,
      );
    } catch (e) {
      ctx.logger?.warn?.('chat.topicTaskUpdates: side-table SELECT failed', {
        companyId,
        topicIssueId,
        err: (e as Error).message,
      });
      return { error: 'TASKS_FAILED' as const };
    }

    const total = taskIssueIds.length;
    const capped = total >= TOPIC_CARD_CAP;

    if (total === 0) {
      return {
        kind: 'topicTaskUpdates' as const,
        topicIssueId,
        cards: [],
        total: 0,
        shown: 0,
        capped: false,
        skipped: 0,
      };
    }

    // Bounded-PARALLEL per-task enrich. Each task does 1 issues.get + 1
    // listComments, both in-dispatch. A per-row failure degrades to a counted
    // skip rather than failing the whole response.
    type EnrichResult = { ok: true; card: TaskUpdateCard } | { ok: false };
    const enriched = await Promise.all(
      taskIssueIds.map(async (taskIssueId): Promise<EnrichResult> => {
        let row: IssueLike | null;
        try {
          row = (await ctx.issues.get(taskIssueId, companyId)) as IssueLike | null;
        } catch (e) {
          ctx.logger?.warn?.('chat.topicTaskUpdates: per-row issues.get failed — counted as skipped', {
            taskIssueId,
            err: (e as Error).message,
          });
          return { ok: false };
        }
        if (!row) {
          ctx.logger?.warn?.('chat.topicTaskUpdates: per-row issues.get null — counted as skipped', {
            taskIssueId,
          });
          return { ok: false };
        }

        // Blocked / did-not-complete signal (reuse isTopicStuck — do NOT call
        // its write paths). The named recovery action surfaces the human step.
        const blocked = isTopicStuck(row);
        let blockedAction: string | null = null;
        if (blocked && row.activeRecoveryAction) {
          const raw = row.activeRecoveryAction.recoveryOwnerName ?? null;
          blockedAction = raw ? stripUuids(raw) || null : null;
        }

        // Latest agent comment (best-effort: a read failure degrades the card
        // to status-only, never fails the whole response).
        let latestComment: { text: string; createdAt: string } | null = null;
        try {
          const comments = (await ctx.issues.listComments(
            taskIssueId,
            companyId,
          )) as unknown as CommentLike[];
          latestComment = pickLatestAgentComment(comments ?? []);
        } catch (e) {
          ctx.logger?.warn?.('chat.topicTaskUpdates: listComments failed — status-only card', {
            taskIssueId,
            err: (e as Error).message,
          });
        }

        return {
          ok: true,
          card: {
            issueId: (row.id as string) ?? taskIssueId,
            identifier: stripUuids((row.identifier as string) ?? taskIssueId) || taskIssueId,
            status: (row.status as string) ?? 'todo',
            assignee: resolveAssigneeLabel(row),
            latestComment,
            blocked,
            blockedAction,
          },
        };
      }),
    );

    const cards: TaskUpdateCard[] = [];
    let skipped = 0;
    for (const r of enriched) {
      if (!r.ok) {
        skipped += 1;
        continue;
      }
      cards.push(r.card);
    }

    return {
      kind: 'topicTaskUpdates' as const,
      topicIssueId,
      cards,
      total,
      shown: cards.length,
      capped,
      skipped,
    };
  });
}
