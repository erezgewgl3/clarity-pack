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
import {
  insertChatTopicTask,
  getEmployeeParentIssueId,
  insertEmployeeParent,
  allocateChtNumber,
  insertChatTopic,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';
// quick-260619-r4v Piece 1 — the atomic new-topic path mirrors chat.topic.create
// (chat-topics.ts). Reuse its two single-source-of-truth helpers: the parent
// issue title formatter and the non-terminal conversation status target.
import { formatParentIssueTitle } from '../handlers/chat-topics.ts';
import { NON_TERMINAL_CONVERSATION_STATUS } from './topic-watchdog.ts';

export type TrueTaskCtx = {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
  // Optional `db` -- the retrofit side-table write is opt-in: a caller
  // that does not thread `db` (older test fixtures, dev-only paths)
  // simply skips the back-link. Production callers (chat-true-task.ts,
  // chat-promote.ts) thread ctx.db transparently because PluginContext
  // carries it.
  //
  // quick-260619-r4v Piece 1: the atomic new-topic path REQUIRES `db` (it
  // allocates CHT-N + writes chat_topics + chat_employee_parents). A
  // newTopicTitle create with no `db` throws (caller must thread it).
  db?: ChatTopicsRepoCtx['db'];
};

export type CreateTrueTaskInput = {
  companyId: string;
  title: string;
  description: string;
  /** D-06 — NEVER omitted. The chat-topic's employee-agent by default, reassignable in the dialog. */
  assigneeAgentId: string;
  /**
   * Topic issue id.
   * - string: chat-anchored task against an EXISTING topic (the marker
   *   comment + side-table back-link are written; originId is
   *   `chat-task:<topic>:<source|composer>`).
   * - null:   no existing topic chosen. A non-empty `newTopicTitle` MUST be
   *   supplied — the atomic new-topic path creates the topic and links the
   *   task to it. quick-260619-r4v Piece 1 REMOVED the cold-task branch: a
   *   null topicIssueId with no newTopicTitle THROWS (the handler converts to
   *   a structured TOPIC_REQUIRED error). No operator task is ever cold.
   */
  topicIssueId: string | null;
  /** Comment id this task came from. null when called direct from the operator composer (no source message). */
  sourceCommentId: string | null;
  /** Plain-English employee name interpolated into the marker comment body (D-07). */
  employeeName: string;
  /** quick-260619-r4v Piece 1 — when topicIssueId is null and this is a
   *  non-empty string, the worker atomically creates a NEW chat topic
   *  (parent issue if needed + CHT-N + chat_topics row) and links the task
   *  to it. Ignored when topicIssueId is a string. */
  newTopicTitle?: string | null;
  /** Retained for back-compat with callers; no longer used to compose a
   *  cold-task originId (the cold path is removed). */
  userId?: string | null;
};

/**
 * Create a true task — a top-level, assigned Paperclip issue plus a marker
 * comment on the chat topic and a chat_topic_tasks back-link. Re-throws on a
 * topic/task create failure; the marker + back-link writes are best-effort.
 *
 * quick-260619-r4v Piece 1 — every operator-created task is topic-linked:
 *   - topicIssueId is a non-empty string → link to that EXISTING topic.
 *   - topicIssueId null + newTopicTitle non-empty → atomically create the
 *     topic (bootstrap parent if first-ever + CHT-N + chat_topics row), then
 *     link the task to it.
 *   - neither → THROW (no cold task path remains).
 */
export async function createTrueTask(
  ctx: TrueTaskCtx,
  input: CreateTrueTaskInput,
): Promise<{ issueId: string }> {
  const hasExistingTopic =
    typeof input.topicIssueId === 'string' && input.topicIssueId.length > 0;
  const newTopicTitle =
    typeof input.newTopicTitle === 'string' && input.newTopicTitle.trim().length > 0
      ? input.newTopicTitle.trim()
      : null;

  // quick-260619-r4v Piece 1 — resolve the topic issue id the task links to.
  // EXISTING topic → use as-is. NEW topic → create it atomically below.
  // NEITHER → throw (cold path removed; the handler maps this to
  // TOPIC_REQUIRED).
  let topicIssueId: string;
  if (hasExistingTopic) {
    topicIssueId = input.topicIssueId as string;
  } else if (newTopicTitle) {
    topicIssueId = await createTopicForTask(ctx, input, newTopicTitle);
  } else {
    throw new Error(
      'createTrueTask: a topicIssueId OR a non-empty newTopicTitle is required (cold tasks are not allowed)',
    );
  }

  // D-05 — TOP-LEVEL: the new task lives in the normal Paperclip Issues list,
  // NOT nested under the chat topic. The originId back-link is the
  // authoritative provenance pointer. We deliberately do NOT pass a parent-
  // pointer field on the create payload.
  const originId = `chat-task:${topicIssueId}:${input.sourceCommentId ?? 'composer'}`;

  const issue = await ctx.issues.create({
    companyId: input.companyId,
    title: input.title,
    description: input.description,
    status: 'todo',
    assigneeAgentId: input.assigneeAgentId,
    originKind: 'plugin:clarity-pack',
    originId,
  });

  // D-07 — marker comment on the topic issue. Plugin-authored, so a future
  // classifyComment (Plan 04.1-04) returns 'conversation' for it. The wording
  // is LOCKED and pinned by test 6 of true-task.test.mjs (Pitfall 4 — must
  // never overlap RUNTIME_PHRASES).
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
 * quick-260619-r4v Piece 1 — atomically create a NEW chat topic for a task
 * being created with `newTopicTitle` and no existing topic. Mirrors
 * chat.topic.create (chat-topics.ts:306-367): resolve/bootstrap the per-
 * employee parent issue, allocate CHT-N, create the child topic issue at the
 * non-terminal conversation status assigned to the employee-agent, and insert
 * the chat_topics metadata row.
 *
 * Returns the created topic's issue id. The topic + parent + chat_topics
 * writes surface failure (they re-throw) so the handler maps them to
 * CREATE_FAILED — a half-built topic must never silently link a dangling task.
 *
 * `ctx.db` is REQUIRED for this path (CHT-N allocation + side-table writes);
 * a missing db throws.
 */
async function createTopicForTask(
  ctx: TrueTaskCtx,
  input: CreateTrueTaskInput,
  newTopicTitle: string,
): Promise<string> {
  if (!ctx.db) {
    throw new Error('createTrueTask: db is required for the new-topic path');
  }
  const db = ctx.db;
  const companyId = input.companyId;
  const employeeAgentId = input.assigneeAgentId;
  const employeeName = input.employeeName;

  // 1. Resolve the per-employee `Chat — <employee>` parent issue, O(1).
  let parentId = await getEmployeeParentIssueId({ db }, companyId, employeeAgentId);

  // 2. First-ever topic — bootstrap the parent issue, then record it.
  if (!parentId) {
    const parent = await ctx.issues.create({
      companyId,
      title: formatParentIssueTitle(employeeName),
      description:
        `Parent thread for chat topics with ${employeeName}. ` +
        'Each child issue is a single chat topic.',
      status: 'todo',
      originKind: 'plugin:clarity-pack',
      originId: `chat-parent-${employeeAgentId}`,
    });
    parentId = await insertEmployeeParent({ db }, companyId, employeeAgentId, parent.id);
  }

  // 3. Allocate the CHT-NN topic id.
  const topicId = await allocateChtNumber({ db }, companyId);

  // 4. Create the child topic issue — assigned to the employee-agent
  //    (D-02 — assignment is the wake contract) at the non-terminal
  //    conversation status (D-09; the watchdog flip target is the same value).
  const child = await ctx.issues.create({
    companyId,
    parentId,
    title: newTopicTitle,
    description:
      `Chat topic: ${newTopicTitle}\n\n` +
      `This is a chat thread between the operator and ${employeeName}.\n` +
      'Reply to messages by posting a comment on THIS issue.\n\n' +
      'IMPORTANT: This issue is a CONVERSATION CONTAINER, not a work task. ' +
      'Do NOT mark it `done` or `cancelled`.',
    status: NON_TERMINAL_CONVERSATION_STATUS,
    assigneeAgentId: employeeAgentId,
    originKind: 'plugin:clarity-pack',
    originId: `chat-topic-${topicId}`,
  });

  // 5. Record the chat_topics metadata row.
  const now = new Date().toISOString();
  await insertChatTopic(
    { db },
    {
      topic_id: topicId,
      company_id: companyId,
      issue_id: child.id,
      parent_issue_id: parentId,
      employee_agent_id: employeeAgentId,
      title: newTopicTitle,
      last_activity_at: now,
      archived: false,
      created_at: now,
    },
  );

  return child.id;
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
