// src/ui/surfaces/situation-room/employee-row.tsx
//
// Plan 08-02 Task 1 (Phase 8 people-first cockpit) — ROOM-13/16/17.
//
// A single per-agent row in the Situation Room employee strip. Renders:
//   - a state dot (color sourced from --clarity-state-<state>)
//   - name + role + state pill + age chip
//   - the worker-polished focusLine (voice byte-identical to Reader) — hidden
//     for idle/stale rows where focusLine is null
//   - when blocked: the inline chain leaf `└ blocked by <action> (<leaf>)` plus
//     an "Open chat with <owner>" button that reuses the ROOM-09 / Plan 06.1-12
//     buildChatDeepLink employee-only carrier
//   - for idle/stale: an amber state + an "Assign work" / "Stand down" affordance
//     (write-path DEFERRED to a later release per CONTEXT.md "Deferred Ideas").
//
// SECURITY (T-08-UI-01 / T-08-UI-02): every visible string is a React text node
// (no dangerouslySetInnerHTML). `ownerAgentId` (an AGENT uuid) is consumed ONLY
// as the buildChatDeepLink `assigneeAgentId` argument — never rendered as text.
// M2: the leaf-issue segment renders only when leafIssueId is non-null (never an
// empty "()" or a uuid-suffix display string).
//
// This is a NORMAL typed React component, NOT a plugin slot-root (08-RESEARCH
// Pitfall 5) — it takes `{ row, companyPrefix, navigate }` props directly.

import * as React from 'react';

import { formatAge } from '../../primitives/state-pill-format.ts';
import { buildChatDeepLink } from '../chat/deep-link.mjs';

// Mirror of the worker builder's SituationEmployeeRow
// (src/worker/situation/build-employees-rollup.ts — Plan 08-01). Kept structural
// here so the UI bundle does not import worker types.
export type EmployeeState =
  | 'running'
  | 'reviewing'
  | 'blocked'
  | 'idle'
  | 'stale'
  | 'unknown';
export type AgeBucket = 'fresh' | 'aging' | 'stale';

export type SituationEmployeeRow = {
  agentId: string;
  name: string;
  role: string;
  state: EmployeeState;
  focusIssueId: string | null;
  focusLine: string | null;
  lastActivityAt: string | null;
  ageBucket: AgeBucket;
  blockerChain: {
    rootIssueId: string;
    leafIssueId: string | null;
    humanAction: string;
    ownerName: string;
    // AGENT uuid (focusIssue.assigneeAgentId), NOT a USER uuid (B1).
    ownerAgentId: string | null;
  } | null;
  doneTodayCount: number;
};

type EmployeeRowProps = {
  row: SituationEmployeeRow;
  companyPrefix: string;
  navigate: (to: string) => void;
};

/** Pure helper: ISO timestamp → age in ms (null-safe). null/invalid → null,
 *  which formatAge renders as the "?" sentinel. */
function ageMsFromISO(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

export function EmployeeRow({
  row,
  companyPrefix,
  navigate,
}: EmployeeRowProps): React.ReactElement {
  // B1: assigneeAgentId is an AGENT uuid sourced from row.blockerChain.ownerAgentId
  // (focusIssue.assigneeAgentId at the worker tier). Never thread a USER uuid
  // (terminal.userId) — that's a different namespace and would malform the link.
  const deepLink =
    row.state === 'blocked' && row.blockerChain && row.blockerChain.ownerAgentId
      ? buildChatDeepLink({
          route: 'employee-only',
          companyPrefix,
          assigneeAgentId: row.blockerChain.ownerAgentId,
        })
      : null;

  const ageMs = ageMsFromISO(row.lastActivityAt);

  return (
    <div className={`clarity-employee-row clarity-state-${row.state}`}>
      <span className="clarity-employee-state-dot" aria-hidden="true" />
      <span className="clarity-employee-name">{row.name}</span>
      <span className="clarity-employee-role">{row.role}</span>
      <span className="clarity-employee-state-pill">{row.state}</span>
      <span className="clarity-employee-age">{formatAge(ageMs ?? -1)}</span>

      {row.focusLine && (
        <p className="clarity-employee-focus">
          {row.focusLine}
          {row.focusIssueId && (
            <span className="clarity-employee-focus-ref">{` (${row.focusIssueId})`}</span>
          )}
        </p>
      )}

      {row.state === 'blocked' && row.blockerChain && (
        <div className="clarity-employee-chain">
          <span className="clarity-employee-chain-prefix">{`└ blocked by `}</span>
          <span className="clarity-employee-chain-action">
            {row.blockerChain.humanAction}
          </span>
          {row.blockerChain.leafIssueId && (
            <span className="clarity-employee-chain-leaf">{` (${row.blockerChain.leafIssueId})`}</span>
          )}
          <button
            type="button"
            className="clarity-employee-chain-open-chat"
            disabled={!deepLink}
            onClick={() => {
              if (deepLink) navigate(deepLink.to);
            }}
          >
            {`Open chat with ${row.blockerChain.ownerName}`}
          </button>
        </div>
      )}

      {(row.state === 'idle' || row.state === 'stale') && (
        <div className="clarity-employee-action">
          {/* v1.2.0: affordance present, write path deferred per CONTEXT.md
              "Deferred Ideas" — tap-to-stand-down. NO-OP click for now. */}
          <button
            type="button"
            className="clarity-employee-assign"
            onClick={() => {
              // v1.2.0: write path deferred — affordance only.
            }}
          >
            {row.state === 'idle' ? 'Assign work' : 'Stand down or re-assign'}
          </button>
        </div>
      )}
    </div>
  );
}
