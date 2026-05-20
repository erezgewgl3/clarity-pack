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
// Visual reuse: chat.css:1092-1132 `.task-row` + `.task-row .st.*` — every
// row class already exists. Only the empty-state `.active-tasks-owned-empty`
// is added to chat.css's Phase 4.1 section.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { usePoll } from '../../primitives/use-poll.ts';
import { RefChip } from '../../primitives/ref-chip.tsx';
import { ChatTaskStatusPill } from './true-task/chat-task-status-pill.tsx';

type ActiveTask = {
  issueId: string;
  identifier: string;
  title: string;
  status: string;
  createdAt: string | null;
};

type Result =
  | { kind: 'taskOwned'; topicIssueId: string; tasks: ActiveTask[] }
  | { error: string }
  | null;

export function ActiveTasksOwned({
  companyId,
  userId,
  topicIssueId,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
}): React.ReactElement {
  const { data, refresh } = usePluginData<Result>('chat.taskOwned', {
    companyId,
    userId,
    topicIssueId,
  });

  // Same 15s cadence + visibility-pause as MessageThread (UI-SPEC §"Active
  // tasks owned, live status" / chat.css `.auto-refresh` budget).
  usePoll({
    key: `chat.taskOwned.refresh:${topicIssueId}`,
    fetcher: async () => {
      void refresh?.();
      return null;
    },
    intervalMs: 15_000,
    dedupeBy: 'off',
    pauseOnHidden: true,
  });

  const tasks: ActiveTask[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'taskOwned'
      ? data.tasks
      : [];

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
              clickable chip into classic Paperclip. */}
          <span className="id">
            <RefChip refId={t.identifier} />
          </span>
          <span className="ttl">{t.title}</span>
          <ChatTaskStatusPill status={t.status} />
        </div>
      ))}
    </>
  );
}
