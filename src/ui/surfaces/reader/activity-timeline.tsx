// src/ui/surfaces/reader/activity-timeline.tsx
//
// Plan 02-03 Task 2 — READER-09 distilled activity timeline. Renders the
// top-N (N <= 8) most-relevant events. Distillation happens server-side in
// the issue.reader handler — this component just renders what it receives.

import * as React from 'react';

// Plan 05-03 (DIST-03) — shortAgo moved to ../../util/humanize.ts so the AC
// auto-status indicator can reuse the same format. activity-timeline still
// renders it; the implementation just lives elsewhere now.
import { shortAgo } from '../../util/humanize.ts';

export type ActivityEvent = {
  kind: 'state_change' | 'comment' | 'work_product_write' | string;
  actor: string;
  at: string;
  detail?: string;
};

export function ActivityTimeline({ events }: { events: ActivityEvent[] | undefined }): React.ReactElement {
  // DEV-15 (drill 2026-05-14): defensive null-safety. Same pattern as
  // AnchoredToCards / AcChecklist — handler may return events as undefined
  // when degraded; crashing on .length blows the whole Reader tab.
  const safe = events ?? [];
  return (
    <section className="clarity-activity-timeline" data-clarity-region="activity">
      <h3>Recent activity</h3>
      {safe.length === 0 ? (
        <p className="clarity-activity-empty">No relevant activity yet.</p>
      ) : (
        <ul>
          {safe.map((e, i) => (
            <li key={`${e.at}-${i}`} className="clarity-activity-item" data-kind={e.kind}>
              <span className="clarity-activity-kind">{e.kind}</span>
              <span className="clarity-activity-actor">{e.actor}</span>
              <span className="clarity-activity-when">{shortAgo(e.at)} ago</span>
              {e.detail ? <span className="clarity-activity-detail">{e.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
