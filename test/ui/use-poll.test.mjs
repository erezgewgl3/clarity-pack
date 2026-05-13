// test/ui/use-poll.test.mjs
//
// Plan 02-02 Task 2 — drives the pure createPollLoop state machine without
// React. Exercises the SCAF-07 + PITFALLS.md #1 contracts:
//   - visibility guard (pauseOnHidden)
//   - PLUGIN_DISABLED → terminal stop (no further setTimeout schedules)
//   - WORKER_UNAVAILABLE → exponential backoff (next delay = intervalMs * 2)
//   - synchronous murmur3 content-hash dedupe (no state emit on identical payloads)
//   - synchronous-ness of the hash (no crypto.subtle present in the source)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyFetchError, createPollLoop, murmur3_32 } from '../../src/ui/primitives/use-poll.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USE_POLL_SRC = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-poll.ts');

function makeMockScheduler() {
  let nextHandle = 1;
  const pending = new Map(); // handle → { cb, ms }
  const calls = [];
  return {
    setTimeoutImpl(cb, ms) {
      const h = nextHandle++;
      pending.set(h, { cb, ms });
      calls.push({ kind: 'set', h, ms });
      return h;
    },
    clearTimeoutImpl(h) {
      pending.delete(h);
      calls.push({ kind: 'clear', h });
    },
    /** Drain all currently-pending timers in insertion order. */
    drain() {
      // Snapshot keys; the callbacks may schedule new timers we don't drain in this pass.
      const handles = Array.from(pending.keys());
      for (const h of handles) {
        const entry = pending.get(h);
        if (entry) {
          pending.delete(h);
          entry.cb();
        }
      }
    },
    pending: () => pending,
    calls: () => calls,
    setCalls: () => calls.filter((c) => c.kind === 'set'),
  };
}

test('PLUGIN_DISABLED terminal stop — after fetcher rejects with code: PLUGIN_DISABLED, no further setTimeout scheduled across 5 manual ticks', async () => {
  const sched = makeMockScheduler();
  let callCount = 0;
  const loop = createPollLoop({
    key: 'test',
    intervalMs: 100,
    fetcher: async () => {
      callCount += 1;
      const err = new Error('disabled');
      err.code = 'PLUGIN_DISABLED';
      throw err;
    },
    setTimeoutImpl: sched.setTimeoutImpl,
    clearTimeoutImpl: sched.clearTimeoutImpl,
    visibilityState: () => 'visible',
  });

  // Drive a single tick directly — start() would schedule(0) and drain()
  // would invoke the tick, but calling loop.tick() afterward would double-
  // fire the fetcher. The pure tick() invocation is sufficient to exercise
  // the state machine.
  await loop.tick();

  const setCountAtFailure = sched.setCalls().length;
  // Drive 5 more "ticks" simulating later setTimeout fires (none should be there).
  for (let i = 0; i < 5; i += 1) sched.drain();

  assert.equal(callCount, 1, 'fetcher called exactly once before PLUGIN_DISABLED terminal');
  const snapshot = loop.snapshot();
  assert.equal(snapshot.stopped, true, 'loop must be stopped after PLUGIN_DISABLED');
  assert.equal(snapshot.error?.kind, 'PLUGIN_DISABLED');
  // No new setTimeout calls beyond what was queued at failure time.
  assert.equal(
    sched.setCalls().length,
    setCountAtFailure,
    'no further setTimeout scheduled after PLUGIN_DISABLED',
  );
});

test('WORKER_UNAVAILABLE transient backoff — next setTimeout fires at intervalMs * 2 after one WORKER_UNAVAILABLE rejection', async () => {
  const sched = makeMockScheduler();
  let callCount = 0;
  const loop = createPollLoop({
    key: 'test',
    intervalMs: 100,
    fetcher: async () => {
      callCount += 1;
      const err = new Error('worker down');
      err.code = 'WORKER_UNAVAILABLE';
      throw err;
    },
    setTimeoutImpl: sched.setTimeoutImpl,
    clearTimeoutImpl: sched.clearTimeoutImpl,
    visibilityState: () => 'visible',
  });

  // Drive a single tick directly so backoff = intervalMs * 2 (not * 4).
  await loop.tick(); // fetcher rejects with WORKER_UNAVAILABLE → backoff schedule

  const lastSet = sched.setCalls().at(-1);
  assert.ok(lastSet, 'at least one schedule call must have happened');
  assert.equal(lastSet.ms, 200, 'next delay must be intervalMs * 2 (exponential backoff)');
  const snapshot = loop.snapshot();
  assert.equal(snapshot.stopped, false, 'loop must NOT be stopped for transient failure');
  assert.equal(snapshot.error?.kind, 'WORKER_UNAVAILABLE');
});

test('Content-hash dedupe — two consecutive fetches returning the same payload emit only ONE state change', async () => {
  const sched = makeMockScheduler();
  let stateChanges = 0;
  const fixed = { id: 'BEAAA-1', count: 42 };
  const loop = createPollLoop({
    key: 'test',
    intervalMs: 100,
    fetcher: async () => fixed,
    setTimeoutImpl: sched.setTimeoutImpl,
    clearTimeoutImpl: sched.clearTimeoutImpl,
    visibilityState: () => 'visible',
    onStateChange: () => {
      stateChanges += 1;
    },
  });

  await loop.tick(); // first fetch — emits
  await loop.tick(); // second fetch (same hash) — does NOT emit
  await loop.tick(); // third fetch (same hash) — does NOT emit

  assert.equal(stateChanges, 1, `expected exactly one state change; got ${stateChanges}`);
});

test('Visibility guard — pauseOnHidden=true (default) skips fetcher invocation when document is hidden', async () => {
  const sched = makeMockScheduler();
  let callCount = 0;
  let isHidden = true;
  const loop = createPollLoop({
    key: 'test',
    intervalMs: 100,
    fetcher: async () => {
      callCount += 1;
      return { ok: true };
    },
    setTimeoutImpl: sched.setTimeoutImpl,
    clearTimeoutImpl: sched.clearTimeoutImpl,
    visibilityState: () => (isHidden ? 'hidden' : 'visible'),
  });

  await loop.tick();
  assert.equal(callCount, 0, 'fetcher must NOT run when visibility is hidden');

  // Flip to visible and run again — fetcher should now fire.
  isHidden = false;
  await loop.tick();
  assert.equal(callCount, 1, 'fetcher runs when visible');
});

test('classifyFetchError — HTTP 404 maps to PLUGIN_DISABLED, 503 maps to WORKER_UNAVAILABLE, AbortError maps to TIMEOUT, unknown maps to UNKNOWN', () => {
  assert.equal(classifyFetchError({ status: 404 }).kind, 'PLUGIN_DISABLED');
  assert.equal(classifyFetchError({ status: 503 }).kind, 'WORKER_UNAVAILABLE');
  assert.equal(classifyFetchError({ status: 502 }).kind, 'WORKER_UNAVAILABLE');
  assert.equal(classifyFetchError({ name: 'AbortError', message: 'aborted' }).kind, 'TIMEOUT');
  assert.equal(classifyFetchError({ message: 'something exploded' }).kind, 'UNKNOWN');
  assert.equal(classifyFetchError({ code: 'PLUGIN_DISABLED' }).kind, 'PLUGIN_DISABLED');
  assert.equal(classifyFetchError({ code: 'WORKER_UNAVAILABLE' }).kind, 'WORKER_UNAVAILABLE');
});

test('murmur3_32 is deterministic and synchronous', () => {
  // Synchronous: no Promise involved. Same input → same output bytes.
  const a = murmur3_32('hello');
  const b = murmur3_32('hello');
  const c = murmur3_32('world');
  assert.equal(typeof a, 'string');
  assert.equal(a.length, 8, '32-bit hash rendered as 8-char hex');
  assert.equal(a, b, 'deterministic');
  assert.notEqual(a, c, 'different inputs produce different hashes');
});

test('use-poll.ts source contains synchronous murmur3 implementation and zero crypto.subtle references', () => {
  const src = readFileSync(USE_POLL_SRC, 'utf8');
  assert.match(src, /function murmur3_32/, 'use-poll must inline a synchronous murmur3_32');
  assert.equal(
    /crypto\.subtle/.test(src),
    false,
    'use-poll must NOT use crypto.subtle — it is async and races with the next tick (PITFALLS.md #7)',
  );
  assert.match(src, /PLUGIN_DISABLED/, 'use-poll must reference PLUGIN_DISABLED for the terminal-stop branch');
  assert.match(src, /stopped\s*=\s*true/, 'use-poll must set stopped=true on PLUGIN_DISABLED');
});
