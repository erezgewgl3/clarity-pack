// src/ui/surfaces/chat/true-task/true-task-dialog.tsx
//
// Plan 04.1-08 — RESHAPED dual-mode dialog. The Plan 04.1-06 single-mode
// confirm-dialog (UI-SPEC §"Confirm dialog (D-02)") is replaced by a
// COLD + PROMOTE shared shell:
//
//   COLD mode    — heading "Create a task". Title is autofocused + empty.
//                  Topic dropdown defaults to "Standalone (not linked to any
//                  topic)" (value `null`). NO FROM-MESSAGE block. Submit
//                  invokes chat.createTrueTask with topicIssueId: null →
//                  worker takes the cold-task originId path (Task 4).
//
//   PROMOTE mode — heading "Promote message to task". Title is pre-filled
//                  with titleFromBody(sourceMessage.body). Topic dropdown
//                  defaults to sourceTopic.topicIssueId. FROM-MESSAGE block
//                  renders the source body with the gold left-rule eyebrow.
//                  Submit invokes chat.createTrueTask with the source
//                  topicIssueId + sourceCommentId → chat-task originId path.
//
// Plan 04.1-09 — DIALOG SHELL REWORKED. The Plan 04.1-08 build used the
// native `<dialog>` element + showModal(). On the live Countermoves drill the
// dialog rendered TOP-LEFT instead of centered — the existing CSS forced
// `position: fixed; inset: 0; width: 480px; margin: 0` which fought the
// native auto-centering. The dialog now renders as a custom backdrop +
// body pair: an outer `<div className="true-task-dialog-backdrop">` covers
// the viewport (fixed inset 0, flex centered) and the inner
// `<div className="true-task-dialog">` is `position: relative` with
// `max-width: 560px`. Backdrop click closes; click inside the dialog body
// uses stopPropagation so it does NOT close. Escape is a window listener
// so it fires regardless of focus location. The `open` prop guards render —
// the entire backdrop returns null when closed (no more imperative
// showModal/close calls).
//
// ⌘+Enter / Ctrl+Enter from anywhere inside the dialog submits.
//
// SECURITY (T-04-18): every field renders as untrusted React text. NO
// dangerouslySetInnerHTML. No raw fetch — chat.createTrueTask goes through
// usePluginAction.

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RosterEmployee } from '../roster-rail.tsx';
import type { ChatTopic } from '../topic-strip.tsx';

type RosterResult =
  | RosterEmployee[]
  | { error: string }
  | { employees: RosterEmployee[] }
  | null;

type TopicsResult =
  | { kind: 'topics'; employeeAgentId: string; topics: ChatTopic[] }
  | { error: string }
  | null;

function normalizeRoster(data: RosterResult): RosterEmployee[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ('employees' in data && Array.isArray(data.employees)) return data.employees;
  return [];
}

function normalizeTopics(data: TopicsResult): ChatTopic[] {
  if (!data || typeof data !== 'object') return [];
  if ('kind' in data && data.kind === 'topics') return data.topics ?? [];
  return [];
}

/** Title pre-fill from a message body (matches the worker's titleFromBody). */
function titleFromBody(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= 80) return firstLine || 'Promoted chat message';
  return `${firstLine.slice(0, 77)}...`;
}

/** Format HH:MM from an ISO string (used in the FROM-MESSAGE eyebrow). */
function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type TrueTaskDialogMode = 'cold' | 'promote';

export type PromoteSourceMessage = {
  /** Full message body — rendered into the FROM-MESSAGE block. */
  body: string;
  /** Source comment id — used as sourceCommentId for the chat-task originId. */
  commentId: string;
  /** Display name of the message author (e.g. "CEO"). */
  employeeName: string;
  /** ISO timestamp; used to render the HH:MM in the FROM-MESSAGE eyebrow. */
  occurredAt: string | null;
};

export function TrueTaskDialog({
  open,
  mode,
  onClose,
  onSuccess,
  sourceMessage = null,
  sourceTopic = null,
  defaultAssigneeAgentId,
  defaultEmployeeName,
  companyId,
  userId,
  employeeAgentId,
}: {
  open: boolean;
  mode: TrueTaskDialogMode;
  onClose: () => void;
  onSuccess: (result: { issueId: string; mode: TrueTaskDialogMode }) => void;
  /** Required for PROMOTE mode. Ignored in COLD. */
  sourceMessage?: PromoteSourceMessage | null;
  /** Required for PROMOTE mode (the source topic). Ignored in COLD. */
  sourceTopic?: ChatTopic | null;
  /** Default assignee (the currently-chatted employee). */
  defaultAssigneeAgentId: string;
  defaultEmployeeName: string;
  companyId: string;
  userId: string;
  /** The currently-chatted employee's agent id — used to scope the topics dropdown. */
  employeeAgentId: string;
}): React.ReactElement {
  const createTrueTask = usePluginAction('chat.createTrueTask');

  // Re-fetch the roster only when the dialog opens.
  const { data: rosterData } = usePluginData<RosterResult>(
    'chat.roster',
    open ? { companyId, userId } : {},
  );
  const roster = normalizeRoster(rosterData);

  // Topics scoped to the chatted employee — populates the Topic dropdown.
  const { data: topicsData } = usePluginData<TopicsResult>(
    'chat.topics',
    open && employeeAgentId ? { employeeAgentId, companyId, userId } : {},
  );
  const topics = normalizeTopics(topicsData).filter((t) => !t.archived);

  // Compute defaults from mode.
  const initialTitle =
    mode === 'promote' && sourceMessage ? titleFromBody(sourceMessage.body) : '';
  const initialTopicIssueId: string | null =
    mode === 'promote' && sourceTopic ? sourceTopic.issueId : null;

  const [title, setTitle] = React.useState(initialTitle);
  const [assigneeAgentId, setAssigneeAgentId] = React.useState(defaultAssigneeAgentId);
  /** `null` = Standalone (cold tasks default). String = host issue id of the topic. */
  const [topicIssueId, setTopicIssueId] = React.useState<string | null>(initialTopicIssueId);
  const [details, setDetails] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  // Reset every time the dialog opens — caller may have changed mode / source.
  React.useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setAssigneeAgentId(defaultAssigneeAgentId);
      setTopicIssueId(initialTopicIssueId);
      setDetails('');
      setFeedback(null);
    }
    // We intentionally don't include initialTitle/initialTopicIssueId — they
    // are derived from props that don't change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAssigneeAgentId, mode]);

  // Plan 04.1-09 — Escape closes via a window listener so it fires regardless
  // of focus location. The Plan 04.1-08 build relied on the native <dialog>
  // element's built-in Esc-close; the new backdrop+body shell needs an
  // explicit listener. Mounted only while open so a closed dialog does not
  // intercept Esc for other surfaces.
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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
      // Plan 04.1-08 — topicIssueId is `null` for cold tasks. The worker
      // takes the cold-task originId path (cold-task:<userId>:<unix-ms>) and
      // skips the marker-comment + chat_topic_tasks side-table writes (Task 4).
      // For promote we pass the source topic id + comment id so the existing
      // chat-task originId path runs unchanged.
      const sourceCommentId =
        mode === 'promote' && sourceMessage ? sourceMessage.commentId : null;
      const body =
        mode === 'promote' && sourceMessage
          ? sourceMessage.body
          : details.trim() || trimmedTitle;
      const result = await createTrueTask({
        topicIssueId,
        sourceCommentId,
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
      onSuccess({ issueId, mode });
    } catch {
      setFeedback({ kind: 'error', text: 'Could not create task (CREATE_FAILED). Try again.' });
    } finally {
      setBusy(false);
    }
  }, [
    canSubmit,
    mode,
    sourceMessage,
    topicIssueId,
    trimmedTitle,
    details,
    assigneeAgentId,
    resolvedEmployeeName,
    companyId,
    userId,
    createTrueTask,
    onSuccess,
  ]);

  // ⌘+Enter (Mac) / Ctrl+Enter (Windows) submits from anywhere in the dialog.
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key !== 'Enter') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      void onCreate();
    },
    [onCreate],
  );

  const heading = mode === 'promote' ? 'Promote message to task' : 'Create a task';
  const topicHelper =
    mode === 'promote'
      ? "This task will appear in the source topic's Active tasks owned rail."
      : "Standalone tasks won't appear in any topic's Active tasks owned rail.";

  // Plan 04.1-09 — when closed, render nothing. The Plan 04.1-08 build kept
  // the <dialog> element mounted and toggled via showModal/close; the new
  // backdrop+body shell mounts only while open.
  if (!open) return <></>;

  return (
    <div
      className="true-task-dialog-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="true-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="true-task-dialog-heading"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        data-clarity-mode={mode}
      >
        <h2 id="true-task-dialog-heading" className="true-task-dialog-heading">
          {heading}
        </h2>

      <div className="true-task-dialog-field">
        <label htmlFor="true-task-dialog-title">TITLE</label>
        <input
          id="true-task-dialog-title"
          type="text"
          value={title}
          maxLength={200}
          placeholder={
            mode === 'promote'
              ? 'Title (pre-filled from message)'
              : 'What needs to get done?'
          }
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Task title"
          autoFocus
        />
      </div>

      <div className="true-task-dialog-field">
        <label htmlFor="true-task-dialog-assignee">ASSIGN TO</label>
        <select
          id="true-task-dialog-assignee"
          value={assigneeAgentId}
          onChange={(e) => setAssigneeAgentId(e.target.value)}
          aria-label="Task assignee"
        >
          {roster.find((e) => e.id === defaultAssigneeAgentId) ? null : (
            <option value={defaultAssigneeAgentId}>{defaultEmployeeName}</option>
          )}
          {roster.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
              {emp.role ? ` · ${emp.role}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="true-task-dialog-field">
        <label htmlFor="true-task-dialog-topic">TOPIC (OPTIONAL)</label>
        <select
          id="true-task-dialog-topic"
          value={topicIssueId ?? ''}
          onChange={(e) => setTopicIssueId(e.target.value || null)}
          aria-label="Linked topic"
        >
          {/* Cold default — Standalone always first. */}
          <option value="">Standalone (not linked to any topic)</option>
          {topics.map((t) => (
            <option key={t.issueId} value={t.issueId}>
              {t.title}
              {t.topicId ? ` · ${t.topicId}` : ''}
              {sourceTopic && t.issueId === sourceTopic.issueId ? ' (from message)' : ''}
            </option>
          ))}
        </select>
        <p className="true-task-dialog-helper">{topicHelper}</p>
      </div>

      {mode === 'cold' ? (
        <div className="true-task-dialog-field">
          <label htmlFor="true-task-dialog-details">DETAILS (OPTIONAL)</label>
          <input
            id="true-task-dialog-details"
            type="text"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Add context, acceptance criteria, links…"
            aria-label="Task details"
          />
        </div>
      ) : null}

      {mode === 'promote' && sourceMessage ? (
        <div
          className="true-task-dialog-from-msg"
          role="note"
          aria-label="Source message"
        >
          <span className="true-task-dialog-from-msg-label">
            FROM THIS MESSAGE · {sourceMessage.employeeName}
            {sourceMessage.occurredAt ? ` · ${clock(sourceMessage.occurredAt)}` : ''}
          </span>
          {sourceMessage.body}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`pa-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="true-task-dialog-actions">
        <span className="true-task-dialog-foot-hint" aria-hidden="true">
          <kbd>⌘</kbd>
          <kbd>⏎</kbd> create · <kbd>Esc</kbd> cancel
        </span>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void onCreate()}
          disabled={!canSubmit}
        >
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
      </div>
    </div>
  );
}
