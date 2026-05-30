// src/worker/situation/classify-employee-state.ts
//
// Plan 08-01 Task 2 — ROOM-14. The pure deterministic 5-state classifier for
// the people-first Situation Room cockpit. Single source of truth.
//
// LOCKED boundary source: 08-CONTEXT.md line 38 + ROOM-14 (REQUIREMENTS.md).
//   running   = active heartbeat-run in last 5 min (SOLE running signal —
//               heartbeat freshness wins; issue status NEVER promotes to running)
//   reviewing = stale heartbeat AND topOpenIssueStatus === 'in_review'
//   blocked   = stale heartbeat AND topOpenIssueStatus === 'blocked'
//   idle      = no open assigned issue AND last activity < 24h
//   stale     = no open assigned issue AND last activity ≥ 24h (or no signal);
//               ALSO an in_progress issue whose heartbeat is stale (M1, below)
//
// Pure: no SDK import, no I/O, no wall-clock read — nowMs is injected so every
// boundary is deterministically unit-testable.

export type EmployeeState = 'running' | 'reviewing' | 'blocked' | 'idle' | 'stale' | 'unknown';

export type ClassifyInput = {
  /** Agent.lastHeartbeatAt as ms-since-epoch, or null when never seen. */
  lastHeartbeatMs: number | null;
  /** Most-recent open assigned issue's status (priority: blocked > in_review >
   *  in_progress). null when the agent has no open assigned issue. */
  topOpenIssueStatus: 'in_progress' | 'in_review' | 'blocked' | null;
  /** Last activity signal (focus issue lastActivityAt, else heartbeat), ms. */
  lastActivityMs: number | null;
  /** Now() injected for testability — never read inside the function. */
  nowMs: number;
};

const RUNNING_WINDOW_MS = 5 * 60 * 1000; // 5 min
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Classify one employee row's state from the deterministic boundary logic.
 * Returns exactly one of the six EmployeeState values for every input.
 */
export function classifyEmployeeState(input: ClassifyInput): EmployeeState {
  const { lastHeartbeatMs, topOpenIssueStatus, lastActivityMs, nowMs } = input;

  const heartbeatAge = lastHeartbeatMs != null ? nowMs - lastHeartbeatMs : Infinity;

  // 1. running is GATED on heartbeat freshness ONLY (CONTEXT.md line 38). An
  //    issue status does NOT promote a stale-heartbeat row to running.
  if (heartbeatAge < RUNNING_WINDOW_MS) return 'running';

  // 2-3. Heartbeat is stale → fall through to open-issue status.
  if (topOpenIssueStatus === 'in_review') return 'reviewing';
  if (topOpenIssueStatus === 'blocked') return 'blocked';

  // 5. M1 (revision): an in_progress issue WITHOUT a fresh heartbeat is no
  //    evidence the agent is moving — classify as 'stale' so the operator can
  //    investigate. Heartbeat freshness wins over issue status (CONTEXT.md
  //    line 38 + revision M1). This branch MUST NOT return 'running'.
  if (topOpenIssueStatus === 'in_progress') return 'stale';

  // 6. No open assigned issue → idle/stale based on activity age.
  const activityAge = lastActivityMs != null ? nowMs - lastActivityMs : Infinity;
  if (!Number.isFinite(activityAge) || activityAge >= STALE_WINDOW_MS) return 'stale';
  return 'idle';
}
