// src/ui/primitives/state-pill.tsx
//
// Plan 02-02 Task 2 — the 5-state pill from sketches/paperclip-fix-situation-room.html.
// Renders "<State> · <age>" where age is a human-readable duration (5m, 2h, 3d).
// Pure helpers (formatAge, humaniseState, STATE_TO_CLASS) live in
// `./state-pill-format.ts` so they're unit-testable without JSX loading.

import * as React from 'react';

import {
  formatAge,
  humaniseState,
  STATE_TO_CLASS,
  type StatePillState,
} from './state-pill-format.ts';

export type { StatePillState } from './state-pill-format.ts';
export { formatAge } from './state-pill-format.ts';

export function StatePill({
  state,
  age,
}: {
  state: StatePillState;
  age: number;
}): React.ReactElement {
  return (
    <span className={`clarity-state-pill ${STATE_TO_CLASS[state]}`}>
      {humaniseState(state)} · {formatAge(age)}
    </span>
  );
}
