// src/worker/situation/awaiting-you-selector.ts
//
// Phase 16.1 Plan 16.1-04 Task 1 (D-10) — the PURE awaiting-you selector that
// feeds the bounded warm-on-heartbeat (Task 2). Given the employees rollup the
// heartbeat already built (buildEmployeesRollup), it returns ONLY the issue ids
// of rows whose blockerChain marks them awaiting-you — a person must act — in
// stable, de-duped order.
//
// WHY PURE (no ctx, no DB, no host call). The heartbeat supplies the rows it has
// in hand and does ALL the staleness (tldr-cache) + governor (checkAndRecordWake)
// work itself. Keeping the selector free of I/O makes it trivially unit-testable
// (test/worker/situation/awaiting-you-selector.test.mjs) and keeps the warm's
// scope/governor gating in one place (editor.ts), not split across modules.
//
// THE AWAITING-YOU PREDICATE. The viewer-invariant `blockerChain.needsYou === true`
// signal is the engine verdict already carried on every SituationEmployeeRow
// (set when a *person* must act — AWAITING_HUMAN / UNOWNED, Plan 11-03 D-13/D-14).
// It is exactly the signal the action-cards heartbeat path already reads
// (editor.ts needsYouRows filter), so the warm targets the same set the cockpit
// flags as "needs you" — no second, divergent definition of awaiting-you.
//
// THE ISSUE ID. A warm needs a real issue id to compile a TL;DR against. We use
// the row's UUID dispatch keys (targetIssueUuid preferred, then leafIssueUuid) —
// the same UUIDs the rollup carries for mutation/dispatch, NEVER a human
// .identifier (NO_UUID_LEAK is irrelevant here: these are passed to compile, not
// rendered). A row whose chain resolves no usable uuid contributes nothing.
//
// NOTE (Node strip-only TS): imported by `.mjs` tests under Node's type-stripping
// loader. Plain exported function + type-only imports only; no emit-requiring
// syntax.

import type { SituationEmployeeRow } from './build-employees-rollup.ts';

/**
 * Pick the issue ids of the awaiting-you rows from an employees rollup, in stable
 * first-seen order, de-duped. PURE — no ctx, no DB, no host call.
 *
 * A row contributes iff its blockerChain is present, marks needsYou === true
 * (the engine "a person must act" verdict, D-10), and resolves a usable issue
 * UUID (targetIssueUuid preferred, then leafIssueUuid). Rows that are not
 * awaiting-you, carry no chain, or resolve no uuid are excluded.
 *
 * @param rows the rollup rows (buildEmployeesRollup .employees)
 * @returns the awaiting-you issue ids — possibly empty, never containing null /
 *          empty / duplicate entries.
 */
export function selectAwaitingYouIssueIds(rows: SituationEmployeeRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const chain = r.blockerChain;
    if (!chain || chain.needsYou !== true) continue;
    const issueId = chain.targetIssueUuid ?? chain.leafIssueUuid ?? null;
    if (typeof issueId !== 'string' || issueId.length === 0) continue;
    if (seen.has(issueId)) continue;
    seen.add(issueId);
    out.push(issueId);
  }
  return out;
}
