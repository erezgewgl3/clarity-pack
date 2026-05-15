// src/worker/jobs/compile-bulletin.ts
//
// Plan 03-01 — Bulletin compile job (Wave 1 skeleton).
//
// Wave-1 contract: the handler is registered under the manifest `jobs[]` key
// 'compile-bulletin' and runs every minute. On each fire it reads
// `bulletins.next_due_at` per company and short-circuits to a no-op when
// `now < next_due_at`. The actual two-pass compile + `ctx.issues.create`
// publish path lands in Plan 03-02. The full date-fns-tz round-trip for
// next_due_at is exercised here (the bootstrap path), so DST handling is
// locked behind CI before any compile pipeline goes near it.
//
// Mirrors src/worker/jobs/situation-snapshot.ts: per-company try/catch-and-
// continue (a single failing company never aborts the loop), warn-not-throw
// via `ctx.logger?.warn?.()`, and `ctx.jobs.register` registration. No
// `setInterval` — scheduling is the host's job (governance parity, D-12).

import type {
  PluginAgentsClient,
  PluginCompaniesClient,
  PluginDatabaseClient,
  PluginIssuesClient,
  PluginJobsClient,
  PluginLogger,
  Company,
} from '@paperclipai/plugin-sdk';

import { computeNextDueAt } from '../bulletin/next-due-at.ts';
import {
  getNextDueAtForCompany,
  upsertBulletin,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';

/**
 * Context shape the compile-bulletin job needs. Extends BulletinsRepoCtx so
 * the repo functions accept it directly. `logger` is optional to match the
 * Phase 2 job ctx shape; `issues` is present for Plan 03-02's publish path
 * (unused in the Wave-1 skeleton).
 */
export type CompileBulletinCtx = BulletinsRepoCtx & {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
  jobs: PluginJobsClient;
  companies: PluginCompaniesClient;
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
};

/**
 * Register the compile-bulletin job. Wave-1: skeleton only — gates correctly
 * and writes nothing real beyond the first-time bootstrap row.
 */
export function registerCompileBulletinJob(ctx: CompileBulletinCtx): void {
  ctx.jobs.register('compile-bulletin', async () => {
    const now = new Date();

    let companies: Company[] = [];
    try {
      companies = await ctx.companies.list();
    } catch (e) {
      ctx.logger?.warn?.('compile-bulletin: companies.list failed', {
        err: (e as Error).message,
      });
      return;
    }

    for (const company of companies) {
      try {
        const nextDueAtIso = await getNextDueAtForCompany(ctx, company.id);

        // Bootstrap: first ever compile for this company. Write a 'pending'
        // row carrying the freshly-computed next_due_at and return without
        // compiling — the next fire compiles only once now >= next_due_at.
        if (!nextDueAtIso) {
          const nextDueAt = computeNextDueAt(now);
          await upsertBulletin(ctx, {
            company_id: company.id,
            next_due_at: nextDueAt.toISOString(),
            compiled_at: null,
            verified_at: null,
            published_at: null,
            published_issue_id: null,
            compile_status: 'pending',
            content_hash: '__bootstrap__',
            lineage_thread_json: [],
            draft_json: {},
          });
          ctx.logger?.info?.('compile-bulletin: bootstrapped next_due_at', {
            companyId: company.id,
            nextDueAt: nextDueAt.toISOString(),
          });
          continue;
        }

        // Gate: not yet due → no-op.
        if (now.toISOString() < nextDueAtIso) {
          continue;
        }

        // Wave-1 stub: due, but the two-pass compile pipeline is implemented
        // in Plan 03-02. Log and return — no INSERT yet. Plan 03-02 replaces
        // this block with facts-table extraction → LLM pass-1 → deterministic
        // pass-2 verifier → ctx.issues.create publish → bulletins.compile_
        // status='published' UPDATE.
        ctx.logger?.info?.(
          'compile-bulletin: cycle due, awaiting Plan 03-02 pipeline',
          { companyId: company.id, nextDueAtIso },
        );
      } catch (e) {
        ctx.logger?.warn?.('compile-bulletin: per-company iteration failed', {
          companyId: company.id,
          err: (e as Error).message,
        });
      }
    }
  });
}
