// src/ui/surfaces/situation-room/index.tsx
//
// Plan 09-02 — the actionable cockpit. ONE three-group people view (Needs you /
// Working / Idle, always all three per D-03), fed solely by situation_employees
// + the worker `group` field (R2). Every surfaced action performs or is absent
// (R4). Assign owner / Stand down / Resume force-refetch the snapshot so the
// row visibly re-groups (the mockup's live behavior).
//
// REMOVED in this plan (R1 + BLOCKER 1):
//   - the dead AgentCard grid (payload.employees, fed by the dead recompute job)
//   - the usePluginData('situation.artifacts') fetch + artifactsByAgent map
//   - the situation.artifacts WORKER handler (deleted ATOMICALLY in this same
//     commit — see Task 2: src/worker/handlers/situation-artifacts.ts +
//     src/worker.ts registration are removed alongside this UI caller, so no
//     wave-gap exists where the UI calls a removed handler)
//   - the standalone <OrgBlockedBacklogBanner>, <CriticalPathStrip>, and
//     <AwaitingYouPill> mounts — org-backlog + critical-path are now ONE
//     "+N more blocked issues" expander at the end of Needs-you (R6).
//
// Opt-in gated (OPTIN-02). Leader-elected polling preserved (ROOM-07). Cadence
// configurable via instanceConfigSchema.situationRefreshIntervalMs (D-03).

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  useHostContext,
  useHostLocation,
  useHostNavigation,
} from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { ClaritySurfaceHeader } from '../../primitives/clarity-surface-header.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useInstanceConfig } from '../../primitives/use-instance-config.ts';
import { usePollWithLeader } from '../../primitives/use-poll-with-leader.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { PauseBanner } from '../reader/pause-banner.tsx';
// Phase 9 (Plan 09-02) — the people-first cockpit: un-frozen needs-you banner +
// the grouped (Needs you / Working / Idle) row strip. The flat strip, the dead
// AgentCard grid, the org-backlog banner, the critical-path strip, and the
// awaiting-you pill are all gone (R1 / R6).
import { NeedsYouBanner, type NeedsYou } from './needs-you-banner.tsx';
import { EmployeeRowStrip } from './employee-row-strip.tsx';
import type { SituationEmployeeRow } from './employee-row.tsx';
import type { OrgBlockedBacklog } from './org-blocked-backlog-banner-types.ts';

import type { BlockerChainResult } from '../../../shared/types.ts';

type SituationData = {
  // Plan 09-01 (Phase 8/9) — the per-employee rollup, each row carrying its
  // worker-assigned `group` (R2) + `isPaused` (D-04). This is the SOLE feed for
  // the three-group people view.
  situation_employees?: SituationEmployeeRow[];
  needsYou?: NeedsYou;
  // Plan 07-03 — the org-level blocked backlog; folded into the Needs-you
  // expander (R6). critical_path's narrative is folded into the same expander.
  org_blocked_backlog?: OrgBlockedBacklog | null;
  critical_path?: BlockerChainResult[];
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
      {/* Plan 05-08 (D-17) — shared `+ Create task` header. */}
      <ClaritySurfaceHeader
        companyId={companyId}
        userId={userId ?? ''}
        surface="situation-room"
      />
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
  // Plan 09-02 — refreshKey is bumped by a successful situation.assignOwner /
  // stand-down / resume (onAssignSuccess). Bumping it forces
  // usePluginData('situation.snapshot') to refetch so the row re-groups (the
  // mockup's "jumps into Working" live behavior). Same force-refetch idiom as
  // Chat's index.tsx (Plan 05-08 D-20).
  const [refreshKey, setRefreshKey] = React.useState(0);
  const forceRefetch = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Plan 08-02 — companyPrefix + navigate for the grouped strip + banner
  // (open-chat / open-issue / assign-work deep links reuse the employee-only
  // buildChatDeepLink carrier).
  const { pathname } = useHostLocation();
  const { navigate } = useHostNavigation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  // The snapshot fetch (SDK-blessed bridge call). usePollWithLeader is the
  // leader-election + follower-broadcast side-channel (ROOM-07); usePluginData
  // owns the network round-trip + cache key.
  const { data: snapshotData } = usePluginData<SituationData | { error: 'OPT_IN_REQUIRED' } | null>(
    'situation.snapshot',
    { userId, companyId, _refreshKey: refreshKey },
  );

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

  const employees = payload.situation_employees ?? [];

  return (
    <>
      {/* Plan 09-02 — un-frozen banner (R5): urgent + Assign-first picker for the
       *  unowned case, chat deep-link for the all-owned case, neutral only when
       *  count is genuinely 0. */}
      <NeedsYouBanner
        needsYou={payload.needsYou ?? { count: 0, topAction: null }}
        employees={employees}
        companyPrefix={companyPrefix}
        navigate={navigate}
      />
      {/* Plan 09-02 — the ONE three-group people view (D-03). The org-backlog +
       *  critical-path expander (R6) lives at the end of Needs-you, rendered by
       *  the strip. onAssignSuccess threads forceRefetch so a row re-groups
       *  live after an assign/stand-down/resume. */}
      <EmployeeRowStrip
        employees={employees}
        companyPrefix={companyPrefix}
        companyId={companyId}
        userId={userId}
        navigate={navigate}
        onAssignSuccess={forceRefetch}
        orgBacklog={payload.org_blocked_backlog ?? null}
        criticalPathNarrative={payload.narrative ?? null}
      />
    </>
  );
}
