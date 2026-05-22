// src/worker/handlers/chat-topics.ts
//
// Plan 04-04 Task A (data) + Task B (action) — CHAT-01 — chat topics handler.
// Plan 04.1-03 Task 3 — D-09 (in_progress initial status) + D-11 (converse-
//   only description) + ROADMAP scope correction #1 ('private' removed).
//
// This module registers TWO handler keys:
//
//   chat.topics (DATA): lists the chat_topics rows for a selected
//     employee-agent, company-scoped, most-recently-active first. Powers the
//     CHT-NN topic strip in the Employee Chat surface.
//
//   chat.topic.create (ACTION): creates a new chat topic. A topic is a real
//     Paperclip child issue assigned to the employee-agent — assignment IS the
//     wake contract (D-02). Each employee has a single `Chat — <employee>`
//     PARENT issue under which all their topic issues hang.
//
// Parent-issue resolution (BLOCKER-3 / D-05): the per-employee parent issue is
// discovered O(1) via getEmployeeParentIssueId (a lookup on the
// chat_employee_parents map table 04-02 added) — there is NO issue-tree scan.
//   - parent EXISTS  → reuse it directly.
//   - parent is NULL → first-ever topic for this employee: create the
//     `Chat — <employee>` parent issue, then insertEmployeeParent (which is
//     ON CONFLICT DO NOTHING + read-back, so a concurrent first-topic race
//     resolves to a single canonical parent).
//
// The child topic issue carries the D-14 reasoning-block convention in its
// description plus an explicit "reply by posting a comment on this issue"
// instruction (04-01-SPIKE-FINDINGS OQ-4 reply-channel guidance) AND a strong
// D-11 'CONVERSATION CONTAINER — do NOT mark done/cancelled' instruction so
// the assigned agent reads the topic as an ongoing conversation, not a fresh
// task to complete (RESEARCH §Pitfall 6). The child topic issue is created at
// status: 'in_progress' (NOT 'todo') — the watchdog flip target is the same
// value, so the D-11 lifecycle has no thrash and the agent's first read
// matches the steady-state status.
//
// chat.topics is wrapped with wrapDataHandler (RETURNS errors); chat.topic.
// create is wrapped with wrapActionHandler (THROWS on missing required params,
// per the action-handler convention). Both are opt-in-guarded (T-04-15).

import { wrapDataHandler, wrapActionHandler } from '../opt-in-guard.ts';
import type { OptInGuardDataCtx, OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listChatTopicsForEmployee,
  allocateChtNumber,
  insertChatTopic,
  getEmployeeParentIssueId,
  insertEmployeeParent,
  type ChatTopicsRepoCtx,
  type ChatTopicRow,
} from '../db/chat-topics-repo.ts';
// Plan 04.1-03 — share the watchdog's non-terminal status target so the
// initial child-topic create AND the D-11 flip-off-done sweep agree by
// construction (no thrash; single source of truth).
import { NON_TERMINAL_CONVERSATION_STATUS } from '../chat/topic-watchdog.ts';

export type ChatTopicsCtx = OptInGuardDataCtx &
  OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

/** A chat topic as the topic strip consumes it. */
type TopicEntry = {
  topicId: string;
  issueId: string;
  parentIssueId: string;
  employeeAgentId: string;
  title: string;
  lastActivityAt: string;
  archived: boolean;
};

function mapTopic(row: ChatTopicRow): TopicEntry {
  return {
    topicId: row.topic_id,
    issueId: row.issue_id,
    parentIssueId: row.parent_issue_id,
    employeeAgentId: row.employee_agent_id,
    title: row.title,
    lastActivityAt: row.last_activity_at,
    archived: row.archived,
  };
}

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.topic.create: ${key} required`);
}

// The D-14 reasoning-block convention + the OQ-4 reply-channel instruction
// (Phase 4) + the Plan 04.1-03 D-11 'CONVERSATION CONTAINER' instruction.
//
// The agent reads this as its standing brief for the topic; replies are posted
// as comments on this very issue (which natively wakes the human's chat view
// via the 04-03 stream bridge). The D-11 block (lines starting 'IMPORTANT')
// tells the agent the topic is a conversation, not a work task — do NOT
// dispose it. RESEARCH §Pitfall 6: agents read issue descriptions per Phase 4
// D-14; strong unambiguous wording is required for the instruction to land.
//
// The early-Phase-4 description called the chat thread 'private' — this was
// incorrect (ROADMAP scope correction #1: chat-topic issues are not private,
// any operator with read access on the parent issue can see them). The word
// is removed.
function buildTopicDescription(title: string, employeeName: string): string {
  return [
    `Chat topic: ${title}`,
    '',
    `This is a chat thread between the operator and ${employeeName}.`,
    'Reply to messages by posting a comment on THIS issue — every comment on',
    'this issue is delivered to the operator chat surface in realtime.',
    '',
    // D-11 — converse only, never complete. Strong, unambiguous wording per
    // RESEARCH §Pitfall 6. The agent reads issue descriptions (Phase 4 D-14);
    // this block prevents the disposition-recovery flip the host's machinery
    // would otherwise apply post-run (OQ3 attempt-2 evidence in
    // 04.1-01-SPIKE-FINDINGS).
    'IMPORTANT: This issue is a CONVERSATION CONTAINER, not a work task. Do',
    'NOT mark it `done` or `cancelled`. To direct work, the operator will',
    'spin off a separate true-task issue (you do not need to create one).',
    'Stay non-terminal and conversational.',
    '',
    '## Reasoning',
    '(record your reasoning for each reply here, per the D-14 convention)',
  ].join('\n');
}

export function registerChatTopics(ctx: ChatTopicsCtx): void {
  // ---- chat.topics — DATA handler (Task A) --------------------------------
  wrapDataHandler(ctx, 'chat.topics', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const employeeAgentId =
      typeof params?.employeeAgentId === 'string' && params.employeeAgentId
        ? params.employeeAgentId
        : null;

    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!userId) {
      return { error: 'USER_ID_REQUIRED' };
    }
    if (!employeeAgentId) {
      return { error: 'EMPLOYEE_AGENT_ID_REQUIRED' };
    }

    let rows: ChatTopicRow[];
    try {
      rows = await listChatTopicsForEmployee(ctx, companyId, employeeAgentId);
    } catch (e) {
      ctx.logger?.warn?.('chat.topics: listChatTopicsForEmployee failed', {
        companyId,
        employeeAgentId,
        err: (e as Error).message,
      });
      return { error: 'TOPICS_FAILED' };
    }

    return { kind: 'topics' as const, employeeAgentId, topics: rows.map(mapTopic) };
  });

  // ---- chat.topic.create — ACTION handler (Task B) ------------------------
  wrapActionHandler(ctx, 'chat.topic.create', async (params) => {
    const companyId = reqStr(params, 'companyId');
    const employeeAgentId = reqStr(params, 'employeeAgentId');
    const title = reqStr(params, 'title');
    const userId = reqStr(params, 'userId');
    void userId;
    // employeeName is best-effort — falls back to the agent id for the parent
    // issue title when the UI does not thread it through.
    const employeeName =
      typeof params?.employeeName === 'string' && params.employeeName
        ? params.employeeName
        : employeeAgentId;
    // Plan 04.2-01 (RCB-04) — OPTIONAL. When the UI opens this topic through
    // the Reader-view Continue-in-chat -> new-topic flow it threads the
    // source issue id via the `?originIssueId=` deep-link param; absent for
    // every ordinary + New topic create. Written into chat_topics.
    // origin_issue_id (migration 0009) so the About-chip + reverse-topics
    // backlinks resolve.
    const originIssueId =
      typeof params?.originIssueId === 'string' && params.originIssueId
        ? params.originIssueId
        : null;

    try {
      // 1. Resolve the per-employee `Chat — <employee>` parent issue, O(1).
      let parentId = await getEmployeeParentIssueId(ctx, companyId, employeeAgentId);

      // 2. First-ever topic — bootstrap the parent issue, then record it.
      if (!parentId) {
        const parent = await ctx.issues.create({
          companyId,
          title: `Chat — ${employeeName}`,
          description:
            `Parent thread for chat topics with ${employeeName}. ` +
            'Each child issue is a single chat topic.',
          status: 'todo',
          originKind: 'plugin:clarity-pack',
          originId: `chat-parent-${employeeAgentId}`,
        });
        // insertEmployeeParent is ON CONFLICT DO NOTHING + read-back: a racing
        // concurrent first-topic create resolves to one canonical parent.
        parentId = await insertEmployeeParent(ctx, companyId, employeeAgentId, parent.id);
      }

      // 3. Allocate the CHT-NN topic id.
      const topicId = await allocateChtNumber(ctx, companyId);

      // 4. Create the child topic issue — assigned to the employee-agent
      //    (D-02 — assignment is the wake contract). The child is created at
      //    NON_TERMINAL_CONVERSATION_STATUS ('in_progress') per D-09: the
      //    agent reads the topic as an ongoing conversation, NOT a fresh
      //    task; the watchdog (topic-watchdog.ts) flips it back to the same
      //    value if the host's disposition-recovery service parks it
      //    terminal post-run. Single source of truth — no thrash.
      const child = await ctx.issues.create({
        companyId,
        parentId,
        title,
        description: buildTopicDescription(title, employeeName),
        status: NON_TERMINAL_CONVERSATION_STATUS,
        assigneeAgentId: employeeAgentId,
        originKind: 'plugin:clarity-pack',
        originId: `chat-topic-${topicId}`,
      });

      // 5. Record the chat_topics metadata row.
      const now = new Date().toISOString();
      await insertChatTopic(ctx, {
        topic_id: topicId,
        company_id: companyId,
        issue_id: child.id,
        parent_issue_id: parentId,
        employee_agent_id: employeeAgentId,
        title,
        last_activity_at: now,
        archived: false,
        created_at: now,
        // Plan 04.2-01 (RCB-04) — null for ordinary creates; the source issue
        // id when this topic was started from a Reader.
        originIssueId,
      });

      return { ok: true, topicId, issueId: child.id, parentIssueId: parentId };
    } catch (e) {
      ctx.logger?.warn?.('chat.topic.create: failed', {
        companyId,
        employeeAgentId,
        err: (e as Error).message,
      });
      return { error: 'CREATE_FAILED' };
    }
  });
}
