// src/ui/surfaces/reader/deliverable-preview.tsx
//
// Plan 02-03 Task 2 — READER-05: "The deliverable" section placeholder.
// Renders the artifact filename + last-write timestamp + a sub-line stating
// that full xlsx/pdf/md/png in-place previewers are Phase 5 work (DIST-04).
//
// The literal "Phase 5" substring is part of the locked deferred-message
// contract — reader-view.test.mjs greps for it.

import * as React from 'react';

export type DeliverableProps = {
  deliverable: { filename: string; last_write_at: string } | null | undefined;
};

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then) || then > now) return '';
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'yesterday' : `${day}d ago`;
}

export function DeliverablePreview({ deliverable }: DeliverableProps): React.ReactElement | null {
  if (!deliverable) return null;
  return (
    <section className="clarity-deliverable" data-clarity-region="deliverable">
      <h3>The deliverable</h3>
      <p>
        {deliverable.filename} · last write {ago(deliverable.last_write_at)}
      </p>
      <div className="clarity-deliverable-placeholder">
        Inline preview — coming in Phase 5 (DIST-04). Open in classic Paperclip for now.
      </div>
    </section>
  );
}
