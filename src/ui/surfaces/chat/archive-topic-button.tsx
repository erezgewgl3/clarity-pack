// src/ui/surfaces/chat/archive-topic-button.tsx
//
// Plan 04.1-06 Task 1 — Pattern E (UI-SPEC §"Archive topic affordance").
//
// Two-step in-row archive control inserted as the FIRST `.qa` row in the
// context-rail's Quick actions block. Step 1 = click "⌗ Archive this
// topic"; the row mutates in place to "Archive {topic}? · YES · KEEP TOPIC".
// Step 2 = click YES → usePluginAction('chat.topic.archive') with
// archived:true → 2s "✓ Topic archived" feedback → onArchived() callback
// removes the topic from the strip.
//
// Critical invariant (Wave 1 lock + Plan 04.1-05 chat-topic-archive.ts):
// the handler does NOT touch the host issue's status. archived is a
// plugin-namespace flag only; classic Paperclip sees the topic
// continuing as in_progress.
//
// State-machine pattern reused from message-thread.tsx:421-529
// `PromoteActions` — the same busy + feedback + resultError shape.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

export function ArchiveTopicButton({
  companyId,
  userId,
  topicIssueId,
  topicTitle,
  onArchived,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  topicTitle: string;
  /** Called after the 2s "✓ Topic archived" feedback so the parent can
   *  refresh the topic strip — the archived topic disappears from the
   *  open-topics view (it stays addressable via the +N archived pill). */
  onArchived: () => void;
}): React.ReactElement {
  const archive = usePluginAction('chat.topic.archive');
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<
    { kind: 'ok' | 'error'; text: string } | null
  >(null);

  function resultError(result: unknown): string | null {
    if (result && typeof result === 'object' && 'error' in result) {
      return String((result as { error: unknown }).error);
    }
    return null;
  }

  const onConfirm = React.useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await archive({
        companyId,
        userId,
        topicIssueId,
        archived: true,
      });
      const err = resultError(result);
      if (err) {
        setFeedback({ kind: 'error', text: `Could not archive (${err})` });
      } else {
        setFeedback({ kind: 'ok', text: '✓ Topic archived' });
        // UI-SPEC: drop the topic from the strip after a 2s confirmation.
        setTimeout(() => {
          setConfirming(false);
          setFeedback(null);
          onArchived();
        }, 2000);
      }
    } catch {
      setFeedback({ kind: 'error', text: 'Could not archive (ARCHIVE_FAILED)' });
    } finally {
      setBusy(false);
    }
  }, [archive, companyId, userId, topicIssueId, onArchived]);

  if (!confirming) {
    return (
      <button
        type="button"
        className="qa archive-topic-button"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        ⌗ Archive this topic
      </button>
    );
  }

  // ARMED — the two-step confirmation pill rendered in place of the .qa row.
  return (
    <div className="archive-topic-confirm" role="group" aria-label="Archive confirmation">
      <span className="archive-topic-confirm-prompt">
        Archive <b>{topicTitle}</b>?
      </span>
      <div className="archive-topic-confirm-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void onConfirm()}
          disabled={busy}
        >
          {busy ? 'Archiving…' : 'YES'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setConfirming(false);
            setFeedback(null);
          }}
          disabled={busy}
        >
          KEEP TOPIC
        </button>
      </div>
      {feedback ? (
        <span
          className={`pa-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </span>
      ) : null}
    </div>
  );
}
