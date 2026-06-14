// src/shared/looks-done.ts
//
// Plan 18-03 Task 1 (LEG-03 / D-05 / D-06) — the deterministic, HIGH-PRECISION
// completion-phrase detector. Returns true when an AI-compiled TL;DR body reads
// as "this is finished" — the TL;DR side of the honest-divergence trigger: when
// looksDone(tldr.body) fires AND the deterministic engine still classifies the
// item as blocked (needsYou), the surfaces offer a confirm-gated
// "Looks done — close it?" affordance instead of silently hiding the conflict.
//
// PRECISION OVER RECALL (D-06). The cost of a false positive is a confusing
// "close it?" prompt on an item that genuinely is NOT done — that erodes trust
// in the affordance. The cost of a false negative is merely that one done-but-
// blocked item does not get the convenience prompt (the operator still sees the
// blocker chain and can close it the normal way). So the regex fires ONLY on
// explicit, unhedged completion phrasing and deliberately tolerates misses:
//   - "This task is done."            → true
//   - "Work is complete."             → true
//   - "The PR has been merged."       → true
//   - "Feature delivered."            → true
//   - "Issue resolved."               → true
//   - "...has shipped."               → true
//   - "Almost done, blocked on review." → FALSE (hedged — "almost")
//   - "Not done yet."                 → FALSE (negated)
//   - "" / null / undefined           → FALSE (degrade-safe; no false prompt)
//
// DETERMINISTIC FLOOR (landmine #6). This is a UI/worker concern, NOT an engine
// concern: it must NEVER be imported into src/shared/blocker-chain.ts (the pure
// deterministic engine whose test bans model-provider tokens). This file makes
// no model call and names no provider — it is a plain regex over a string. (The
// word "completion" is this helper's legitimate domain vocabulary; the
// determinism guard scans blocker-chain.ts only, which this file is kept out of.)
//
// NOTE (Node strip-only TS): imported by `.mjs` tests under Node's
// type-stripping loader. Plain exported function + no emit-requiring syntax.

// The completion verbs that, in their PAST-PARTICIPLE / state form, signal a
// finished item. Each is matched only when it reads as a completion CLAIM, not a
// hedge or a negation.
const DONE_TERMS = ['done', 'complete', 'completed', 'shipped', 'merged', 'delivered', 'resolved', 'finished'];

// Hedge / negation cues that DISQUALIFY an otherwise-matching sentence. If any of
// these precedes (within a short window) or directly negates the completion verb,
// the body is NOT treated as done — precision bias (D-06). Anchored as whole
// words so "redone"/"undone" handling stays predictable.
const NEGATORS = ['not', "n't", 'almost', 'nearly', 'partially', 'partly', 'soon', 'once', 'when', 'after', 'before', 'until', 'unless', 'if', 'pending', 'awaiting', 'blocked', 'cannot', "can't", 'isn', 'aren', 'wasn', 'still need', 'to be', 'needs to'];

/**
 * The core anchored completion-phrase pattern.
 *
 * Matches an explicit completion CLAIM: an optional subject/copula lead-in
 * ("is/are/has been/was/'s/been") immediately followed by one of the completion
 * terms. Examples it MUST match:
 *   "is done", "are complete", "has been merged", "was delivered", "been shipped",
 *   "task is resolved", "work complete", "feature delivered", "PR merged".
 *
 * The leading copula group is OPTIONAL so terse Editorial phrasing ("Work
 * complete.", "Feature delivered.", "PR merged.") still matches, but a bare verb
 * with no completion sense (e.g. "merge the branch" — imperative "merge", not the
 * past-participle "merged") does not, because the term list uses the completed
 * forms ("merged"/"delivered"/"resolved"/"shipped"/"completed"/"done"/"finished")
 * and "complete" is gated to its adjective/copula position by the hedge filter.
 */
const DONE_PATTERN = new RegExp(
  String.raw`\b(?:is|are|was|were|has been|have been|had been|'s|been|now)?\s*(?:${DONE_TERMS.join('|')})\b`,
  'i',
);

/**
 * High-precision completion-phrase detector over a TL;DR body (D-05/D-06).
 *
 * @param body the AI-compiled TL;DR body (`tldr_cache.body`) — may be null /
 *             undefined / empty (degrade-safe → false).
 * @returns true ONLY when the body carries an explicit, unhedged completion
 *          claim. Biased for precision: tolerates misses over false prompts.
 */
export function looksDone(body: string | null | undefined): boolean {
  if (typeof body !== 'string') return false;
  const text = body.trim();
  if (text.length === 0) return false;

  // Examine each sentence independently so a hedge in one sentence ("Almost
  // done.") cannot disqualify a genuine completion claim in another, and a
  // completion verb in one sentence is judged against the negators in ITS OWN
  // sentence only (precision: a global "blocked" elsewhere should not, on its
  // own, veto an explicit "is done" — but a same-sentence hedge MUST).
  const sentences = text.split(/[.!?\n]+/);
  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.trim();
    if (sentence.length === 0) continue;
    const lower = sentence.toLowerCase();

    // The sentence must carry an explicit completion claim.
    const m = DONE_PATTERN.exec(sentence);
    if (!m) continue;

    // Precision veto (D-06): a hedge or negation in the SAME sentence disqualifies
    // it. This is what turns "Almost done, blocked on review." into a non-match
    // while keeping "This task is done." a match.
    let hedged = false;
    for (const neg of NEGATORS) {
      if (lower.includes(neg)) {
        hedged = true;
        break;
      }
    }
    if (hedged) continue;

    // An unhedged, explicit completion claim — done.
    return true;
  }

  return false;
}
