// test/shared/opt-in.test.mjs
//
// Plan 02-02 Task 1 — OPTIN-01 semantics: absence of clarity_user_prefs row = OFF.
// Tested against the in-memory shape; the durable storage path (clarity_user_prefs
// table reads/writes) lives in Plan 02-04 worker handlers.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { getOptIn, isOptedIn } from '../../src/shared/opt-in.ts';

test('getOptIn returns OFF defaults when prefs map has no row for the user (OPTIN-01)', () => {
  const prefs = new Map();
  const result = getOptIn('eric', prefs);
  assert.deepEqual(result, {
    userId: 'eric',
    optedInAt: null,
    defaultLanding: 'classic',
  });
});

test('getOptIn returns the existing row when present', () => {
  const prefs = new Map([
    [
      'eric',
      {
        userId: 'eric',
        optedInAt: '2026-05-13T10:00:00Z',
        defaultLanding: 'clarity',
      },
    ],
  ]);
  const result = getOptIn('eric', prefs);
  assert.equal(result.userId, 'eric');
  assert.equal(result.optedInAt, '2026-05-13T10:00:00Z');
  assert.equal(result.defaultLanding, 'clarity');
});

test('isOptedIn returns false when optedInAt is null', () => {
  assert.equal(
    isOptedIn({ userId: 'eric', optedInAt: null, defaultLanding: 'classic' }),
    false,
  );
});

test('isOptedIn returns true when optedInAt is an ISO string', () => {
  assert.equal(
    isOptedIn({
      userId: 'eric',
      optedInAt: '2026-05-13T10:00:00Z',
      defaultLanding: 'clarity',
    }),
    true,
  );
});
