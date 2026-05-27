// src/ui/surfaces/situation-room/agent-card.tsx
//
// Plan 02-04 Task 2 — ROOM-01 one card per Paperclip employee. Renders:
//   - role + StatePill (state + age)
//   - "now doing" line
//   - inline ArtifactChipRow (Plan 06.1-03 / ROOM-10 — REPLACES Phase 2
//     bottom shelf; D-02). Renders nothing when the per-agent artifact
//     window is empty.
//   - blocker-chain terminal (one typed terminal kind — PRIM-05)
//   - 7-day velocity sparkline
//
// Plan 06.1-03 / UI-SPEC §Visual Hierarchy Lock — composition order:
//   1. clarity-agent-card-header (unchanged)
//   2. clarity-now-doing (unchanged)
//   3. clarity-artifact-chip-row (NEW; renders only when non-empty)
//   4. clarity-agent-terminal (unchanged)
//   5. (DEPRECATED — removed) clarity-agent-artifact placeholder
//   6. clarity-sparkline (unchanged)
//
// Plan 06.1-08 / 06.1-09 / 06.1-10 (state-aware terminal block + Take-
// Responsibility button) — three composed concerns:
//
//   A) Idle agents (no blocker edges, chain.pathIds.length === 1):
//      The chain terminates trivially with HUMAN_ACTION_ON.__unowned__
//      via the blocker-chain.ts:178 fallback, but there's no actual
//      blocker. Pre-Plan-06.1-10 the card rendered "HUMAN ACTION ON /
//      X has no owner assigned" — false signal, no rabbit-holes
//      semantics, surfaces noise. New behavior: render "No blockers"
//      in a quieter style; suppress the "HUMAN ACTION ON" chip.
//
//   B) Blocked + unclaimed (HUMAN_ACTION_ON.__unowned__ with real edges):
//      Render body as "Nobody is handling [role]'s blockers" — voice-
//      aligned with the "Take responsibility" affordance (Plan 06.1-08
//      language polish). The worker's terminal.label is overridden
//      here because the Critical Path strip's voice ("Awaiting action:
//      ... has no owner assigned") doesn't compose naturally on the
//      agent card where the user is being asked to assume responsibility.
//
//   C) Take-Responsibility button (Plan 06.1-09 — ROOM-09 UI tier):
//      Conditional on terminal.kind === 'HUMAN_ACTION_ON' &&
//      terminal.userId === '__unowned__'. Shown on BOTH idle and
//      blocked unclaimed states (operator's Plan 06.1-10 decision
//      "option b" — proactive claim). Dispatches the same
//      agent.takeOwnership action handler the Critical Path button
//      uses (Plan 06.1-01 worker tier), keyed on employee.agentId
//      (Plan 06.1-09 — the canonical id that the snapshot job's
//      ownerMap consults; see EmployeeSnapshot.agentId docstring in
//      situation-snapshot.ts:52).
//
// Visual fidelity target: sketches/paperclip-fix-situation-room.html agent cards.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { StatePill, type StatePillState } from '../../primitives/state-pill.tsx';
import { formatAge, humaniseState } from '../../primitives/state-pill-format.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useToast } from '../../primitives/toast.tsx';
import type { BlockerChainResult } from '../../../shared/types.ts';
import { Sparkline } from './sparkline.tsx';
import { ArtifactChipRow, type Artifact } from './artifact-chip-row.tsx';

/** D-13 — locked sentinel for an unowned HUMAN_ACTION_ON terminal. */
const UNOWNED_SENTINEL = '__unowned__';

export type AgentEmployee = {
  userId: string;
  // Phase 6.1 HOTFIX (Plan 06.1-09) -- canonical agent id for ownership
  // dispatch. Falls back to userId for backward compat with pre-06.1-09
  // payloads / tests.
  agentId?: string;
  role: string;
  state: string;
  age_ms: number;
  now_doing: string | null;
  blocker_chain: BlockerChainResult;
  latest_artifact: unknown | null;
  velocity_7d: number[];
};

const STATE_FALLBACK: StatePillState = 'Standby';

function normaliseState(raw: string): StatePillState {
  switch (raw) {
    case 'Working':
    case 'Stuck':
    case 'AwaitingYou':
    case 'Standby':
    case 'AwaitingPeer':
      return raw;
    default:
      return STATE_FALLBACK;
  }
}

/**
 * Plan 02-08 Task 2 (DEV-12) — when now_doing is null, derive a fallback line
 * from state + age so the card body never renders empty. Phase 3's
 * Editor-Agent prose pass will eventually fill this with richer text; until
 * then, "Standby — idle 2m" / "Working for 5m" is better than nothing.
 */
function nowDoingFallback(employee: AgentEmployee): string {
  if (employee.now_doing) return employee.now_doing;
  const state = normaliseState(employee.state);
  const age = formatAge(employee.age_ms);
  if (state === 'Standby') {
    return `Standby — idle ${age}`;
  }
  return `${humaniseState(state)} for ${age}`;
}

export function AgentCard({
  employee,
  artifacts,
  companyId,
  userId,
  onTakeOwnershipSuccess,
}: {
  employee: AgentEmployee;
  /** Plan 06.1-03 / ROOM-10 — per-agent artifact union from
   *  `usePluginData('situation.artifacts')`. Empty array → ArtifactChipRow
   *  returns null and no DOM is emitted (D-02). Optional for backward
   *  compatibility with non-Phase-6.1 call sites + tests. */
  artifacts?: Artifact[];
  /** Plan 06.1-03 — threaded through to the AttachmentChipWithPreview
   *  popover that the chip click opens. Optional for back-compat. */
  companyId?: string;
  userId?: string;
  /** Plan 06.1-09 — called after a successful Take-Responsibility claim
   *  so the parent can force-refetch the situation.snapshot query. */
  onTakeOwnershipSuccess?: () => void;
}): React.ReactElement {
  const state = normaliseState(employee.state);
  const terminal = employee.blocker_chain?.terminal;
  const pathLength = employee.blocker_chain?.pathIds?.length ?? 0;
  const nowDoingText = nowDoingFallback(employee);

  // Plan 06.1-10 — degenerate chain (no edges) means the agent has no
  // active blockers, even though blocker-chain.ts:178 falls back to
  // HUMAN_ACTION_ON.__unowned__ for the chain start node. Use pathIds
  // length as the source of truth: length === 1 means the walk visited
  // only the start node, no edges traversed.
  const hasBlockers = pathLength > 1;

  // Plan 06.1-09 — Take-Responsibility button visibility. Renders on
  // HUMAN_ACTION_ON.__unowned__ terminals regardless of whether there
  // are active blockers (operator's Plan 06.1-10 option b: pre-designate
  // responsibility so future escalations route correctly).
  const isUnclaimed =
    terminal?.kind === 'HUMAN_ACTION_ON' && terminal.userId === UNOWNED_SENTINEL;

  // Take-Ownership dispatch wiring (mirrors critical-path-strip.tsx).
  const viewerUserId = useResolvedUserId();
  const { showToast } = useToast();
  const takeOwnership = usePluginAction('agent.takeOwnership');
  const [claiming, setClaiming] = React.useState(false);
  const takeOwnershipDisabled = !viewerUserId || claiming;
  const agentIdForOwnership = employee.agentId ?? employee.userId;

  const onClaim = React.useCallback(async () => {
    if (!viewerUserId || claiming) return;
    if (!agentIdForOwnership || agentIdForOwnership === UNOWNED_SENTINEL) return;
    setClaiming(true);
    try {
      const result = (await takeOwnership({
        companyId: companyId ?? '',
        agentId: agentIdForOwnership,
        ownerUserId: viewerUserId,
        userId: viewerUserId,
      })) as { ok?: boolean; error?: string } | null;
      if (result && result.ok) {
        showToast({ message: 'Responsibility taken' });
        if (onTakeOwnershipSuccess) onTakeOwnershipSuccess();
      } else {
        showToast({ message: 'Could not take responsibility — try again' });
      }
    } catch {
      showToast({ message: 'Could not take responsibility — try again' });
    } finally {
      setClaiming(false);
    }
  }, [
    viewerUserId,
    claiming,
    agentIdForOwnership,
    takeOwnership,
    companyId,
    showToast,
    onTakeOwnershipSuccess,
  ]);

  // Terminal block rendering — three states per Plan 06.1-08/10.
  let terminalBlock: React.ReactElement | null = null;
  if (!terminal) {
    terminalBlock = null;
  } else if (!hasBlockers) {
    // Plan 06.1-10 — idle: no blocker edges. Render quiet "No blockers"
    // body without the "HUMAN ACTION ON" chip (no action is needed).
    terminalBlock = (
      <p className="clarity-agent-terminal clarity-agent-terminal-idle" data-terminal-kind="IDLE">
        <span className="clarity-agent-terminal-label">No blockers</span>
      </p>
    );
  } else if (isUnclaimed) {
    // Plan 06.1-08 — blocked + unclaimed. Override the worker's
    // "X has no owner assigned" label with the voice-aligned body
    // that matches the Take-Responsibility button.
    terminalBlock = (
      <p className="clarity-agent-terminal" data-terminal-kind={terminal.kind}>
        <span className="clarity-agent-terminal-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        <span className="clarity-agent-terminal-label">{`Nobody is handling ${employee.role}'s blockers`}</span>
      </p>
    );
  } else {
    // Default: existing rendering. Covers claimed HUMAN_ACTION_ON
    // (with humanize-snapshot's "You to act on CEO" rewrite),
    // SELF_RESOLVING, EXTERNAL, CYCLE.
    terminalBlock = (
      <p className="clarity-agent-terminal" data-terminal-kind={terminal.kind}>
        <span className="clarity-agent-terminal-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        <span className="clarity-agent-terminal-label">{terminal.label}</span>
      </p>
    );
  }

  return (
    <div className="clarity-agent-card" data-clarity-region="agent-card">
      <header className="clarity-agent-card-header">
        <span className="clarity-agent-role">{employee.role}</span>
        <StatePill state={state} age={employee.age_ms} />
      </header>
      <p className="clarity-now-doing">{nowDoingText}</p>
      <ArtifactChipRow
        artifacts={artifacts ?? []}
        agentRole={employee.role}
        companyId={companyId ?? ''}
        userId={userId ?? ''}
      />
      {terminalBlock}
      {isUnclaimed ? (
        <button
          type="button"
          className="clarity-take-ownership-btn"
          onClick={onClaim}
          disabled={takeOwnershipDisabled}
          aria-busy={claiming || undefined}
          title={viewerUserId ? undefined : 'Sign in to claim ownership'}
        >
          {claiming ? 'Taking responsibility…' : 'Take responsibility'}
        </button>
      ) : null}
      <Sparkline values={employee.velocity_7d} />
    </div>
  );
}
