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
// Plan 04.2-07 (D-01 step 2 + D-04) — reverse-lookup helper + auto-unarchive.
import {
  listTopicsForIssueAndAssignee,
  setChatTopicArchived,
} from '../db/chat-topics-repo.ts';

export type ChatOpenForIssueCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  // Plan 04.2-06 D9 — resolves assigneeAgentId UUID to a human-friendly
  // display name so the Reader's Continue-in-chat button reads
  // "Continue in chat with CMO →" instead of "Continue in chat with <UUID> →".
  agents: PluginAgentsClient;
  logger?: PluginLogger;
};

/** Plan 04.2-07 D-01 — one candidate the ambiguous-route popover renders. */
export type ChatOpenForIssueCandidate = {
  /** chat-topic UUID — internal id; never operator-visible. */
  topicIssueId: string;
  /** CHT-NN — operator-visible (D-08 hygiene). */
  topicId: string;
  title: string;
  lastActivityAt: string;
  archived: boolean;
};

/** The deterministic route + payload the Reader-view button consumes. */
export type ChatOpenForIssueResult = {
  kind: 'chatOpenForIssue';
  /** Plan 04.2-07 — added 'existing-topics-ambiguous' for N>=2 same-assignee
   *  reverse-link matches (D-01 step 2 + D-02 popover reuse). */
  route:
    | 'existing-topic'
    | 'existing-topics-ambiguous'
    | 'new-topic-needed'
    | 'topic-itself';
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
  /** Plan 04.2-06 D9 — display name resolved from `ctx.agents.get`.
   *  Null when the lookup degrades (offline/permission). The UI then falls
   *  back to a friendly generic label ("this employee"), NEVER to the UUID. */
  assigneeName?: string | null;
  /** Plan 04.2-07 (D-01 step 2 + D-08) — for the 'existing-topics-ambiguous'
   *  route only: the same-assignee candidate topics, sorted via the D-05
   *  GREATEST(last_activity_at, max chat_messages.sent_at) DESC tiebreaker
   *  (see chat-topics-repo.ts listTopicsForIssueAndAssignee). Always carries
   *  CHT-NN (topicId) for operator-visible UI text — never raw UUIDs. */
  candidates?: ChatOpenForIssueCandidate[];
  /** Plan 04.2-07 (D-01 step 2 + D-08) — for ambiguous-route tooltips: the
   *  BEAAA-NNN identifier of the source issue (already resolved from
   *  issue.identifier earlier in this handler — no new resolver call). */
  sourceIssueIdentifier?: string;
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

    // 6b. Plan 04.2-07 (D-01 step 2 + D-04 + D-08) -- reverse-lookup against
    //     chat_topics.origin_issue_id + employee_agent_id. This catches
    //     "cold but conversed-about" issues: the Reader-originated chat
    //     topic that already references this issue is silently resumed.
    //
    //     Cardinality semantics:
    //       0 same-assignee matches -> fall through to step 7 (D-03 +
    //         D-11: cross-employee threads stay reachable via the manual
    //         RCB-06 popover; cold issues still get the seeded dialog).
    //       1 match -> route 'existing-topic' WITHOUT sourceCommentId
    //         (resuming the THREAD, not a comment). When that one match
    //         is archived, auto-unarchive via setChatTopicArchived(false)
    //         -- plugin-side only; ctx.issues.update is NEVER called
    //         (CTT-07 invariant pinned by Test 6 of chat-topic-archive
    //         and Test RED 3 of this plan).
    //       >=2 matches -> route 'existing-topics-ambiguous' carrying the
    //         candidates list (D-08: topicId is CHT-NN, never UUID) +
    //         sourceIssueIdentifier (BEAAA-NNN already resolved above).
    //         UI auto-opens the RCB-06 popover pre-filtered to same-
    //         assignee candidates (D-02).
    //
    //     Failure handling mirrors the issue-get pattern (lines 121-130):
    //     on throw, warn-log and fall through to step 7 (fail-open keeps
    //     cold-issue routing working when the side-table query degrades).
    let reverseMatches: Awaited<
      ReturnType<typeof listTopicsForIssueAndAssignee>
    > = [];
    try {
      reverseMatches = await listTopicsForIssueAndAssignee(
        ctx,
        companyId,
        issueId,
        assigneeAgentId,
      );
    } catch (e) {
      ctx.logger?.warn?.(
        'chat.openForIssue: listTopicsForIssueAndAssignee threw',
        {
          issueId,
          companyId,
          assigneeAgentId,
          err: (e as Error).message,
        },
      );
      // Fall through to step 7 (new-topic-needed).
    }

    if (reverseMatches.length === 1) {
      const match = reverseMatches[0];
      // D-04 auto-unarchive: if the single match is archived, flip
      // archived_at to NULL via the existing plugin-side helper. Host
      // issue stays untouched (CTT-07).
      if (match.archived) {
        try {
          await setChatTopicArchived(ctx, companyId, match.topicIssueId, false);
          ctx.logger?.info?.(
            'chat.openForIssue: auto-unarchive on silent resume',
            {
              issueId,
              companyId,
              topicIssueId: match.topicIssueId,
              topicId: match.topicId,
            },
          );
        } catch (e) {
          ctx.logger?.warn?.(
            'chat.openForIssue: setChatTopicArchived (unarchive) threw',
            {
              issueId,
              companyId,
              topicIssueId: match.topicIssueId,
              err: (e as Error).message,
            },
          );
          // Proceed with the resume even if the unarchive UPDATE failed —
          // the chat surface can still open the topic; the archived flag
          // is a UI hint, not a routing gate.
        }
      }
      return {
        kind: 'chatOpenForIssue' as const,
        route: 'existing-topic' as const,
        topicIssueId: match.topicIssueId,
        // No sourceCommentId — D-01 resumes the thread, not a comment.
        assigneeAgentId,
        assigneeName,
      };
    }

    if (reverseMatches.length >= 2) {
      // D-03 fall-through is implicit here: the helper's WHERE clause
      // already filters by employee_agent_id, so cross-employee topics
      // about the same issue do not appear in `reverseMatches`. If only
      // cross-employee threads exist, reverseMatches.length === 0 and
      // execution drops to step 7 (same as cold-task). The
      // implementation reduces D-03 to the N=0 case by construction.
      return {
        kind: 'chatOpenForIssue' as const,
        route: 'existing-topics-ambiguous' as const,
        assigneeAgentId,
        assigneeName,
        sourceIssueIdentifier: identifier,
        candidates: reverseMatches.map((m) => ({
          topicIssueId: m.topicIssueId,
          topicId: m.topicId,
          title: m.title,
          lastActivityAt: m.lastActivityAt,
          archived: m.archived,
        })),
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
