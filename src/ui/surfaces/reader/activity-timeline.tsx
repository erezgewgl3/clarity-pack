// src/ui/surfaces/reader/activity-timeline.tsx
//
// Plan 02-03 Task 2 — READER-09 distilled activity timeline. Renders the
// top-N (N <= 8) most-relevant events. Distillation happens server-side in
// the issue.reader handler — this component just renders what it receives.

import * as React from 'react';

export type ActivityEvent = {
  kind: 'state_change' | 'comment' | 'work_product_write' | string;
  actor: string;
  at: string;
  detail?: string;
};

function shortAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then) || then > now) return iso;
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

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
