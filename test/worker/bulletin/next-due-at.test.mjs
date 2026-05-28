// test/worker/bulletin/next-due-at.test.mjs
//
// Plan 03-01 Task 1 — BULL-01 DST-safe 06:30 scheduling kernel.
//
// 2026-05-28 — computeNextDueAt now takes an optional IANA `tz` argument
// (default BULLETIN_TZ = 'Asia/Jerusalem'; operator-configurable via the
// bulletinTimezone instance-config). The original four ET DST fixtures are
// retained but PINNED to an explicit 'America/New_York' argument — the DST
// round-trip property they prove is zone-agnostic in value, and ET has two
// well-understood 2026 transitions worth keeping as regression coverage:
//   - spring-forward: 2026-03-08 02:00 local jumps to 03:00 local
//   - fall-back:      2026-11-01 02:00 EDT falls back to 01:00 EST (the
//                     01:00-02:00 wall-clock hour repeats)
// New Asia/Jerusalem fixtures cover the default path + an Israel DST instant.
//
// Pure-function pattern (PITFALLS.md #9): `now` is a parameter, no global
// Date mocking. The fall-back fixture is the load-bearing one: re-firing
// inside the repeated hour must NOT advance next_due_at.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  computeNextDueAt,
  BULLETIN_TZ,
  BULLETIN_HOUR,
  BULLETIN_MINUTE,
} from '../../../src/worker/bulletin/next-due-at.ts';
import { formatInTimeZone } from 'date-fns-tz';

const ET = 'America/New_York';

// ---------------------------------------------------------------------------
// DST fixture 1 — day before spring-forward, before 06:30 ET (explicit ET)
// ---------------------------------------------------------------------------

test('next_due_at[ET]: 2026-03-08 05:00 EST (day of spring-forward) -> 06:30 ET same day', () => {
  const now = new Date('2026-03-08T10:00:00Z');
  const next = computeNextDueAt(now, ET);
  // 06:30 ET on 2026-03-08 (EDT, UTC-4) = 10:30 UTC.
  assert.equal(next.toISOString(), '2026-03-08T10:30:00.000Z');
  assert.equal(formatInTimeZone(next, ET, "yyyy-MM-dd'T'HH:mm"), '2026-03-08T06:30');
});

// ---------------------------------------------------------------------------
// DST fixture 2 — spring-forward day, after 06:30 ET -> next day
// ---------------------------------------------------------------------------

test('next_due_at[ET]: 2026-03-08 after 06:30 EDT (spring-forward day) -> NEXT day 06:30 EDT', () => {
  const now = new Date('2026-03-08T12:00:00Z'); // 08:00 EDT
  const next = computeNextDueAt(now, ET);
  assert.equal(next.toISOString(), '2026-03-09T10:30:00.000Z');
  assert.equal(formatInTimeZone(next, ET, "yyyy-MM-dd'T'HH:mm"), '2026-03-09T06:30');
});

// ---------------------------------------------------------------------------
// DST fixture 3 — fall-back day, before 06:30 ET
// ---------------------------------------------------------------------------

test('next_due_at[ET]: 2026-11-01 00:30 EDT (fall-back day, before 06:30) -> 06:30 EST same day', () => {
  const now = new Date('2026-11-01T04:30:00Z'); // 00:30 EDT
  const next = computeNextDueAt(now, ET);
  // 06:30 EST = 11:30 UTC.
  assert.equal(next.toISOString(), '2026-11-01T11:30:00.000Z');
  assert.equal(formatInTimeZone(next, ET, "yyyy-MM-dd'T'HH:mm"), '2026-11-01T06:30');
});

// ---------------------------------------------------------------------------
// DST fixture 4 — fall-back day, INSIDE the repeated 01:00-02:00 hour
// ---------------------------------------------------------------------------

test('next_due_at[ET]: 2026-11-01 inside the repeated 01:00-02:00 ET hour -> must NOT advance', () => {
  const now = new Date('2026-11-01T06:30:00Z'); // 01:30 in the repeated hour
  const next = computeNextDueAt(now, ET);
  assert.equal(
    next.toISOString(),
    '2026-11-01T11:30:00.000Z',
    'fall-back repeated hour must not advance next_due_at',
  );
});

// ---------------------------------------------------------------------------
// DST fixture 5 — day after fall-back, EST stable
// ---------------------------------------------------------------------------

test('next_due_at[ET]: 2026-11-02 05:00 EST (day after fall-back) -> 06:30 EST same day', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 05:00 EST
  const next = computeNextDueAt(now, ET);
  assert.equal(next.toISOString(), '2026-11-02T11:30:00.000Z');
  assert.equal(formatInTimeZone(next, ET, "yyyy-MM-dd'T'HH:mm"), '2026-11-02T06:30');
});

// ---------------------------------------------------------------------------
// Asia/Jerusalem — the new DEFAULT (2026-05-28). No-arg call must use it.
// ---------------------------------------------------------------------------

test('next_due_at[default]: no tz argument resolves to Asia/Jerusalem 06:30', () => {
  // 2026-06-15 is inside Israel DST (IDT, UTC+3; DST 2026-03-27..2026-10-25).
  // 2026-06-15T00:00:00Z = 03:00 IDT. Next 06:30 IDT = 03:30 UTC same day.
  const now = new Date('2026-06-15T00:00:00Z');
  const next = computeNextDueAt(now); // <-- no tz arg, exercises the default
  assert.equal(next.toISOString(), '2026-06-15T03:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm"),
    '2026-06-15T06:30',
  );
});

test('next_due_at[Jerusalem summer/IDT]: after 06:30 IDT rolls to next day', () => {
  // 2026-06-15T05:00:00Z = 08:00 IDT (past 06:30). Next is 06-16 06:30 IDT
  // = 2026-06-16T03:30:00Z.
  const now = new Date('2026-06-15T05:00:00Z');
  const next = computeNextDueAt(now, 'Asia/Jerusalem');
  assert.equal(next.toISOString(), '2026-06-16T03:30:00.000Z');
});

test('next_due_at[Jerusalem winter/IST]: 06:30 IST = 04:30 UTC', () => {
  // 2026-12-01 is outside Israel DST (IST, UTC+2). 2026-12-01T00:00:00Z =
  // 02:00 IST. Next 06:30 IST = 04:30 UTC same day.
  const now = new Date('2026-12-01T00:00:00Z');
  const next = computeNextDueAt(now, 'Asia/Jerusalem');
  assert.equal(next.toISOString(), '2026-12-01T04:30:00.000Z');
  assert.equal(
    formatInTimeZone(next, 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm"),
    '2026-12-01T06:30',
  );
});

// ---------------------------------------------------------------------------
// Empty / whitespace tz falls back to the default (guard in computeNextDueAt)
// ---------------------------------------------------------------------------

test('next_due_at[guard]: empty-string tz falls back to Asia/Jerusalem default', () => {
  const now = new Date('2026-06-15T00:00:00Z');
  const viaEmpty = computeNextDueAt(now, '');
  const viaDefault = computeNextDueAt(now);
  assert.equal(viaEmpty.toISOString(), viaDefault.toISOString());
  assert.equal(viaEmpty.toISOString(), '2026-06-15T03:30:00.000Z');
});

// ---------------------------------------------------------------------------
// Idempotency / determinism guard (zone-agnostic)
// ---------------------------------------------------------------------------

test('next_due_at: two calls with the same `now` produce byte-equal ISO strings', () => {
  const now = new Date('2026-06-15T14:00:00Z');
  const a = computeNextDueAt(now, ET);
  const b = computeNextDueAt(now, ET);
  assert.equal(a.toISOString(), b.toISOString());
});

test('next_due_at[ET]: strictly greater than `now` even when now == today 06:30 exactly', () => {
  // 06:30 EDT on 2026-06-15 = 10:30 UTC. A `now` exactly at the target must
  // roll forward to tomorrow (strict-greater contract).
  const now = new Date('2026-06-15T10:30:00.000Z');
  const next = computeNextDueAt(now, ET);
  assert.ok(next.getTime() > now.getTime(), 'next_due_at must be strictly after now');
  assert.equal(next.toISOString(), '2026-06-16T10:30:00.000Z');
});

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

test('next-due-at module exports locked constants (default tz = Asia/Jerusalem as of 2026-05-28)', () => {
  assert.equal(BULLETIN_TZ, 'Asia/Jerusalem');
  assert.equal(BULLETIN_HOUR, 6);
  assert.equal(BULLETIN_MINUTE, 30);
});
