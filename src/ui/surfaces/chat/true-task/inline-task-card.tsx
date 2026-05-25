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
// Plan 04.1-09 — WRAPPER FIXED. The Plan 04.1-08 build wrapped the card in
// the `.msg` chat-bubble grid (`grid-template-columns: 34px 1fr`) — the
// card has no avatar so it collapsed into the 34px avatar column and the
// UUID title wrapped char-by-char. The wrapper is now the new
// `inline-task-card-row` block element that lets the card breathe full
// width. The `title` prop also accepts `null` to render a skeleton
// placeholder when chat.taskOwned hasn't caught up (race window of up to
// 15s after a marker comment lands but before the side-table back-link
// surfaces).
//
// SECURITY (T-04-18): every field renders as React text. NO
// dangerouslySetInnerHTML. The BEAAA-NNN ref renders via the RefChip
// primitive (Plan 02 resolve-refs round-trip is safe).

import * as React from 'react';
import { useHostLocation } from '@paperclipai/plugin-sdk/ui/hooks';

import { RefChip } from '../../../primitives/ref-chip.tsx';
import { useHostNavigation } from '../../../primitives/use-host-navigation.ts';
import { extractCompanyPrefixFromPathname } from '../../../primitives/use-resolved-company-id.ts';
import { ChatTaskStatusPill } from './chat-task-status-pill.tsx';

/** Render a HH:MM timestamp from an ISO string. */
function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Plan 05-06 item (g) — optimistic Todo render. The Plan 04.1-09 build mapped
 * null/undefined status through `ChatTaskStatusPill`'s null branch which renders
 * the muted `· — ·` loader. This card now coerces null/undefined to 'todo'
 * before passing to the pill, so the operator sees `Todo` immediately while
 * waiting for chat.taskOwned to reconcile. Once the real status arrives via
 * the `matchedTask?.status` lookup at message-thread.tsx line 504, the
 * coercion becomes a no-op (the real value passes through unchanged).
 *
 * The coercion is SCOPED to InlineTaskCard — `ChatTaskStatusPill`'s null
 * branch is intentionally unchanged so any other call site that genuinely
 * wants the `· — ·` loader still gets it.
 */
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
  /** Plan 04.1-09 — `null` while chat.taskOwned hasn't surfaced the row yet
   *  (race window of up to 15s after the marker comment lands). The card
   *  renders a `.clarity-loading-skeleton` placeholder for the title slot
   *  until the next poll resolves it. */
  title: string | null;
  employeeName: string;
  /** Optional employee role suffix; rendered as " · {role}" when present. */
  role?: string | null;
  /** Host issue status — Plan 05-06 item (g): null/undefined now renders as
   *  an optimistic "Todo" pill rather than the muted `· — ·` loader. Real
   *  status arrives via chat.taskOwned on the next 15s poll. */
  status: string | null | undefined;
  createdAt: string | null;
}): React.ReactElement {
  // Plan 05-06 item (g) — optimistic Todo coercion. Default for the a11y
  // label is now 'todo' (was 'pending'); the a11y text matches the visible
  // pill render so screen-reader announcements track sighted experience.
  const statusLabel = status ?? 'todo';
  // Plan 05-06 item (g) — coerce null/undefined to 'todo' before the pill.
  // Scoped to this card so other (potential future) call sites of
  // ChatTaskStatusPill can still render the loader form.
  const statusForPill = status ?? 'todo';
  // Plan 04.1-09 — the a11y label degrades gracefully when the title hasn't
  // resolved yet (the operator hears "Task created" without the UUID-as-title
  // gibberish the Plan 04.1-08 build leaked).
  const ariaLabel = title
    ? `Task created — ${title}, assigned to ${employeeName}, status ${statusLabel}`
    : `Task created — loading title, assigned to ${employeeName}, status ${statusLabel}`;

  // Plan 04.2-05 D3 — the title is wrapped in a host-routed anchor to the
  // canonical issue Reader at `/<companyPrefix>/issues/<identifier>` so the
  // inline TASK CREATED card is clickable (the 2026-05-24 drill captured the
  // operator typing issue URLs by hand because the card was not clickable).
  // Falls back to plain text when companyPrefix is unavailable or the
  // identifier hasn't resolved yet — no broken anchor target. The RefChip
  // primitive on the meta row already became a clickable anchor under D3 too,
  // so the operator has two click targets on a fully-resolved card.
  const nav = useHostNavigation();
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';
  const hasTitleLink = companyPrefix && identifier && title !== null;

  return (
    <article
      className="inline-task-card-row"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="inline-task-card">
        <div className="inline-task-card-eyebrow">↗ TASK CREATED</div>
        <div className="inline-task-card-title">
          {title === null ? (
            <span className="clarity-loading-skeleton">…</span>
          ) : hasTitleLink ? (
            <a
              {...nav.linkProps(`/${companyPrefix}/issues/${identifier}`)}
              className="inline-task-card-title-link"
              data-clarity-action="open-inline-task"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </div>
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
          <ChatTaskStatusPill status={statusForPill} />
          <span className="ts">{clock(createdAt)}</span>
        </div>
      </div>
    </article>
  );
}
