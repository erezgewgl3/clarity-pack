// src/ui/surfaces/chat/true-task/chat-task-status-pill.tsx
//
// Plan 04.1-06 Task 1 — UI-SPEC §"State pill mapping (D-08 live status)".
//
// Thin presentational wrapper over the existing chat status-pill classes
// (chat.css:1114-1132 — `.task-row .st.*`). Maps ISSUE_STATUSES to the
// four colour-classed pills (todo / review / done / blocked) per the
// UI-SPEC table. Loading / undefined renders the muted "· — ·" form so
// a poll round-trip that hasn't yet returned status never alarms the
// operator (UI-SPEC §"Cross-affordance error states").
//
// aria-label per UI-SPEC §Accessibility: screen readers announce the
// status word, not the colour class.

import * as React from 'react';

const PILL_CLASS_BY_STATUS: Record<string, string> = {
  backlog: 'todo',
  todo: 'todo',
  in_progress: 'todo',
  in_review: 'review',
  done: 'done',
  blocked: 'blocked',
  cancelled: 'todo',
};

const PILL_LABEL_BY_STATUS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

export function ChatTaskStatusPill({
  status,
}: {
  status: string | null | undefined;
}): React.ReactElement {
  if (!status) {
    return (
      <span className="st todo" aria-label="Status: loading" style={{ opacity: 0.5 }}>
        · — ·
      </span>
    );
  }
  const cls = PILL_CLASS_BY_STATUS[status] ?? 'todo';
  const label = PILL_LABEL_BY_STATUS[status] ?? status;
  // Cancelled renders with strike-through per UI-SPEC mapping.
  const style: React.CSSProperties | undefined =
    status === 'cancelled' ? { textDecoration: 'line-through' } : undefined;
  return (
    <span className={`st ${cls}`} aria-label={`Status: ${label}`} style={style}>
      {label}
    </span>
  );
}
