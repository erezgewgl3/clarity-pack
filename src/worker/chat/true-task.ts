// src/worker/chat/true-task.ts
//
// Plan 04.1-02 — D-04 / D-05 / D-06 / D-07 — the shared "create a true task"
// helper. One mechanism, two entry points:
//
//   - chat.createTrueTask (operator composer path, src/worker/handlers/chat-true-task.ts)
//   - chat.promote        (agent-message Promote path, src/worker/handlers/chat-promote.ts — REWRITTEN to delegate here)
//
// Both produce IDENTICAL host-side artifacts: a TOP-LEVEL Paperclip issue
// (D-05 — never parented under the chat topic, the exact bug the Phase 4
// followup identifies) with assigneeAgentId set (D-06 — never unassigned)
// plus a marker comment on the topic issue (D-07 — durable back-link survives
// plugin disable).
//
// Marker classification: the marker body is plugin-authored so the chat-
// messages classifyComment (Plan 04.1-04) returns 'conversation' for it
// natively (authorType ≠ 'system'). The exact wording is locked here AND
// pinned by Test 6 of test/worker/chat/true-task.test.mjs so a future change
// cannot accidentally make the marker match RUNTIME_PHRASES (Pitfall 4).
//
// originKind 'plugin:clarity-pack' (NOT the 'plugin:clarity-pack:operation:*'
// namespace — that namespace triggers the Editor-Agent self-loop filter,
// RESEARCH §Pattern 1 footnote).
//
// Best-effort durability: a marker-comment write failure after a successful
// issue create does NOT fail the helper — the issueId is the authoritative
// back-link via originId. The handler returns { ok: true, issueId }. A
// warn-level log records the marker failure so it stays diagnosable.

import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
// Plan 04.1-05 retrofit (cross-plan, [Rule 3] per Wave 1 lock): every
// successful task create writes a best-effort back-link to the
// chat_topic_tasks side table. chat.taskOwned reads via this table
// because the host REST issues.list silently ignores originId filters
// (04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER). Best-effort symmetry with
// the marker-comment write: try/catch + warn-log; failure NEVER bubbles.
import { insertChatTopicTask, type ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

export type TrueTaskCtx = {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
  // Optional `db` -- the retrofit side-table write is opt-in: a caller
  // that does not thread `db` (older test fixtures, dev-only paths)
  // simply skips the back-link. Production callers (chat-true-task.ts,
  // chat-promote.ts) thread ctx.db transparently because PluginContext
  // carries it.
  db?: ChatTopicsRepoCtx['db'];
};

export type CreateTrueTaskInput = {
  companyId: string;
  title: string;
  description: string;
  /** D-06 — NEVER omitted. The chat-topic's employee-agent by default, reassignable in the dialog. */
  assigneeAgentId: string;
  /**
   * Topic issue id, OR null for a COLD task (Plan 04.1-08).
   * - string: chat-anchored task (the marker comment + side-table back-link
   *   are written; originId is `chat-task:<topic>:<source|composer>`).
   * - null:   COLD task. NO marker comment (no topic to mark). NO side-table
   *   back-link (not linked to any topic). originId is
   *   `cold-task:<userId>:<unix-ms>` — distinct prefix so chat.taskOwned
   *   does NOT pick it up for any topic.
   */
  topicIssueId: string | null;
  /** Comment id this task came from. null when called direct from the operator composer (no source message). */
  sourceCommentId: string | null;
  /** Plain-English employee name interpolated into the marker comment body (D-07). */
  employeeName: string;
  /** Plan 04.1-08 — required for COLD tasks to compose the cold-task originId.
   *  Ignored when topicIssueId is a string (chat-anchored path). */
  userId?: string | null;
};

/**
 * Create a true task — a top-level, assigned Paperclip issue plus (for
 * chat-anchored tasks) a marker comment on the chat topic. Re-throws on
 * ctx.issues.create failure; the marker write is best-effort (a failed
 * marker still returns { issueId }).
 *
 * Plan 04.1-08 — when input.topicIssueId === null, the cold-task path runs:
 * originId is `cold-task:<userId>:<unix-ms>`, NO marker comment, NO
 * chat_topic_tasks side-table back-link. The task is fully top-level (no
 * topic association) so chat.taskOwned NEVER returns it for any topic.
 */
export async function createTrueTask(
  ctx: TrueTaskCtx,
  input: CreateTrueTaskInput,
): Promise<{ issueId: string }> {
  // Plan 04.1-08 — COLD vs chat-anchored task discrimination.
  // `input.topicIssueId === null` literally (NOT falsy — a deliberate strict
  // check so empty string and other falsy values cannot accidentally trigger
  // the cold path).
  const isCold = input.topicIssueId === null;

  // D-05 — TOP-LEVEL: the new task lives in the normal Paperclip Issues list,
  // NOT nested under the chat topic. The originId back-link is the
  // authoritative provenance pointer. We deliberately do NOT pass a parent-
  // pointer field on the create payload.
  const originId = isCold
    ? `cold-task:${input.userId ?? 'unknown'}:${Date.now()}`
    : `chat-task:${input.topicIssueId}:${input.sourceCommentId ?? 'composer'}`;

  const issue = await ctx.issues.create({
    companyId: input.companyId,
    title: input.title,
    description: input.description,
    status: 'todo',
    assigneeAgentId: input.assigneeAgentId,
    originKind: 'plugin:clarity-pack',
    originId,
  });

  // COLD path: no topic to mark, no side-table to populate; return early.
  if (isCold) {
    return { issueId: issue.id };
  }

  // D-07 — marker comment on the topic issue. Plugin-authored, so a future
  // classifyComment (Plan 04.1-04) returns 'conversation' for it. The wording
  // is LOCKED and pinned by test 6 of true-task.test.mjs (Pitfall 4 — must
  // never overlap RUNTIME_PHRASES).
  const topicIssueId = input.topicIssueId as string;
  const markerBody = `Task created — ${issue.id}, assigned to ${input.employeeName}.`;
  try {
    await ctx.issues.createComment(topicIssueId, markerBody, input.companyId);
  } catch (e) {
    // Best-effort durability: the originId carries the authoritative back-
    // reference; the marker is the in-thread artifact. A marker failure must
    // not make the operator see the task as failed.
    ctx.logger?.warn?.('createTrueTask: marker createComment failed', {
      topicIssueId,
      issueId: issue.id,
      err: (e as Error).message,
    });
  }

  // Plan 04.1-05 retrofit (cross-plan per Wave 1 lock) — write the
  // topic → task back-link to the chat_topic_tasks side table so
  // chat.taskOwned (D-08) can list the topic's spun-off tasks. The
  // REST issues.list surface silently ignores originId filters on this
  // host (04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER), so this side table
  // is the steady-state lookup path. Best-effort symmetry with the
  // marker write above: try/catch + warn-log; failure never bubbles.
  // The repo helper carries ON CONFLICT DO NOTHING for race-safety.
  if (ctx.db) {
    try {
      await insertChatTopicTask(
        { db: ctx.db },
        input.companyId,
        topicIssueId,
        issue.id,
      );
    } catch (e) {
      ctx.logger?.warn?.('createTrueTask: chat_topic_tasks side-table write failed', {
        topicIssueId,
        issueId: issue.id,
        err: (e as Error).message,
      });
    }
  }

  return { issueId: issue.id };
}

/**
 * Derive a concise issue title from a (possibly long) message body.
 *
 * Extracted from the Phase 4 chat-promote.ts:55-59 verbatim — kept stable so
 * the chat.promote rewrite (Task 3) and chat.createTrueTask (Task 2) both
 * produce identical titles for identical bodies.
 */
export function titleFromBody(body: string): string {
  const firstLine = body.split('\n')[0].trim();
  if (firstLine.length <= 80) return firstLine || 'Promoted chat message';
  return `${firstLine.slice(0, 77)}...`;
}
