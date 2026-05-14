// src/ui/surfaces/situation-room/index.tsx
//
// Plan 02-04 Task 2 — Situation Room page (ROOM-01..08).
//
// Renders the agent grid (one card per Paperclip employee), Critical Path
// strip, Awaiting-You inbox pill, and Artifacts Shipped Today shelf — all
// served from the 60s materialized snapshot. Polling is leader-elected via
// BroadcastChannel (ROOM-07): only one tab in the browser fetches; followers
// receive the leader's payload via postMessage. Visibility-paused (ROOM-06).
//
// Cadence is configurable via instanceConfigSchema.situationRefreshIntervalMs
// (D-03), read by the useInstanceConfig FALLBACK wrapper (per 02-01 Check F).
//
// Opt-in gated (OPTIN-02) — opted-out users see <EnableClarityCta />.
//
// Visual fidelity target: sketches/paperclip-fix-situation-room.html.

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  useHostContext,
} from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useInstanceConfig } from '../../primitives/use-instance-config.ts';
import { usePollWithLeader } from '../../primitives/use-poll-with-leader.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { PauseBanner } from '../reader/pause-banner.tsx';
import { CriticalPathStrip } from './critical-path-strip.tsx';
import { AgentCard, type AgentEmployee } from './agent-card.tsx';
import { AwaitingYouPill } from './awaiting-you-pill.tsx';
import { ArtifactsShippedShelf } from './artifacts-shipped-shelf.tsx';

import type { BlockerChainResult } from '../../../shared/types.ts';

type SituationData = {
  employees: AgentEmployee[];
  critical_path: BlockerChainResult[];
  artifacts_shipped_today: unknown[];
  awaiting_you_count: number;
  awaiting_you_oldest_age: number | null;
  narrative?: string | null;
  taken_at?: string;
};

function generateTabId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2);
}

export function SituationRoom(_props?: PluginPageProps): React.ReactElement {
  // OPTIN-02 — gate BEFORE companyId resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <EnableClarityCta surfaceName="Situation Room" />
      </ClaritySurfaceRoot>
    );
  }
  return <SituationRoomOptedIn />;
}

function SituationRoomOptedIn(): React.ReactElement {
  const { userId } = useHostContext();
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const config = useInstanceConfig();
  const intervalMs = config.situationRefreshIntervalMs ?? 60_000;

  // Stable tab id per mount.
  const tabIdRef = React.useRef<string>(generateTabId());
  const pingAction = usePluginAction('situation.active-viewer-ping');

  // ROOM-05 active-viewer heartbeat — fire on mount + on every interval tick.
  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const ping = (): void => {
      if (cancelled) return;
      void pingAction({ userId, tabId: tabIdRef.current }).catch(() => {
        // Swallow — the snapshot job degrades to no-op when no recent viewers.
      });
    };
    ping();
    const interval = setInterval(ping, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId, pingAction, intervalMs]);

  // Resolver in flight.
  if (companyLoading) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-loading">Resolving company context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError === 'no-company-context' || !companyId) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-error" data-clarity-error="no-company-context">
          Situation Room unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="situation-room">
      <SituationRoomBody
        companyId={companyId}
        userId={userId ?? ''}
        intervalMs={intervalMs}
      />
      <PauseBanner />
    </ClaritySurfaceRoot>
  );
}

function SituationRoomBody({
  companyId,
  userId,
  intervalMs,
}: {
  companyId: string;
  userId: string;
  intervalMs: number;
}): React.ReactElement {
  // The actual snapshot fetch is via usePluginData (SDK-blessed bridge call).
  // usePluginData re-fetches when params change; we let it own the network
  // round-trip + cache key. The leader-election guard lives in
  // usePollWithLeader, which we use below as a coordination side-channel so
  // followers receive the leader's payload via BroadcastChannel postMessage
  // (ROOM-07). This composition means:
  //   - Every tab calls usePluginData → host bridge dedupes per (key, params)
  //   - usePollWithLeader's leader.broadcast() echoes the leader's data to
  //     followers, so a follower's UI updates immediately without waiting for
  //     its own usePluginData refetch.
  // The redundancy is intentional belt-and-suspenders; future v2 may switch
  // to a single-source via usePoll once the SDK exposes a non-hook fetcher.
  const { data: snapshotData } = usePluginData<SituationData | { error: 'OPT_IN_REQUIRED' } | null>(
    'situation.snapshot',
    { userId, companyId },
  );

  // usePollWithLeader is referenced primarily for its leader-election +
  // follower-broadcast bridge — its fetcher is a thin pass-through that
  // mirrors snapshotData so followers also receive the data via the channel.
  const followerBridge = usePollWithLeader<SituationData | null>({
    key: 'situation.snapshot',
    fetcher: async () => (snapshotData as SituationData | null) ?? null,
    intervalMs,
    pauseOnHidden: true,
  });

  // Belt-and-suspenders: opt-in error from the worker is also handled here.
  if (
    snapshotData &&
    typeof snapshotData === 'object' &&
    (snapshotData as { error?: string }).error === 'OPT_IN_REQUIRED'
  ) {
    return <EnableClarityCta surfaceName="Situation Room" />;
  }

  if (followerBridge.error?.kind === 'PLUGIN_DISABLED') {
    return (
      <p className="clarity-room-error">
        Plugin disabled. Reload after re-enabling.
      </p>
    );
  }

  const payload = ((snapshotData as SituationData | null) ?? followerBridge.data ?? null);
  if (!payload) {
    return <p className="clarity-room-loading">Recomputing…</p>;
  }
  return (
    <>
      <header className="clarity-room-header">
        <AwaitingYouPill
          count={payload.awaiting_you_count ?? 0}
          oldestAge={payload.awaiting_you_oldest_age ?? null}
        />
      </header>
      <CriticalPathStrip
        chains={payload.critical_path ?? []}
        narrative={payload.narrative ?? null}
      />
      <div className="clarity-agent-grid">
        {(payload.employees ?? []).map((emp) => (
          <AgentCard key={emp.userId} employee={emp} />
        ))}
      </div>
      <ArtifactsShippedShelf items={payload.artifacts_shipped_today ?? []} />
    </>
  );
}
