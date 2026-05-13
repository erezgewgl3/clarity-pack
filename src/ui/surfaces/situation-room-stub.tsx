// src/ui/surfaces/situation-room-stub.tsx
//
// Plan 02-02 Task 3 — Situation Room placeholder. Plan 02-04 fills this with
// the 60s materialized snapshot job, agent grid, critical-path strip,
// artifacts shelf per sketches/paperclip-fix-situation-room.html.

import * as React from 'react';

import { ClaritySurfaceRoot } from '../primitives/clarity-surface-root.tsx';

export function SituationRoom(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="situation-room">
      <div style={{ padding: '1rem', opacity: 0.7 }}>
        <p>Situation Room — Plan 02-04 will fill this with the agent grid, critical-path strip, and artifacts shelf.</p>
      </div>
    </ClaritySurfaceRoot>
  );
}
