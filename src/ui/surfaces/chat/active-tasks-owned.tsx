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
  // Phase 19 Plan 19-03 (CARD-02 / D-09) — the Editor named-action card for this
  // task's leaf, attached read-only by chat.taskOwned ONLY when the flag is ON and
  // a FRESH cached card exists; null/absent otherwise → the rail floors to its
  // deterministic line. DISPLAY fields ONLY (sourceIssueUuid omitted, NO_UUID_LEAK).
  actionCard?: {
    namedAction: string;
    awaitedParty: string;
    estBucket: 'quick' | 'focused' | 'deep' | (string & {});
    actionKind: 'answer' | 'decide' | 'assign' | 'none' | (string & {});
    decisionOptions: string[] | null;
  } | null;
};

/** quick-260619-r4v Piece 2 — a live-assignee group as the company-wide rail
 *  consumes it. The handler groups by the issues.get LIVE assignee so a
 *  reassigned task follows its owner. */
export type ChatActiveTaskGroup = {
  assignee: string;
  tasks: ChatActiveTask[];
};

type Result =
  | {
      kind: 'taskOwned';
      topicIssueId: string | null;
      tasks: ChatActiveTask[];
      // quick-260619-r4v Piece 2 — grouped + bounded-completeness metadata.
      groups?: ChatActiveTaskGroup[];
      total?: number;
      shown?: number;
      capped?: boolean;
      skipped?: number;
    }
  | { error: string }
  | null;

/**
 * Plan 04.1-09 — single fetch+poll site for chat.taskOwned. Used by
 * index.tsx; the resulting `tasks` array is threaded to both
 * ActiveTasksOwned (right rail) AND MessageThread (for inline-task-card
 * title lookup). The 15s poll cadence + visibility-pause match the
 * MessageThread poll (UI-SPEC §"Active tasks owned, live status").
 */
/** quick-260619-r4v Piece 2 — the hook's full result. `tasks` stays flat
 *  (index.tsx + MessageThread inline-card title lookup consume it unchanged);
 *  `groups` + the bounded-completeness fields drive the company-wide rail. */
export type ChatActiveTasksResult = {
  tasks: ChatActiveTask[];
  groups: ChatActiveTaskGroup[];
  total: number;
  shown: number;
  capped: boolean;
  skipped: number;
};

export function useChatActiveTasks({
  companyId,
  userId,
  topicIssueId,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string | null;
}): ChatActiveTasksResult {
  // quick-260619-r4v Piece 2 — the rail is COMPANY-WIDE now: fetch whenever
  // companyId + userId are present. topicIssueId is still threaded (the
  // handler accepts-and-ignores it) so the response echo + poll key stay
  // stable across topic switches, but it no longer gates the fetch.
  const { data, refresh } = usePluginData<Result>(
    'chat.taskOwned',
    companyId && userId
      ? { companyId, userId, ...(topicIssueId ? { topicIssueId } : {}) }
      : {},
  );

  usePoll({
    key: `chat.taskOwned.refresh:${topicIssueId ?? 'company'}`,
    fetcher: async () => {
      void refresh?.();
      return null;
    },
    intervalMs: 15_000,
    dedupeBy: 'off',
    pauseOnHidden: true,
  });

  const ok =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'taskOwned'
      ? data
      : null;
  const tasks: ChatActiveTask[] = ok ? ok.tasks : [];
  const groups: ChatActiveTaskGroup[] = ok?.groups ?? [];

  return {
    tasks,
    groups,
    total: ok?.total ?? tasks.length,
    shown: ok?.shown ?? tasks.length,
    capped: ok?.capped ?? false,
    skipped: ok?.skipped ?? 0,
  };
}

export function ActiveTasksOwned({
  tasks,
  groups = [],
  total,
  shown,
  capped = false,
  skipped = 0,
  employeeName,
}: {
  tasks: ChatActiveTask[];
  /** quick-260619-r4v Piece 2 — live-assignee groups (company-wide). When
   *  absent (legacy callers), fall back to a single flat list. */
  groups?: ChatActiveTaskGroup[];
  total?: number;
  shown?: number;
  capped?: boolean;
  skipped?: number;
  /** The selected employee's display name for the scope label. */
  employeeName?: string | null;
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

  // quick-260619-r4v Piece 2 — render grouped-by-assignee when groups are
  // present; degrade to a single flat group for legacy callers.
  const renderGroups: ChatActiveTaskGroup[] =
    groups.length > 0
      ? groups
      : tasks.length > 0
        ? [{ assignee: employeeName ?? '', tasks }]
        : [];

  const scopeLabel = employeeName
    ? `Tasks owned by ${employeeName}, company-wide`
    : 'Tasks owned company-wide';

  // A single host-routed row (reused per task in every group).
  const renderRow = (t: ChatActiveTask): React.ReactElement => (
    <div key={t.issueId} className="task-row">
      <span className="id">
        <RefChip refId={t.identifier} />
      </span>
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
  );

  if (renderGroups.length === 0) {
    return (
      <>
        <p className="active-tasks-owned-scope">{scopeLabel}</p>
        <p className="active-tasks-owned-empty">
          No spun-off tasks yet. Tasks created from chat appear here.
        </p>
      </>
    );
  }

  return (
    <>
      {/* Scope label — the rail is company-wide, never silently topic-scoped. */}
      <p className="active-tasks-owned-scope">{scopeLabel}</p>
      {renderGroups.map((g) => (
        <div key={g.assignee || '__ungrouped__'} className="active-tasks-owned-group">
          {/* One header per LIVE assignee so a reassigned task is visibly
              grouped under its new owner. Omitted for the legacy single
              flat group (empty assignee). */}
          {g.assignee ? (
            <div className="active-tasks-owned-group-head">{g.assignee}</div>
          ) : null}
          {g.tasks.map(renderRow)}
        </div>
      ))}
      {/* Bounded + never silently incomplete (Eric's no-rabbit-holes rule). */}
      {capped ? (
        <p className="active-tasks-owned-cap">
          showing {shown ?? tasks.length} of {total ?? tasks.length}
        </p>
      ) : null}
      {skipped > 0 ? (
        <p className="active-tasks-owned-skipped">({skipped} could not be loaded)</p>
      ) : null}
    </>
  );
}
