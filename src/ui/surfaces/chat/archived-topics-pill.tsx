// src/ui/surfaces/chat/archived-topics-pill.tsx
//
// Plan 04.1-06 Task 1 — Pattern E tail (UI-SPEC §"Archive topic affordance"
// — the strip-end pill).
//
// Renders a muted `.topic` button at the right end of the topic strip when
// archivedCount > 0. Clicking expands archived topics into the strip; the
// parent renders them at opacity 0.6 with an inline Unarchive hover-action.
// Returns null when archivedCount === 0 — the strip stays clean for new
// employees with no archives.

import * as React from 'react';

export function ArchivedTopicsPill({
  archivedCount,
  expanded,
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
    >
      +{archivedCount} archived
    </button>
  );
}
