// src/worker/situation/group-employee-state.ts
//
// Plan 09-01 Task 1 — R2 worker-tier group classifier. The pure deterministic
// map from the locked 6-value EmployeeState union (classify-employee-state.ts)
// to the 3-value display group the Situation Room cockpit renders verbatim.
//
// LOCKED mapping (09-SPEC.md R2):
//   needs_you = blocked
//   working   = running | reviewing
//   idle      = idle | stale
//   (unknown) = idle  — degrade-safe fallback: an 'unknown' row (a per-agent
//                       compute that threw) NEVER lands in needs_you/working,
//                       so a transient failure never spikes the headline count.
//
// Pure: no SDK import, no I/O, no wall-clock read — same discipline as
// classify-employee-state.ts. Grouping is computed at the worker tier and the
// UI renders the worker order verbatim (ROOM-17 sort discipline, R2).

import type { EmployeeState } from './classify-employee-state.ts';

export type EmployeeGroup = 'needs_you' | 'working' | 'idle';

/**
 * Map one employee row's state to its display group. Total over every member
 * of EmployeeState (exhaustiveness pinned by the Task 1 test). 'unknown'
 * degrades to 'idle' so a degraded row never inflates Needs-you/Working.
 */
export function groupForState(state: EmployeeState): EmployeeGroup {
  switch (state) {
    case 'blocked':
      return 'needs_you';
    case 'running':
    case 'reviewing':
      return 'working';
    case 'idle':
    case 'stale':
    case 'unknown':
      return 'idle';
    default: {
      // Exhaustiveness guard: if EmployeeState gains a member, TypeScript flags
      // this as a non-never assignment. Runtime degrade is still idle (safe).
      const _exhaustive: never = state;
      void _exhaustive;
      return 'idle';
    }
  }
}
