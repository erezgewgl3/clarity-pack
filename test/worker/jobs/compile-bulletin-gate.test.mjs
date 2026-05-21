// test/worker/jobs/compile-bulletin-gate.test.mjs
//
// Plan 04.1-11 — bulletin cadence gate regression test (Fix A).
//
// Pins the gate decision against BOTH timestamp formats the value at
// `bulletins.next_due_at` may arrive in:
//   - Postgres `timestamptz` round-trip: `'2026-05-21 10:30:00+00'` (space sep)
//   - JS `Date.prototype.toISOString` output: `'2026-05-21T10:30:00.000Z'` (T sep)
//
// Production diagnosis 2026-05-21 (`bulletin-compile-cadence-runaway.md`
// RE-DRILL): the pre-Plan-04.1-11 gate read `now.toISOString() < nextDueAtIso`
// — a LEXICOGRAPHIC string compare. When both timestamps fell on the SAME DAY,
// the day-digit prefix matched and the FIRST differing character was the
// separator: 'T' (ASCII 84) vs ' ' (ASCII 32), reversing the chronological
// relation. Same-day gate failure ran the compile every cron tick →
// Countermoves bulletin cycle #691 before manual SQL bleed-stop.
//
// `isPastDue(now, nextDueAtIso)` is the pure helper extracted in Plan 04.1-11
// Task 1; the per-company loop in `registerCompileBulletinJob` now reads
// `if (!isPastDue(now, nextDueAtIso)) continue;`. This file unit-tests the
// helper directly so any future refactor that reintroduces a string compare
// — or that ever drops the Date conversion — fails the suite.
//
// The four required scenarios:
//   1. now = 2026-05-21T09:35:00Z, next = '2026-05-21 10:30:00+00'
//      → SAME-DAY, future. isPastDue = FALSE (gate triggers continue).
//   2. now = 2026-05-21T11:00:00Z, next = '2026-05-21 10:30:00+00'
//      → SAME-DAY, past. isPastDue = TRUE (gate releases).
//   3. now = 2026-05-21T09:35:00Z, next = '2026-05-22 10:30:00+00'
//      → CROSS-DAY, future. isPastDue = FALSE.
//   4. now = 2026-05-22T11:00:00Z, next = '2026-05-21 10:30:00+00'
//      → CROSS-DAY, past. isPastDue = TRUE.
//
// Plus regression-pinning meta-assertions documenting WHY the bug existed
// (string compare reverses same-day chronology) and proving the ISO-T format
// variant also gates correctly.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { isPastDue } from '../../../src/worker/jobs/compile-bulletin.ts';

// ---------------------------------------------------------------------------
// Postgres timestamptz format — space separator (the production scenario).
// ---------------------------------------------------------------------------

test('Test 1 (SAME-DAY, FUTURE, postgres-space-format): gate triggers continue', () => {
  // The bug scenario. Both timestamps land on 2026-05-21; pre-fix string
  // compare returned `false` here (BUG: 'T' > ' ' reversed the relation),
  // letting the compile run when it should have waited. isPastDue must
  // return false so the per-company loop hits `continue` and the every-
  // minute cron does nothing.
  const now = new Date('2026-05-21T09:35:00.000Z');
  const nextDueAtIso = '2026-05-21 10:30:00+00';
  assert.strictEqual(isPastDue(now, nextDueAtIso), false);
});

test('Test 2 (SAME-DAY, PAST, postgres-space-format): gate releases', () => {
  // The normal release case. Now is genuinely past the target on the same
  // day. Both pre-fix string compare and post-fix Date compare agree on
  // this answer (`'2026-05-21T11:00:00.000Z' > '2026-05-21 10:30:00+00'` is
  // also true), so this case stayed correct through the bug — which is
  // exactly why it never tripped the suite.
  const now = new Date('2026-05-21T11:00:00.000Z');
  const nextDueAtIso = '2026-05-21 10:30:00+00';
  assert.strictEqual(isPastDue(now, nextDueAtIso), true);
});

test('Test 3 (CROSS-DAY, FUTURE, postgres-space-format): gate triggers continue', () => {
  // Cross-day future: now is 2026-05-21, next is 2026-05-22. The day digit
  // at column 9 (`1` vs `2`) dominates the lexicographic compare, masking
  // the separator-position difference. Pre-fix worked here for the WRONG
  // reason; post-fix continues to work.
  const now = new Date('2026-05-21T09:35:00.000Z');
  const nextDueAtIso = '2026-05-22 10:30:00+00';
  assert.strictEqual(isPastDue(now, nextDueAtIso), false);
});

test('Test 4 (CROSS-DAY, PAST, postgres-space-format): gate releases', () => {
  // Cross-day past: now is 2026-05-22, next was 2026-05-21. This is the
  // scenario the v0.6.6 closure drill (2026-05-18) hit: next_due_at had
  // already advanced to a different day from `now`, so the lexicographic
  // compare accidentally produced the correct answer and the bug stayed
  // hidden. Same answer post-fix.
  const now = new Date('2026-05-22T11:00:00.000Z');
  const nextDueAtIso = '2026-05-21 10:30:00+00';
  assert.strictEqual(isPastDue(now, nextDueAtIso), true);
});

// ---------------------------------------------------------------------------
// ISO-8601 'T' format — the shape upsertBulletin writes (via toISOString).
// The gate must handle both formats because the value can arrive from either
// path (driver round-trip vs the just-written ISO string).
// ---------------------------------------------------------------------------

test('Test 5 (SAME-DAY, FUTURE, ISO-T-format): gate triggers continue', () => {
  // Mirror of Test 1 but with the next_due_at in ISO-T format — proves
  // isPastDue handles both formats symmetrically.
  const now = new Date('2026-05-21T09:35:00.000Z');
  const nextDueAtIso = '2026-05-21T10:30:00.000Z';
  assert.strictEqual(isPastDue(now, nextDueAtIso), false);
});

test('Test 6 (SAME-DAY, PAST, ISO-T-format): gate releases', () => {
  const now = new Date('2026-05-21T11:00:00.000Z');
  const nextDueAtIso = '2026-05-21T10:30:00.000Z';
  assert.strictEqual(isPastDue(now, nextDueAtIso), true);
});

// ---------------------------------------------------------------------------
// Exact-equality boundary — at the instant now === nextDueAt the cron should
// FIRE (not gate), because next_due_at is the moment the compile is owed.
// ---------------------------------------------------------------------------

test('Test 7 (EXACT-EQUAL): now === nextDueAt → gate releases (this tick consumes the due)', () => {
  // The cron pollster wakes every minute. If `now` lands exactly on the
  // due instant, this tick consumes it — failing to compile here would
  // delay the bulletin by a full minute.
  const now = new Date('2026-05-21T10:30:00.000Z');
  const nextDueAtIso = '2026-05-21 10:30:00+00';
  assert.strictEqual(isPastDue(now, nextDueAtIso), true);
});

// ---------------------------------------------------------------------------
// Regression-pinning meta-assertions — document WHY the bug existed.
// ---------------------------------------------------------------------------

test('Regression pin: string compare DOES reverse same-day chronology (this is the bug Fix A corrects)', () => {
  // The pre-Plan 04.1-11 code read:
  //   if (now.toISOString() < nextDueAtIso) continue;
  // This assertion documents the lexicographic anomaly that caused the
  // production runaway. Despite chronologically 09:35 < 10:30, the string
  // compare returns FALSE because 'T' (ASCII 84) > ' ' (ASCII 32) at
  // position 10 (where the day prefix matches, day-position differs, AND
  // the separator differs). Future code that reintroduces a string compare
  // would re-trip the runaway. The post-Fix-A isPastDue() above proves it
  // returns the chronologically correct answer for the SAME inputs.
  assert.strictEqual(
    '2026-05-21T09:35:00.000Z' < '2026-05-21 10:30:00+00',
    false,
    'string compare reverses same-day chronology — this is the bug Fix A corrects',
  );
  // And the converse: with the Date-based compare, the same inputs return
  // the chronologically correct answer (now is BEFORE target → not past
  // due → gate triggers continue).
  assert.strictEqual(
    isPastDue(new Date('2026-05-21T09:35:00.000Z'), '2026-05-21 10:30:00+00'),
    false,
    'Date compare returns chronologically correct answer',
  );
});

test('Regression pin: BOTH formats compare equally via Date constructor', () => {
  // Defensive — confirms that new Date(<postgres-space-format>) and
  // new Date(<iso-T-format>) parse the same absolute instant. If a future
  // Node version ever changed Date-parsing for the space-separator
  // variant, this test would fail loudly before production did.
  const pgFormat = '2026-05-21 10:30:00+00';
  const isoFormat = '2026-05-21T10:30:00.000Z';
  assert.strictEqual(
    new Date(pgFormat).getTime(),
    new Date(isoFormat).getTime(),
    'space-separator and T-separator parse to the same epoch ms',
  );
});
