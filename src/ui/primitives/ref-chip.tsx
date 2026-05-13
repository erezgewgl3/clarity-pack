// src/ui/primitives/ref-chip.tsx
//
// Plan 02-02 Task 2 — inline reference card. Renders an issue id with status
// badge inline (e.g. "BEAAA-141 · in_progress"). Calls the worker handler
// 'resolve-refs' via the plugin bridge; that handler enforces the PRIM-01
// single-round-trip contract — for batches of refs in the same render, the
// caller is expected to gather ids into one usePluginData call (Plan 02-03
// Reader view does this).

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RefCardData } from '../../shared/types.ts';

export function RefChip({ refId }: { refId: string }): React.ReactElement {
  const { data, loading } = usePluginData<RefCardData[]>('resolve-refs', {
    ids: [refId],
  });
  const card = data?.[0];
  if (loading || !card) {
    return (
      <span className="clarity-ref-chip clarity-ref-chip--loading">{refId}</span>
    );
  }
  return (
    <span className="clarity-ref-chip" data-status={card.status}>
      {card.id} · {card.status}
    </span>
  );
}
