// src/ui/surfaces/chat/composer.tsx
//
// Plan 04-05 Task 2 — CHAT-06 / CHAT-07 — the message composer.
//
// Send model (D-10 / CHAT-06 / RESEARCH Pattern 3):
//   - On send, the composer generates a crypto.randomUUID() message_uuid
//     BEFORE the bridge call and renders an optimistic bubble in the thread
//     keyed by that uuid.
//   - On success the optimistic bubble reconciles away once the server
//     thread (re-fetched by MessageThread on the stream event) contains the
//     comment.
//   - On failure the optimistic bubble STAYS marked "Failed to send" with a
//     Retry affordance — Retry re-sends the SAME message_uuid so chat.send's
//     dedup makes the retry idempotent. Eric's typed text is never silently
//     lost (T-04-21).
//
// Attachment graceful-degrade (CHAT-07): the 04-01 spike OQ-1 verdict is
// NO-PATH — there is no plugin-accessible upload route on the live host. The
// 📎 Attach button is therefore rendered DISABLED with the explicit inline
// message "Attachments are temporarily unavailable". This is a valid,
// requirement-satisfying implementation of CHAT-07's graceful-degrade clause
// (see ATTACHMENTS_AVAILABLE below — the single switch a future PATH-FOUND
// build flips).
//
// SECURITY: no raw fetch — chat.send goes through usePluginAction. The
// composed text is plain user input; it is rendered downstream as untrusted
// text by MessageThread (no dangerouslySetInnerHTML anywhere).
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 307-340.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { MessageThread, type OptimisticMessage } from './message-thread.tsx';
import { TrueTaskToggle } from './true-task/true-task-toggle.tsx';
import { TrueTaskDialog } from './true-task/true-task-dialog.tsx';

// 04-01 spike OQ-1 verdict: NO-PATH. No plugin-accessible attachment-upload
// route exists on the live host. CHAT-07 ships degraded. A future PATH-FOUND
// build flips this to true and wires the upload with a ~10MB cap.
const ATTACHMENTS_AVAILABLE = false;

/** Generate a message_uuid — crypto.randomUUID with a safe fallback. */
function newMessageUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Composer({
  companyId,
  userId,
  topicIssueId,
  topicTitle,
  topicId,
  assigneeAgentId,
  employeeName,
  employeeRole,
  diagnostics = false,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  topicTitle: string;
  /** CHT-NNN id rendered in the TrueTaskDialog eyebrow (Pattern B). */
  topicId: string;
  /** D-06 default assignee for chat.createTrueTask — the chatted employee. */
  assigneeAgentId: string;
  /** Locked copywriting — used in Send-as-task placeholder + dialog defaults. */
  employeeName: string;
  /** Optional role suffix used by InlineTaskCard's "Assigned to …" line. */
  employeeRole?: string | null;
  /** Plan 04.1-06 — threaded down from index.tsx so chat.messages receives
   *  includeDiagnostics:true and MessageThread renders runtime-noise inline. */
  diagnostics?: boolean;
}): React.ReactElement {
  const send = usePluginAction('chat.send');
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // The optimistic overlay — messages sent this session, keyed by uuid.
  const [optimistic, setOptimistic] = React.useState<OptimisticMessage[]>([]);
  // Plan 04.1-06 D-01/D-02 — Send-as-task toggle + confirm dialog state.
  const [taskArmed, setTaskArmed] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // Locally-shown inline task card (UI-SPEC §"Interaction Flow" step 6 — the
  // optimistic post-create state before chat.taskOwned has caught up).
  const [pendingTaskCard, setPendingTaskCard] =
    React.useState<{ issueId: string; title: string } | null>(null);

  // doSend is shared by the initial send and Retry. Retry passes the SAME
  // uuid + body so chat.send's message_uuid dedup makes it idempotent.
  const doSend = React.useCallback(
    async (messageUuid: string, body: string) => {
      setBusy(true);
      // Mark this uuid pending (insert on first send, reset on retry).
      setOptimistic((prev) => {
        const existing = prev.find((o) => o.messageUuid === messageUuid);
        const entry: OptimisticMessage = {
          messageUuid,
          body,
          createdAt: Date.now(),
          status: 'pending',
          onRetry: () => void doSend(messageUuid, body),
        };
        return existing
          ? prev.map((o) => (o.messageUuid === messageUuid ? entry : o))
          : [...prev, entry];
      });
      try {
        const result = await send({
          topicIssueId,
          body,
          // GAP 6 — the chat.send handler reads `messageUuid` (camelCase) via
          // reqStr; a snake_case `message_uuid` left params.messageUuid
          // undefined and threw `chat.send: messageUuid required` on EVERY
          // send. The handler's reqStr key is the contract — match it here.
          messageUuid,
          companyId,
          userId,
        });
        // A worker { error } result is a failed send too (D-10).
        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error(String((result as { error: unknown }).error));
        }
        // GAP 9 — success: flip the bubble to 'sent' so Eric sees an immediate
        // "✓ sent" confirmation instead of "sending…" lingering until the next
        // 15s poll. MessageThread still drops the bubble once the reconciled
        // server comment arrives on that poll.
        setOptimistic((prev) =>
          prev.map((o) =>
            o.messageUuid === messageUuid ? { ...o, status: 'sent' } : o,
          ),
        );
      } catch {
        // Failure — the optimistic bubble STAYS, marked failed, with Retry.
        setOptimistic((prev) =>
          prev.map((o) =>
            o.messageUuid === messageUuid ? { ...o, status: 'failed' } : o,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [send, topicIssueId, companyId, userId],
  );

  const handleSend = React.useCallback(() => {
    const body = draft.trim();
    if (!body || busy) return;
    // Plan 04.1-06 D-01 — armed → open the confirm dialog instead of sending.
    // The composer keeps the draft body until the dialog closes via either
    // Keep editing (preserves draft + stays armed) or a successful Create
    // task (the dialog's onSuccess callback clears + disarms).
    if (taskArmed) {
      setDialogOpen(true);
      return;
    }
    const messageUuid = newMessageUuid();
    setDraft('');
    void doSend(messageUuid, body);
  }, [draft, busy, taskArmed, doSend]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Standard chat convention: plain Enter SENDS; Shift+Enter inserts a
      // newline (the textarea's default — we don't preventDefault for it).
      // ⌘/Ctrl+Enter is kept as a harmless secondary send shortcut.
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return; // Shift+Enter → let the newline through.
      e.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  // Placeholder + Send-button label flip on armed state (UI-SPEC Pattern A).
  const placeholder = taskArmed
    ? `Task for ${employeeName}… Enter to open the task form`
    : 'Message this employee… Enter to send, Shift+Enter for newline';
  const sendLabel = taskArmed ? 'Open task form' : 'Send';

  return (
    <>
      <MessageThread
        companyId={companyId}
        userId={userId}
        topicIssueId={topicIssueId}
        optimistic={optimistic}
        assigneeAgentId={assigneeAgentId}
        employeeName={employeeName}
        employeeRole={employeeRole ?? null}
        diagnostics={diagnostics}
        pendingTaskCard={pendingTaskCard}
      />
      <div className="composer" data-clarity-region="composer">
        <div className="composer-meta">
          <span className="topic-now">
            Topic · <b>{topicTitle}</b>
          </span>
          <span>messages persist as comments on the topic issue</span>
        </div>
        <div className="composer-box">
          <textarea
            className="composer-input"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message composer"
            // GAP 1 — the Composer is keyed `composer-${topic.issueId}` in
            // index.tsx, so it remounts whenever a topic opens. autoFocus
            // therefore lands the cursor in the input on every topic open —
            // including a just-created topic — so the user is dropped
            // straight into a place to type.
            autoFocus
          />
          <div className="composer-foot">
            <div className="composer-tools">
              {/* Plan 04.1-06 Pattern A — Send-as-task toggle REPLACES the
                  old "↗ New task" stub. The toggle owns its visual armed-state
                  styling; the parent owns the boolean. */}
              <TrueTaskToggle
                armed={taskArmed}
                disabled={!assigneeAgentId}
                onToggle={() => setTaskArmed((a) => !a)}
              />
              <button
                type="button"
                className="tool-btn"
                disabled={!ATTACHMENTS_AVAILABLE}
                title={
                  ATTACHMENTS_AVAILABLE
                    ? 'Attach a file'
                    : 'Attachments are temporarily unavailable'
                }
              >
                📎 Attach
              </button>
              {!ATTACHMENTS_AVAILABLE ? (
                <span className="attach-unavailable">
                  Attachments are temporarily unavailable
                </span>
              ) : null}
            </div>
            <div className="send-row">
              <span className="composer-hint">
                <kbd>↵</kbd> to send · <kbd>⇧</kbd>+<kbd>↵</kbd> for newline
              </span>
              <button
                type="button"
                className="btn"
                onClick={handleSend}
                disabled={busy || draft.trim().length === 0}
              >
                {sendLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Plan 04.1-06 Pattern B — confirm dialog. Mounted once at the JSX
          tree's end; the native <dialog> imperative API opens/closes via
          dialogRef inside the component. */}
      <TrueTaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={(result) => {
          setDialogOpen(false);
          setTaskArmed(false);
          // Show an immediate optimistic InlineTaskCard until chat.taskOwned
          // catches up (UI-SPEC §"Interaction Flow" step 6); cleared whenever
          // a new send starts so it never lingers across topics.
          if (result.issueId) {
            setPendingTaskCard({
              issueId: result.issueId,
              title: draft.trim().slice(0, 200) || 'New task',
            });
          }
          setDraft('');
        }}
        defaultTitle={draft.trim().slice(0, 80)}
        body={draft.trim()}
        topicIssueId={topicIssueId}
        topicTitle={topicTitle}
        topicId={topicId}
        assigneeAgentId={assigneeAgentId}
        employeeName={employeeName}
        companyId={companyId}
        userId={userId}
      />
    </>
  );
}
