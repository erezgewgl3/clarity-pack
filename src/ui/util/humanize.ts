// src/ui/util/humanize.ts
//
// Plan 05-03 (DIST-03) — extracted from activity-timeline.tsx so the Reader's
// AC auto-status indicator can re-use the same relative-time format ("5m" /
// "2h" / "3d") without duplicating the function. activity-timeline.tsx now
// imports shortAgo from here; ac-checklist.tsx consumes the same export.

/**
 * Format an ISO timestamp as a short relative-time string ("5m", "2h", "3d").
 * Returns the raw ISO when the input is unparseable or in the future. Pure;
 * no DOM dependency; safe to call from the worker tier in principle (but
 * currently only consumed in the UI tier).
 */
export function shortAgo(iso: string): string {
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
