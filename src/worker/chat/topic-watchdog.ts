// src/worker/chat/topic-watchdog.ts
//
// Plan 04.1-03 — D-09 / D-11 — keep the chat-topic issue wakeable.
//
// Single helper called from BOTH chat.send (per-message, src/worker/handlers/
// chat-send.ts) AND chat.messages on every poll (per-poll, wired by Plan
// 04.1-04). Per the locked 04.1-01-SPIKE-FINDINGS (PROBE-OQ3 verdict
// PASS-NATIVE) multi-turn native re-wake works without `ctx.issues.requestWakeup`
// — the REST surface returns HTTP 404 on this host version, and a bare comment
// posted on the topic issue is sufficient to natively wake the assignee on turn
// N>1 (RESEARCH §Pitfall 3 closed).
//
// The helper therefore performs ONLY the D-11 defensive flip-off-done check:
//
//   ctx.issues.get → status-check → ctx.issues.update IF status ∈
//     {done, cancelled, blocked} (flip to NON_TERMINAL_CONVERSATION_STATUS).
//
// Best-effort: every step is wrapped in try/catch + warn-log; a failure NEVER
// bubbles to the caller. chat.send invokes this fire-and-forget via `void` so a
// slow / failing watchdog cannot delay or fail the send.
//
// `isTopicStuck(issue)` is the UI-SPEC Pattern G trigger — returns TRUE when
// the topic issue's activeRecoveryAction is set OR successfulRunHandoff is
// exhausted. Plan 04.1-04 surfaces this signal into the chat.messages response
// so the host-stuck banner (CTT-06) can render. Defensively typed: we accept a
// structural shape rather than the SDK's strict Issue type which may not
// expose these recovery fields directly.
//
// `NON_TERMINAL_CONVERSATION_STATUS` is the literal 'in_progress'. Exported so
// chat-topics.ts (Task 3) can use it for the initial child-topic status — both
// sites then agree by construction (no thrash: the watchdog flip target IS the
// initial create status).

import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

/** The non-terminal status a chat-topic issue is held at (D-09 / D-11). */
export const NON_TERMINAL_CONVERSATION_STATUS = 'in_progress';

/** Statuses the watchdog flips OFF — terminal disposition + blocked recovery. */
const TERMINAL_OR_BLOCKED_STATUSES = new Set(['done', 'cancelled', 'blocked']);

type TopicWatchdogCtx = {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

/**
 * D-09 / D-11 — defensive flip-off-done sweep for a chat-topic issue.
 *
 * Reads the current status; if it has been parked at `done`, `cancelled`, or
 * `blocked` (by the host's disposition-recovery service per the OQ3 attempt-2
 * evidence, or by a hypothetical future agent that DOES flip to terminal),
 * flips it back to `in_progress`. No-op otherwise.
 *
 * Per 04.1-01-SPIKE-FINDINGS PROBE-OQ3 PASS-NATIVE, this helper does NOT call
 * `ctx.issues.requestWakeup` — multi-turn native re-wake works (the REST
 * surface returns 404 anyway).
 *
 * Every step wrapped in try/catch + warn-log. Never throws to the caller —
 * `chat.send` invokes this fire-and-forget via `void ensureTopicWakeable(...)`.
 */
export async function ensureTopicWakeable(
  ctx: TopicWatchdogCtx,
  topicIssueId: string,
  companyId: string,
): Promise<void> {
  let issue: { status?: string } | null;
  try {
    issue = (await ctx.issues.get(topicIssueId, companyId)) as { status?: string } | null;
  } catch (e) {
    ctx.logger?.warn?.('topic-watchdog: issues.get failed', {
      topicIssueId,
      err: (e as Error).message,
    });
    return;
  }
  if (!issue) return;

  // D-11 — only flip OFF terminal/blocked. A non-terminal status (in_progress,
  // todo, backlog, in_review) is left alone.
  //
  // rc.8 hotfix 2026-05-26 (CTT-07 invariant restoration):
  //
  // The original Plan 04.1-03 implementation called `ctx.issues.update` here
  // to flip the topic back to in_progress. The clarity-pack manifest does
  // NOT declare the `issues.update` capability (per CTT-07 — plugin actions
  // NEVER mutate `public.issues.updated_at`). So the update call ALWAYS
  // failed on the live host with "missing required capability" — every
  // chat.messages poll generated a warn-log entry (~4 lines/minute on every
  // active chat surface). Live 2026-05-26 drill caught this as production
  // log spam.
  //
  // The host's disposition-recovery / handoff machinery is the rightful
  // owner of restoring terminal topics to in_progress (the recovery loop
  // we observed on Countermoves is exactly this mechanism working as
  // designed). The plugin only logs an info-level hint so an operator
  // tailing logs can see WHY the host's recovery loop is firing on this
  // topic, without triggering a host-side error.
  if (typeof issue.status === 'string' && TERMINAL_OR_BLOCKED_STATUSES.has(issue.status)) {
    ctx.logger?.info?.(
      'topic-watchdog: topic in terminal status; relying on host disposition-recovery',
      { topicIssueId, status: issue.status },
    );
  }
}

/**
 * UI-SPEC Pattern G trigger — true when the topic issue is parked in the host
 * disposition-recovery / handoff-exhausted machinery and the operator should
 * see the CTT-06 host-stuck banner.
 *
 * Plan 04.1-04 surfaces this into the chat.messages response shape; UI
 * (Plan 04.1-06) renders the banner when `topicStuck === true`.
 *
 * Defensively typed — we accept a structural shape rather than the SDK's
 * strict Issue type which may not expose `activeRecoveryAction` /
 * `successfulRunHandoff` directly (RESEARCH §Pattern 3 notes the same).
 */
export function isTopicStuck(
  issue:
    | {
        status?: string;
        activeRecoveryAction?: unknown;
        successfulRunHandoff?: { exhausted?: boolean } | null;
      }
    | null
    | undefined,
): boolean {
  if (!issue) return false;
  if (issue.activeRecoveryAction != null) return true;
  const handoff = issue.successfulRunHandoff as { exhausted?: boolean } | null | undefined;
  if (handoff && handoff.exhausted === true) return true;
  return false;
}
