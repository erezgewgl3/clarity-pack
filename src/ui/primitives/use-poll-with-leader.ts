// src/ui/primitives/use-poll-with-leader.ts
//
// Plan 02-04 Task 2 — wraps usePoll + useLeaderElection so only the leader
// tab actually fetches; followers consume the leader's broadcast payload via
// BroadcastChannel.postMessage (the revision iteration 2 warning #2
// "follower-receives-leader-data within 1000ms" acceptance assertion).
//
// The pure broadcast helper `createLeaderBroadcast` is exported separately so
// the two-tab contract can be tested without React. It accepts an injected
// BroadcastChannelCtor so tests can pass an in-memory mock bus.

import * as React from 'react';

import { usePoll, type PollError } from './use-poll.ts';
import { useLeaderElection } from './use-leader-election.ts';

export type UsePollWithLeaderOptions<T> = {
  key: string;
  fetcher: () => Promise<T>;
  intervalMs: number;
  pauseOnHidden?: boolean;
};

export type UsePollWithLeaderResult<T> = {
  data: T | null;
  error: PollError | null;
  stale: boolean;
  isLeader: boolean;
};

type BroadcastChannelLike = {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type BroadcastChannelCtor = new (name: string) => BroadcastChannelLike;

export type LeaderBroadcast<T> = {
  broadcast(payload: T): void;
  broadcastError(error: PollError): void;
  onData(handler: (payload: T) => void): void;
  onError(handler: (error: PollError) => void): void;
  cleanup(): void;
};

/**
 * Pure orchestration helper: wraps a BroadcastChannel (or compatible) and
 * exposes a leader/follower API. The leader calls broadcast(); followers'
 * onData() handlers fire. Tests inject a mock channel class.
 */
export function createLeaderBroadcast<T>({
  channelName,
  isLeader,
  BroadcastChannelCtor,
}: {
  channelName: string;
  isLeader: boolean;
  BroadcastChannelCtor: BroadcastChannelCtor | undefined;
}): LeaderBroadcast<T> {
  if (!BroadcastChannelCtor) {
    // No-op shape — broadcast() is dropped on the floor; onData() never fires.
    return {
      broadcast() {},
      broadcastError() {},
      onData() {},
      onError() {},
      cleanup() {},
    };
  }
  const channel = new BroadcastChannelCtor(channelName);
  let dataHandler: ((payload: T) => void) | null = null;
  let errorHandler: ((error: PollError) => void) | null = null;
  channel.onmessage = (event: { data: unknown }) => {
    const data = event.data as { kind?: string; payload?: T; error?: PollError };
    if (data?.kind === 'leader-data' && dataHandler) {
      dataHandler(data.payload as T);
    } else if (data?.kind === 'leader-error' && errorHandler) {
      errorHandler(data.error as PollError);
    }
  };
  return {
    broadcast(payload: T): void {
      if (!isLeader) return;
      channel.postMessage({ kind: 'leader-data', payload });
    },
    broadcastError(error: PollError): void {
      if (!isLeader) return;
      channel.postMessage({ kind: 'leader-error', error });
    },
    onData(handler: (payload: T) => void): void {
      dataHandler = handler;
    },
    onError(handler: (error: PollError) => void): void {
      errorHandler = handler;
    },
    cleanup(): void {
      channel.close();
    },
  };
}

export function usePollWithLeader<T>(
  opts: UsePollWithLeaderOptions<T>,
): UsePollWithLeaderResult<T> {
  const channelName = `clarity-${opts.key}`;
  const { isLeader, available } = useLeaderElection({ channelName });

  // Leader runs the real fetcher; followers get a no-op fetcher (no requests).
  // The pause-on-hidden flag continues to apply for the leader.
  const polled = usePoll<T | null>({
    key: opts.key,
    fetcher: isLeader || !available ? opts.fetcher : async () => null,
    intervalMs: opts.intervalMs,
    pauseOnHidden: opts.pauseOnHidden,
  });

  const [followerData, setFollowerData] = React.useState<T | null>(null);
  const [followerError, setFollowerError] = React.useState<PollError | null>(null);

  // Follower subscribes to leader-data broadcasts.
  React.useEffect(() => {
    if (!available || isLeader) return;
    const BroadcastChannelCtor =
      typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : undefined;
    if (!BroadcastChannelCtor) return;
    const bridge = createLeaderBroadcast<T>({
      channelName,
      isLeader: false,
      BroadcastChannelCtor: BroadcastChannelCtor as unknown as BroadcastChannelCtor,
    });
    bridge.onData((payload) => setFollowerData(payload));
    bridge.onError((error) => setFollowerError(error));
    return () => bridge.cleanup();
  }, [channelName, available, isLeader]);

  // Leader broadcasts its latest payload to followers.
  React.useEffect(() => {
    if (!available || !isLeader) return;
    const BroadcastChannelCtor =
      typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : undefined;
    if (!BroadcastChannelCtor) return;
    const bridge = createLeaderBroadcast<T>({
      channelName,
      isLeader: true,
      BroadcastChannelCtor: BroadcastChannelCtor as unknown as BroadcastChannelCtor,
    });
    if (polled.data !== null) bridge.broadcast(polled.data as T);
    if (polled.error !== null) bridge.broadcastError(polled.error);
    return () => bridge.cleanup();
  }, [polled.data, polled.error, channelName, available, isLeader]);

  return {
    data: isLeader || !available ? (polled.data as T | null) : followerData,
    error: isLeader || !available ? polled.error : followerError,
    stale: polled.stale,
    isLeader,
  };
}
