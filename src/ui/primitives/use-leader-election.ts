// src/ui/primitives/use-leader-election.ts
//
// Plan 02-04 Task 2 — BroadcastChannel-based leader election among Situation
// Room tabs in the same browser. Wraps usePoll's fetcher so only the leader
// tab issues network requests; followers receive the leader's payload via
// postMessage (see use-poll-with-leader.ts).
//
// Algorithm: every tab generates a UUID at mount; broadcasts an 'announce'
// every 10s; the lowest UUID currently observed wins. Re-announce loop runs
// until the leader's tab closes, after which the next election picks the
// surviving tab with the lowest UUID.
//
// Fallback: if BroadcastChannel is undefined (older browser, JSDOM, embedded
// context) the hook returns {isLeader: true, available: false} so the tab
// falls back to per-tab polling — with a console.warn that the thundering-
// herd guard is off.

import * as React from 'react';

export type LeaderElectionResult = {
  isLeader: boolean;
  available: boolean;
};

const RE_ANNOUNCE_INTERVAL_MS = 10_000;

export function useLeaderElection({
  channelName,
}: {
  channelName: string;
}): LeaderElectionResult {
  const available = typeof BroadcastChannel !== 'undefined';
  const [isLeader, setIsLeader] = React.useState<boolean>(!available);

  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn(
        '[clarity-pack] BroadcastChannel unavailable — Situation Room falls back to per-tab polling. ' +
          'Thundering-herd guard is off; multiple open tabs will each fetch independently.',
      );
      return;
    }
    const channel = new BroadcastChannel(channelName);
    const me = generateId();
    let leaderId: string = me;

    const election = (): void => {
      channel.postMessage({ kind: 'announce', id: me });
    };

    channel.onmessage = (e: MessageEvent): void => {
      const data = e.data as { kind?: string; id?: string };
      if (data?.kind === 'announce' && typeof data.id === 'string') {
        if (data.id < leaderId) {
          leaderId = data.id;
        }
        // Respond so the new tab learns the current leader id.
        channel.postMessage({ kind: 'leader-response', id: leaderId });
      } else if (data?.kind === 'leader-response' && typeof data.id === 'string') {
        if (data.id < leaderId) {
          leaderId = data.id;
        }
      }
      setIsLeader(leaderId === me);
    };

    election();
    setIsLeader(leaderId === me);
    const interval = setInterval(election, RE_ANNOUNCE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      channel.close();
    };
  }, [channelName]);

  return { isLeader, available };
}

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the Math.random path.
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
