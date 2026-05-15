// src/worker/bulletin/next-due-at.ts
//
// Plan 03-01 — BULL-01 DST-safe 06:30 ET scheduling kernel.
//
// PITFALLS.md #9 documents five post-mortems where a bare UTC cron string
// drifted across a DST boundary and fired the morning job at the wrong
// wall-clock time. The fix (CONTEXT.md D-12): the bulletin's schedule is
// worker-managed — `bulletins.next_due_at` is the source of truth, and it is
// always computed as a wall-clock target (06:30 in America/New_York) and
// converted to a UTC instant via `date-fns-tz`. The manifest `jobs[]` cron is
// only a heartbeat hint; this function decides when the compile actually runs.
//
// `computeNextDueAt` is a PURE function — `now` is a parameter, no global Date
// state, no I/O, no `ctx`. That makes the four DST fixture tests in
// test/worker/bulletin/next-due-at.test.mjs deterministic without a
// time-mocking library (Node's experimental `mock.timers.setTime` needs
// 21.2+; the parameter-injection pattern matches Plan 02-09's
// `decideResolvedUserId`).

import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  addDays,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
} from 'date-fns';

/** IANA timezone for the daily compile. Locked to ET for v1 (BULL-01). */
export const BULLETIN_TZ = 'America/New_York';
/** Wall-clock hour of the daily compile. */
export const BULLETIN_HOUR = 6;
/** Wall-clock minute of the daily compile. */
export const BULLETIN_MINUTE = 30;

/**
 * Pure function. Given a wall-clock `now` (a UTC `Date`), return the next
 * 06:30 America/New_York instant STRICTLY greater than `now`.
 *
 * Round-trips cleanly across both 2026 DST transitions:
 *   - spring-forward (2026-03-08 02:00 local -> 03:00 local): 06:30 never
 *     falls inside the skipped hour, so the wall-clock target is unambiguous.
 *   - fall-back (2026-11-01 02:00 EDT -> 01:00 EST): 06:30 is well clear of
 *     the repeated 01:00-02:00 hour; re-firing inside that repeated hour
 *     resolves to the SAME next_due_at, so the bulletin compiles once.
 *
 * `date-fns-tz` `fromZonedTime` selects the correct UTC offset for the target
 * date, which is what makes the round-trip DST-safe.
 */
export function computeNextDueAt(now: Date): Date {
  // Represent the UTC instant `now` as wall-clock time in America/New_York.
  const nowZoned = toZonedTime(now, BULLETIN_TZ);

  // Build "today at 06:30" in that same wall-clock representation.
  let targetZoned = setMilliseconds(
    setSeconds(setMinutes(setHours(nowZoned, BULLETIN_HOUR), BULLETIN_MINUTE), 0),
    0,
  );

  // If today's 06:30 has already arrived (or is exactly now), roll to
  // tomorrow — the contract is STRICTLY greater than `now`.
  if (targetZoned.getTime() <= nowZoned.getTime()) {
    targetZoned = addDays(targetZoned, 1);
  }

  // Convert the wall-clock target back to a UTC instant. fromZonedTime applies
  // the timezone's offset for the target date (handling DST automatically).
  return fromZonedTime(targetZoned, BULLETIN_TZ);
}

// Re-export the formatter so downstream plans (03-02/03-03 masthead date text)
// have a single import surface for date-fns-tz.
export { formatInTimeZone } from 'date-fns-tz';
