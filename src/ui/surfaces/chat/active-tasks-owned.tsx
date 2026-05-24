// src/ui/surfaces/chat/active-tasks-owned.tsx
//
// Plan 04.1-06 Task 1 — Pattern D (UI-SPEC §"Active tasks owned").
//
// Replaces the existing stub in context-rail.tsx:51-54 with a live polled
// list of tasks spun off from the current chat topic. Reads chat.taskOwned
// (Plan 04.1-05 — backed by the chat_topic_tasks plugin-namespace side
// table, NOT issues.list — per the Wave 1 spike OQ2 lock). One `.task-row`
// per task; status-pill updates on the 15s poll.
//
// Plan 04.1-09 — fetch lifted to index.tsx so the MessageThread can look up
// inline-task-card titles from the same data (Plan 04.1-08 drill fix #2b —
// the marker comment's first capture is the issueId, not the title; the
// title must be looked up by issueId from chat.taskOwned). This component
// now takes `activeTasks` as a prop; the `useChatActiveTasks` hook below
// is the single fetch site used by index.tsx.
//
// Visual reuse: chat.css:1092-1132 `.task-row` + `.task-row .st.*` — every
// row class already exists. Only the empty-state `.active-tasks-owned-empty`
// is added to chat.css's Phase 4.1 section.

import * as React from 'react';
import { useHostLocation, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { usePoll } from '../../primitives/use-poll.ts';
import { RefChip } from '../../primitives/ref-chip.tsx';
import { useHostNavigation } from '../../primitives/use-host-navigation.ts';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { ChatTaskStatusPill } from './true-task/chat-task-status-pill.tsx';

export type ChatActiveTask = {
  issueId: string;
  identifier: string;
  title: string;
  status: string;
  createdAt: string | null;
};

type Result =
  | { kind: 'taskOwned'; topicIssueId: string; tasks: ChatActiveTask[] }
  | { error: string }
  | null;

/**
 * Plan 04.1-09 — single fetch+poll site for chat.taskOwned. Used by
 * index.tsx; the resulting `tasks` array is threaded to both
 * ActiveTasksOwned (right rail) AND MessageThread (for inline-task-card
 * title lookup). The 15s poll cadence + visibility-pause match the
 * MessageThread poll (UI-SPEC §"Active tasks owned, live status").
 */
export function useChatActiveTasks({
  companyId,
  userId,
  topicIssueId,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string | null;
}): { tasks: ChatActiveTask[] } {
  const { data, refresh } = usePluginData<Result>(
    'chat.taskOwned',
    topicIssueId ? { companyId, userId, topicIssueId } : {},
  );

  usePoll({
    key: `chat.taskOwned.refresh:${topicIssueId ?? 'none'}`,
    fetcher: async () => {
      void refresh?.();
      return null;
    },
    intervalMs: 15_000,
    dedupeBy: 'off',
    pauseOnHidden: true,
  });

  const tasks: ChatActiveTask[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'taskOwned'
      ? data.tasks
      : [];

  return { tasks };
}

export function ActiveTasksOwned({
  tasks,
}: {
  tasks: ChatActiveTask[];
}): React.ReactElement {
  // Plan 04.2-05 D3 — the rail row title is wrapped in a host-routed anchor
  // so clicking it lands on the issue's canonical Reader at
  // `/<companyPrefix>/issues/<identifier>` (MemPalace runbook
  // `paperclip-issue-url-pattern`). The RefChip primitive (rendered inside
  // the row's .id span) already became a clickable anchor in Plan 04.2-05
  // D3; this title wrap gives the operator a larger click target for the
  // common case of clicking the visible title text. Without companyPrefix
  // available we render the title as plain text (no broken anchor).
  const nav = useHostNavigation();
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  if (tasks.length === 0) {
    return (
      <p className="active-tasks-owned-empty">
        No spun-off tasks yet. Tasks created from this chat appear here.
      </p>
    );
  }

  return (
    <>
      {tasks.map((t) => (
        <div key={t.issueId} className="task-row">
          {/* The RefChip primitive runs its own resolve-refs round-trip; pass
              the BEAAA-NNN identifier as the refId so it surfaces as a
              clickable chip into classic Paperclip. Plan 04.2-05 D3 — the
              chip itself is now a host-routed anchor to /<prefix>/issues/<id>. */}
          <span className="id">
            <RefChip refId={t.identifier} />
          </span>
          {/* Plan 04.1-09 — `title={t.title}` so hover tooltip shows the full
              text when the 3-line clamp truncates a long title.
              Plan 04.2-05 D3 — wrapped in a host-routed anchor when
              companyPrefix is available; otherwise plain text. */}
          {companyPrefix && t.identifier ? (
            <a
              {...nav.linkProps(`/${companyPrefix}/issues/${t.identifier}`)}
              className="ttl"
              title={t.title}
              data-clarity-action="open-active-task"
            >
              {t.title}
            </a>
          ) : (
            <span className="ttl" title={t.title}>
              {t.title}
            </span>
          )}
          <ChatTaskStatusPill status={t.status} />
        </div>
      ))}
    </>
  );
}
