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

/**
 * Default IANA timezone for the daily compile when no config override is
 * provided.
 *
 * 2026-05-28: changed the DEFAULT from 'America/New_York' to 'Asia/Jerusalem'
 * at operator request (both founders work in Israel). The value is now also
 * runtime-overridable via the `bulletinTimezone` instance-config field —
 * `computeNextDueAt(now, tz)` accepts an explicit IANA zone, and
 * `compile-bulletin.ts` passes `ctx.config.get('bulletinTimezone')`. This
 * constant is the fallback when config is absent/empty/invalid. Callers that
 * omit the argument (older tests) get the default.
 */
export const BULLETIN_TZ = 'Asia/Jerusalem';
/** Wall-clock hour of the daily compile. */
export const BULLETIN_HOUR = 6;
/** Wall-clock minute of the daily compile. */
export const BULLETIN_MINUTE = 30;

/**
 * Pure function. Given a wall-clock `now` (a UTC `Date`) and an IANA `tz`,
 * return the next 06:30-in-`tz` instant STRICTLY greater than `now`.
 *
 * `tz` defaults to BULLETIN_TZ (Asia/Jerusalem) for back-compat with callers
 * that don't pass it. The DST-safe round-trip property holds for ANY IANA
 * zone because `date-fns-tz` `fromZonedTime` selects the correct UTC offset
 * for the target wall-clock date in that zone — 06:30 is well clear of every
 * common DST transition hour (spring-forward 02:00→03:00, fall-back
 * 02:00→01:00), so the wall-clock target is always unambiguous and re-firing
 * inside a repeated hour resolves to the same instant.
 */
export function computeNextDueAt(now: Date, tz: string = BULLETIN_TZ): Date {
  // Guard: an empty/whitespace tz string would make date-fns-tz throw or
  // silently treat it as UTC. Fall back to the default in that case.
  const zone = typeof tz === 'string' && tz.trim() ? tz.trim() : BULLETIN_TZ;

  // Represent the UTC instant `now` as wall-clock time in the target zone.
  const nowZoned = toZonedTime(now, zone);

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
  // the zone's offset for the target date (handling DST automatically).
  return fromZonedTime(targetZoned, zone);
}

// Re-export the formatter so downstream plans (03-02/03-03 masthead date text)
// have a single import surface for date-fns-tz.
export { formatInTimeZone } from 'date-fns-tz';
