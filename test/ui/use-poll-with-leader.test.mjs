// test/ui/use-poll-with-leader.test.mjs
//
// Plan 02-04 Task 2 RED — usePollWithLeader follower postMessage bridge
// (revision iteration 2 warning #2 acceptance assertion).
//
// PRIMARY contract: with two mounted hook instances sharing a mocked
// BroadcastChannel, after the leader (tab A) fetches snapshot at simulated
// t=0, the follower (tab B) receives the same data via
// BroadcastChannel.postMessage within 1000ms.
//
// SECONDARY:
//   - Follower's fetcher is NEVER called (spy count == 0)
//   - When leader unmounts, follower becomes leader on the next election
//   - Disabled-state pass-through: PLUGIN_DISABLED terminal stops both tabs
//
// Source-grep contracts:
//   - file exists at src/ui/primitives/use-poll-with-leader.ts
//   - postMessage with kind: 'leader-data' literal appears
//   - imports useLeaderElection
//
// Behavior tests: pure orchestration logic exported as createLeaderBroadcast
// (so we can verify the broadcast bridge deterministically without React).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createLeaderBroadcast } from '../../src/ui/primitives/use-poll-with-leader.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-poll-with-leader.ts');

// ---------------------------------------------------------------------------
// Source-grep contracts
// ---------------------------------------------------------------------------

test('use-poll-with-leader.ts exists', () => {
  assert.ok(existsSync(HOOK), `expected ${HOOK} to exist`);
});

test('use-poll-with-leader.ts contains literal kind: \'leader-data\' postMessage payload', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /kind:\s*['"]leader-data['"]/);
});

test('use-poll-with-leader.ts imports useLeaderElection', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /from\s+['"]\.\/use-leader-election/);
});

test('use-poll-with-leader.ts exports usePollWithLeader', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /export\s+function\s+usePollWithLeader\b/);
});

// ---------------------------------------------------------------------------
// Pure-helper behavior: createLeaderBroadcast — wraps a BroadcastChannel-like
// bus and exposes broadcast(payload) + subscribe(onData) so the two-tab
// follower-receives-leader-payload contract can be asserted without React.
// ---------------------------------------------------------------------------

// In-memory BroadcastChannel mock — both tabs share the same `bus`.
class MockChannelBus {
  constructor() {
    this.listeners = [];
  }
  attach(channel) {
    this.listeners.push(channel);
  }
  detach(channel) {
    this.listeners = this.listeners.filter((c) => c !== channel);
  }
  fanout(senderChannel, message) {
    for (const c of this.listeners) {
      if (c === senderChannel) continue;
      // Deliver async so the follower's onmessage runs after the leader's
      // postMessage returns (mirrors the real BroadcastChannel semantics).
      queueMicrotask(() => {
        if (typeof c.onmessage === 'function') c.onmessage({ data: message });
      });
    }
  }
}

function makeMockChannelClass(bus) {
  return class MockChannel {
    constructor(_name) {
      this.onmessage = null;
      bus.attach(this);
    }
    postMessage(message) {
      bus.fanout(this, message);
    }
    close() {
      bus.detach(this);
    }
  };
}

test('createLeaderBroadcast: leader broadcasts payload, follower receives it within 1000ms (acceptance)', async () => {
  const bus = new MockChannelBus();
  const ChannelCls = makeMockChannelClass(bus);
  const leader = createLeaderBroadcast({
    channelName: 'test',
    isLeader: true,
    BroadcastChannelCtor: ChannelCls,
  });
  const follower = createLeaderBroadcast({
    channelName: 'test',
    isLeader: false,
    BroadcastChannelCtor: ChannelCls,
  });
  let followerData = null;
  follower.onData((payload) => {
    followerData = payload;
  });
  // Simulate the leader fetching at t=0 and broadcasting.
  const leaderPayload = { ts: 't0', payload: { n: 1 } };
  leader.broadcast(leaderPayload);

  // Await one tick so the queued microtask fires.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(followerData, leaderPayload, 'follower must receive leader payload via BroadcastChannel');

  leader.cleanup();
  follower.cleanup();
});

test('createLeaderBroadcast: follower\'s onData is NOT invoked when isLeader (leader does not echo to itself)', async () => {
  const bus = new MockChannelBus();
  const ChannelCls = makeMockChannelClass(bus);
  const leader = createLeaderBroadcast({
    channelName: 'test2',
    isLeader: true,
    BroadcastChannelCtor: ChannelCls,
  });
  let leaderEcho = null;
  leader.onData((payload) => {
    leaderEcho = payload;
  });
  leader.broadcast({ ts: 't0', payload: { n: 1 } });
  await new Promise((r) => setTimeout(r, 50));
  // The MockChannelBus skips the sender, so even if leader.onData were wired
  // it should NOT receive its own message. The bridge contract: leader does
  // not consume its own broadcast.
  assert.equal(leaderEcho, null, 'leader does not see its own broadcast');
  leader.cleanup();
});

test('createLeaderBroadcast: error broadcast (PLUGIN_DISABLED) is propagated to followers', async () => {
  const bus = new MockChannelBus();
  const ChannelCls = makeMockChannelClass(bus);
  const leader = createLeaderBroadcast({
    channelName: 'test3',
    isLeader: true,
    BroadcastChannelCtor: ChannelCls,
  });
  const follower = createLeaderBroadcast({
    channelName: 'test3',
    isLeader: false,
    BroadcastChannelCtor: ChannelCls,
  });
  let followerError = null;
  follower.onError((err) => {
    followerError = err;
  });
  leader.broadcastError({ kind: 'PLUGIN_DISABLED' });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(followerError, { kind: 'PLUGIN_DISABLED' });
  leader.cleanup();
  follower.cleanup();
});

test('createLeaderBroadcast: unavailable BroadcastChannel returns a no-op shape', () => {
  // When the platform has no BroadcastChannel, the helper still returns a
  // valid object — broadcast() is a no-op, onData() never fires.
  const noop = createLeaderBroadcast({
    channelName: 'test4',
    isLeader: false,
    BroadcastChannelCtor: undefined,
  });
  let invoked = false;
  noop.onData(() => { invoked = true; });
  noop.broadcast({ ts: 't0' });
  // Even on error broadcast, follower never receives anything when no BC available.
  assert.equal(invoked, false);
  noop.cleanup();
});
