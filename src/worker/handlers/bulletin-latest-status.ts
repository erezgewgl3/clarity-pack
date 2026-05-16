// src/worker/handlers/bulletin-latest-status.ts
//
// Plan 03-04 - BULL-08 failed-compile banner state machine. The UI asks this
// handler for the latest retry window; stale failures hide once next_retry_at
// is due so the banner never lingers after the worker should retry.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  getLatestCompileFailure,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';
import type { CompileFailureStatus } from '../../shared/types.ts';

export type BulletinLatestStatusCtx = OptInGuardDataCtx & BulletinsRepoCtx;

export function registerBulletinLatestStatus(ctx: BulletinLatestStatusCtx): void {
  wrapDataHandler(ctx, 'bulletin.latestCompileStatus', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) return { kind: 'ok' as const };

    try {
      const failure = await getLatestCompileFailure(ctx, companyId);
      if (!failure) return { kind: 'ok' as const };

      const retryAtMs = new Date(failure.next_retry_at).getTime();
      if (!Number.isFinite(retryAtMs) || retryAtMs <= Date.now()) {
        return { kind: 'ok' as const };
      }

      return {
        kind: 'failed',
        attemptAt: failure.failed_at,
        nextRetryAt: failure.next_retry_at,
        reason: failure.reason,
        attemptN: failure.attempt_n,
      } satisfies CompileFailureStatus;
    } catch (e) {
      ctx.logger?.warn?.('bulletin.latestCompileStatus: read failed', {
        companyId,
        err: (e as Error).message,
      });
      return { kind: 'ok' as const };
    }
  });
}
