// src/worker/handlers/situation-reply-and-resume.ts
//
// Plan 14-01 Task 2 (DO-01 / DO-02) — situation.replyAndResume: the Do-It-Here
// reply+resume mutation. Implements the proven Phase-10 unblock-resume recipe
// (10-03-SPIKE-FINDINGS): post the operator's reply as a canonical
// public.issue_comments comment — the NATIVE resume trigger for both Shape A
// (awaiting-answer) and Shape B (status='blocked') — then, ONLY for Shape B,
// apply the operator-attributed durable {status:'in_progress'} flip.
//
// STRUCTURAL MIRROR — situation-assign-owner.ts (wrapActionHandler, reqStr,
// leafIssueUuid-vs-leafIssueId split, actor={actorUserId:userId}, structured
// {error} returns, human-key echo) + chat-send.ts (the createComment write,
// the messageUuid dedup, the no-orphan rule, the fire-and-forget non-awaited
// requestWakeup with idempotencyKey:messageUuid).
//
// SHAPE SELECTION IS A REAL SIGNAL, NOT A PROXY. The handler does NOT inspect
// or re-derive terminal.kind. It receives `needsDurabilityFlip` — a boolean the
// worker rollup/backlog (14-04) emits from the leaf issue's status at build
// time — and acts on it directly. The flag is the worker-emitted Shape-B
// signal; an absent flag means comment-only (Shape A), the spike-proven-
// sufficient trigger. On the dominant AWAITING_HUMAN+status=blocked real path
// the caller ALWAYS passes the real boolean (no "default false when unknown" gap).
//
// IDEMPOTENCY (T-14-01) — dedup on the client messageUuid BEFORE any host
// mutation: a lost-ACK retry returns the ORIGINAL commentId WITHOUT re-posting
// a comment or re-applying the flip. The dedup row (migration 0016) records
// `durable` so a replay never re-attempts the flip.
//
// CTT-07 EXCEPTION (T-14-04) — the Shape-B status flip carries
// actor={actorUserId:userId} (operator-attributed, audited). It is operator-
// initiated + one-shot, NOT a silent per-poll sweep (the topic-watchdog ban).
//
// NO_UUID_LEAK — every mutation uses leafIssueUuid; the human leafIssueId is
// logged/echoed only, never the first arg of createComment or update.
//
// AWAIT-CONFIRM — the handler returns { ok: true } only after the comment write
// confirms. A createComment failure returns an honest { error: 'REPLY_FAILED' }
// (never claims resumed). The Shape-B flip is the only non-fatal step (the
// comment already triggered the native resume), so a flip failure still returns
// { ok: true, durable: false }.
//
// CAPABILITIES — issue.comments.create + issues.update are ALREADY declared
// (D-14, no new cap; NOT issue.relations.write).

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type {
  PluginIssuesClient,
  PluginIssueMutationActor,
  PluginLogger,
} from '@paperclipai/plugin-sdk';
import {
  getReplyResumeByUuid,
  insertReplyResume,
  type ReplyResumeRepoCtx,
} from '../db/reply-resume-repo.ts';

export type SituationReplyAndResumeCtx = OptInGuardActionCtx &
  ReplyResumeRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

function reqStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`situation.replyAndResume: ${key} required`);
}

export function registerSituationReplyAndResume(ctx: SituationReplyAndResumeCtx): void {
  wrapActionHandler(ctx, 'situation.replyAndResume', async (params) => {
    const companyId = reqStr(params, 'companyId');
    // The issue UUID — the MUTATION id passed to createComment + update.
    const leafIssueUuid = reqStr(params, 'leafIssueUuid');
    // Human display key (e.g. BEAAA-43) — logged + echoed, NEVER the mutation id.
    const leafIssueId = reqStr(params, 'leafIssueId');
    const body = reqStr(params, 'body');
    const userId = reqStr(params, 'userId');
    const messageUuid = reqStr(params, 'messageUuid');

    // SHAPE SELECTION — a REAL caller-supplied signal. The worker rollup/backlog
    // (14-04) emits needsDurabilityFlip from the leaf issue's status (true when
    // status==='blocked'). The handler TRUSTS this boolean; it does NOT inspect
    // params.terminal.kind to decide (no terminal-kind proxy). An absent flag
    // means comment-only (Shape A), the spike-proven-sufficient native trigger.
    const needsDurabilityFlip = params?.needsDurabilityFlip === true;

    // 1. DEDUP (BEFORE any host mutation) — a resend with an already-stored
    //    messageUuid is idempotent: return the ORIGINAL commentId WITHOUT
    //    re-posting or re-flipping (T-14-01).
    const existing = await getReplyResumeByUuid(ctx, companyId, messageUuid);
    if (existing) {
      return {
        ok: true as const,
        commentId: existing.comment_id,
        leafIssueId,
        durable: existing.durable,
      };
    }

    // 2. COMMENT (await-confirm) — the operator's reply lands in
    //    public.issue_comments via the issue UUID. This alone natively resumes
    //    the agent for both Shape A and Shape B (10-03 recipe). A failure
    //    returns an honest error and writes NO dedup row (no orphan).
    let comment: { id: string };
    try {
      comment = await ctx.issues.createComment(leafIssueUuid, body, companyId);
    } catch (e) {
      ctx.logger?.warn?.('situation.replyAndResume: createComment failed', {
        leafIssueId,
        err: (e as Error).message,
      });
      return { error: 'REPLY_FAILED' as const };
    }

    // 3. FLIP (Shape B only) — the durable {status:'in_progress'} flip,
    //    operator-attributed (CTT-07 exception). Comment FIRST, flip after
    //    (the spike ordering). NON-FATAL: the comment already triggered the
    //    resume, so a flip failure degrades to durable=false rather than
    //    failing the action. The dedup row below records the ACTUAL durable
    //    outcome so a replay never re-attempts a failed flip.
    let durable = false;
    if (needsDurabilityFlip) {
      const actor: PluginIssueMutationActor = { actorUserId: userId };
      try {
        await ctx.issues.update(
          leafIssueUuid,
          { status: 'in_progress' } as Parameters<PluginIssuesClient['update']>[1],
          companyId,
          actor,
        );
        durable = true;
      } catch (e) {
        // Non-fatal — log the human key (never the UUID).
        ctx.logger?.warn?.('situation.replyAndResume: durability flip failed (non-fatal)', {
          leafIssueId,
          err: (e as Error).message,
        });
      }
    }

    // 4. DEDUP INSERT — record the messageUuid -> comment_id map with the actual
    //    durable outcome. ON CONFLICT DO NOTHING (a racing replay is a no-op).
    await insertReplyResume(ctx, {
      company_id: companyId,
      message_uuid: messageUuid,
      leaf_issue_id: leafIssueId,
      comment_id: comment.id,
      durable,
    });

    // 5. FIRE-AND-FORGET wake — requestWakeup is unreliable on this host
    //    (paperclipai@2026.525.0): it can time out / scope-error in worker→host
    //    calls. Awaiting it would block the ACK and congest the channel; the
    //    comment above is the real native trigger. So we keep the call (harmless
    //    when it works) but NEVER await it and NEVER fail the action on it.
    //    idempotencyKey IS messageUuid so a resend never double-wakes (T-14-07).
    void Promise.resolve()
      .then(() =>
        ctx.issues.requestWakeup(leafIssueUuid, companyId, {
          reason: 'clarity-pack reply: operator answer',
          idempotencyKey: messageUuid,
        }),
      )
      .catch((e) =>
        ctx.logger?.info?.(
          'situation.replyAndResume: requestWakeup non-fatal (native wake applies)',
          { leafIssueId, reason: (e as Error).message },
        ),
      );

    // 6. await-confirmed success — the comment landed; durable reflects the
    //    actual Shape-B flip outcome. The human key is echoed for the UI toast.
    return { ok: true as const, commentId: comment.id, leafIssueId, durable };
  });
}
