// src/ui/surfaces/chat/archived-banner.tsx
//
// Plan 04.1-08 — NEW component. Sticky read-only banner rendered at the top
// of `.messages` when the active topic is archived (open via the archive
// panel's row click). The banner uses the --warn color family (NOT --alert,
// which is reserved for host-stuck). Sketch contract:
// paperclip-fix-chat-true-task.html ll. 642-660.
//
// Wires:
//   - On Unarchive click → dispatches chat.topic.archive({ archived: false })
//     via the onUnarchive callback (the parent owns the bridge call so the
//     same handler can be re-used from the panel hover button).
//   - The composer in the same parent is rendered in DISABLED state when the
//     topic is archived (composer.tsx `disabled` prop drives the .composer--
//     disabled class + read-only textarea).
//
// SECURITY (T-04-18): every rendered field is React text; no
// dangerouslySetInnerHTML. No raw fetch.

import * as React from 'react';

/** Best-effort "{n}d ago" relative-time formatting. Mirrors archive-panel.tsx. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const dms = Date.now() - t;
  if (dms < 0) return 'just now';
  const m = Math.floor(dms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function ArchivedBanner({
  topicTitle,
  messageCount,
  tasksSpawned,
  lastActiveAt,
  onUnarchive,
  busy = false,
}: {
  topicTitle: string;
  messageCount: number;
  /** Number of true-tasks spawned from this topic (from chat.taskOwned). */
  tasksSpawned: number;
  lastActiveAt: string | null;
  onUnarchive: () => void;
  busy?: boolean;
}): React.ReactElement {
  const relTime = relativeTime(lastActiveAt);
  return (
    <div
      className="chat-archived-banner"
      role="note"
      data-clarity-region="archived-banner"
      aria-label={`Archived topic ${topicTitle}, read-only`}
    >
      <div className="chat-archived-banner__ico" aria-hidden="true">
        📁
      </div>
      <div className="chat-archived-banner__text">
        <div className="chat-archived-banner__ttl">ARCHIVED — read-only</div>
        <div className="chat-archived-banner__body">
          {relTime ? (
            <>
              Last active <b>{relTime}</b> ·{' '}
            </>
          ) : null}
          {messageCount} message{messageCount === 1 ? '' : 's'} · {tasksSpawned} task
          {tasksSpawned === 1 ? '' : 's'} spawned. You can browse the conversation
          but can&apos;t send new messages until you unarchive.
        </div>
      </div>
      <button
        type="button"
        className="chat-archived-banner__unarchive"
        onClick={onUnarchive}
        disabled={busy}
        aria-label={`Unarchive ${topicTitle}`}
        data-clarity-action="unarchive"
      >
        {busy ? 'Unarchiving…' : 'Unarchive'}
      </button>
    </div>
  );
}
