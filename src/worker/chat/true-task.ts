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

export type TrueTaskCtx = {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export type CreateTrueTaskInput = {
  companyId: string;
  title: string;
  description: string;
  /** D-06 — NEVER omitted. The chat-topic's employee-agent by default, reassignable in the confirm dialog. */
  assigneeAgentId: string;
  /** Topic issue id — the marker comment is posted here, and the originId back-references it. */
  topicIssueId: string;
  /** Comment id this task came from. null when called direct from the operator composer (no source message). */
  sourceCommentId: string | null;
  /** Plain-English employee name interpolated into the marker comment body (D-07). */
  employeeName: string;
};

/**
 * Create a true task — a top-level, assigned Paperclip issue plus a marker
 * comment on the chat topic. Re-throws on ctx.issues.create failure; the
 * marker write is best-effort (a failed marker still returns { issueId }).
 */
export async function createTrueTask(
  ctx: TrueTaskCtx,
  input: CreateTrueTaskInput,
): Promise<{ issueId: string }> {
  // D-05 — TOP-LEVEL: the new task lives in the normal Paperclip Issues list,
  // NOT nested under the chat topic. The originId back-link is the
  // authoritative provenance pointer. We deliberately do NOT pass a parent-
  // pointer field on the create payload.
  const issue = await ctx.issues.create({
    companyId: input.companyId,
    title: input.title,
    description: input.description,
    status: 'todo',
    assigneeAgentId: input.assigneeAgentId,
    originKind: 'plugin:clarity-pack',
    originId: `chat-task:${input.topicIssueId}:${input.sourceCommentId ?? 'composer'}`,
  });

  // D-07 — marker comment on the topic issue. Plugin-authored, so a future
  // classifyComment (Plan 04.1-04) returns 'conversation' for it. The wording
  // is LOCKED and pinned by test 6 of true-task.test.mjs (Pitfall 4 — must
  // never overlap RUNTIME_PHRASES).
  const markerBody = `Task created — ${issue.id}, assigned to ${input.employeeName}.`;
  try {
    await ctx.issues.createComment(input.topicIssueId, markerBody, input.companyId);
  } catch (e) {
    // Best-effort durability: the originId carries the authoritative back-
    // reference; the marker is the in-thread artifact. A marker failure must
    // not make the operator see the task as failed.
    ctx.logger?.warn?.('createTrueTask: marker createComment failed', {
      topicIssueId: input.topicIssueId,
      issueId: issue.id,
      err: (e as Error).message,
    });
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
