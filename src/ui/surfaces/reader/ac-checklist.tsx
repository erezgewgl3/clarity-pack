// src/ui/surfaces/reader/ac-checklist.tsx
//
// Plan 02-03 Task 2 — READER-07 manual acceptance-criteria checklist. Each
// row = checkbox + label; toggling calls usePluginAction('ac-toggle'). Auto-
// status (driven by AC text) is Phase 5 DIST-03 work.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

export type AcItem = {
  id: number;
  issue_id: string;
  label: string;
  checked: boolean;
  display_order: number;
};

export function AcChecklist({
  issueId,
  items,
  userId,
}: {
  issueId: string;
  items: AcItem[];
  userId?: string | null;
}): React.ReactElement {
  const toggleAc = usePluginAction('ac-toggle');
  return (
    <section className="clarity-ac-checklist" data-clarity-region="ac-checklist">
      <h3>Acceptance criteria</h3>
      {items.length === 0 ? (
        <p className="clarity-ac-empty">No acceptance criteria recorded yet.</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.id} className="clarity-ac-item">
              <label>
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={(e) => {
                    void toggleAc({ id: it.id, checked: e.target.checked, userId: userId ?? null });
                  }}
                  aria-label={`Toggle: ${it.label}`}
                  data-issue-id={issueId}
                />
                {it.label}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
