// src/worker/handlers/chat-open-for-issue.ts
//
// Plan 04.2-01 Task 2 -- chat.openForIssue DATA handler (RCB-02).
//
// Deterministic issue-lineage routing for the Reader-view Continue-in-chat
// primitive. Given { companyId, userId, issueId } the handler reads the host
// issue ONCE and returns exactly one route. No navigation guessing -- the
// route is fully determined by the issue's lineage. This is the "zero
// rabbit-holes" core value (CLAUDE.md) applied to the Reader -> Chat direction.
//
// Routing table (Plan 04.2-01 <design_source>):
//
//   | Lineage                  | Detected by                          | route             |
//   |--------------------------|--------------------------------------|-------------------|
//   | Chat-topic issue itself  | originKind/originId is a chat-topic   | topic-itself      |
//   | No assignee              | assigneeAgentId null/empty           | new-topic-needed* |
//   | Chat-spawned task        | originId ^chat-task:<topic>:<comment> | existing-topic    |
//   | Cold task / regular task | cold-task:... OR neither prefix      | new-topic-needed  |
//   * NO_ASSIGNEE -- route present so the UI can position a disabled button.
//
// INTERFACE NOTE: chat-topic issues created by chat.topic.create (see
// src/worker/handlers/chat-topics.ts) carry originKind 'plugin:clarity-pack'
// with originId 'chat-topic-<CHT-NN>'. The plan's prose assumed originKind
// 'plugin:clarity-pack:chat-topic'. This handler accepts EITHER form so it is
// correct against the live host shape AND the plan's stated shape.
//
// Pure routing: this handler is READ-ONLY -- it never mutates the host issue
// (T-04.2-01-02; pinned by the Task 2 acceptance grep, which expects zero host
// issue-write calls in this file). The originId parse is a single anchored
// regex; a cold-task prefix or a non-match both fall to the new-topic-needed
// branch.
//
// Data-handler convention (mirrors chat-active-tasks.ts):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//     (never throw -- data handlers carry structured errors)
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }
//     (via wrapDataHandler -- fires BEFORE the body)

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type {
  PluginAgentsClient,
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type ChatOpenForIssueCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  // Plan 04.2-06 D9 — resolves assigneeAgentId UUID to a human-friendly
  // display name so the Reader's Continue-in-chat button reads
  // "Continue in chat with CMO →" instead of "Continue in chat with <UUID> →".
  agents: PluginAgentsClient;
  logger?: PluginLogger;
};

/** The deterministic route + payload the Reader-view button consumes. */
export type ChatOpenForIssueResult = {
  kind: 'chatOpenForIssue';
  route: 'existing-topic' | 'new-topic-needed' | 'topic-itself';
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
  /** Plan 04.2-06 D9 — display name resolved from `ctx.agents.get`.
   *  Null when the lookup degrades (offline/permission). The UI then falls
   *  back to a friendly generic label ("this employee"), NEVER to the UUID. */
  assigneeName?: string | null;
  seedTitle?: string;
  seedBody?: string;
  error?: string;
};

// Anchored: chat-task:<topicIssueId>:<sourceCommentId-or-"composer">.
// `[^:]+` for the topic id, `.+` for the trailing comment id so a comment id
// that itself contains a colon still parses (greedy -- the whole tail).
const CHAT_TASK_RE = /^chat-task:([^:]+):(.+)$/;

/**
 * True when the issue IS a chat-topic container (it is already a chat
 * surface, so the Continue-in-chat button renders nothing). Accepts both the
 * live-host shape (originKind 'plugin:clarity-pack' + originId
 * 'chat-topic-...') and the plan-stated shape (originKind
 * 'plugin:clarity-pack:chat-topic').
 */
function isChatTopicIssue(originKind: string, originId: string): boolean {
  if (originKind === 'plugin:clarity-pack:chat-topic') return true;
  if (originKind === 'plugin:clarity-pack' && originId.startsWith('chat-topic-')) {
    return true;
  }
  return false;
}

export function registerChatOpenForIssue(ctx: ChatOpenForIssueCtx): void {
  wrapDataHandler(ctx, 'chat.openForIssue', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const issueId =
      typeof params?.issueId === 'string' && params.issueId
        ? params.issueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!issueId) return { error: 'ISSUE_ID_REQUIRED' as const };

    // ONE host read. A throw OR a null/not-found both degrade to a structured
    // error -- the UI hides the button rather than crashing the Reader.
    let issue:
      | {
          id?: string;
          identifier?: string;
          title?: string;
          status?: string;
          originKind?: string | null;
          originId?: string | null;
          assigneeAgentId?: string | null;
        }
      | null;
    try {
      issue = (await ctx.issues.get(issueId, companyId)) as typeof issue;
    } catch (e) {
      ctx.logger?.warn?.('chat.openForIssue: ctx.issues.get threw', {
        issueId,
        companyId,
        err: (e as Error).message,
      });
      return { error: 'ISSUE_LOOKUP_FAILED' as const };
    }
    if (!issue) {
      ctx.logger?.warn?.('chat.openForIssue: issue not found', { issueId, companyId });
      return { error: 'ISSUE_LOOKUP_FAILED' as const };
    }

    const originKind = typeof issue.originKind === 'string' ? issue.originKind : '';
    const originId = typeof issue.originId === 'string' ? issue.originId : '';
    const assigneeAgentId =
      typeof issue.assigneeAgentId === 'string' && issue.assigneeAgentId
        ? issue.assigneeAgentId
        : null;
    const identifier =
      typeof issue.identifier === 'string' && issue.identifier
        ? issue.identifier
        : issueId;
    const title = typeof issue.title === 'string' ? issue.title : '';

    // 4. Chat-topic issue itself -- it is already a chat surface; the button
    //    renders nothing. Checked FIRST so a chat-topic that happens to have
    //    no assignee does not fall to the NO_ASSIGNEE branch.
    if (isChatTopicIssue(originKind, originId)) {
      return { kind: 'chatOpenForIssue' as const, route: 'topic-itself' as const };
    }

    // 5. No assignee -- route present so the UI can still position the button
    //    (disabled); `error` drives the disabled state + tooltip.
    if (!assigneeAgentId) {
      return {
        kind: 'chatOpenForIssue' as const,
        route: 'new-topic-needed' as const,
        error: 'NO_ASSIGNEE' as const,
      };
    }

    // Plan 04.2-06 D9 -- resolve assignee display name. Degrades to null on
    // any failure path so the UI can fall back to a generic label ("this
    // employee") instead of leaking the raw UUID into the button text.
    let assigneeName: string | null = null;
    try {
      const agent = await ctx.agents.get(assigneeAgentId, companyId);
      if (agent && typeof (agent as { name?: unknown }).name === 'string') {
        const candidate = (agent as { name: string }).name.trim();
        if (candidate) assigneeName = candidate;
      }
    } catch (e) {
      ctx.logger?.warn?.('chat.openForIssue: agents.get for assignee failed', {
        issueId,
        companyId,
        assigneeAgentId,
        err: (e as Error).message,
      });
    }

    // 6. Chat-spawned task -- jump straight to the source topic + comment.
    const chatTaskMatch = CHAT_TASK_RE.exec(originId);
    if (chatTaskMatch) {
      return {
        kind: 'chatOpenForIssue' as const,
        route: 'existing-topic' as const,
        topicIssueId: chatTaskMatch[1],
        sourceCommentId: chatTaskMatch[2],
        assigneeAgentId,
        assigneeName,
      };
    }

    // 7. Cold task OR a regular assigned task with no chat origin -- the
    //    operator opens a pre-seeded New Topic dialog with the assignee.
    return {
      kind: 'chatOpenForIssue' as const,
      route: 'new-topic-needed' as const,
      assigneeAgentId,
      assigneeName,
      seedTitle: title,
      seedBody: `Continuing from ${identifier}: ${title}`,
    };
  });
}
