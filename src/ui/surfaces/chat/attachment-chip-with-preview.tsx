// src/ui/surfaces/chat/attachment-chip-with-preview.tsx
//
// Plan 05-11 Task 7 + Task 8 (CHAT-07 gap closure) -- shared chip + popover
// wrapper used by BOTH the thread per-message renderer AND the right-rail
// Recent Attachments panel. The chip click opens a popover anchored to the
// chip that mounts the Plan 05-04 DIST-04 DeliverablePreview component.
//
// Single source of truth: DeliverablePreview comes straight from
// `../reader/deliverable-preview.tsx`. The chat-attachment use-case passes
// `documentKey={a.documentKey}` so the worker handler dispatches against
// the canonical chat-attach-<uuid>-<filename> key (Plan 05-11 contract
// extension on DeliverableProps -- the optional documentKey overrides
// `deliverable.filename` as the worker param when present).

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
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);

  // Plan 04.2-04 popover pattern: click outside closes; Escape closes.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-block' }}
      data-clarity-region="attachment-chip-with-preview"
    >
      <AttachmentChip
        filename={attachment.originalFilename}
        mimeType={attachment.mimeType}
        byteSize={attachment.byteSize}
        state="ready"
        onClick={() => setOpen((p) => !p)}
      />
      {open ? (
        <div
          className="attachment-popover"
          role="dialog"
          aria-label={`Preview of ${attachment.originalFilename}`}
        >
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
      ) : null}
    </span>
  );
}
