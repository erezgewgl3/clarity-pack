// src/ui/surfaces/situation-room/sparkline.tsx
//
// Plan 02-04 Task 2 — pure SVG 7-day velocity sparkline. No charting library;
// no external dependencies beyond React. Renders a single polyline.

import * as React from 'react';

export function Sparkline({ values }: { values: number[] }): React.ReactElement | null {
  if (!values || values.length === 0) return null;
  const width = 70;
  const height = 20;
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - (v / max) * (height - 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="clarity-sparkline" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}
