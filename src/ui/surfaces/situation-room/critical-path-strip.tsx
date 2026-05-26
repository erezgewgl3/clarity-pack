// src/ui/surfaces/situation-room/critical-path-strip.tsx
//
// Plan 02-04 Task 2 — ROOM-02 top strip of up to 3 critical-path chains.
// Each chain renders with a one-line plain-English narration when the
// Editor-Agent has compiled one (snapshot.narrative field, populated by a
// future iteration). For v1 we fall back to a kind-derived sentence.

import * as React from 'react';

import type { BlockerChainResult, Terminal } from '../../../shared/types.ts';

function defaultNarration(terminal: Terminal): string {
  switch (terminal.kind) {
    case 'HUMAN_ACTION_ON':
      return `Awaiting action: ${terminal.label}.`;
    case 'SELF_RESOLVING':
      return `Self-resolving: ${terminal.label}.`;
    case 'EXTERNAL':
      return `External: ${terminal.label}.`;
    case 'CYCLE':
      return `Cycle detected: ${terminal.label}.`;
    default: {
      // TS narrows to `never` after the four discriminants are exhausted; we
      // keep the default as a runtime safety net by widening the type back to
      // the union to access `label`.
      const t = terminal as Terminal;
      return t.kind;
    }
  }
}

/**
 * rc.8 final 2026-05-26 — idle-state filter. Live drill found every idle
 * agent generates a `HUMAN_ACTION_ON: "<Agent> has no owner assigned"`
 * chain — accurate per Paperclip's data model (the agent literally has
 * no operator assignment) but useless as actionable critical path. Three
 * "no owner assigned" rows in a row read as accusatory noise, not
 * "single human action ending a transitively-resolved blocker chain"
 * (PROJECT.md Surface 2 spec). Plan 06-01 will replace this with
 * properly-wired "Take ownership" affordances + real blocker-chain
 * resolution. For rc.8 final we suppress the no-owner-assigned chains
 * so the strip only renders when there's an actual critical path.
 */
const NO_OWNER_ASSIGNED_RE = /\bhas no owner assigned\b/i;

function isActionableChain(chain: BlockerChainResult): boolean {
  const label = chain.terminal?.label ?? '';
  return !NO_OWNER_ASSIGNED_RE.test(label);
}

export function CriticalPathStrip({
  chains,
  narrative,
  // Plan 06.1-03 — props accepted ahead of Task 2's full Take-Ownership /
  // Convert-to-task button cluster. Wired through the surface root so this
  // file can land in two commits (Task 1 wiring; Task 2 buttons + tests).
  // Optional so older call sites + tests stay green.
  viewerUserId: _viewerUserId,
  companyId: _companyId,
  onTakeOwnershipSuccess: _onTakeOwnershipSuccess,
}: {
  chains: BlockerChainResult[];
  narrative?: string | null;
  viewerUserId?: string | null;
  companyId?: string;
  onTakeOwnershipSuccess?: () => void;
}): React.ReactElement | null {
  if (!chains || chains.length === 0) return null;
  const actionable = chains.filter(isActionableChain);
  if (actionable.length === 0) return null;
  return (
    <section className="clarity-critical-path" data-clarity-region="critical-path">
      <h2 className="clarity-critical-path-heading">Critical Path</h2>
      <ol className="clarity-critical-path-list">
        {actionable.slice(0, 3).map((chain, i) => (
          <li
            key={`${chain.terminal.kind}-${i}-${chain.terminal.label}`}
            className="clarity-critical-path-item"
            data-terminal-kind={chain.terminal.kind}
          >
            <span className="clarity-critical-path-index">{i + 1}.</span>
            <span className="clarity-critical-path-text">{defaultNarration(chain.terminal)}</span>
          </li>
        ))}
      </ol>
      {narrative ? (
        <p className="clarity-critical-path-narrative">{narrative}</p>
      ) : null}
    </section>
  );
}
