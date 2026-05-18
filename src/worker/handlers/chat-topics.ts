// src/worker/handlers/chat-topics.ts
//
// Plan 04-04 Task A (data) + Task B (action) — CHAT-01 — chat topics handler.
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
// instruction (04-01-SPIKE-FINDINGS OQ-4 reply-channel guidance).
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

// The D-14 reasoning-block convention + the OQ-4 reply-channel instruction.
// The agent reads this as its standing brief for the topic; replies are posted
// as comments on this very issue (which natively wakes the human's chat view
// via the 04-03 stream bridge).
function buildTopicDescription(title: string, employeeName: string): string {
  return [
    `Chat topic: ${title}`,
    '',
    `This is a private chat thread between the operator and ${employeeName}.`,
    'Reply to messages by posting a comment on THIS issue — every comment on',
    'this issue is delivered to the operator chat surface in realtime.',
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
      //    (D-02 — assignment is the wake contract).
      const child = await ctx.issues.create({
        companyId,
        parentId,
        title,
        description: buildTopicDescription(title, employeeName),
        status: 'todo',
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
