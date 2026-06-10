// src/worker/situation/apply-structured-wait.ts
//
// Phase 17 Plan 17-02 Task 1 (WAIT-02 / SC5) — the single anti-divergence merge
// primitive.
//
// THE SC5 PARITY TRAP: the persisted structured human-wait row (Plan 17-01's
// clarity_human_waits) must be merged into nodeMeta[rootId] IDENTICALLY at all
// THREE root-meta write sites:
//   1. src/worker/handlers/flatten-blocker-chain.ts (Reader)
//   2. src/worker/situation/build-employees-rollup.ts (Situation Room rollup)
//   3. src/worker/handlers/org-blocked-backlog.ts    (Situation Room backlog)
// A wait merged on one path but not the others reproduces the EXACT BEAAA-972
// cross-surface bug: the SAME issue reads AWAITING_HUMAN in the Situation Room
// and AWAITING_AGENT_STUCK in the Reader. The ONLY safe shape is one shared
// helper fed by one waitMap built once per company in the situation-room
// prefetch — so this is the single place the merge logic lives. No site
// inline-duplicates the waitMap.get/field-set logic.
//
// Pure: no I/O, no clock, deterministic. The engine (src/shared/blocker-chain.ts,
// the priority-0 AWAITING_HUMAN leaf branch from 17-01) reads the two fields this
// helper sets. Keeping this AI-free preserves the blocker-chain purity guard.

/** The minimal nodeMeta value shape the merge writes — every caller's nodeMeta
 *  value type is a superset of this (it also carries ownerUserId/status/etc.). */
type StructuredWaitTarget = {
  structuredWaitOwnerUserId: string | null;
  structuredWaitOneLiner: string | null;
};

/** The minimal wait-row shape the merge reads — a subset of ClarityHumanWaitRow
 *  (Plan 17-01 clarity-human-wait-repo.ts). */
type StructuredWaitSource = {
  owner_user_id: string;
  decision_one_liner: string;
};

/**
 * Merge the prefetched structured human-wait for `startId` into
 * `nodeMeta[startId]`. No-op when no wait exists for `startId` (the conservative
 * floor: the engine then classifies from the node's own state, never a false
 * needs-you). Mutates in place.
 *
 * Precondition: `nodeMeta[startId]` already exists (the caller initialized the
 * two structuredWait* fields to null in its root-meta literal). Every one of the
 * three call sites does this immediately before calling the helper — that is the
 * SC5 discipline.
 */
export function applyStructuredWait(
  nodeMeta: Record<string, StructuredWaitTarget>,
  startId: string,
  waitMap: Map<string, StructuredWaitSource>,
): void {
  const w = waitMap.get(startId);
  if (!w) return;
  const node = nodeMeta[startId];
  if (!node) return;
  node.structuredWaitOwnerUserId = w.owner_user_id;
  node.structuredWaitOneLiner = w.decision_one_liner;
}
