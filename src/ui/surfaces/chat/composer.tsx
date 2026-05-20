// src/ui/surfaces/chat/composer.tsx
//
// Plan 04-05 Task 2 — CHAT-06 / CHAT-07 — the message composer.
// Plan 04.1-08 STRIPPED — single-purpose chat textarea. The Send-as-task
// TOGGLE is REMOVED entirely. The send button always says SEND. The placeholder
// is `Message {employee}…`. Cold task creation lives in the new actions row
// (`+ Create task` primary button); promote-from-message lives in the per-bubble
// hover affordance. This component is no longer responsible for opening any
// task dialog.
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
// Disabled state (Plan 04.1-08): when the active topic is archived, the
// parent passes `disabled={true}`. The textarea becomes read-only, the send
// button is disabled, the wrapper picks up `.composer--disabled` (dashed
// border + dim text), and the placeholder flips to "Unarchive to send
// messages." No chat.send call can fire from a disabled composer.
//
// Attachment graceful-degrade (CHAT-07): the 04-01 spike OQ-1 verdict is
// NO-PATH — there is no plugin-accessible upload route on the live host. The
// 📎 Attach button is therefore rendered DISABLED with the explicit inline
// message "Attachments are temporarily unavailable".
//
// SECURITY: no raw fetch — chat.send goes through usePluginAction. The
// composed text is plain user input; it is rendered downstream as untrusted
// text by MessageThread.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import {
  MessageThread,
  type OptimisticMessage,
  type PromoteSourceMessagePayload,
} from './message-thread.tsx';

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
  assigneeAgentId,
  employeeName,
  employeeRole,
  diagnostics = false,
  disabled = false,
  pendingTaskCard = null,
  onPromoteMessage = null,
  archivedBanner = null,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  topicTitle: string;
  /** D-06 default assignee for chat.send — the chatted employee. Plan 04.1-08
   *  removed the dialog wiring from this component; the composer no longer
   *  passes assigneeAgentId to a child dialog. Threaded down to MessageThread
   *  for PromoteActions (per-bubble hover). */
  assigneeAgentId: string;
  /** Locked copywriting — the placeholder reads `Message {employeeName}…`. */
  employeeName: string;
  /** Optional employee role suffix for downstream components. */
  employeeRole?: string | null;
  /** Plan 04.1-06 — threaded down from index.tsx so chat.messages receives
   *  includeDiagnostics:true and MessageThread renders runtime-noise inline. */
  diagnostics?: boolean;
  /** Plan 04.1-08 — true when the active topic is archived. Disables sending
   *  and applies `.composer--disabled` styling. */
  disabled?: boolean;
  /** Plan 04.1-08 — optimistic InlineTaskCard shown in the thread until the
   *  marker comment lands on the next poll. Now driven by the parent (the
   *  + Create task / Promote dialog opens at the index.tsx level). */
  pendingTaskCard?: { issueId: string; title: string } | null;
  /** Plan 04.1-08 — threaded from index.tsx through to the per-bubble
   *  PromoteActions; clicking "→ Promote to task" opens the dual-mode
   *  dialog in PROMOTE mode at the index.tsx level. */
  onPromoteMessage?: ((src: PromoteSourceMessagePayload) => void) | null;
  /** Plan 04.1-08 — passed through to MessageThread so the sticky read-only
   *  banner renders at the top of `.messages` when the topic is archived. */
  archivedBanner?: {
    topicTitle: string;
    messageCount: number;
    tasksSpawned: number;
    lastActiveAt: string | null;
    onUnarchive: () => void;
  } | null;
}): React.ReactElement {
  const send = usePluginAction('chat.send');
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // The optimistic overlay — messages sent this session, keyed by uuid.
  const [optimistic, setOptimistic] = React.useState<OptimisticMessage[]>([]);

  // doSend is shared by the initial send and Retry. Retry passes the SAME
  // uuid + body so chat.send's message_uuid dedup makes it idempotent.
  const doSend = React.useCallback(
    async (messageUuid: string, body: string) => {
      setBusy(true);
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
          messageUuid,
          companyId,
          userId,
        });
        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error(String((result as { error: unknown }).error));
        }
        setOptimistic((prev) =>
          prev.map((o) =>
            o.messageUuid === messageUuid ? { ...o, status: 'sent' } : o,
          ),
        );
      } catch {
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
    // Plan 04.1-08 — disabled state hard-blocks send.
    if (disabled) return;
    const body = draft.trim();
    if (!body || busy) return;
    const messageUuid = newMessageUuid();
    setDraft('');
    void doSend(messageUuid, body);
  }, [draft, busy, doSend, disabled]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return; // Shift+Enter → newline.
      e.preventDefault();
      handleSend();
    },
    [handleSend, disabled],
  );

  const placeholder = disabled
    ? 'Unarchive to send messages.'
    : `Message ${employeeName}…`;

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
        onPromoteMessage={onPromoteMessage}
        archivedBanner={archivedBanner}
      />
      <div
        className={`composer${disabled ? ' composer--disabled' : ''}`}
        data-clarity-region="composer"
        data-clarity-disabled={disabled ? 'true' : 'false'}
      >
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
            readOnly={disabled}
            disabled={disabled}
            // GAP 1 — Composer is keyed `composer-${topic.issueId}` in
            // index.tsx, so it remounts on every topic open — autoFocus drops
            // the cursor in the textarea.
            autoFocus={!disabled}
          />
          <div className="composer-foot">
            <div className="composer-tools">
              <button
                type="button"
                className="tool-btn"
                disabled={!ATTACHMENTS_AVAILABLE || disabled}
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
                disabled={busy || disabled || draft.trim().length === 0}
              >
                SEND
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
