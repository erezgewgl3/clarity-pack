// src/ui/surfaces/chat/true-task/true-task-dialog.tsx
//
// Plan 04.1-06 Task 1 — Pattern B (UI-SPEC §"Confirm dialog (D-02)").
//
// Native <dialog>-element confirm modal. NO shadcn / radix import — the
// UI-SPEC §"Registry Safety" pin keeps the plugin bundle free of radix.
// React 19's native dialog support is sufficient; opening/closing goes
// through dialog.showModal() / dialog.close() inside a useEffect.
//
// Focus-trap is provided for free by the <dialog> API; Escape closes
// (= Keep editing); clicking the backdrop does NOT close — the only
// exits are Create or Keep editing (UI-SPEC: "small modal, deliberate
// friction").
//
// Wires:
//   - Title field: controlled <input>, defaults to first ~80 chars of body,
//     max 200 chars (UX bound — not a security bound; the host stores as
//     text and React text-rendering downstream prevents HTML injection).
//   - Assignee select: options from chat.roster (re-fetched at dialog
//     open), default selection = the chatted employee. The Editor-Agent
//     is excluded from the dropdown (D-03 from Phase 4 — reuse).
//   - FROM MESSAGE preview: the full composer body in a read-only
//     quote-block.
//   - Create button: usePluginAction('chat.createTrueTask') with the
//     locked param shape; on { ok, issueId } the parent's onSuccess
//     closes the dialog, disarms the toggle, and clears the composer.
//
// Error pattern: matches message-thread.tsx PromoteActions.resultError —
// worker action handlers RETURN { error } structures rather than throw.
// A genuine transport-level throw falls into the catch with a static
// CREATE_FAILED code.

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RosterEmployee } from '../roster-rail.tsx';

type RosterResult =
  | RosterEmployee[]
  | { error: string }
  | { employees: RosterEmployee[] }
  | null;

function normalizeRoster(data: RosterResult): RosterEmployee[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ('employees' in data && Array.isArray(data.employees)) return data.employees;
  return [];
}

export function TrueTaskDialog({
  open,
  onClose,
  onSuccess,
  defaultTitle,
  body,
  topicIssueId,
  topicTitle,
  topicId,
  assigneeAgentId: defaultAssigneeAgentId,
  employeeName: defaultEmployeeName,
  companyId,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: { issueId: string }) => void;
  /** First ~80 chars of the composer body, trimmed. */
  defaultTitle: string;
  /** Full composer body — rendered into the read-only FROM MESSAGE block. */
  body: string;
  topicIssueId: string;
  topicTitle: string;
  /** CHT-NNN style id used in the dialog eyebrow. */
  topicId: string;
  assigneeAgentId: string;
  employeeName: string;
  companyId: string;
  userId: string;
}): React.ReactElement {
  const createTrueTask = usePluginAction('chat.createTrueTask');
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  // Re-fetch the roster only when the dialog opens — chat.roster is cheap
  // (~5 employees) but the empty-params object is the no-op shape the
  // opt-in-guard returns OPT_IN_REQUIRED for, so a closed dialog short-
  // circuits before reaching the worker.
  const { data: rosterData } = usePluginData<RosterResult>(
    'chat.roster',
    open ? { companyId, userId } : {},
  );
  const roster = normalizeRoster(rosterData);

  const [title, setTitle] = React.useState(defaultTitle);
  const [assigneeAgentId, setAssigneeAgentId] = React.useState(defaultAssigneeAgentId);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  // Sync defaults each time the dialog opens — the parent rebuilds these
  // from a fresh composer draft + active employee on every Send-as-task.
  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setAssigneeAgentId(defaultAssigneeAgentId);
      setFeedback(null);
    }
  }, [open, defaultTitle, defaultAssigneeAgentId]);

  // Open / close via the imperative dialog API. Native <dialog>.showModal()
  // gives us focus-trap + Escape-to-close for free; click-outside is a no-op
  // (UI-SPEC §"Confirm dialog (D-02)" — deliberate friction).
  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  // Escape pressed inside the native dialog fires a 'close' event — wire it
  // back up to the parent so the toggle stays armed (operator was adjusting,
  // not abandoning).
  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handleClose = (): void => {
      if (open) onClose();
    };
    node.addEventListener('close', handleClose);
    return () => node.removeEventListener('close', handleClose);
  }, [open, onClose]);

  const resolvedEmployeeName = React.useMemo(() => {
    const match = roster.find((e) => e.id === assigneeAgentId);
    return match?.name ?? defaultEmployeeName;
  }, [roster, assigneeAgentId, defaultEmployeeName]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !!assigneeAgentId && !busy;

  const onCreate = React.useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await createTrueTask({
        topicIssueId,
        sourceCommentId: null,
        title: trimmedTitle,
        body,
        assigneeAgentId,
        employeeName: resolvedEmployeeName,
        companyId,
        userId,
      });
      if (result && typeof result === 'object' && 'error' in result) {
        const err = String((result as { error: unknown }).error);
        setFeedback({ kind: 'error', text: `Could not create task (${err}). Try again.` });
        return;
      }
      const issueId =
        result && typeof result === 'object' && 'issueId' in result
          ? String((result as { issueId: unknown }).issueId)
          : '';
      onSuccess({ issueId });
    } catch {
      setFeedback({ kind: 'error', text: 'Could not create task (CREATE_FAILED). Try again.' });
    } finally {
      setBusy(false);
    }
  }, [
    canSubmit,
    createTrueTask,
    topicIssueId,
    trimmedTitle,
    body,
    assigneeAgentId,
    resolvedEmployeeName,
    companyId,
    userId,
    onSuccess,
  ]);

  const titleCount = trimmedTitle.length;

  return (
    <dialog ref={dialogRef} className="true-task-dialog" aria-labelledby="true-task-dialog-heading">
      <div className="true-task-dialog-eyebrow">
        FROM CHAT · {topicTitle} · {topicId}
      </div>
      <h2 id="true-task-dialog-heading" className="true-task-dialog-heading">
        Create task for {resolvedEmployeeName}
      </h2>

      <div className="true-task-dialog-field">
        <label htmlFor="true-task-dialog-title">
          TITLE
          {titleCount > 160 ? (
            <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontFamily: 'Geist Mono', fontSize: 10 }}>
              {titleCount}/200
            </span>
          ) : null}
        </label>
        <input
          id="true-task-dialog-title"
          type="text"
          value={title}
          maxLength={200}
          placeholder="One-line summary of what to do"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Task title"
          autoFocus
        />
      </div>

      <div className="true-task-dialog-field">
        <label htmlFor="true-task-dialog-assignee">ASSIGNEE</label>
        <select
          id="true-task-dialog-assignee"
          value={assigneeAgentId}
          onChange={(e) => setAssigneeAgentId(e.target.value)}
          aria-label="Task assignee"
        >
          {/* If the default assignee is not (yet) in the loaded roster, still
              keep the option present so the dialog never starts with an empty
              select — defense-in-depth for a slow chat.roster round-trip. */}
          {roster.find((e) => e.id === defaultAssigneeAgentId) ? null : (
            <option value={defaultAssigneeAgentId}>
              {defaultEmployeeName}
            </option>
          )}
          {roster.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
              {emp.role ? ` · ${emp.role}` : ''}
            </option>
          ))}
        </select>
        <p
          id="true-task-dialog-helper"
          className="true-task-dialog-helper"
        >
          The task will appear in the Issues list, assigned to this employee.
        </p>
      </div>

      <div className="true-task-dialog-field">
        <label>FROM MESSAGE</label>
        <div className="true-task-dialog-source" aria-readonly="true">
          {body}
        </div>
      </div>

      {feedback ? (
        <div
          className={`pa-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="true-task-dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          Keep editing
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void onCreate()}
          disabled={!canSubmit}
        >
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </dialog>
  );
}
