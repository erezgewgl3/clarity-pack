// src/ui/surfaces/reader-view-stub.tsx
//
// Plan 02-02 Task 3 — placeholder Reader view. Real Reader view (TL;DR,
// inline ref resolution, ancestry breadcrumb, AC checklist, deliverable
// preview) lands in Plan 02-03. This stub satisfies the manifest's
// `exportName: 'ReaderView'` so the host can mount the slot at install time;
// Eric sees a placeholder text + a layout-shaped div until 02-03 fills it in.

import * as React from 'react';

import { ClaritySurfaceRoot } from '../primitives/clarity-surface-root.tsx';

export function ReaderView(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="reader">
      <div style={{ padding: '1rem', opacity: 0.7 }}>
        <p>Reader view — Plan 02-03 will fill this with the TL;DR, ref chips, ancestry breadcrumb, and AC checklist per sketches/paperclip-fix-task-detail.html.</p>
      </div>
    </ClaritySurfaceRoot>
  );
}
