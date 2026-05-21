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
// 'conversation'. Plan 04.1-11 added an explicit marker-pattern allowlist at
// the top of classifyComment for this. The prior Plan 04.1-04 assumption that
// the marker carries authorType:'agent' or 'user' is FALSE in production —
// the Paperclip host stamps plugin-worker `ctx.issues.createComment` calls
// with authorType:'system' on Countermoves (CONFIRMED 2026-05-21 by Eric's
// diagnostics-on test: markers were visible as system-noise rows in the
// thread when diagnostics were toggled on, then absent from the rendered
// conversation when diagnostics were toggled off — the PRIMARY discriminator
// was stripping them). The allowlist guarantees the marker passes through
// regardless of host-stamped authorType. A future RUNTIME_PHRASES addition
// that accidentally matches the marker still can't strip it — the allowlist
// returns 'conversation' BEFORE the body-pattern path even runs. Pinned by
// the marker-with-authorType-system regression test in
// test/worker/chat/comment-classify.test.mjs.

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
/**
 * Plan 04.1-11 (2026-05-21) — Plan 04.1-02 task-created marker allowlist.
 *
 * Matches the canonical marker shape produced by `createTrueTask` in
 * src/worker/chat/true-task.ts:124:
 *   `Task created — <issueId>, assigned to <employeeName>.`
 *
 * The regex is TIGHT on purpose: em-dash separator (NOT hyphen-minus),
 * single non-comma chunk for the issueId (UUID or short id — NO commas
 * allowed so the trailing chunk delimiter stays unambiguous), single
 * non-empty chunk for the employeeName, literal period terminator. Does
 * NOT broaden the conversational allowlist beyond this one literal pattern
 * — future plugin-worker comment shapes do NOT get a free pass; they need
 * their own opt-in entry here.
 *
 * The PRIMARY/SECONDARY/FALLBACK chain below is UNCHANGED. This allowlist
 * is purely additive at the HEAD of classifyComment so the host's
 * authorType:'system' stamp can't strip the marker on Countermoves.
 *
 * If the marker shape ever changes in true-task.ts, this regex MUST update
 * in the same commit. The two locations are linked by Plan 04.1-11.
 */
const TASK_CREATED_MARKER_RE = /^Task created — [^,]+, assigned to .+\.$/;

export function classifyComment(c: CommentLike): CommentClass {
  // Plan 04.1-11 (2026-05-21) — marker-pattern allowlist (Pitfall 4
  // production fix). The Plan 04.1-02 marker comment
  //   `Task created — <issueId>, assigned to <employeeName>.`
  // MUST classify as 'conversation' regardless of authorType, because the
  // host stamps plugin-worker `ctx.issues.createComment` calls with
  // authorType:'system' on Countermoves (CONFIRMED 2026-05-21 by
  // diagnostics-on test). The original Plan 04.1-04 spec assumed
  // authorType:'agent' or 'user'; production showed otherwise.
  //
  // Without this exception the marker is filtered server-side as
  // runtime-noise → chat.messages never returns it → message-thread's
  // inline-task-card render path never fires → operator's confirmation
  // card disappears on every chat reload.
  //
  // Order matters: the allowlist runs BEFORE the primary authorType check
  // so a marker stamped authorType:'system' still passes through. The
  // RUNTIME_PHRASES fallback path below CANNOT strip a marker even if a
  // future phrase accidentally overlaps — the return here is final.
  const trimmedBody = (c.body ?? '').trim();
  if (TASK_CREATED_MARKER_RE.test(trimmedBody)) {
    return 'conversation';
  }

  // PRIMARY (HIGH confidence) — host discriminator from 04.1-01-SPIKE-FINDINGS.
  if (c.authorType === 'system') return 'runtime-noise';

  // SECONDARY (defense-in-depth) — presentation envelope.
  if (c.presentation?.kind === 'system_notice') return 'runtime-noise';

  // FALLBACK — narrow body-pattern blocklist (case-insensitive substring
  // match). Uses a fresh `.toLowerCase()` view of `trimmedBody`.
  const lowerBody = trimmedBody.toLowerCase();
  if (lowerBody.length > 0 && RUNTIME_PHRASES.some((p) => lowerBody.includes(p.toLowerCase()))) {
    return 'runtime-noise';
  }
  return 'conversation';
}
