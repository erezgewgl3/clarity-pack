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
//
// Plan 05-07 Task 2 (D-14) — React-key audit pass for TrueTaskDialog.
// Audit verdict: both JSX-returning `.map(...)` callbacks (the roster
// <option> map at line 327 keyed on `emp.id`; the topics <option> map
// at line 346 keyed on `t.issueId`) are stable. The single closed-state
// return `<></>` (line 277) is an empty fragment for the not-rendered
// path — not a sibling-in-list pattern. Sibling files
// `chat-task-status-pill.tsx` + `inline-task-card.tsx` contain no
// `.map()` calls at all. The 2026-05-25 drill attribution likely
// surfaced from a parent (the dialog is mounted by ChatPageBody —
// audited separately) rather than from this component's own JSX.
// Verified by the test/ui/chat-react-key-console-capture.test.mjs gate.

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
  currentTopic = null,
  defaultAssigneeAgentId,
  defaultEmployeeName,
  companyId,
  userId,
  employeeAgentId,
}: {
  open: boolean;
  mode: TrueTaskDialogMode;
  onClose: () => void;
  onSuccess: (result: { issueId: string; mode: TrueTaskDialogMode; title: string }) => void;
  /** Required for PROMOTE mode. Ignored in COLD. */
  sourceMessage?: PromoteSourceMessage | null;
  /** Required for PROMOTE mode (the source topic). Ignored in COLD. */
  sourceTopic?: ChatTopic | null;
  /** quick-260619-r4v Piece 1 — the currently-open topic. In create ("cold")
   *  mode the Topic dropdown defaults to this topic instead of the removed
   *  Standalone option. Null when no topic is open (zero-topics fallback). */
  currentTopic?: ChatTopic | null;
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
  // quick-260619-r4v Piece 1 — the Standalone (null) default is REMOVED. The
  // dialog defaults the Topic dropdown to the source topic (promote) or the
  // currently-open topic (create). Null only when no topic is open at all
  // (zero-topics fallback → the operator MUST name a new topic).
  const initialTopicIssueId: string | null =
    mode === 'promote' && sourceTopic
      ? sourceTopic.issueId
      : currentTopic
        ? currentTopic.issueId
        : null;

  const [title, setTitle] = React.useState(initialTitle);
  const [assigneeAgentId, setAssigneeAgentId] = React.useState(defaultAssigneeAgentId);
  /** Selected EXISTING topic's host issue id, or null when creating a NEW
   *  topic (the new-topic name input is then the source of truth). */
  const [topicIssueId, setTopicIssueId] = React.useState<string | null>(initialTopicIssueId);
  /** quick-260619-r4v Piece 1 — when the operator picks "+ New topic" the
   *  dropdown value becomes the __new__ sentinel and this controlled input
   *  carries the new topic's title. Non-empty ⇒ atomic new-topic create. */
  const [newTopicName, setNewTopicName] = React.useState('');
  const [creatingNewTopic, setCreatingNewTopic] = React.useState(false);
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
      setNewTopicName('');
      // When no topic is open at all (zero topics), default straight into the
      // new-topic input — there is nothing to select.
      setCreatingNewTopic(initialTopicIssueId === null);
      setDetails('');
      setFeedback(null);
    }
    // We intentionally don't include initialTitle/initialTopicIssueId — they
    // are derived from props that don't change while the dialog is open.
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
  // quick-260619-r4v Piece 1 — Create is gated on a topic being chosen: an
  // existing topic selected, OR a non-empty new-topic name. (Standalone is
  // gone — there is no "no topic" path.)
  const trimmedNewTopic = newTopicName.trim();
  const hasTopic = creatingNewTopic ? trimmedNewTopic.length > 0 : !!topicIssueId;
  const canSubmit = trimmedTitle.length > 0 && !!assigneeAgentId && hasTopic && !busy;

  const onCreate = React.useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      // quick-260619-r4v Piece 1 — every task is topic-linked. When the
      // operator chose "+ New topic" we pass newTopicTitle + topicIssueId:null
      // so the worker atomically creates the topic then links the task; when
      // an existing topic is selected we pass its issueId. Promote passes the
      // source topic id + comment id so the existing chat-task path runs.
      const sourceCommentId =
        mode === 'promote' && sourceMessage ? sourceMessage.commentId : null;
      const body =
        mode === 'promote' && sourceMessage
          ? sourceMessage.body
          : details.trim() || trimmedTitle;
      const result = await createTrueTask({
        topicIssueId: creatingNewTopic ? null : topicIssueId,
        newTopicTitle: creatingNewTopic ? trimmedNewTopic : undefined,
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
      // Plan 04.1-10 — title threaded back to the parent so index.tsx can
      // (a) set pendingTaskCard for the optimistic inline card render
      // (promote mode), (b) compose the creation toast with a human-
      // readable label that survives the 15s chat.taskOwned poll race.
      onSuccess({ issueId, mode, title: trimmedTitle });
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
    creatingNewTopic,
    trimmedNewTopic,
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
  // quick-260619-r4v Piece 1 — every task is topic-linked, so the helper no
  // longer mentions Standalone. It explains the new-topic affordance instead.
  const topicHelper = creatingNewTopic
    ? 'A new topic will be created and the task linked to it.'
    : 'This task will be linked to the selected topic and appear in its thread.';
  const NEW_TOPIC_SENTINEL = '__new__';

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
        {/* quick-260619-r4v Piece 1 — TOPIC is REQUIRED (label no longer reads
            "(OPTIONAL)"). The Standalone option is GONE. Order: current/source
            topic first, then the employee's other topics, then "+ New topic".
            Picking "+ New topic" reveals the name input below. */}
        <label htmlFor="true-task-dialog-topic">TOPIC</label>
        <select
          id="true-task-dialog-topic"
          value={creatingNewTopic ? NEW_TOPIC_SENTINEL : topicIssueId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_TOPIC_SENTINEL) {
              setCreatingNewTopic(true);
              setTopicIssueId(null);
            } else {
              setCreatingNewTopic(false);
              setTopicIssueId(v || null);
            }
          }}
          aria-label="Linked topic"
        >
          {topics.map((t) => (
            <option key={t.issueId} value={t.issueId}>
              {t.title}
              {t.topicId ? ` · ${t.topicId}` : ''}
              {sourceTopic && t.issueId === sourceTopic.issueId ? ' (from message)' : ''}
              {currentTopic && t.issueId === currentTopic.issueId && !sourceTopic
                ? ' (current)'
                : ''}
            </option>
          ))}
          <option value={NEW_TOPIC_SENTINEL}>+ New topic…</option>
        </select>
        {creatingNewTopic ? (
          <input
            id="true-task-dialog-new-topic"
            type="text"
            value={newTopicName}
            maxLength={120}
            placeholder="New topic name"
            onChange={(e) => setNewTopicName(e.target.value)}
            aria-label="New topic name"
            className="true-task-dialog-new-topic-input"
          />
        ) : null}
        <p className="true-task-dialog-helper">{topicHelper}</p>
      </div>

      {mode === 'cold' ? (
        <div className="true-task-dialog-field">
          <label htmlFor="true-task-dialog-details">DETAILS (OPTIONAL)</label>
          {/* Plan 04.1-10 drill fix #2a — DETAILS was an <input type="text">
              which capped the operator's primary content (task body) at a
              single line. Promoted to a <textarea> with min-height 140px,
              max-height 40vh, vertical resize, and overflow-y auto (CSS in
              chat.css under [data-clarity-surface="chat"] .true-task-dialog
              textarea). */}
          <textarea
            id="true-task-dialog-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Add context, acceptance criteria, links…"
            aria-label="Task details"
            rows={6}
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
