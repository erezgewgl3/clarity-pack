// test/worker/bulletin/dst-ci-matrix.test.mjs
//
// Plan 03-04 Task 1 RED — BULL-01 completion: DST wall-clock invariants
// for the Daily Bulletin schedule.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { formatInTimeZone } from 'date-fns-tz';

import { computeNextDueAt } from '../../../src/worker/bulletin/next-due-at.ts';

const TZ = 'America/New_York';

const FIXTURES = [
  {
    name: '2026-03-08 spring-forward day',
    now: '2026-03-08T11:30:00.000Z',
    next: '2026-03-09T10:30:00.000Z',
    dayText: 'Sunday, 2026-03-08',
  },
  {
    name: '2026-03-09 day after spring-forward',
    now: '2026-03-09T10:30:00.000Z',
    next: '2026-03-10T10:30:00.000Z',
    dayText: 'Monday, 2026-03-09',
  },
  {
    name: '2026-11-01 fall-back day',
    now: '2026-11-01T11:30:00.000Z',
    next: '2026-11-02T11:30:00.000Z',
    dayText: 'Sunday, 2026-11-01',
  },
  {
    name: '2026-11-02 day after fall-back',
    now: '2026-11-02T11:30:00.000Z',
    next: '2026-11-03T11:30:00.000Z',
    dayText: 'Monday, 2026-11-02',
  },
];

for (const fixture of FIXTURES) {
  test(`DST matrix: ${fixture.name} advances next_due_at to next 06:30 ET`, () => {
    const next = computeNextDueAt(new Date(fixture.now)).toISOString();
    assert.equal(next, fixture.next);
    assert.equal(formatInTimeZone(next, TZ, 'HH:mm'), '06:30');
  });
}

test('DST matrix: every fixture preserves exactly one 06:30 ET wall-clock target', () => {
  const nextDueAts = FIXTURES.map((f) => computeNextDueAt(new Date(f.now)).toISOString());
  assert.deepEqual(nextDueAts, FIXTURES.map((f) => f.next));
  assert.deepEqual(nextDueAts.map((iso) => formatInTimeZone(iso, TZ, 'HH:mm')), [
    '06:30',
    '06:30',
    '06:30',
    '06:30',
  ]);
});

test('DST matrix: deterministic across repeated runs', () => {
  const first = FIXTURES.map((f) => computeNextDueAt(new Date(f.now)).toISOString());
  const second = FIXTURES.map((f) => computeNextDueAt(new Date(f.now)).toISOString());
  assert.deepEqual(second, first);
});

