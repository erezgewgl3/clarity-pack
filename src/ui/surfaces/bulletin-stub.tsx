// src/ui/surfaces/bulletin-stub.tsx
//
// Plan 02-02 Task 3 — Daily Bulletin placeholder. Phase 3 fills this with the
// 06:30 ET cron-compiled digest of yesterday's operations + today's
// awaiting-you items.

import * as React from 'react';

import { ClaritySurfaceRoot } from '../primitives/clarity-surface-root.tsx';

export function BulletinPage(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="bulletin">
      <div style={{ padding: '1rem', opacity: 0.7 }}>
        <p>Daily Bulletin — Phase 3 will fill this with the 06:30 ET morning digest.</p>
      </div>
    </ClaritySurfaceRoot>
  );
}
