// src/worker/handlers/bulletin-compile-now.ts
//
// Quick task 260528-nns — `bulletin.compileNow` action: the operator's
// "Generate bulletin now" button on the Bulletin page.
//
// View-driven rework (2026-05-28). The scheduled compile-bulletin job's
// invocation scope is DEAD for host calls on paperclipai@2026.525.0 (PR #6547),
// so the earlier "write a force-marker for the job to honor" approach can never
// run (the job can't read the marker OR make host calls). An ACTION, by
// contrast, runs in a valid HTTP-request scope (the old synchronous version
// successfully created operation issues + woke the agent before its scope
// expired mid-poll). So the action now does the cross-tick START itself —
// `compileBulletinForCompany(force:true)`: reconcile + standing numbers + facts
// + prompt + startAgentTask + ONE immediate poll, persisting a pending record
// (ctx.state) if the agent isn't warm. The `bulletin.byCycle` data handler (also
// a valid scope, polled by the open page) then CONSUMES the result + publishes.
//
// The action returns { kind:'queued' } immediately — it never holds its
// invocation across the agent round-trip. The UI shows "Compiling…", polls
// byCycle (which advances + publishes), and renders the new edition.
//
// Opt-in-guard wrapped (opted-out → { error:'OPT_IN_REQUIRED' }); THROWS on a
// missing companyId.

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { Company } from '@paperclipai/plugin-sdk';

import {
  compileBulletinForCompany,
  resolveBulletinTz,
  type CompileBulletinCtx,
} from '../jobs/compile-bulletin.ts';

export type BulletinCompileNowCtx = OptInGuardActionCtx & CompileBulletinCtx;

export type BulletinCompileNowResult =
  | { kind: 'queued' }
  | { kind: 'error'; reason: string };

export function registerBulletinCompileNow(ctx: BulletinCompileNowCtx): void {
  wrapActionHandler(ctx, 'bulletin.compileNow', async (params): Promise<BulletinCompileNowResult> => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) throw new Error('bulletin.compileNow: companyId required');

    // Resolve the company (for the masthead display name); fall back to a bare
    // {id} if the list read fails or the id is not found.
    let company: Company;
    try {
      const companies = await ctx.companies.list();
      company = companies.find((c) => c.id === companyId) ?? ({ id: companyId } as Company);
    } catch {
      company = { id: companyId } as Company;
    }

    // Do the force START in THIS action's valid scope. compileBulletinForCompany
    // bounds its host calls (no long poll): it creates/reuses the operation
    // issue, does one immediate readback (publishes if the agent is already
    // warm — e.g. a reused op whose result is filed), else persists a pending
    // record for byCycle to consume. Never blocks across the agent round-trip.
    try {
      await compileBulletinForCompany(ctx, company, {
        now: new Date(),
        bulletinTz: await resolveBulletinTz(ctx),
        force: true,
      });
    } catch (e) {
      return { kind: 'error', reason: `Could not start the compile: ${(e as Error).message}` };
    }

    return { kind: 'queued' };
  });
}
