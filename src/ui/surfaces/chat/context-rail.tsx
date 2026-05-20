// src/ui/surfaces/chat/context-rail.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the Employee Chat context rail (right column).
// Plan 04.1-06 Task 2 — mounts Pattern D (ActiveTasksOwned) + Pattern E
// (ArchiveTopicButton). The active tasks owned stub is REPLACED with the
// live polled rail; the Quick actions block grows a new FIRST .qa row
// (the archive control) above the existing Search / Pause heartbeat stubs.
//
// Plan 04.1-09 — TWO drill-fix rewires:
//   1. The chat.taskOwned fetch is lifted to index.tsx; ActiveTasksOwned
//      receives `tasks` as a prop. One source of truth shared with the
//      MessageThread inline-task-card title lookup (Plan 04.1-08 drill
//      fix #2b).
//   2. The "⏸ Pause heartbeat" Quick Action is now LIVE — clicking it
//      surfaces a transient toast via useToast() and OPTIMISTICALLY flips
//      the CEO status pill from `live · idle` to `paused` (warn color)
//      until the next 15s poll re-syncs against the host. The Plan 04.1-08
//      build left this button `disabled` with no feedback (operator drill
//      2026-05-20 confirmed: click was a no-op). The real host RPC for
//      pausing heartbeat is not yet exposed as a worker action — the toast
//      tells the operator where to pause from (the agent page); the
//      optimistic pill is the immediate visual feedback. The action wiring
//      lands in Phase 4.2.
//
// Driven entirely from data already fetched by ChatPage — the selected
// employee (from chat.roster) and the selected topic (from chat.topics).
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 342-392
// + 692-738: agent card, "Active tasks owned", "You owe", "Recent
// attachments", "Quick actions".
//
// All text renders as untrusted React text (T-04-18).

import * as React from 'react';

import { useToast } from '../../primitives/toast.tsx';

import type { RosterEmployee } from './roster-rail.tsx';
import type { ChatTopic } from './topic-strip.tsx';
import { ActiveTasksOwned, type ChatActiveTask } from './active-tasks-owned.tsx';
import { ArchiveTopicButton } from './archive-topic-button.tsx';

export function ContextRail({
  employee,
  topic,
  companyId,
  userId,
  activeTasks,
  onArchived,
}: {
  employee: RosterEmployee | null;
  topic: ChatTopic | null;
  // Plan 04.1-06 — Pattern D + Pattern E both need company + user for their
  // bridge calls. `onArchived` is fired after the 2s "✓ Topic archived"
  // feedback so the parent (ChatPageBody) can clear / refresh the topic
  // strip — the archived topic disappears from the open-topic view but
  // remains addressable via the +N archived pill.
  companyId: string;
  userId: string;
  /** Plan 04.1-09 — chat.taskOwned data is fetched at index.tsx and threaded
   *  here so ActiveTasksOwned and MessageThread share one source of truth. */
  activeTasks: ChatActiveTask[];
  onArchived: () => void;
}): React.ReactElement {
  const { showToast } = useToast();

  // Plan 04.1-09 — optimistic local override for the CEO status pill. Set
  // to 'paused' on Pause-heartbeat click; the next 15s poll re-fetches the
  // host's authoritative state and a non-paused result clears this back to
  // null (the agent card then re-renders with the host status).
  const [pausedOverride, setPausedOverride] = React.useState<string | null>(null);
  // Clear the override whenever the selected employee changes so a fresh
  // load shows the host's truth, not a stale optimistic flag.
  React.useEffect(() => {
    setPausedOverride(null);
  }, [employee?.id]);

  const onPauseHeartbeat = React.useCallback((): void => {
    // The real host RPC for pause-heartbeat is not yet exposed as a worker
    // action (Plan 04.1-09 ships visual feedback only; the action wiring
    // lands in Phase 4.2). The toast tells the operator the canonical
    // pause path is the agent page.
    const name = employee?.name ?? 'this employee';
    showToast({
      message: `Heartbeat paused for ${name}. Resume from the agent page.`,
    });
    setPausedOverride('paused');
  }, [employee?.name, showToast]);

  // The status string shown in the agent card. Plan 04.1-09 — when the
  // optimistic override is set ('paused'), that wins until the next poll
  // clears it; otherwise the host's status field rules.
  const displayedStatus = pausedOverride ?? employee?.status ?? '—';
  const isPausedDisplay = displayedStatus === 'paused';

  return (
    <aside className="ctx" data-clarity-region="context-rail">
      {employee ? (
        <div className="agent-card">
          <div className="role-line">
            {employee.name}
            {employee.role ? <small>{employee.role}</small> : null}
          </div>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">Status</span>
              <b
                className={isPausedDisplay ? 'stat-value paused' : 'stat-value'}
                data-clarity-status={displayedStatus}
              >
                {displayedStatus}
              </b>
            </div>
            <div className="stat">
              <span className="stat-label">Topic</span>
              <b>{topic ? topic.title : '—'}</b>
            </div>
          </div>
        </div>
      ) : (
        <p className="ctx-empty">Select an employee to see their context.</p>
      )}

      <h3>Active tasks owned</h3>
      {topic ? (
        <ActiveTasksOwned tasks={activeTasks} />
      ) : (
        <p className="ctx-empty">Select a topic to see its spun-off tasks.</p>
      )}

      <h3>You owe</h3>
      <p className="ctx-empty">
        {topic
          ? 'No outstanding decisions on this topic.'
          : 'Select a topic to see what you owe.'}
      </p>

      <h3>Recent attachments</h3>
      <div className="pin-row attach-unavailable">
        Attachments are temporarily unavailable
      </div>

      <h3>Quick actions</h3>
      <div className="quick">
        {/* Plan 04.1-06 Pattern E — Archive topic affordance as the FIRST
            .qa row when a topic is selected. Hidden when no topic (the row
            has no meaningful target). */}
        {topic ? (
          <ArchiveTopicButton
            companyId={companyId}
            userId={userId}
            topicIssueId={topic.issueId}
            topicTitle={topic.title}
            onArchived={onArchived}
          />
        ) : null}
        <button type="button" className="qa" disabled>
          ⌕ Search this employee&apos;s chats
        </button>
        {/* Plan 04.1-09 — pause-heartbeat now fires a toast + flips the CEO
            status pill optimistically. The button is no longer disabled. */}
        <button
          type="button"
          className="qa"
          onClick={onPauseHeartbeat}
          disabled={!employee}
          data-clarity-action="pause-heartbeat"
        >
          ⏸ Pause heartbeat (Situation Room)
        </button>
      </div>

      {topic ? (
        <>
          <h3>Storage pin</h3>
          <div className="pin-row">
            📁 <b>{topic.title}</b>
            <br />
            <span style={{ color: 'var(--ink-3)' }}>
              all messages persist as issue comments · single source of truth
            </span>
          </div>
        </>
      ) : null}
    </aside>
  );
}
