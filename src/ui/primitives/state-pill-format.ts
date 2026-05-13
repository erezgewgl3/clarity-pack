// src/ui/primitives/state-pill-format.ts
//
// Plan 02-02 Task 2 — pure helpers extracted from state-pill.tsx so they can
// be unit-tested without loading JSX (Node 24's native .ts strip-types
// doesn't extend to .tsx; loading a .tsx component into node:test requires
// either an esbuild compile step or testing against the bundled UI output).
//
// Keeping the React component minimal (state-pill.tsx imports from this file)
// means the JSX surface is small enough to review by inspection during
// Plan 02-03 integration testing.

export type StatePillState =
  | 'Working'
  | 'Stuck'
  | 'AwaitingYou'
  | 'Standby'
  | 'AwaitingPeer';

export const STATE_TO_CLASS: Record<StatePillState, string> = {
  Working: 'clarity-state-working',
  Stuck: 'clarity-state-stuck',
  AwaitingYou: 'clarity-state-awaiting-you',
  Standby: 'clarity-state-standby',
  AwaitingPeer: 'clarity-state-awaiting-peer',
};

/**
 * Render a human-readable age from a millisecond count. Buckets:
 *   <0 or NaN → "?"  (sentinel — caller passed something invalid)
 *   < 60s    → "<1m"
 *   < 60m    → "Nm"
 *   < 24h    → "Nh"
 *   else     → "Nd"
 *
 * Deterministic — same input always returns same output.
 */
export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '?';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return '<1m';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

/** Split CamelCase to "Camel Case". Used in StatePill's display text. */
export function humaniseState(state: StatePillState): string {
  return state.replace(/([A-Z])/g, ' $1').trim();
}
