// src/shared/reply-reachable.ts
//
// Plan 14-02 Task 1 (DO-05 / SC4) — the pure reply-reachable predicate.
//
// `isReplyReachable(terminalKind)` answers ONE question: can the operator unblock
// this chain by posting an answer-comment in place (→ render Send / chips), or must
// the row degrade to a named action + "Open ↗" escape (no dead Send)?
//
// SCOPE — AWAITING_HUMAN and AWAITING_AGENT_STUCK (the two reply-reachable kinds).
// Both resume via the SAME answer-comment recipe the Phase-10 spike proved: posting
// the answer-comment triggers the assigned party's native resume (Shape A
// awaiting-answer / Shape B status='blocked'). Every other kind returns false:
//   - AWAITING_HUMAN → true. The operator answers his own awaited-decision issue;
//     the answer-comment wakes the assigned agent.
//   - AWAITING_AGENT_STUCK → true. Phase 21 (21-CONTEXT D-2) ACTIVATED. A stuck
//     agent's blocked issue is Shape B (status='blocked'); a plain reply comment
//     resumes it exactly as the spike proved. The verdict moved to
//     actionAffordance:'nudge' (blocker-chain.ts D-1) and mounts the same
//     <ReplyInPlace> Send. (The prior Phase-12 D-05 LOCK that routed it to
//     'assign'/false is reversed.)
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
 * SC4 reply-reachable predicate — AWAITING_HUMAN + AWAITING_AGENT_STUCK.
 *
 * Returns true iff the operator can unblock the chain by replying in place (the
 * answer-comment triggers the assigned party's resume per the Phase-10 spike).
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
      // Phase 21 (21-CONTEXT D-2) — ACTIVATED. A stuck agent's blocked issue
      // resumes via the SAME answer-comment recipe as AWAITING_HUMAN (Phase-10
      // Shape B proven: a plain comment wakes a status='blocked' agent). So the
      // operator can reply in place to unstick — reply is reachable. The verdict
      // moved to actionAffordance:'nudge' (blocker-chain.ts D-1); the quiet
      // nudge affordance mounts the same <ReplyInPlace> Send.
      return true;
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
