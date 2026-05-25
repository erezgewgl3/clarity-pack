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
  /** Plan 04.2-01 (RCB-05) — the source Paperclip issue this topic was
   *  started from via the Reader-view Continue-in-chat flow. NULL for topics
   *  created the ordinary way + every pre-0009 row. Drives the topic strip's
   *  `About <COU-NNNN> ↗` backlink chip. */
  originIssueId: string | null;
  /** Plan 04.2-06 D10 — server-resolved BEAAA-NNN identifier of
   *  `originIssueId`. The topic-strip's `About ... ↗` chip uses this for
   *  BOTH the visible text AND the click-through URL (per runbook
   *  paperclip-issue-url-pattern: `/<companyPrefix>/issues/<identifier>`,
   *  NOT `<UUID>` — UUID URLs 404). Null when the originIssueId is null OR
   *  the resolution lookup degraded; the UI then hides the chip rather than
   *  rendering a broken navigation target. */
  originIssueIdentifier: string | null;
  /** Plan 05-08 (D-20) — non-NULL ISO timestamp when the topic is PINNED
   *  (storage-pin = exempt from archive, per migration 0010 pinned_at
   *  column). NULL for unpinned + every pre-0010 row. The chat right-rail
   *  Storage pin card reads this to render the live pinned state without a
   *  second round-trip. Additive output field; existing consumers ignoring
   *  it remain unaffected. */
  pinnedAt: string | null;
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
    // Plan 04.2-01 (RCB-05) — surfaced from the migration-0009 column.
    originIssueId: row.origin_issue_id ?? null,
    // Plan 04.2-06 D10 — resolved AFTER the map step (see resolveOriginIdentifiers
    // below). Default null so the shape is stable even when resolution is skipped.
    originIssueIdentifier: null,
    // Plan 05-08 (D-20 carrier) — surface pinned state from migration 0010
    // so the chat right-rail Storage pin card can render live state without
    // a second round-trip. Explicit null (never undefined) so UI consumers
    // can treat null as "not pinned" without checking field presence.
    pinnedAt: row.pinned_at ?? null,
  };
}

/**
 * Plan 04.2-06 D10 — resolve each distinct `originIssueId` UUID to its
 * BEAAA-NNN identifier via a single ctx.issues.get per distinct id. Mutates
 * the topic entries in-place. Degrades silently per id (a lookup failure
 * leaves that topic's `originIssueIdentifier` null, and the UI hides the
 * chip — same fallback as `originIssueId === null`).
 *
 * For a typical chat employee with <10 topics this is one host roundtrip
 * per distinct origin, which in practice is 1–5 calls. We do NOT batch via
 * a non-existent ctx.issues.list({ ids: [...] }) API — the SDK exposes
 * `issues.get(id, companyId)` as the only single-issue read; the cost of
 * sequential calls is bounded and only paid on the chat strip render path.
 */
async function resolveOriginIdentifiers(
  topics: TopicEntry[],
  companyId: string,
  ctx: ChatTopicsCtx,
): Promise<void> {
  const distinct = Array.from(
    new Set(
      topics
        .map((t) => t.originIssueId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  if (distinct.length === 0) return;

  const idToIdentifier = new Map<string, string>();
  for (const originId of distinct) {
    try {
      const issue = (await ctx.issues.get(originId, companyId)) as
        | { identifier?: string | null }
        | null;
      const identifier = issue && typeof issue.identifier === 'string' ? issue.identifier : null;
      if (identifier) idToIdentifier.set(originId, identifier);
    } catch (e) {
      ctx.logger?.warn?.('chat.topics: origin issue identifier resolution failed', {
        originId,
        companyId,
        err: (e as Error).message,
      });
      // Leave unresolved — topic.originIssueIdentifier stays null.
    }
  }
  for (const topic of topics) {
    if (topic.originIssueId && idToIdentifier.has(topic.originIssueId)) {
      topic.originIssueIdentifier = idToIdentifier.get(topic.originIssueId) ?? null;
    }
  }
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
/**
 * Plan 04.2-05 D7 — format the per-employee `Chat — <name>` PARENT issue
 * title. The classic Paperclip Reader renders the parent issue's title as
 * a clickable breadcrumb at the top of every child issue. When the UI did
 * not thread a human-friendly employeeName, the worker's fallback set
 * `employeeName = employeeAgentId` (a UUID), so the parent title became
 * "Chat — b2a22e50-d772-…" and on a chat-topic Reader that rendered as an
 * unstyled clickable text occupying the same vertical position the gold
 * Continue button occupies on regular task Readers — visually mistaken for
 * a styling-broken Continue button (Countermoves drill 2026-05-24 D7).
 *
 * Fix: when employeeName looks like a UUID, drop the "— UUID" tail and
 * render the parent as "Chat thread" alone. Real names (CEO, Eric, …) get
 * the full "Chat — CEO" treatment unchanged.
 *
 * Existing parent issues retain their current title; this formatter
 * applies to NEW parents only (and is the only place the title literal
 * lives in this codebase, by design — single source of truth).
 */
export function formatParentIssueTitle(employeeName: string): string {
  const trimmed = employeeName.trim();
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  return looksLikeUuid ? 'Chat thread' : `Chat — ${employeeName}`;
}

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

    const topics = rows.map(mapTopic);
    // Plan 04.2-06 D10 — resolve each distinct origin issue UUID to its
    // BEAAA-NNN identifier so the topic strip's `About <COU-NNNN> ↗` chip
    // (a) shows a readable identifier instead of leaking the raw UUID and
    // (b) navigates to the correct issue URL pattern. See the helper above.
    await resolveOriginIdentifiers(topics, companyId, ctx);

    return { kind: 'topics' as const, employeeAgentId, topics };
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
          // Plan 04.2-05 D7 — formatParentIssueTitle drops the UUID tail
          // when employeeName fell back to the agent id, so the host-
          // rendered parent breadcrumb on chat-topic Readers no longer
          // looks like a styling-broken Continue button.
          title: formatParentIssueTitle(employeeName),
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
