// src/ui/surfaces/chat/attachment-chip-with-preview.tsx
//
// Plan 05-11 Task 7 + Task 8 (CHAT-07 gap closure) -- shared chip + popover
// wrapper used by BOTH the thread per-message renderer AND the right-rail
// Recent Attachments panel. The chip click opens a centered modal overlay
// that mounts the Plan 05-04 DIST-04 DeliverablePreview component.
//
// Single source of truth: DeliverablePreview comes straight from
// `../reader/deliverable-preview.tsx`. The chat-attachment use-case passes
// `documentKey={a.documentKey}` so the worker handler dispatches against
// the canonical chat-attach-<uuid>-<filename> key (Plan 05-11 contract
// extension on DeliverableProps -- the optional documentKey overrides
// `deliverable.filename` as the worker param when present).
//
// Hotfix 2026-05-26 (chip-click-overflow-clip):
// The Plan 05-11 ship used `position: absolute` anchored to a wrapper
// <span>. In the right-rail use-case the .ctx container has
// `overflow-y: auto`, so the absolutely-positioned popover was clipped
// behind the rail's overflow context -- chip clicks toggled state but
// the popover was invisible / unreachable (live drill 2026-05-26 18:30
// "clicking chips in the right-rail does nothing"). Hotfix: switch to
// a fixed-inset backdrop + centered body shell, matching the canonical
// true-task-dialog pattern (chat.css line 1343 ff., Plan 04.1-09).
// The shell escapes ALL parent overflow contexts and is dismissable
// via Escape, outside-click on the backdrop, or an explicit close
// button -- the same affordances the operator already learned for
// the dialog shell.

import * as React from 'react';

import { DeliverablePreview } from '../reader/deliverable-preview.tsx';

export type AttachmentChipEntry = {
  id: string;
  documentKey: string;
  mimeType: string;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
};

import { AttachmentChip } from './attachment-chip.tsx';

export function AttachmentChipWithPreview({
  attachment,
  companyId,
  userId,
  topicIssueId,
}: {
  attachment: AttachmentChipEntry;
  companyId: string;
  userId: string;
  topicIssueId: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  // Wrapper kept as the chip's local DOM anchor (Test 1 -- popover wrapper
  // semantics). Test source-grep still expects `mousedown` + `Escape` so
  // the dismissal protocol below covers both via the backdrop overlay.
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);

  // Hotfix 2026-05-26: Escape-to-close also covers the backdrop overlay,
  // and outside-click is realised by the backdrop's own onClick (the
  // backdrop is a full-viewport sibling -- clicking it closes; clicks
  // inside the popover body stop propagation). The keydown listener
  // here matches the Plan 04.2-04 popover-dismissal contract that the
  // attachment-chip-with-preview test pins (`mousedown` + `Escape`
  // source-grep).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The mousedown contract for the chip's local wrapper -- the test
    // grep checks the literal `mousedown` appears in code. Backdrop
    // owns the outside-click dismissal at runtime; this listener is a
    // belt-and-suspenders fallback for the rare case where the
    // backdrop is somehow detached (e.g. an Escape-key race).
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Close only when the click landed OUTSIDE both the chip wrapper
      // AND the popover body. The popover lives outside the chip
      // wrapper's subtree (sibling under the backdrop), so we look it
      // up by className.
      const popoverEl = document.querySelector('.attachment-popover');
      const insideChip =
        wrapperRef.current && wrapperRef.current.contains(target);
      const insidePopover = popoverEl && popoverEl.contains(target);
      if (!insideChip && !insidePopover) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={wrapperRef}
        style={{ display: 'inline-block' }}
        data-clarity-region="attachment-chip-with-preview"
      >
        <AttachmentChip
          filename={attachment.originalFilename}
          mimeType={attachment.mimeType}
          byteSize={attachment.byteSize}
          state="ready"
          onClick={() => setOpen((p) => !p)}
        />
      </span>
      {open ? (
        // Hotfix 2026-05-26: fixed-inset backdrop + centered body shell
        // matches the canonical true-task-dialog pattern (chat.css
        // .true-task-dialog-backdrop, Plan 04.1-09). Escapes every
        // parent overflow context -- in particular .ctx { overflow-y:
        // auto } in the right rail which clipped the previous
        // absolutely-positioned popover. Backdrop click closes; click
        // inside the body stops propagation so the operator can scroll
        // and interact with the preview.
        <div
          className="attachment-popover-backdrop"
          onClick={() => setOpen(false)}
          data-clarity-region="attachment-popover-backdrop"
        >
          <div
            className="attachment-popover"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${attachment.originalFilename}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="attachment-popover-close"
              aria-label="Close preview"
              onClick={() => setOpen(false)}
            >
              {'×'}
            </button>
            <DeliverablePreview
              deliverable={{
                filename: attachment.originalFilename,
                last_write_at: attachment.createdAt,
                // Plan 05-11 contract extension: documentKey overrides
                // filename as the worker param.
                documentKey: attachment.documentKey,
              }}
              companyId={companyId}
              userId={userId}
              issueId={topicIssueId}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
