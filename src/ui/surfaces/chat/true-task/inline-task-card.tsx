// src/ui/surfaces/chat/true-task/inline-task-card.tsx
//
// Plan 04.1-06 Task 1 — Pattern C — D-07 marker comment intercepted and
// rendered as an inline provenance card in the messages scroller.
// Plan 04.1-08 TONED DOWN per the visual-fidelity drill: the card is no
// longer a hero element. New treatment (chat.css):
//   - 2px LEFT-RULE in --you (no full border, no gradient, no background fill)
//   - 13px weight-400 --ink-2 title (was 15px weight-500 --ink)
//   - ref-chip renders as a gold UNDERLINED LINK (not a chip box)
//   - status pill is outlined-only (no background fill)
// The wrapper class stays `.inline-task-card` so CSS owns the visual change.
// Reads as a quiet "X happened" event, not a message.
//
// SECURITY (T-04-18): every field renders as React text. NO
// dangerouslySetInnerHTML. The BEAAA-NNN ref renders via the RefChip
// primitive (Plan 02 resolve-refs round-trip is safe).

import * as React from 'react';

import { RefChip } from '../../../primitives/ref-chip.tsx';
import { ChatTaskStatusPill } from './chat-task-status-pill.tsx';

/** Render a HH:MM timestamp from an ISO string. */
function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function InlineTaskCard({
  identifier,
  issueId,
  title,
  employeeName,
  role,
  status,
  createdAt,
}: {
  /** BEAAA-NNN identifier when known; null while the optimistic card waits for chat.taskOwned to catch up. */
  identifier: string | null;
  /** Host issue id used by the RefChip to resolve the inline card. */
  issueId: string | null;
  title: string;
  employeeName: string;
  /** Optional employee role suffix; rendered as " · {role}" when present. */
  role?: string | null;
  /** Host issue status — `null` while loading (renders the "· — ·" pill). */
  status: string | null | undefined;
  createdAt: string | null;
}): React.ReactElement {
  const statusLabel = status ?? 'pending';
  return (
    <article
      className="msg"
      role="group"
      aria-label={`Task created — ${title}, assigned to ${employeeName}, status ${statusLabel}`}
    >
      <div className="inline-task-card">
        <div className="inline-task-card-eyebrow">↗ TASK CREATED</div>
        <div className="inline-task-card-title">{title}</div>
        <div className="inline-task-card-assignee">
          Assigned to {employeeName}
          {role ? ` · ${role}` : ''}
        </div>
        <div className="inline-task-card-meta">
          {/* Plan 04.1-08 — the ref-chip is a real underlined anchor (rendered
              by the RefChip primitive's resolve-refs round-trip). The card no
              longer renders a status badge with a background fill — the CSS
              now makes .st outlined-only. */}
          {identifier && issueId ? (
            <RefChip refId={identifier} />
          ) : (
            <span className="clarity-ref-chip clarity-ref-chip--loading">…</span>
          )}
          <ChatTaskStatusPill status={status} />
          <span className="ts">{clock(createdAt)}</span>
        </div>
      </div>
    </article>
  );
}
