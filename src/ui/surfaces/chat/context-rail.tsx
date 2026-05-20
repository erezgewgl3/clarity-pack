// src/ui/surfaces/chat/context-rail.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the Employee Chat context rail (right column).
// Plan 04.1-06 Task 2 — mounts Pattern D (ActiveTasksOwned) + Pattern E
// (ArchiveTopicButton). The active tasks owned stub is REPLACED with the
// live polled rail; the Quick actions block grows a new FIRST .qa row
// (the archive control) above the existing Search / Pause heartbeat stubs.
//
// Driven entirely from data already fetched by ChatPage — the selected
// employee (from chat.roster) and the selected topic (from chat.topics).
// The new components add two worker handler calls (chat.taskOwned,
// chat.topic.archive) — both wave-2/3 of Phase 4.1.
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 342-392
// + 692-738: agent card, "Active tasks owned", "You owe", "Recent
// attachments", "Quick actions".
//
// All text renders as untrusted React text (T-04-18).

import * as React from 'react';

import type { RosterEmployee } from './roster-rail.tsx';
import type { ChatTopic } from './topic-strip.tsx';
import { ActiveTasksOwned } from './active-tasks-owned.tsx';
import { ArchiveTopicButton } from './archive-topic-button.tsx';

export function ContextRail({
  employee,
  topic,
  companyId,
  userId,
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
  onArchived: () => void;
}): React.ReactElement {
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
              <b>{employee.status || '—'}</b>
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
        <ActiveTasksOwned
          companyId={companyId}
          userId={userId}
          topicIssueId={topic.issueId}
        />
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
        <button type="button" className="qa" disabled>
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
