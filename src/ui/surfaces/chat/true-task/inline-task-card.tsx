// src/ui/surfaces/chat/true-task/inline-task-card.tsx
//
// Plan 04.1-06 Task 1 — Pattern C (UI-SPEC §"Inline task card (D-03)").
//
// Renders inside `.messages` at the marker comment's place, ordered with
// the rest of the thread. NOT a `.bubble` — distinct visual idiom so a
// sighted operator never confuses a spun-off task with a sent message.
//
// Visual cite point: chat.css:872-901 `.decision-msg` (the closest
// existing centered-typeform idiom). The new `.inline-task-card` rule
// in chat.css's Phase 4.1 section extends that with task-specific
// affordances + the gold "TASK CREATED" eyebrow (UI-SPEC §Color accent
// reservation).
//
// SECURITY (T-04-18): every field renders as untrusted React text. NO
// dangerouslySetInnerHTML. The BEAAA-NNN identifier renders via the
// existing RefChip primitive — Plan 02 already established the safe
// resolve-refs round-trip.

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
          {identifier && issueId ? (
            // The RefChip primitive runs its own usePluginData('resolve-refs')
            // round-trip; we hand it the BEAAA-NNN identifier as a refId.
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
