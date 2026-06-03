// test/worker/util/map-bounded.test.mjs
//
// Plan 16-01 Task 2 — the hand-rolled bounded-concurrency pool + deadline floor.
// The ONLY genuinely-new primitive in Phase 16 (no in-repo pool exists; the
// canonical 15-line shapes live in 16-RESEARCH.md Code Examples lines 311-338).
//
// mapBounded: keeps at most `limit` workers pulling from a shared cursor, writing
//   into a pre-sized results array by index so order is preserved regardless of
//   per-item completion order (caps in-flight host Postgres load — T-16-01 DoS).
// withDeadline: floors a hung OR rejecting relations.get to a deterministic
//   fallback well under the 30s host default, clearing the timer on settle
//   (T-16-02 DoS — a single hung call must not consume the whole 30s budget).
//
// NO p-limit, NO new dependency (bundle-size CI ceiling forbids it — RESEARCH
// lines 77-82). Tested like the existing pure builders (node:test, stubbed work).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { mapBounded, withDeadline } from '../../../src/worker/util/map-bounded.ts';

// A controllable async unit: returns a promise + a `resolve` lever so a test can
// hold work in-flight to observe the concurrency ceiling deterministically.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// mapBounded — concurrency ceiling
// ---------------------------------------------------------------------------

test('mapBounded — never has more than `limit` invocations in flight (max-in-flight === limit)', async () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const LIMIT = 2;
  let inFlight = 0;
  let maxInFlight = 0;
  const gates = items.map(() => deferred());

  const resultP = mapBounded(items, LIMIT, async (item, i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await gates[i].promise;
    inFlight--;
    return `${item}!`;
  });

  // Let the pool spin up; only `limit` workers should have started.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(inFlight, LIMIT, 'exactly `limit` workers in flight before any settle');

  // Release the gates one by one; the pool pulls the next item each time.
  for (let i = 0; i < gates.length; i++) {
    gates[i].resolve();
    await new Promise((r) => setTimeout(r, 1));
  }

  const out = await resultP;
  assert.deepEqual(out, ['a!', 'b!', 'c!', 'd!', 'e!', 'f!']);
  // The cap held AND the pool parallelized up to the ceiling (min(limit, n)).
  assert.equal(maxInFlight, Math.min(LIMIT, items.length), 'observed max-in-flight equals min(limit, items.length)');
});

// ---------------------------------------------------------------------------
// mapBounded — order preservation regardless of completion order
// ---------------------------------------------------------------------------

test('mapBounded — preserves input order even when items complete out of order', async () => {
  const items = [0, 1, 2, 3, 4];
  // Item i resolves after (items.length - i) ms, so later items finish first.
  const out = await mapBounded(items, 3, async (n) => {
    await new Promise((r) => setTimeout(r, (items.length - n) * 3));
    return n * 10;
  });
  assert.deepEqual(out, [0, 10, 20, 30, 40], 'results indexed by input position, not completion order');
});

// ---------------------------------------------------------------------------
// mapBounded — limit > items.length does not over-spawn
// ---------------------------------------------------------------------------

test('mapBounded — limit greater than items.length runs items.length workers, returns all results', async () => {
  const items = ['x', 'y', 'z'];
  let inFlight = 0;
  let maxInFlight = 0;
  const out = await mapBounded(items, 99, async (item) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return item.toUpperCase();
  });
  assert.deepEqual(out, ['X', 'Y', 'Z']);
  assert.equal(maxInFlight, items.length, 'never spawns more workers than there are items');
});

// ---------------------------------------------------------------------------
// mapBounded — empty input
// ---------------------------------------------------------------------------

test('mapBounded — empty items resolves to [] without calling fn', async () => {
  let called = 0;
  const out = await mapBounded([], 4, async () => {
    called++;
    return 1;
  });
  assert.deepEqual(out, []);
  assert.equal(called, 0, 'fn is never invoked on an empty input');
});

// ---------------------------------------------------------------------------
// withDeadline — times out to onTimeout()
// ---------------------------------------------------------------------------

test('withDeadline — resolves onTimeout() when p neither resolves nor rejects within ms', async () => {
  const neverSettles = new Promise(() => {}); // hangs forever
  const value = await withDeadline(neverSettles, 10, () => 'FLOOR');
  assert.equal(value, 'FLOOR', 'a hung promise floors to onTimeout()');
});

// ---------------------------------------------------------------------------
// withDeadline — floors to onTimeout() on rejection (a thrown relations.get
// must not escape)
// ---------------------------------------------------------------------------

test('withDeadline — floors to onTimeout() when p REJECTS (never throws)', async () => {
  const rejects = Promise.reject(new Error('relations.get blew up'));
  let threw = false;
  let value;
  try {
    value = await withDeadline(rejects, 50, () => 'FLOOR_ON_REJECT');
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'a rejecting promise must not throw out of withDeadline');
  assert.equal(value, 'FLOOR_ON_REJECT', 'rejection floors to onTimeout()');
});

// ---------------------------------------------------------------------------
// withDeadline — resolves p's value (and clears the timer) when p wins the race
// ---------------------------------------------------------------------------

test('withDeadline — resolves p value when p settles before ms', async () => {
  const fast = Promise.resolve('REAL');
  const value = await withDeadline(fast, 1000, () => 'FLOOR');
  assert.equal(value, 'REAL', 'a fast promise yields its own value, not the floor');
});

test('withDeadline — clears the timer on resolve (onTimeout never fires after a win)', async () => {
  let timeoutCalls = 0;
  const fast = new Promise((res) => setTimeout(() => res('REAL'), 5));
  const value = await withDeadline(fast, 30, () => {
    timeoutCalls++;
    return 'FLOOR';
  });
  // Wait past the original deadline to prove the timer was cleared.
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(value, 'REAL');
  assert.equal(timeoutCalls, 0, 'onTimeout must not fire once p has resolved (timer cleared)');
});
