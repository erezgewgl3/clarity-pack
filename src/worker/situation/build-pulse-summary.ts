// src/worker/situation/build-pulse-summary.ts
//
// Plan 15-01 Task 1 (COCK-01 / SC1 worker half) — the Pulse vital-sign
// aggregation. Four integer counts summed over the EXISTING per-row engine
// verdicts the rollup already produced + the already-computed needsYou.count.
//
// PURE by construction (15-CONTEXT D-01 / D-09): no new host fetch, no await, no
// clock, no ctx.* — a single synchronous sum over the inputs. Keeping the
// counting in the WORKER (not the React view) means the snapshot carries every
// verdict-derived number and the view never re-derives ownership (SC3). Empty
// input degrades to the all-zero floor so the Pulse chips never blank (SC4).
//
// LOCKED count definitions (15-CONTEXT D-01 — each a sum over existing verdicts,
// NO new classification):
//   need-you      = needsYou.count VERBATIM (the Phase-12 per-leaf-deduped
//                   human-actionable count; NOT re-counted from rows).
//   in-motion     = rows with blockerChain.tier === 'in-motion'
//                   (⇔ AWAITING_AGENT_WORKING) PLUS chainless rows with
//                   group === 'working' (actively-running agents with no blocker).
//                   The group branch counts ONLY chainless rows so an in-motion
//                   chain whose group is 'working' is counted once (no double).
//   stuck         = rows with blockerChain.terminalKind === 'AWAITING_AGENT_STUCK'
//                   (tier 'watch'; the design-spec "1 agent stuck").
//   self-clearing = rows with blockerChain.terminalKind === 'SELF_RESOLVING'
//                   (the design-spec "2 clearing themselves").
//
// NO_UUID_LEAK by construction (T-15-01): the output is four integers — integers
// cannot carry a UUID.

import type {
  SituationEmployeeRow,
  NeedsYou,
} from './build-employees-rollup.ts';

/** The four Pulse vital-sign counts. All integers; additive snapshot payload. */
export type PulseSummary = {
  /** Per-leaf-deduped human-actionable count (= needsYou.count). */
  needYou: number;
  /** In-motion-tier chains + chainless working-state agents. */
  inMotion: number;
  /** AWAITING_AGENT_STUCK rows (quietly stalled, Watch tier). */
  stuck: number;
  /** SELF_RESOLVING rows (clearing themselves, Watch tier). */
  selfClearing: number;
};

/**
 * Pure aggregation of the four Pulse vital signs over the already-built
 * situation_employees rows + the already-computed needsYou.count.
 *
 * Reads ONLY existing engine-verdict fields (blockerChain.tier / .terminalKind)
 * and the agent-state group — never re-classifies, never does host I/O. Degrades to
 * all-zero on empty input (deterministic floor, never throws).
 */
export function buildPulseSummary(
  employees: SituationEmployeeRow[],
  needsYou: NeedsYou,
): PulseSummary {
  const rows = Array.isArray(employees) ? employees : [];

  // need-you — the worker-supplied deduped count, verbatim (D-01). Coerce to a
  // safe non-negative integer floor so a malformed needsYou never blanks the chip.
  const needYou =
    needsYou && Number.isFinite(needsYou.count) ? Math.max(0, Math.trunc(needsYou.count)) : 0;

  // in-motion — in-motion-tier chains PLUS chainless working rows. The group
  // branch is guarded to chainless rows (blockerChain == null) so a working-group
  // row that ALSO carries an in-motion chain is counted exactly once (no double).
  const inMotion = rows.filter(
    (r) =>
      r.blockerChain?.tier === 'in-motion' ||
      (r.blockerChain == null && r.group === 'working'),
  ).length;

  // stuck — AWAITING_AGENT_STUCK leaves (tier 'watch').
  const stuck = rows.filter(
    (r) => r.blockerChain?.terminalKind === 'AWAITING_AGENT_STUCK',
  ).length;

  // self-clearing — SELF_RESOLVING leaves.
  const selfClearing = rows.filter(
    (r) => r.blockerChain?.terminalKind === 'SELF_RESOLVING',
  ).length;

  return { needYou, inMotion, stuck, selfClearing };
}
