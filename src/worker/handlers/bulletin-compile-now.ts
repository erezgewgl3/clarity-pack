// src/worker/handlers/bulletin-compile-now.ts
//
// Quick task 260528-nns — `bulletin.compileNow` action: the operator's
// "Generate bulletin now" button on the Bulletin page.
//
// Runs the SAME compile pipeline the daily 06:30 cron uses, for the current
// company, via the shared `compileBulletinForCompany(..., { force: true })`:
//   - bypasses the `now >= next_due_at` due-gate,
//   - leaves the daily schedule pointer (next_due_at) UNTOUCHED,
//   - dedupes on content_hash (no new bulletin when nothing changed since the
//     last published one),
//   - skips breaker failure-table recording (an operator action must not trip
//     the D-06 auto-pause breaker).
//
// Mirrors bulletin-action-approve.ts: opt-in-guard wrapped (opted-out →
// { error: 'OPT_IN_REQUIRED' }), THROWS on a missing required param, otherwise
// returns a discriminated result the UI dispatches its copy on:
//   { kind: 'published', cycleNumber, publishedAt }
//   { kind: 'no-change', cycleNumber, publishedAt }
//   { kind: 'error', reason }   // paused/unavailable agent, compile/publish failure

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { Company } from '@paperclipai/plugin-sdk';

import {
  compileBulletinForCompany,
  resolveBulletinTz,
  type CompileBulletinCtx,
} from '../jobs/compile-bulletin.ts';

export type BulletinCompileNowCtx = OptInGuardActionCtx & CompileBulletinCtx;

export type BulletinCompileNowResult =
  | { kind: 'published'; cycleNumber: number; publishedAt: string }
  | { kind: 'no-change'; cycleNumber: number; publishedAt: string | null }
  | { kind: 'error'; reason: string };

export function registerBulletinCompileNow(ctx: BulletinCompileNowCtx): void {
  wrapActionHandler(ctx, 'bulletin.compileNow', async (params): Promise<BulletinCompileNowResult> => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) throw new Error('bulletin.compileNow: companyId required');

    // Resolve the company object (for the masthead display name); fall back to
    // a bare {id} if the list read fails or the id is not found.
    let company: Company;
    try {
      const companies = await ctx.companies.list();
      company = companies.find((c) => c.id === companyId) ?? ({ id: companyId } as Company);
    } catch {
      company = { id: companyId } as Company;
    }

    const result = await compileBulletinForCompany(ctx, company, {
      now: new Date(),
      bulletinTz: await resolveBulletinTz(ctx),
      force: true,
    });

    switch (result.kind) {
      case 'published':
        return { kind: 'published', cycleNumber: result.cycleNumber, publishedAt: result.publishedAt };
      case 'no-change':
        return { kind: 'no-change', cycleNumber: result.cycleNumber, publishedAt: result.publishedAt };
      case 'duplicate':
        // An idempotent re-publish of an already-published cycle reads the same
        // to the operator as "nothing new".
        return { kind: 'no-change', cycleNumber: result.cycleNumber, publishedAt: null };
      case 'skipped':
      case 'failed':
        return { kind: 'error', reason: result.reason };
      default:
        return { kind: 'error', reason: 'Compile produced an unexpected result.' };
    }
  });
}
