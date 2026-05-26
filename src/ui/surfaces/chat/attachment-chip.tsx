// src/ui/surfaces/chat/attachment-chip.tsx
//
// Plan 05-11 Task 5 (CHAT-07 gap closure) -- shared AttachmentChip
// primitive. Three consumers in v1.0.0:
//
//   1. Composer (staged + uploading + failed states; onRemove + onRetry)
//   2. MessageThread per-bubble (ready + failed states; onClick + onRetry)
//   3. ContextRail right-rail Recent Attachments panel (ready state; onClick)
//
// Visual contract: short pill chip with a mime-glyph icon, truncated
// filename, and a humanized byte size. The chip renders as a `<button>`
// when onClick is provided (keyboard-focusable), otherwise as a `<span>`.
// All text renders as React text -- no dangerouslySetInnerHTML, no raw
// HTML (T-04-18 / R3 a11y invariant).
//
// State classes (drive CSS modifiers, NO new color tokens -- all colors
// via the existing --bg-*, --line, --ink-*, --danger variables):
//
//   staged    -- file held in browser memory only, no upload network call
//                yet (composer default between pick and Send)
//   uploading -- the per-file upload chain is in flight (subtle opacity)
//   ready     -- upload completed; chat_message_attachments row exists
//   failed    -- the upload chain rejected for this chip; Retry affordance
//                visible (composer post-send + thread-bubble post-send)

import * as React from 'react';

export type AttachmentChipState =
  | 'staged'
  | 'uploading'
  | 'ready'
  | 'failed';

export type AttachmentChipProps = {
  filename: string;
  mimeType: string;
  byteSize: number;
  state: AttachmentChipState;
  /** When provided, renders an inline x Remove button (composer use-case). */
  onRemove?: () => void;
  /** When provided, the chip is a button (keyboard-focusable). */
  onClick?: () => void;
  /** When provided AND state==='failed', renders an inline Retry button. */
  onRetry?: () => void;
};

const FILENAME_TRUNCATE = 24;

/** Humanize a byte count as "1.2 KB" / "4.7 MB" etc. */
export function humanizeBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

/** Truncate filename to FILENAME_TRUNCATE chars with a trailing ellipsis. */
function truncateFilename(name: string): string {
  if (name.length <= FILENAME_TRUNCATE) return name;
  return `${name.slice(0, FILENAME_TRUNCATE - 1)}…`;
}

/**
 * Map mime type to a single (label, fill) tuple. Bundle-cheap version:
 * one tiny SVG element with two children, regardless of the format.
 */
function mimeMeta(mimeType: string): { label: string; fill: string } {
  const m = (mimeType || '').toLowerCase();
  if (m === 'application/pdf') return { label: 'PDF', fill: '#c34d3a' };
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return { label: 'XLS', fill: '#3a7d44' };
  if (m === 'text/markdown' || m === 'text/plain')
    return { label: 'MD', fill: '#5a5a5a' };
  if (m === 'image/png' || m.startsWith('image/'))
    return { label: 'IMG', fill: '#3a5d9d' };
  return { label: '', fill: '#7e7869' };
}

/**
 * Return a pure-SVG inline mime glyph for the given mime type. NO external
 * font / icon dep; the glyph is a single SVG with a colored rect + an
 * optional label centered on it. Bundle-conscious version (single component
 * + a meta lookup) -- mirrors the 4-format coverage of the chat.attachment.
 * upload allowlist.
 */
export function mimeIconFor(mimeType: string): React.ReactElement {
  const { label, fill } = mimeMeta(mimeType);
  return (
    <svg
      className="attachment-chip-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="1" width="10" height="12" rx="1" fill={fill} />
      {label ? (
        <text
          x="7"
          y="9"
          textAnchor="middle"
          fontSize="4.5"
          fontFamily="monospace"
          fill="#fff"
          fontWeight="600"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}

/**
 * Render an attachment chip. The chip is a `<button>` when onClick is
 * provided so keyboard users can activate it; otherwise it is a `<span>`
 * (composer staged chips don't navigate). The Remove + Retry buttons are
 * nested controls; we stopPropagation on them so an outer onClick (thread
 * chip -> open previewer popover) doesn't fire when the operator clicks
 * Remove or Retry.
 */
export function AttachmentChip({
  filename,
  mimeType,
  byteSize,
  state,
  onRemove,
  onClick,
  onRetry,
}: AttachmentChipProps): React.ReactElement {
  const displayName = truncateFilename(filename);
  const sizeLabel = humanizeBytes(byteSize);
  const cls = `attachment-chip attachment-chip--${state}`;

  const inner = (
    <>
      {mimeIconFor(mimeType)}
      <span className="attachment-chip-name" title={filename}>
        {displayName}
      </span>
      <span className="attachment-chip-size">{sizeLabel}</span>
      {state === 'failed' && onRetry ? (
        <button
          type="button"
          className="attachment-chip-retry"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          aria-label="Retry upload"
        >
          Retry
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="attachment-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove attachment"
        >
          {'✕'}
        </button>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        data-clarity-attachment-state={state}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className={cls} data-clarity-attachment-state={state}>
      {inner}
    </span>
  );
}
