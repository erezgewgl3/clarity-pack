// src/ui/surfaces/situation-room/index.tsx
//
// Plan 02-04 Task 1 placeholder — minimal stub created during Task 1 so the
// UI barrel compiles. Task 2 replaces this with the full Situation Room
// implementation (agent grid, critical-path strip, artifacts shelf, poll
// with leader, etc. per sketches/paperclip-fix-situation-room.html).

import * as React from 'react';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';

export function SituationRoom(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="situation-room">
      <p>Situation Room — Plan 02-04 Task 2 fills this with the live agent grid.</p>
    </ClaritySurfaceRoot>
  );
}
