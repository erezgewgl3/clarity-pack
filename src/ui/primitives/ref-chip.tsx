// src/ui/primitives/ref-chip.tsx
//
// Plan 02-02 Task 2 — inline reference card. Renders an issue id with status
// badge inline (e.g. "BEAAA-141 · in_progress"). Calls the worker handler
// 'resolve-refs' via the plugin bridge; that handler enforces the PRIM-01
// single-round-trip contract — for batches of refs in the same render, the
// caller is expected to gather ids into one usePluginData call (Plan 02-03
// Reader view does this).
//
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL: viewer identity must come from
// useResolvedUserId() (the Better-Auth-backed resolver) so detail-tab slots
// where useHostContext().userId is null still identify the caller correctly.
// Prior to this change we destructured `userId` from useHostContext() and
// passed `userId ?? ''` — which fail-closed every wrapped handler in
// detail-tab slots during the host's session-loading window.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RefCardData } from '../../shared/types.ts';
import { useResolvedUserId } from './use-resolved-user-id.ts';

export function RefChip({ refId }: { refId: string }): React.ReactElement {
  // Plan 02-09 Task 2 — resolver sources the viewer id even when host bridge
  // is still null in detail-tab slots. While the resolver is in flight we
  // pass an empty params object — opt-in-guard's extractUserId returns null,
  // the guard returns OPT_IN_REQUIRED, and the chip stays in its loading
  // pill state until the resolver lands. This is the structurally-correct
  // bootstrap: no fake identity, no race, no crash.
  const { userId, loading: userIdLoading } = useResolvedUserId();
  const ready = !userIdLoading && !!userId;
  const { data, loading } = usePluginData<RefCardData[] | { error: string }>(
    'resolve-refs',
    ready ? { ids: [refId], userId } : {},
  );
  const card = Array.isArray(data) ? data[0] : undefined;
  if (loading || userIdLoading || !card) {
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
