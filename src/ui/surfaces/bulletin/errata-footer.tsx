// src/ui/surfaces/bulletin/errata-footer.tsx
//
// Plan 03-04 - BULL-07 footer rendering. Errata are amendments, not edits:
// render them below the issue body and leave the canonical Paperclip issue
// description untouched.

import * as React from 'react';

import type { ErratumEntry } from '../../../shared/types.ts';

export type ErrataFooterProps = {
  errata: ErratumEntry[];
};

function formatAddedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ErrataFooter({ errata }: ErrataFooterProps): React.ReactElement | null {
  if (!errata || errata.length === 0) return null;

  return (
    <footer className="clarity-bulletin-errata-footer" data-clarity-region="errata-footer">
      <h2 className="clarity-bulletin-errata-h2">Errata</h2>
      <ol className="clarity-bulletin-errata-list">
        {errata.map((entry) => (
          <li className="clarity-bulletin-errata-item" key={entry.id}>
            <div className="clarity-bulletin-errata-meta">
              {formatAddedAt(entry.addedAt)} · {entry.addedByUserId}
            </div>
            <div className="clarity-bulletin-errata-body">{entry.bodyMd}</div>
          </li>
        ))}
      </ol>
    </footer>
  );
}
