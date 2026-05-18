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
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  topicTitle: string;
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
          message_uuid: messageUuid,
          companyId,
          userId,
        });
        // A worker { error } result is a failed send too (D-10).
        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error(String((result as { error: unknown }).error));
        }
        // Success — leave the optimistic bubble in place; MessageThread drops
        // it once the re-fetched server thread contains the comment.
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
    const messageUuid = newMessageUuid();
    setDraft('');
    void doSend(messageUuid, body);
  }, [draft, busy, doSend]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘+Enter (or Ctrl+Enter) sends.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <>
      <MessageThread
        companyId={companyId}
        userId={userId}
        topicIssueId={topicIssueId}
        optimistic={optimistic}
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
            placeholder="Message this employee… ⌘+Enter to send"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message composer"
          />
          <div className="composer-foot">
            <div className="composer-tools">
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
                <kbd>⌘</kbd>+<kbd>↵</kbd> to send
              </span>
              <button
                type="button"
                className="btn"
                onClick={handleSend}
                disabled={busy || draft.trim().length === 0}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
