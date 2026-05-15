// src/ui/surfaces/bulletin/standing-numbers-panel.tsx
//
// Plan 03-03 — BULL-05 carryover. Right-rail "Standing Numbers" panel. Tiny
// pure render (mirrors situation-room/critical-path-strip.tsx).
//
// Every value originates from Plan 03-02's STANDING_NUMBER_SLOTS registry —
// no number is typed here. Per-row formatting is format-aware
// (currency / pct / count / ratio).
//
// Visual contract: sketches/paperclip-fix-bulletin.html ll. 410-417.

import * as React from 'react';
import type { StandingNumberRow } from '../../../shared/types.ts';

export type StandingNumbersPanelProps = {
  rows: StandingNumberRow[];
};

export function StandingNumbersPanel(props: StandingNumbersPanelProps): React.ReactElement | null {
  const rows = props.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="clarity-bulletin-panel" data-clarity-region="standing-numbers">
      <h2 className="clarity-bulletin-panel-h2">Standing Numbers</h2>
      {rows.map((row) => (
        <div className="clarity-bulletin-stat" key={row.key}>
          <span className="clarity-bulletin-stat-k">{row.displayName}</span>
          <span className="clarity-bulletin-stat-v">{formatValue(row)}</span>
        </div>
      ))}
    </div>
  );
}

/** Format-aware rendering of a numeric slot value. */
export function formatValue(row: StandingNumberRow): string {
  const v = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : 0;
  switch (row.format) {
    case 'currency':
      return `$${Math.round(v).toLocaleString('en-US')}`;
    case 'pct':
      return `${(v * 100).toFixed(1)}%`;
    case 'ratio':
      // ratios are stored 0..1; render as a percentage-style figure.
      return `${(v * 100).toFixed(1)}%`;
    case 'count':
    default:
      return String(Math.round(v));
  }
}
