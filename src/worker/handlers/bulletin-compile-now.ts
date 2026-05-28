// src/worker/handlers/bulletin-compile-now.ts
//
// Quick task 260528-nns — `bulletin.compileNow` action: the operator's
// "Generate bulletin now" button on the Bulletin page.
//
// Delivery-layer rework (2026-05-28). The action can NOT run the ~50s agent
// compile inside its own invocation: paperclipai@2026.525.0 expires the
// invocation scope mid-poll (PR #6547), so a synchronous compile dies with
// "expired invocation scope" and the button never resolves. Instead the action
// ENQUEUES the request — it writes a per-company `force-requested` marker in
// ctx.state and returns { kind:'queued' } immediately (fast, well within the
// action's invocation). The every-minute `compile-bulletin` job honors the
// marker on its next tick, running the force compile via the cross-tick
// START/RESUME state machine (force + content dedupe; the daily 06:30 schedule
// pointer is left untouched), and clears the marker so it does not force every
// tick. The UI polls `bulletin.byCycle` to surface the published edition.
//
// Mirrors the other opt-in-guarded actions: opt-in-guard wrapped (opted-out →
// { error: 'OPT_IN_REQUIRED' }), THROWS on a missing required param.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';

import { forceRequestScope, type CompileBulletinCtx } from '../jobs/compile-bulletin.ts';

export type BulletinCompileNowCtx = OptInGuardActionCtx & CompileBulletinCtx;

export type BulletinCompileNowResult =
  | { kind: 'queued' }
  | { kind: 'error'; reason: string };

export function registerBulletinCompileNow(ctx: BulletinCompileNowCtx): void {
  wrapActionHandler(ctx, 'bulletin.compileNow', async (params): Promise<BulletinCompileNowResult> => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) throw new Error('bulletin.compileNow: companyId required');

    // The force compile is driven by the compile-bulletin job (cross-tick state
    // machine). Without ctx.state there is no place to enqueue the request —
    // surface a clear, non-throwing error the UI can show.
    if (!ctx.state?.set) {
      return {
        kind: 'error',
        reason: 'On-demand compile is unavailable on this install (plugin state not enabled).',
      };
    }

    try {
      await ctx.state.set(forceRequestScope(companyId), {
        requestedAt: new Date().toISOString(),
        requestedByUserId: typeof params?.userId === 'string' ? params.userId : null,
      });
    } catch (e) {
      return { kind: 'error', reason: `Could not queue the compile: ${(e as Error).message}` };
    }

    return { kind: 'queued' };
  });
}
