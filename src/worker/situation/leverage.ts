// src/worker/situation/leverage.ts
//
// Plan 12-02 Task 1 (NY-02) — the PURE leverage helper for the Situation Room
// Needs-you ranking.
//
// LEVERAGE (D-01): the count of distinct blocked items whose flattened chain
// TERMINATES at this action — "items it frees". Acting once resumes all of them.
// This is a REVERSE-COUNT over the engine's already-walked structural data
// (pathIds / targetIssueUuid); it adds NO new host fetch (the engine already
// walked the dependency graph forward to produce each chain).
//
// SORT (D-02): leverage DESCENDING, tie-break = stable deterministic issue id
// ASCENDING (lexicographic on the leaf key). NO time/age field is read anywhere
// in this module, so the order is fully deterministic and unit-testable.
//
// PER-LEAF DEDUP (D-03): rows whose chains terminate at the SAME leaf collapse to
// ONE action item carrying leverage = the count of collapsed rows and a stable
// representative (the row whose agentId sorts smallest among the collapsed rows —
// all collapsed rows share the same leaf key, so agentId is the discriminator).
// This makes Needs-you action-centric ("one action, frees N") rather than
// per-employee.
//
// SORT-ONLY (D-07): leverage is an INTERNAL sort key. This module emits NO
// rendered "unblocks N" badge / impact string — the grounded named-action
// sentence + "unblocks → impact" prose is the Editor-Agent's job in Phase 13.
//
// SITUATION-ROOM-ONLY (D-08): this ranking applies to the SR Needs-you list only;
// the org-blocked backlog is not re-ordered by leverage this phase.
//
// PURE: no ctx, no SDK import, no Date.now(), no I/O. Copy-then-sort; never
// mutate the input (mirrors blocker-chain.ts pickTopChains).

/** The structural fields the leverage compute reads off a needs-you rollup row.
 *  Every field is already in hand from the engine verdict — no new fetch. */
export type LeverageInputRow = {
  /** Source agent (carried so a banner topAction can name the agent). */
  agentId: string;
  /** The engine's start→terminal chain (inclusive); last element is the leaf the
   *  chain terminates at — the per-leaf dedup key (D-03). */
  pathIds: string[];
  /** The leaf issue UUID dispatch key — the dedup-key fallback when pathIds is
   *  empty. Read as a STRUCTURAL key only, NEVER rendered (NO_UUID_LEAK). */
  targetIssueUuid: string | null;
  /** The already-scrubbed human action string the topAction surfaces (display). */
  humanAction?: string;
  /** Human display identifier — DISPLAY ONLY (carried for the topAction shape). */
  leafIssueId?: string | null;
  /** Mutation-only leaf UUID — carried for the topAction shape, NEVER rendered. */
  leafIssueUuid?: string | null;
};

/** A per-leaf-deduped action item. `leverage` is the SORT KEY only (D-07);
 *  `stableId` is the deterministic tie-break key (the leaf key). The
 *  `representative` row lets a caller build a topAction (agentId/humanAction/…). */
export type LeverageActionItem<R extends LeverageInputRow = LeverageInputRow> = {
  /** The distinct leaf key this action resolves (per-leaf dedup key, D-03). */
  stableId: string;
  /** Count of distinct items this action frees (D-01). Internal sort key (D-07). */
  leverage: number;
  /** A representative source row (the one whose agentId sorts smallest among the
   *  collapsed rows — all collapsed rows share the same leaf key, so agentId is
   *  the deterministic discriminator) — used to derive a banner topAction. */
  representative: R;
};

/** The leaf key the chain terminates at: the last pathIds element, falling back
 *  to targetIssueUuid when pathIds is empty (D-03). Returns null when neither is
 *  available (such a row cannot be leverage-counted and is dropped). */
function leafKeyOf(row: LeverageInputRow): string | null {
  if (Array.isArray(row.pathIds) && row.pathIds.length > 0) {
    const last = row.pathIds[row.pathIds.length - 1];
    if (typeof last === 'string' && last.length > 0) return last;
  }
  if (typeof row.targetIssueUuid === 'string' && row.targetIssueUuid.length > 0) {
    return row.targetIssueUuid;
  }
  return null;
}

/**
 * Reverse-count leverage over the supplied rows and collapse per leaf (D-01/D-03).
 *
 * For each row, the leaf its chain terminates at gains +1 leverage ("items it
 * frees"). Rows sharing a leaf collapse into ONE action item whose leverage is
 * the collapsed count, whose `stableId` is that shared leaf key, and whose
 * `representative` is the row with the smallest agentId among the collapsed rows
 * — deterministic, so the downstream tie-break never drifts.
 *
 * PURE: no clock, no I/O. Does not mutate the input array.
 */
export function computeLeverageByLeaf<R extends LeverageInputRow>(
  rows: readonly R[],
): LeverageActionItem<R>[] {
  const byLeaf = new Map<string, { leverage: number; representative: R }>();
  for (const row of rows) {
    const leaf = leafKeyOf(row);
    if (leaf == null) continue; // not leverage-countable — drop (never crash).
    const existing = byLeaf.get(leaf);
    if (existing == null) {
      byLeaf.set(leaf, { leverage: 1, representative: row });
    } else {
      existing.leverage += 1;
      // The representative is deterministic: keep the row whose agentId sorts
      // smallest so the collapsed item's downstream topAction is stable across
      // input order (no clock involved).
      if (row.agentId < existing.representative.agentId) {
        existing.representative = row;
      }
    }
  }
  const items: LeverageActionItem<R>[] = [];
  for (const [stableId, { leverage, representative }] of byLeaf) {
    items.push({ stableId, leverage, representative });
  }
  return items;
}

/**
 * Copy-then-sort action items by leverage DESCENDING, tie-break by stableId
 * ASCENDING (lexicographic) — the canonical D-02 order. Reads NO timestamp/age
 * field, so the result is deterministic and clock-independent.
 *
 * PURE: does not mutate the input array (mirrors pickTopChains).
 */
export function sortActionItemsByLeverage<R extends LeverageInputRow>(
  items: readonly LeverageActionItem<R>[],
): LeverageActionItem<R>[] {
  return [...items].sort((a, b) => {
    if (b.leverage !== a.leverage) return b.leverage - a.leverage; // leverage DESC
    // Stable tie-break: leaf key ascending (lexicographic). No time input.
    return a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0;
  });
}
