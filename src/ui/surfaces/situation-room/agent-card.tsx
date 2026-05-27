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
//      aligned with the engagement affordance (Plan 06.1-08 language
//      polish). The worker's terminal.label is overridden here because
//      the Critical Path strip's voice ("Awaiting action: ... has no
//      owner assigned") doesn't compose naturally on the agent card.
//
//   C) Open-chat button (Plan 06.1-11 — engagement entry point):
//      ALWAYS rendered. The agent card is the dashboard view; chat is
//      the engagement surface. Clicking writes the side-table
//      ownership row as a fire-and-forget side effect (engagement =
//      implicit "I will handle this agent's escalations") AND
//      navigates to /<companyPrefix>/chat with a new-topic-needed
//      deep-link payload pre-selecting this agent. Operator pivot
//      from the Plan 06.1-09 "Take-Responsibility" verb -- the
//      data-layer claim alone offered no visible engagement, which
//      violated the zero-rabbit-holes core value (every chain should
//      end in a clickable action, not a write-and-wait verb).
//
// Visual fidelity target: sketches/paperclip-fix-situation-room.html agent cards.

import * as React from 'react';
import {
  usePluginAction,
  useHostLocation,
  useHostNavigation,
} from '@paperclipai/plugin-sdk/ui/hooks';

import { StatePill, type StatePillState } from '../../primitives/state-pill.tsx';
import { formatAge, humaniseState } from '../../primitives/state-pill-format.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useToast } from '../../primitives/toast.tsx';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { buildChatDeepLink } from '../chat/deep-link.mjs';
import type { BlockerChainResult } from '../../../shared/types.ts';
import { Sparkline } from './sparkline.tsx';
import { ArtifactChipRow, type Artifact } from './artifact-chip-row.tsx';

/** D-13 — locked sentinel for an unowned HUMAN_ACTION_ON terminal. */
const UNOWNED_SENTINEL = '__unowned__';

/** Capitalize agent role for the button label (`ceo` -> `CEO`,
 *  `editor` -> `Editor`). The card header renders the role as-is
 *  for design fidelity; the button label uses a more polished form
 *  because it appears inline as a sentence-shaped CTA. */
function formatRoleForLabel(role: string): string {
  if (!role) return 'agent';
  if (role.length <= 3) return role.toUpperCase();
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export type AgentEmployee = {
  userId: string;
  // Phase 6.1 HOTFIX (Plan 06.1-09) -- canonical agent id for ownership
  // dispatch. Falls back to userId for backward compat with pre-06.1-09
  // payloads / tests.
  agentId?: string;
  // 2026-05-27 BEAAA hotfix: agent display name (e.g. "Head of Compliance",
  // "Scanner Engineer #2"). When present, used as the primary card-header
  // label and the engagement-button label so we don't render "General /
  // General / General / Ceo" for org charts where every agent has the same
  // generic role string. Optional — older snapshot payloads (pre-fix) won't
  // carry it; we fall back to roleLabel in that case.
  name?: string | null;
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
  /** Plan 06.1-11 — called after the side-table ownership write fires
   *  (fire-and-forget side effect of the Open-chat click). Allows the
   *  parent to force-refetch the situation.snapshot query so the chain
   *  re-resolves immediately on next-snapshot cycle. */
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

  // Phase 6.1 HOTFIX (Plan 06.1-11) — engagement entry point.
  //
  // The primary action on an agent card is NOT "claim ownership of this
  // agent" (the verb the operator pushed back on -- "claim" sounds like
  // grabbing property, and a side-table write alone offers no visible
  // engagement). The primary action is "open chat with this agent."
  //
  // Chat is the surface where the operator actually engages: reviews
  // current work, walks through blockers, gives directions. The
  // Situation Room is the dashboard that ROUTES to engagement.
  //
  // Click semantics:
  //   1. Fire-and-forget write to clarity_agent_owners via
  //      agent.takeOwnership -- captures the implicit intent ("I am
  //      engaging with this agent, so route escalations to me").
  //      Errors are swallowed; the chat navigation is the primary
  //      action and stays robust even if the side-table write fails.
  //   2. Navigate to /<companyPrefix>/chat with a new-topic-needed
  //      deep-link payload (Plan 04.2-03 URL_HASH carrier) that
  //      pre-selects this agent on the chat surface. Operator types
  //      their first message; the conversation starts; the ownership
  //      row is already in place by then.
  //
  // For v1.0, every click goes to new-topic-needed regardless of
  // whether the agent has a current blocker. Operator lands in the
  // chat with the agent selected; the agent's topic list shows
  // existing threads (including the blocker thread if any) and the
  // operator picks which to engage with. Phase 6.2 will add
  // blocker-direct routing (resolve the chain leaf via chat.openForIssue
  // and pre-select the blocker thread automatically) -- that needs
  // eager async pre-resolution per card, out of scope for v1.0 ship.
  const viewerUserId = useResolvedUserId();
  const { showToast } = useToast();
  const takeOwnership = usePluginAction('agent.takeOwnership');
  const { pathname } = useHostLocation();
  const { navigate } = useHostNavigation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';
  const [opening, setOpening] = React.useState(false);
  const agentIdForOwnership = employee.agentId ?? employee.userId;
  const roleLabel = formatRoleForLabel(employee.role);
  // 2026-05-27 BEAAA hotfix: prefer name over role for the header + button.
  // Most BEAAA agents have role="general" — a single distinguishing label
  // ("Head of Compliance", "Scanner Engineer #2") matters more than the
  // generic role string. Fallback to roleLabel keeps Countermoves +
  // unit-test fixtures (pre-name payloads) rendering unchanged.
  const displayLabel = (employee.name && employee.name.trim()) || roleLabel;

  const onOpenChat = React.useCallback(async () => {
    if (opening) return;
    setOpening(true);

    // 1. Fire-and-forget side-table write (engagement = implicit
    //    ownership). Errors are swallowed; the chat navigation is the
    //    primary action.
    if (
      viewerUserId &&
      agentIdForOwnership &&
      agentIdForOwnership !== UNOWNED_SENTINEL
    ) {
      takeOwnership({
        companyId: companyId ?? '',
        agentId: agentIdForOwnership,
        ownerUserId: viewerUserId,
        userId: viewerUserId,
      }).catch(() => {
        // Silent failure; chat opens regardless.
      });
      if (onTakeOwnershipSuccess) onTakeOwnershipSuccess();
    }

    // 2. Build and navigate to the chat deep-link.
    //
    // Plan 06.1-12 — `employee-only` route (NOT `new-topic-needed`). The
    // earlier `new-topic-needed` choice auto-opened the New Topic dialog
    // on every click, even when the agent already had topics the operator
    // wanted to continue. Operator critique: "is it functionally correct
    // that I continue the chat and it always wants to open a new topic?
    // Shouldn't it bring me to the topic that I'm trying to unblock?"
    //
    // `employee-only` selects the agent on the chat roster but lets the
    // operator pick from the topic strip -- existing thread to continue,
    // or "+ New topic" header button if they want fresh. Blocker-direct
    // routing (auto-select the chain-leaf topic) is Phase 6.2 (needs
    // per-card async chat.openForIssue pre-resolution).
    const deepLink = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: agentIdForOwnership,
    });
    if (deepLink) {
      navigate(deepLink.to);
    } else {
      showToast({ message: `Could not open chat with ${displayLabel}` });
      setOpening(false);
    }
    // On successful navigate, the AgentCard unmounts as the route
    // changes -- no need to setOpening(false) in the success branch.
  }, [
    opening,
    viewerUserId,
    agentIdForOwnership,
    takeOwnership,
    companyId,
    companyPrefix,
    navigate,
    showToast,
    roleLabel,
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
  } else if (
    terminal.kind === 'HUMAN_ACTION_ON' &&
    terminal.userId === UNOWNED_SENTINEL
  ) {
    // Plan 06.1-08 — blocked + unclaimed. Override the worker's
    // "X has no owner assigned" label with the voice-aligned body
    // that pairs naturally with the Open-chat affordance.
    terminalBlock = (
      <p className="clarity-agent-terminal" data-terminal-kind={terminal.kind}>
        <span className="clarity-agent-terminal-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        <span className="clarity-agent-terminal-label">{`Nobody is handling ${displayLabel}'s blockers`}</span>
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
        <span className="clarity-agent-role" title={employee.role}>{displayLabel}</span>
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
      <Sparkline values={employee.velocity_7d} />
      {/* Plan 06.1-11 — engagement entry point. Always rendered. Clicking
       *  writes the side-table ownership row (fire-and-forget side effect)
       *  AND navigates to the chat surface with this agent pre-selected.
       *  Anchored to the bottom of the card via .clarity-agent-card's
       *  flex-column layout + margin-top:auto on the button class. */}
      <button
        type="button"
        className="clarity-open-chat-btn"
        onClick={onOpenChat}
        disabled={opening}
        aria-busy={opening || undefined}
      >
        {opening ? 'Opening…' : `Open chat with ${displayLabel}`}
      </button>
    </div>
  );
}
