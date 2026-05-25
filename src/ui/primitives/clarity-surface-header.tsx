// src/ui/primitives/clarity-surface-header.tsx
//
// Plan 05-08 Task 5 (D-17) — shared top-right header with `+ Create task`
// affordance mounted on Reader / Situation Room / Bulletin / Chat.
//
// Click opens the TrueTaskDialog in COLD mode (no sourceMessage, no
// sourceTopic). Plan 04.1-02's TrueTaskDialog already covers the cold flow;
// this header lifts the dialog mount out of chat-only territory so cold-task
// creation works on Reader / Situation Room / Bulletin too.
//
// D-17 cross-surface toast (checker BLOCKER 4): the header calls
// `useToast()` from the ToastProvider hoisted into ClaritySurfaceRoot
// (Task 4). On TrueTaskDialog onSuccess, fire `showToast('Task created')`
// UNCONDITIONALLY — every surface that renders <ClaritySurfaceHeader> is
// inside a <ClaritySurfaceRoot>, which provides the ToastProvider, so
// useToast() always resolves to a real toast surface.
//
// Keyboard contract: the existing chat actions-row owns the single-key `T`
// shortcut (Plan 04.1-09 contract). This header is CLICK-ONLY — no window
// keydown listener. On the chat surface, the actions-row's `T` listener
// continues to work in parallel with this header's button.
//
// SECURITY (T-04-18): the toast message is static React text; no
// dangerouslySetInnerHTML.

import * as React from 'react';

import { useToast } from './toast.tsx';
import {
  TrueTaskDialog,
  type TrueTaskDialogMode,
} from '../surfaces/chat/true-task/true-task-dialog.tsx';
import type { ClaritySurfaceName } from './clarity-surface-root.tsx';

export type ClaritySurfaceHeaderProps = {
  companyId: string;
  userId: string;
  surface: ClaritySurfaceName;
  /** Optional surface-specific extra behavior (e.g. chat refetches its
   *  topic list). The header itself owns the 'Task created' toast — this
   *  callback is for surface-specific side-effects only. */
  onTaskCreated?: (taskIssueId: string) => void;
  /** Optional default assignee — chat threads this from the selected
   *  employee. Reader / Situation Room / Bulletin pass empty defaults and
   *  the dialog's roster selector populates the choice. */
  defaultAssigneeAgentId?: string;
  defaultEmployeeName?: string;
  /** Optional employee agent id used to scope the dialog's topic dropdown.
   *  Empty string when the surface has no current employee context. */
  employeeAgentId?: string;
};

export function ClaritySurfaceHeader({
  companyId,
  userId,
  surface,
  onTaskCreated,
  defaultAssigneeAgentId = '',
  defaultEmployeeName = '',
  employeeAgentId = '',
}: ClaritySurfaceHeaderProps): React.ReactElement {
  const { showToast } = useToast();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleSuccess = React.useCallback(
    (result: { issueId: string; mode: TrueTaskDialogMode; title: string }) => {
      setDialogOpen(false);
      // D-17 cross-surface toast — fires on every surface that mounts
      // ClaritySurfaceHeader. Checker BLOCKER 4 closed.
      showToast({ message: 'Task created' });
      if (onTaskCreated) onTaskCreated(result.issueId);
    },
    [showToast, onTaskCreated],
  );

  return (
    <header
      className="clarity-surface-header"
      data-clarity-region="surface-header"
      data-clarity-surface-header-context={surface}
    >
      <button
        type="button"
        className="clarity-cold-task-btn"
        onClick={() => setDialogOpen(true)}
        data-clarity-action="create-task"
        aria-label="Create a task"
      >
        + Create task
      </button>
      <TrueTaskDialog
        open={dialogOpen}
        mode="cold"
        onClose={() => setDialogOpen(false)}
        onSuccess={handleSuccess}
        sourceMessage={null}
        sourceTopic={null}
        defaultAssigneeAgentId={defaultAssigneeAgentId}
        defaultEmployeeName={defaultEmployeeName}
        companyId={companyId}
        userId={userId}
        employeeAgentId={employeeAgentId}
      />
    </header>
  );
}
