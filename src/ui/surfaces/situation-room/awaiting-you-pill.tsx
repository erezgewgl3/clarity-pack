// src/ui/surfaces/situation-room/awaiting-you-pill.tsx
//
// Plan 02-04 Task 2 — ROOM-08 "Awaiting You" inbox pill. Shows count + age of
// oldest item + deep-link to the relevant task. Uses useHostNavigation per
// SCAF-09 (no raw <a href>).

import * as React from 'react';
import { useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

function formatAge(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function AwaitingYouPill({
  count,
  oldestAge,
  deepLink,
}: {
  count: number;
  oldestAge: number | null;
  deepLink?: string;
}): React.ReactElement | null {
  const nav = useHostNavigation();
  if (count == null || count === 0) return null;
  // Default deep-link points to the classic Paperclip inbox-equivalent route;
  // the host's classic UI surface this issue list. If the snapshot has a more
  // specific link we use that.
  const href = deepLink ?? '/inbox';
  return (
    <a
      {...nav.linkProps(href)}
      className="clarity-awaiting-you-pill"
      data-clarity-region="awaiting-you"
    >
      <span className="clarity-awaiting-you-label">Awaiting You</span>
      <span className="clarity-awaiting-you-count">{count}</span>
      <span className="clarity-awaiting-you-age">·</span>
      <span className="clarity-awaiting-you-age">{formatAge(oldestAge)}</span>
    </a>
  );
}
