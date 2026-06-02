// src/shared/reply-reachable.ts
//
// Plan 14-02 Task 1 (DO-05 / SC4) — the pure reply-reachable predicate.
//
// `isReplyReachable(terminalKind)` answers ONE question: can the operator unblock
// this chain by posting an answer-comment in place (→ render Send / chips), or must
// the row degrade to a named action + "Open ↗" escape (no dead Send)?
//
// SCOPE — AWAITING_HUMAN ONLY (the spike-proven dominant BEAAA shape). The operator
// answering his own awaited-decision issue is the only kind the Phase-10 spike ran
// and PASSED on: posting the answer-comment triggers the assigned agent's native
// resume (Shape A awaiting-answer / Shape B status='blocked'). Every other kind
// returns false:
//   - AWAITING_AGENT_STUCK → false. DEFERRED. It stays actionAffordance:'assign'
//     (Phase 12 D-05 LOCK — NOT reversed); the existing OwnerPicker assign branch
//     owns that row, never a Send. A stuck-agent reply would need a future engine
//     affordance change. The dead "AWAITING_AGENT_STUCK = true" arm from the prior
//     draft is REMOVED.
//   - AWAITING_AGENT_WORKING / SELF_RESOLVING → false (in motion / settling, no
//     action needed).
//   - EXTERNAL / CYCLE / UNCLASSIFIED → false (no in-system thread can consume a
//     comment; the row surfaces Open ↗ to investigate).
//   - UNOWNED → false (assignment, not reply, is the answer — OwnerPicker).
//
// PURITY — the input is the `terminalKind` discriminant string ALONE. No
// targetAgentUuid, no awaitedPartyLabel/ownerName string match, no AI/LLM token,
// no I/O, no wall-clock read. Same purity boundary `blocker-chain.ts` holds; this
// is a structural verdict-driven predicate, not a string match on a scrubbed
// display label (the exact anti-pattern Phase 11/12 killed). It lives NEXT TO the
// classifyVerdict family but does NOT import or modify the engine.
//
// BLOCKER 5 (input shape) — keyed on `Terminal['kind']`, the exact field the rows
// carry (threaded in 14-04 onto the rollup blockerChain + already on
// OrgBlockedRow), so the 14-03 call sites compile against the real row shape
// without constructing a full Terminal object.

import type { Terminal } from './types.ts';

/**
 * SC4 reply-reachable predicate — AWAITING_HUMAN ONLY.
 *
 * Returns true iff the operator can unblock the chain by replying in place (the
 * answer-comment triggers the assigned agent's resume per the Phase-10 spike).
 * Pure / deterministic per kind — exhaustive switch with a `never` guard so a new
 * Terminal kind fails the build here (the established total-function idiom from
 * classifyVerdict).
 */
export function isReplyReachable(terminalKind: Terminal['kind']): boolean {
  switch (terminalKind) {
    case 'AWAITING_HUMAN':
      // The spike-proven dominant shape: the operator answers his own awaited
      // issue; posting the answer-comment natively wakes the assigned agent.
      return true;
    case 'AWAITING_AGENT_WORKING':
      return false; // in motion — no action needed
    case 'AWAITING_AGENT_STUCK':
      // DEFERRED — stays actionAffordance:'assign' (Phase 12 D-05 LOCK). The
      // OwnerPicker handles this row; reply would need a future engine change.
      return false;
    case 'SELF_RESOLVING':
      return false; // settling on its own ETA
    case 'EXTERNAL':
      return false; // third party with no in-system thread to consume a comment
    case 'CYCLE':
      return false; // no single party to answer — break-the-loop is a navigate
    case 'UNOWNED':
      return false; // assignment, not reply, is the answer — OwnerPicker
    case 'UNCLASSIFIED':
      return false; // honest degrade — Open ↗ to investigate
    default: {
      // Exhaustiveness — TS narrows to `never`. A new kind fails the build here.
      const _exhaustive: never = terminalKind;
      throw new Error(`isReplyReachable: unhandled terminal kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
