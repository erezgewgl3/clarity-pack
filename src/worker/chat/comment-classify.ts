// src/worker/chat/comment-classify.ts
//
// Plan 04.1-04 — D-14 / D-15 — host-field-first comment classification.
//
// Pure function; unit-testable in node --test. The IssueComment shape comes
// from packages/shared/src/types/issue.ts (paperclipai/paperclip@master):
//
//   authorType: 'user' | 'agent' | 'system'             (constants.ts)
//   presentation.kind: 'message' | 'system_notice'      (constants.ts)
//
// Discriminator order (LOCKED by 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM,
// PASS dual-keyed against a live Countermoves recovery notice on
// 2026-05-20T08:25:40Z):
//
//   1. PRIMARY   — `c.authorType === 'system'`. HIGH-confidence, host-stamped
//                  on EVERY disposition / recovery-owner / finish_successful_
//                  run_handoff notice. Would require a public-API change on
//                  the host to defeat. The captured live notice on Countermoves
//                  carried `authorType: 'system'` + `authorUserId: null` +
//                  `authorAgentId: null` — the recovery service does not
//                  pose as an agent.
//   2. SECONDARY — `c.presentation?.kind === 'system_notice'`. Correlated on
//                  the live capture (both keys co-occurred). Provides the
//                  structured envelope Plan 04.1-06 D-16 diagnostics view
//                  renders. Defense-in-depth: catches any host build that
//                  ever stamps the envelope without authorType.
//   3. FALLBACK  — narrow body-pattern blocklist (RUNTIME_PHRASES). Used only
//                  if both host keys are absent. Five phrases per the locked
//                  spike findings (RESEARCH.md's four + the verbatim live
//                  disposition phrase). Case-insensitive substring match.
//
// Pitfall 4 — the Plan 04.1-02 marker comment
// `"Task created — <issueId>, assigned to <employeeName>."` MUST classify as
// 'conversation'. The marker is authored by the plugin worker (authorType is
// 'agent'/'user', NEVER 'system') and its wording does not overlap any
// RUNTIME_PHRASES entry. Both invariants are pinned by Test 11 / Test 11b in
// test/worker/chat/comment-classify.test.mjs — a future RUNTIME_PHRASES
// addition that accidentally matches the marker fails the suite before it
// could ever strip a real marker from a live chat thread.

export type CommentClass = 'conversation' | 'runtime-noise';

type CommentLike = {
  authorType?: string | null;
  presentation?: { kind?: string | null } | null;
  body?: string | null;
};

/**
 * Body-pattern blocklist — defense-in-depth fallback. The PRIMARY +
 * SECONDARY host-field discriminators already catch every captured live
 * runtime notice; the body list exists for any host build that ever drops
 * those stamps.
 *
 * Phrases 1-4: RESEARCH.md (verified across the host's recovery-service
 * source). Phrase 5: 04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM (live capture
 * verbatim — `comment fa25ef4d-78ee-4143-a527-c23227721eec` on Countermoves
 * COU-1757, 2026-05-20T08:25:40Z).
 *
 * Frozen so a downstream module cannot mutate the contract; future plans
 * extend by editing this file (and updating the contract test).
 */
export const RUNTIME_PHRASES: readonly string[] = Object.freeze([
  'needs a disposition',
  'blocked on a recovery owner',
  'finish_successful_run_handoff',
  'exhausted the bounded corrective handoff',
  // 5th phrase — verbatim from the live Countermoves spike capture
  // (04.1-01-SPIKE-FINDINGS PROBE-D14-DISCRIM, comment fa25ef4d-...).
  'Paperclip needs a disposition before this issue can continue',
]);

/**
 * Classify one IssueComment row as conversational or runtime noise.
 *
 * Returns 'runtime-noise' for any comment whose `authorType` is 'system' OR
 * whose `presentation.kind` is 'system_notice' OR whose `body` contains any
 * RUNTIME_PHRASES entry (case-insensitive). Returns 'conversation' otherwise.
 *
 * Order matters: host-field discriminator FIRST, body-pattern fallback LAST
 * (RESEARCH §Pattern 2 verbatim). The body match never overrides a host
 * field — a system-authored comment with no body still classifies as
 * runtime-noise.
 *
 * Defensive on null / undefined / missing keys: a comment with no
 * `authorType` and no `presentation.kind` defaults to 'conversation' so we
 * never strip a legitimate-but-incomplete row.
 */
export function classifyComment(c: CommentLike): CommentClass {
  // PRIMARY (HIGH confidence) — host discriminator from 04.1-01-SPIKE-FINDINGS.
  if (c.authorType === 'system') return 'runtime-noise';

  // SECONDARY (defense-in-depth) — presentation envelope.
  if (c.presentation?.kind === 'system_notice') return 'runtime-noise';

  // FALLBACK — narrow body-pattern blocklist.
  const body = (c.body ?? '').toLowerCase();
  if (body.length > 0 && RUNTIME_PHRASES.some((p) => body.includes(p.toLowerCase()))) {
    return 'runtime-noise';
  }
  return 'conversation';
}
