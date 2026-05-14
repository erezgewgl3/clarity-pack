// src/ui/surfaces/situation-room/artifacts-shipped-shelf.tsx
//
// Plan 02-04 Task 2 — ROOM-04 "Artifacts shipped today" shelf at the bottom
// of the Situation Room. Each item is a 1-line inline preview snippet —
// no rabbit-holing to detail pages for first-look. Full preview Phase 5
// DIST-04 (same "Phase 5" marker as DeliverablePreview in the Reader).

import * as React from 'react';

export type ArtifactSummary = {
  id: string;
  title: string;
  authorName?: string | null;
  preview?: string | null;
};

export function ArtifactsShippedShelf({
  items,
}: {
  items: unknown[];
}): React.ReactElement | null {
  if (!items || items.length === 0) return null;
  return (
    <section className="clarity-artifacts-shelf" data-clarity-region="artifacts-shelf">
      <h2 className="clarity-artifacts-heading">Artifacts shipped today</h2>
      <ul className="clarity-artifacts-list">
        {items.map((raw, i) => {
          const item = raw as ArtifactSummary;
          return (
            <li key={item.id ?? i} className="clarity-artifact-item">
              <span className="clarity-artifact-title">{item.title ?? 'Untitled'}</span>
              {item.authorName ? (
                <span className="clarity-artifact-author">{item.authorName}</span>
              ) : null}
              <span className="clarity-artifact-preview">
                {item.preview ?? 'Full preview Phase 5 DIST-04.'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
