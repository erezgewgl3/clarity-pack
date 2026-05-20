// src/ui/surfaces/chat/archived-topics-pill.tsx
//
// Plan 04.1-06 Task 1 — Pattern E tail (UI-SPEC §"Archive topic affordance"
// — the strip-end pill).
// Plan 04.1-08 REWIRED — the pill is now a plain button that OPENS the
// `<ArchivePanel>` dropdown (the Plan 04.1-06 inline-reveal pattern is
// replaced; the strip never expands archived rows in-place anymore).
//
// Renders a muted button at the right end of the topic strip when
// archivedCount > 0. Returns null when archivedCount === 0 — the strip stays
// clean for new employees with no archives.

import * as React from 'react';

export function ArchivedTopicsPill({
  archivedCount,
  /** Plan 04.1-08 — true when the panel is open. Drives the active styling. */
  expanded,
  /** Plan 04.1-08 — clicking the pill opens the archive panel (it does NOT
   *  inline-reveal archived rows in the strip anymore). */
  onToggle,
}: {
  archivedCount: number;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement | null {
  if (archivedCount === 0) return null;
  return (
    <button
      type="button"
      className={`topic archived-topics-pill${expanded ? ' active' : ''}`}
      onClick={onToggle}
      aria-pressed={expanded}
      aria-label={`Show ${archivedCount} archived topic${archivedCount > 1 ? 's' : ''}`}
      data-clarity-action="open-archive-panel"
    >
      +{archivedCount} archived
    </button>
  );
}
