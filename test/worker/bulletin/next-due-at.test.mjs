// test/worker/bulletin/next-due-at.test.mjs
//
// Plan 03-01 Task 1 RED — BULL-01 DST-safe 06:30 ET scheduling. Four DST
// fixture instants prove computeNextDueAt round-trips both 2026 DST
// transitions:
//   - spring-forward: 2026-03-08 02:00 local jumps to 03:00 local
//   - fall-back:      2026-11-01 02:00 EDT falls back to 01:00 EST (the
//                     01:00-02:00 wall-clock hour repeats)
//
// Pure-function pattern (PITFALLS.md #9): `now` is a parameter, no global
// Date mocking — matches Plan 02-09's `decideResolvedUserId` resolver. The
// fall-back fixture is the load-bearing one: re-firing inside the repeated
// hour must NOT advance next_due_at, or the bulletin compiles twice.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  computeNextDueAt,
  BULLETIN_TZ,
  BULLETIN_HOUR,
  BULLETIN_MINUTE,
} from '../../../src/worker/bulletin/next-due-at.ts';
import { formatInTimeZone } from 'date-fns-tz';

// ---------------------------------------------------------------------------
// DST fixture 1 — day before spring-forward, before 06:30 ET
// ---------------------------------------------------------------------------

test('next_due_at: 2026-03-08 05:00 EST (before 06:30, day of spring-forward) -> 06:30 ET same day', () => {
  // 2026-03-08T10:00:00Z = 05:00 EST (UTC-5). DST springs at 02:00 local but
  // 05:00 has already passed it — so 05:00 is actually EST -> still UTC-5.
  // Refining: at 10:00 UTC on 03-08, NY clock reads 05:00 (EST window ended
  // at 02:00 local, so we are in EDT: 10:00 UTC = 06:00 EDT)... the contract
  // here is simply: the NEXT 06:30 wall-clock instant in America/New_York.
  const now = new Date('2026-03-08T10:00:00Z');
  const next = computeNextDueAt(now);
  // 06:30 ET on 2026-03-08 (EDT, UTC-4) = 10:30 UTC.
  assert.equal(next.toISOString(), '2026-03-08T10:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'America/New_York', "yyyy-MM-dd'T'HH:mm"),
    '2026-03-08T06:30',
  );
});

// ---------------------------------------------------------------------------
// DST fixture 2 — spring-forward day, after 06:30 ET -> next day
// ---------------------------------------------------------------------------

test('next_due_at: 2026-03-08 after 06:30 EDT (spring-forward day) -> NEXT day 06:30 EDT', () => {
  // 2026-03-08T12:00:00Z = 08:00 EDT (DST already started at 02:00 local).
  const now = new Date('2026-03-08T12:00:00Z');
  const next = computeNextDueAt(now);
  // 2026-03-09 06:30 EDT = 10:30 UTC.
  assert.equal(next.toISOString(), '2026-03-09T10:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'America/New_York', "yyyy-MM-dd'T'HH:mm"),
    '2026-03-09T06:30',
  );
});

// ---------------------------------------------------------------------------
// DST fixture 3 — fall-back day, before 06:30 ET
// ---------------------------------------------------------------------------

test('next_due_at: 2026-11-01 00:30 EDT (fall-back day, before 06:30) -> 06:30 EST same day', () => {
  // 2026-11-01T04:30:00Z = 00:30 EDT (UTC-4). DST ends at 02:00 EDT this day,
  // clocks fall back to 01:00 EST. 06:30 wall-clock on 11-01 is EST (UTC-5).
  const now = new Date('2026-11-01T04:30:00Z');
  const next = computeNextDueAt(now);
  // 06:30 EST = 11:30 UTC.
  assert.equal(next.toISOString(), '2026-11-01T11:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'America/New_York', "yyyy-MM-dd'T'HH:mm"),
    '2026-11-01T06:30',
  );
});

// ---------------------------------------------------------------------------
// DST fixture 4 — fall-back day, INSIDE the repeated 01:00-02:00 hour
// ---------------------------------------------------------------------------

test('next_due_at: 2026-11-01 inside the repeated 01:00-02:00 ET hour -> next_due_at must NOT advance', () => {
  // 2026-11-01T06:30:00Z = 01:30 in the repeated hour after fall-back.
  // Must still resolve to the SAME 06:30 EST instant — no second compile.
  const now = new Date('2026-11-01T06:30:00Z');
  const next = computeNextDueAt(now);
  assert.equal(
    next.toISOString(),
    '2026-11-01T11:30:00.000Z',
    'fall-back repeated hour must not advance next_due_at',
  );
});

// ---------------------------------------------------------------------------
// DST fixture 5 — day after fall-back, EST stable
// ---------------------------------------------------------------------------

test('next_due_at: 2026-11-02 05:00 EST (day after fall-back) -> 06:30 EST same day', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 05:00 EST
  const next = computeNextDueAt(now);
  // 06:30 EST = 11:30 UTC.
  assert.equal(next.toISOString(), '2026-11-02T11:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'America/New_York', "yyyy-MM-dd'T'HH:mm"),
    '2026-11-02T06:30',
  );
});

// ---------------------------------------------------------------------------
// Idempotency / determinism guard
// ---------------------------------------------------------------------------

test('next_due_at: two calls with the same `now` produce byte-equal ISO strings', () => {
  const now = new Date('2026-06-15T14:00:00Z');
  const a = computeNextDueAt(now);
  const b = computeNextDueAt(now);
  assert.equal(a.toISOString(), b.toISOString());
});

test('next_due_at: result is strictly greater than `now` even when now == today 06:30 exactly', () => {
  // 06:30 EDT on 2026-06-15 = 10:30 UTC. A `now` exactly at the target must
  // roll forward to tomorrow (strict-greater contract).
  const now = new Date('2026-06-15T10:30:00.000Z');
  const next = computeNextDueAt(now);
  assert.ok(next.getTime() > now.getTime(), 'next_due_at must be strictly after now');
  assert.equal(next.toISOString(), '2026-06-16T10:30:00.000Z');
});

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

test('next-due-at module exports locked constants', () => {
  assert.equal(BULLETIN_TZ, 'America/New_York');
  assert.equal(BULLETIN_HOUR, 6);
  assert.equal(BULLETIN_MINUTE, 30);
});
