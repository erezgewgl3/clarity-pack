// src/ui/surfaces/situation-room/employee-row.tsx
//
// Plan 09-02 Task 1 (R4 — the operator's headline rule: NO DEAD BUTTONS).
//
// A single per-agent row in the Situation Room. The row renders ONLY actions
// that actually perform — every button either fires a real worker action /
// navigation, or is ABSENT. No `disabled` action affordances, no empty-onClick
// no-ops (that was the Phase 8 sin this plan exists to fix).
//
// PER-STATE ACTION CLUSTERS (R4), keyed on the worker `group` field:
//   - needs_you, UNOWNED (blockerChain.ownerName === 'Unassigned'):
//       [Assign owner ▾] (owner-picker-popover → situation.assignOwner) + [Open <leaf> ↗]
//   - needs_you, OWNED:
//       [Open chat: <owner>] (buildChatDeepLink employee-only) + [Wake] (issues.requestWakeup) + [Open ↗]
//   - working (running / reviewing):
//       focus line + "moving · no action needed" — NO buttons.
//   - idle, state idle:
//       [Assign work ▾] → buildChatDeepLink employee-only (brief the agent in chat).
//   - idle, state stale (not paused):
//       [Assign work ▾] + [Stand down] → confirm dialog → agents.pauseHeartbeat.
//   - paused (D-04, row.isPaused === true): stays in Idle with a "paused" marker
//       + [Resume] → agents.resumeHeartbeat, regardless of idle/stale substate.
//
// CONFIRM POSTURE (R7): Assign owner / Assign work apply immediately; Stand
// down asks first (a consequential pause).
//
// SECURITY (T-09-05 / NO_UUID_LEAK): every visible string is a React text node
// (no dangerouslySetInnerHTML). ownerAgentId / agentId are consumed only as
// buildChatDeepLink args / dispatch args, never rendered as text. The leaf-issue
// segment renders only when leafIssueId is non-null.
//
// This is a NORMAL typed React component, NOT a plugin slot-root — it takes its
// props directly.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { formatAge } from '../../primitives/state-pill-format.ts';
import { useToast } from '../../primitives/toast.tsx';
import { buildChatDeepLink } from '../chat/deep-link.mjs';
import { OwnerPickerPopover } from './owner-picker-popover.tsx';

// Mirror of the worker builder's SituationEmployeeRow
// (src/worker/situation/build-employees-rollup.ts — Plan 08-01 + 09-01). Kept
// structural here so the UI bundle does not import worker types.
export type EmployeeState =
  | 'running'
  | 'reviewing'
  | 'blocked'
  | 'idle'
  | 'stale'
  | 'unknown';
export type AgeBucket = 'fresh' | 'aging' | 'stale';

// Plan 09-01 worker field — the display group computed at the worker tier (R2).
export type EmployeeGroup = 'needs_you' | 'working' | 'idle';

/** The locked sentinel an unowned blocker-chain leaf carries as its ownerName
 *  (worker scrubHumanAction). The picker is rendered for exactly this case. */
const UNASSIGNED = 'Unassigned';

export type SituationEmployeeRow = {
  agentId: string;
  name: string;
  role: string;
  state: EmployeeState;
  // Plan 09-01 — worker-assigned display group (R2). UI partitions by this
  // verbatim; it never re-derives group from state.
  group: EmployeeGroup;
  // Plan 09-01 (D-04) — paused marker from the agent's host status. Independent
  // of group: a paused row stays in Idle but shows the marker + Resume.
  isPaused: boolean;
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
  companyId: string;
  userId: string;
  navigate: (to: string) => void;
  /** Force-refetch the snapshot so a row re-groups after an assign/stand-down/
   *  resume (the mockup's live behavior). */
  onAssignSuccess: () => void;
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
  companyId,
  userId,
  navigate,
  onAssignSuccess,
}: EmployeeRowProps): React.ReactElement {
  const { showToast } = useToast();
  const wakeAction = usePluginAction('issues.requestWakeup');
  const pauseAction = usePluginAction('agents.pauseHeartbeat');
  const resumeAction = usePluginAction('agents.resumeHeartbeat');

  const [confirmingStandDown, setConfirmingStandDown] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const ageMs = ageMsFromISO(row.lastActivityAt);
  const chain = row.blockerChain;
  const isUnowned = !!chain && chain.ownerName === UNASSIGNED;

  // ---- handlers (every one performs a REAL effect; never a no-op) ----------

  const openIssue = React.useCallback(
    (issueId: string | null) => {
      if (!issueId) return;
      navigate(`/${companyPrefix}/issues/${issueId}`);
    },
    [companyPrefix, navigate],
  );

  const openChatWithOwner = React.useCallback(() => {
    if (!chain?.ownerAgentId) return;
    const link = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: chain.ownerAgentId,
    });
    if (link) navigate(link.to);
  }, [chain, companyPrefix, navigate]);

  const assignWork = React.useCallback(() => {
    // Brief the idle agent in chat (employee-only carrier). The agent's own
    // id is the chat correspondent.
    const link = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: row.agentId,
    });
    if (link) navigate(link.to);
    else showToast({ message: `Could not open chat with ${row.name}` });
  }, [companyPrefix, navigate, row.agentId, row.name, showToast]);

  const wake = React.useCallback(async () => {
    const issueId = chain?.leafIssueId ?? row.focusIssueId;
    if (!issueId || busy) return;
    setBusy(true);
    try {
      await wakeAction({ companyId, issueId, userId });
      showToast({ message: `Wake sent to ${chain?.ownerName ?? row.name}.` });
    } catch {
      showToast({
        message: `Wake requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [chain, row.focusIssueId, row.name, busy, wakeAction, companyId, userId, showToast]);

  const standDown = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setConfirmingStandDown(false);
    try {
      await pauseAction({ companyId, agentId: row.agentId, userId });
      showToast({ message: `Stood down ${row.name} · agent paused.` });
      onAssignSuccess();
    } catch {
      showToast({
        message: `Stand down requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, pauseAction, companyId, row.agentId, row.name, userId, showToast, onAssignSuccess]);

  const resume = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resumeAction({ companyId, agentId: row.agentId, userId });
      showToast({ message: `Resumed ${row.name}.` });
      onAssignSuccess();
    } catch {
      showToast({
        message: `Resume requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, resumeAction, companyId, row.agentId, row.name, userId, showToast, onAssignSuccess]);

  // ---- render --------------------------------------------------------------

  return (
    <div className={`clarity-employee-row clarity-state-${row.state}`} data-state={row.state}>
      <span className="clarity-employee-state-dot" aria-hidden="true" />
      <span className="clarity-employee-name">{row.name}</span>
      <span className="clarity-employee-role">{row.role}</span>
      <span className="clarity-employee-state-pill">{row.state}</span>
      {row.isPaused ? (
        <span className="clarity-employee-paused-marker">paused</span>
      ) : null}
      <span className="clarity-employee-age">{formatAge(ageMs ?? -1)}</span>

      {row.focusLine && (
        <p className="clarity-employee-focus">
          {row.focusLine}
          {row.focusIssueId && (
            <span className="clarity-employee-focus-ref">{` (${row.focusIssueId})`}</span>
          )}
        </p>
      )}

      {/* needs_you — the blocked row's chain + per-ownership action cluster */}
      {row.group === 'needs_you' && chain && (
        <>
          <div className={`clarity-employee-chain ${isUnowned ? '' : 'clarity-employee-chain-owned'}`}>
            <span className="clarity-employee-chain-prefix">{`└ blocked: `}</span>
            <span className="clarity-employee-chain-action">
              {isUnowned
                ? `${chain.leafIssueId ?? 'this issue'} has no owner`
                : `waiting on ${chain.ownerName}`}
            </span>
            {chain.leafIssueId && !isUnowned && (
              <span className="clarity-employee-chain-leaf">{` (${chain.leafIssueId})`}</span>
            )}
          </div>
          <div className="clarity-employee-actions">
            {isUnowned ? (
              <>
                {chain.leafIssueId && (
                  <OwnerPickerPopover
                    leafIssueId={chain.leafIssueId}
                    companyId={companyId}
                    userId={userId}
                    onAssigned={() => onAssignSuccess()}
                  />
                )}
                {chain.leafIssueId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-open-issue"
                    onClick={() => openIssue(chain.leafIssueId)}
                  >
                    {`Open ${chain.leafIssueId} ↗`}
                  </button>
                )}
              </>
            ) : (
              <>
                {chain.ownerAgentId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-btn-gold clarity-employee-open-chat"
                    onClick={openChatWithOwner}
                  >
                    {`Open chat: ${chain.ownerName}`}
                  </button>
                )}
                <button
                  type="button"
                  className="clarity-btn clarity-employee-wake"
                  onClick={() => void wake()}
                >
                  Wake
                </button>
                {chain.leafIssueId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-open-issue"
                    onClick={() => openIssue(chain.leafIssueId)}
                  >
                    Open ↗
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* working — momentum, no action needed */}
      {row.group === 'working' && (
        <p className="clarity-employee-moving">moving · no action needed</p>
      )}

      {/* idle — assign work / stand down / resume (D-04) */}
      {row.group === 'idle' && (
        <div className="clarity-employee-actions">
          {row.isPaused ? (
            <button
              type="button"
              className="clarity-btn clarity-btn-gold clarity-employee-resume"
              onClick={() => void resume()}
            >
              Resume
            </button>
          ) : (
            <>
              <button
                type="button"
                className="clarity-btn clarity-btn-gold clarity-employee-assign-work"
                onClick={assignWork}
              >
                Assign work ▾
              </button>
              {row.state === 'stale' && !confirmingStandDown && (
                <button
                  type="button"
                  className="clarity-btn clarity-btn-danger clarity-employee-stand-down"
                  onClick={() => setConfirmingStandDown(true)}
                >
                  Stand down
                </button>
              )}
              {row.state === 'stale' && confirmingStandDown && (
                <span
                  className="clarity-employee-confirm"
                  role="alertdialog"
                  aria-label={`Stand down ${row.name}?`}
                >
                  <span className="clarity-employee-confirm-text">
                    {`Stand down ${row.name}?`}
                  </span>
                  <button
                    type="button"
                    className="clarity-btn clarity-btn-danger clarity-employee-confirm-yes"
                    onClick={() => void standDown()}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-confirm-no"
                    onClick={() => setConfirmingStandDown(false)}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
