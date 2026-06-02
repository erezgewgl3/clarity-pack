// src/worker/situation/agent-liveness.ts
//
// Plan 11-02 Task 1 (D-02/D-03/D-04) — the pure worker liveness helper.
//
// WHY THIS EXISTS: the honest blocker taxonomy engine (src/shared/blocker-chain.ts)
// must stay clock-free (PRIM-03 / SC4 / Pitfall 4). It branches on a pre-resolved
// `agentState: 'working' | 'stuck' | null` string injected by the worker — never
// on a heartbeat age it computes itself. This helper is that single worker-side
// liveness projection: both buildEdges (Task 2, org-blocked-backlog.ts) and the
// per-employee rollup (Plan 11-03) import it, so the working-vs-stuck math lives
// in exactly ONE place outside the engine.
//
// Boundary logic (D-02/D-03/D-04), mirroring classify-employee-state.ts's
// injected-nowMs precedent + its 5-min RUNNING_WINDOW_MS fallback constant
// (Assumption A2 — the established fixed-window when no host cadence is exposed):
//   working = heartbeat fresh (age < stale window) OR (stale heartbeat but work queued)
//   stuck   = stale heartbeat AND nothing queued (D-02); ALSO a known agent with
//             NO heartbeat signal at all (age === Infinity ⇒ D-04 conservative)
//   null    = reserved by the CALLER for "no agent on this node" (WR-04, Plan
//             11-05): nullability lives at the call site, NOT in this helper. This
//             function is only invoked when an assigneeAgentId is present, so its
//             return type is the non-null union 'working' | 'stuck'.
//
// Pure: no SDK import, no I/O, no wall-clock read — nowMs is injected so every
// boundary is deterministically unit-testable.

// The established fixed-window fallback from classify-employee-state.ts
// (Assumption A2). Used to derive the stale window when the host does not expose
// a per-agent expected heartbeat cadence.
const RUNNING_WINDOW_MS = 5 * 60 * 1000; // 5 min

export type ResolveAgentStateInput = {
  /** Agent.lastHeartbeatAt as ms-since-epoch, or null when never seen. */
  lastHeartbeatMs: number | null;
  /** True when the agent has queued/in-flight work (idle run-state + empty work
   *  queue ⇒ false). A stale heartbeat is only 'stuck' when this is false (D-02). */
  hasQueuedWork: boolean;
  /** Now() injected for testability — never read inside the function. */
  nowMs: number;
  /** Optional per-agent expected heartbeat cadence (ms). When supplied the stale
   *  window self-tunes to 2x cadence (D-03); else the 5-min fixed-window fallback
   *  (Assumption A2) is doubled. */
  expectedCadenceMs?: number;
};

/**
 * Project an agent's heartbeat/run-state to the engine's injected agentState.
 * Returns 'working' or 'stuck' for every input (this helper is only called for a
 * node that HAS a known assigneeAgentId; the caller supplies null when there is
 * no agent on the node). Never returns null itself — D-04 makes a missing signal
 * conservatively 'stuck' rather than silent.
 *
 * WR-04 (Plan 11-05): the return type is narrowed to 'working' | 'stuck' — the
 * helper never produces null. NULLABILITY LIVES AT THE CALL SITE: callers
 * (flatten-blocker-chain.ts, org-blocked-backlog.ts) supply null themselves when
 * assigneeAgentId == null, i.e. when there is no agent on the node. Do not widen
 * this annotation back to include null.
 */
export function resolveAgentState(input: ResolveAgentStateInput): 'working' | 'stuck' {
  const { lastHeartbeatMs, hasQueuedWork, nowMs, expectedCadenceMs } = input;

  // Stale window = 2x the expected cadence (D-03 self-tuning) or 2x the
  // established 5-min fixed fallback (Assumption A2) when no cadence is exposed.
  // WR-03 (Plan 11-05): use a POSITIVE-value guard, NOT nullish coalescing — a
  // host value of 0 must fall back to RUNNING_WINDOW_MS, never collapse the stale
  // window to a 0-width band that would falsely classify a fresh heartbeat 'stuck'.
  const cadenceMs =
    typeof expectedCadenceMs === 'number' && expectedCadenceMs > 0
      ? expectedCadenceMs
      : RUNNING_WINDOW_MS;
  const staleWindowMs = 2 * cadenceMs;

  const heartbeatAge = lastHeartbeatMs != null ? nowMs - lastHeartbeatMs : Infinity;

  // 1. D-04 — a known agent with NO heartbeat signal at all (age === Infinity)
  //    is conservatively 'stuck' regardless of the queue: there is zero evidence
  //    the agent is moving, so a silently-absent agent surfaces a nudge rather
  //    than false reassurance. This check precedes the queued-work fallthrough.
  if (!Number.isFinite(heartbeatAge)) return 'stuck';

  // 2. Fresh heartbeat ⇒ working (the agent is provably moving).
  if (heartbeatAge < staleWindowMs) return 'working';

  // 3. Stale heartbeat. D-02: only 'stuck' when there is ALSO nothing queued — a
  //    stale heartbeat with queued work is still progressing (treat as working).
  if (hasQueuedWork) return 'working';

  // 4. Stale heartbeat AND nothing queued ⇒ stuck (D-02).
  return 'stuck';
}
