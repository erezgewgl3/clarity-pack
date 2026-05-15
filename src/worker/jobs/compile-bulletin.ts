// src/worker/jobs/compile-bulletin.ts
//
// Plan 03-02 — Bulletin compile job (the real two-pass pipeline).
//
// Wave-1 (Plan 03-01) shipped this as a no-op skeleton: register under the
// manifest `jobs[]` key 'compile-bulletin', read `bulletins.next_due_at` per
// company, short-circuit when `now < next_due_at`. Plan 03-02 replaces the
// Wave-1 stub block with the real pipeline:
//
//   computeStandingNumbers → computeFactsTable → compilePass1 (LLM) →
//   verifyDraft (deterministic pass-2) → publishBulletin (two-phase write) →
//   advance next_due_at.
//
// Per-company try/catch isolates failures (a single failing company never
// aborts the loop). A verifier rejection records a bulletin-compile failure;
// 3 consecutive rejections trip the existing circuit breaker (Phase 2 D-06)
// via recordFailure(agentKey='bulletin-compile') — a SEPARATE counter from
// compile-tldr's, so a bulletin outage cannot pause TL;DR compiles.
//
// No `setInterval` — scheduling is the host's job (governance parity, D-12).

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
  recordCompileFailure,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';
import { computeStandingNumbers, STANDING_NUMBER_SLOTS } from '../bulletin/standing-numbers.ts';
import { computeFactsTable } from '../bulletin/facts-table.ts';
import { compilePass1, type LlmAdapter } from '../bulletin/compile-pass-1.ts';
import { verifyDraft } from '../bulletin/bulletin-verifier.ts';
import { publishBulletin } from '../bulletin/publish.ts';
import { recordFailure, recordSuccess, BULLETIN_COMPILE_AGENT_KEY } from '../agents/circuit-breaker.ts';
import { EDITOR_AGENT_ID_TAG } from '../agents/compile-tldr.ts';
// Plan 03-03 — cycle-start department reconcile + deterministic lineage build.
import { reconcileDepartments } from '../bulletin/department-reconcile.ts';
import { groupLineageThreads, type ActivityEvent } from '../bulletin/lineage-grouper.ts';
import type { BulletinDraft, StandingNumberRow } from '../../shared/types.ts';

/** Editor-Agent manifest key — used for ctx.agents.managed.reconcile. */
const EDITOR_AGENT_KEY = 'clarity-pack-editor-agent';

/** Retry spacing for a failed compile cycle (D-22 — 15 minutes). */
const RETRY_INTERVAL_MS = 15 * 60 * 1000;

/** v1 default departments — Plan 03-03 reads these from instanceConfig. */
const DEFAULT_DEPARTMENTS = ['Production', 'Sales', 'Customer', 'Builder'];

/**
 * Context shape the compile-bulletin job needs. Extends BulletinsRepoCtx so
 * the repo functions accept it directly. `llm` is optional so tests can inject
 * a stub LlmAdapter; production wires it through the Editor-Agent adapter.
 */
export type CompileBulletinCtx = BulletinsRepoCtx & {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
  jobs: PluginJobsClient;
  companies: PluginCompaniesClient;
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
  llm?: LlmAdapter;
};

/**
 * Register the compile-bulletin job. On each fire it iterates companies; for a
 * company that is at-or-past `next_due_at` it runs the full two-pass pipeline.
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

        // ---- Plan 03-02 — Real two-pass compile pipeline ----

        // Resolve the Editor-Agent id for this company (Phase 2 reconcile output).
        let editorAgentId: string | null;
        try {
          const resolution = await ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, company.id);
          editorAgentId = resolution.agentId;
        } catch (e) {
          ctx.logger?.warn?.('compile-bulletin: editor-agent reconcile failed', {
            companyId: company.id,
            err: (e as Error).message,
          });
          continue;
        }
        if (!editorAgentId) {
          ctx.logger?.warn?.('compile-bulletin: no editor-agent id', {
            companyId: company.id,
          });
          continue;
        }

        // 1. Compute the cycle number — MAX(published cycle) + 1.
        const maxRows = await ctx.db.query<{ max_cycle: number }>(
          `SELECT COALESCE(MAX(cycle_number), 0)::int AS max_cycle
           FROM plugin_clarity_pack_cdd6bda4bd.bulletins
           WHERE company_id = $1 AND compile_status = $2`,
          [company.id, 'published'],
        );
        const cycleNumber = (maxRows[0]?.max_cycle ?? 0) + 1;

        // ---- Plan 03-03 — Cycle-start reconcile + lineage build ----
        // 1a. Reconcile department membership (idempotent — ON CONFLICT DO
        //     NOTHING keeps manual overrides). Best-effort; a failure here is
        //     warned inside reconcileDepartments and never aborts the compile.
        await reconcileDepartments(ctx, company.id);

        // 1b. Build deterministic lineage threads from recent activity. The SDK
        //     has no list-activities-by-time-window tool and no
        //     `caused_by_activity_id` field (03-RESEARCH.md Q3/Q4), so v1
        //     derives activity events from issues updated in the cycle window
        //     (last 24h).
        //
        //     W5 (deviation_protocol #7, RESOLVED): `Issue.lastActorId` /
        //     `lastActorName` are NOT fields on the SDK `Issue` type — a grep of
        //     node_modules/@paperclipai/plugin-sdk/dist/types.d.ts finds zero
        //     matches. Relying on a cast to `lastActorId` would collapse every
        //     activity to a single 'unknown' actor and produce one giant
        //     cluster. The documented fallback is the confirmed `assigneeUserId`
        //     field as the actor key (and the issue title as the display name).
        const lineageActivities: ActivityEvent[] = [];
        try {
          const cycleWindowMs = 24 * 60 * 60 * 1000;
          const recentIssues = (await ctx.issues.list({
            companyId: company.id,
          })) as unknown as Array<{
            id: string;
            title?: string;
            updatedAt?: string | Date;
            assigneeUserId?: string | null;
          }>;
          for (const i of recentIssues ?? []) {
            if (!i.updatedAt) continue;
            const updatedIso =
              i.updatedAt instanceof Date ? i.updatedAt.toISOString() : String(i.updatedAt);
            if (now.getTime() - new Date(updatedIso).getTime() > cycleWindowMs) continue;
            lineageActivities.push({
              id: `${i.id}-${updatedIso}`,
              entityId: i.id,
              // W5: confirmed field — assigneeUserId — as the actor key.
              actorId: i.assigneeUserId ?? 'unassigned',
              timestamp: updatedIso,
              message: i.title ?? '(untitled issue)',
              name: i.title ?? 'Agent',
              detail: i.title ?? '',
            });
          }
        } catch (e) {
          ctx.logger?.warn?.('compile-bulletin: lineage activities fetch failed', {
            companyId: company.id,
            err: (e as Error).message,
          });
        }
        const lineageThreads = groupLineageThreads(lineageActivities, { maxDeltaSec: 300 });

        // 2. Compute standing numbers (verified-numerics pre-LLM).
        let standingValues: Record<string, number>;
        try {
          standingValues = await computeStandingNumbers(ctx, company.id);
        } catch (e) {
          ctx.logger?.warn?.('compile-bulletin: standing-numbers failed', {
            companyId: company.id,
            err: (e as Error).message,
          });
          continue;
        }

        // 3. Build the factsTable + standingNumbers rows.
        const slotDefs: Record<
          string,
          { sql: string; params: unknown[]; format: 'currency' | 'count' | 'pct' | 'ratio' }
        > = {};
        const standingNumberRows: StandingNumberRow[] = [];
        for (const slot of STANDING_NUMBER_SLOTS) {
          slotDefs[slot.key] = { sql: slot.sql, params: slot.params, format: slot.format };
          standingNumberRows.push({
            key: slot.key,
            displayName: slot.displayName,
            value: standingValues[slot.key] ?? 0,
            format: slot.format,
          });
        }
        const factsTable = computeFactsTable({ rows: standingValues, slotDefs });

        // 4. Pass 1 — LLM produces a structured BulletinDraft.
        let draft: BulletinDraft;
        try {
          draft = await compilePass1(ctx, {
            companyId: company.id,
            cycleNumber,
            factsTable,
            standingNumbers: standingNumberRows,
            departments: DEFAULT_DEPARTMENTS,
          });
        } catch (e) {
          // recordFailure already invoked inside compilePass1.
          await recordCompileFailure(ctx, {
            cycle_number: cycleNumber,
            reason: `pass-1 failed: ${(e as Error).message}`,
            attempt_n: 1,
            next_retry_at: new Date(now.getTime() + RETRY_INTERVAL_MS).toISOString(),
          });
          continue;
        }

        // 5. Pass 2 — deterministic verifier re-runs every standing-number SQL.
        const verdict = await verifyDraft(draft, ctx.db, company.id);
        if (!verdict.ok) {
          const reason =
            'mismatches' in verdict
              ? `verifier rejected: ${JSON.stringify(verdict.mismatches)}`
              : `verifier rejected: ${verdict.kind}:${verdict.slot}`;
          await recordFailure(ctx, {
            agentKey: BULLETIN_COMPILE_AGENT_KEY,
            agentId: editorAgentId ?? EDITOR_AGENT_ID_TAG,
            companyId: company.id,
            reason,
          });
          await recordCompileFailure(ctx, {
            cycle_number: cycleNumber,
            reason,
            attempt_n: 1,
            next_retry_at: new Date(now.getTime() + RETRY_INTERVAL_MS).toISOString(),
          });
          continue;
        }

        // Plan 03-03 — override the draft's lineageThreads with the
        // deterministically-grouped threads. The LLM may emit an empty
        // lineageThreads array; the verified, pure-code threads are the
        // authoritative source (BULL-04 / D-21).
        const draftWithLineage: BulletinDraft = {
          ...draft,
          lineageThreads:
            lineageThreads.length > 0 ? lineageThreads : draft.lineageThreads ?? [],
        };

        // 6. Publish — two-phase write.
        const publishResult = await publishBulletin(ctx, {
          companyId: company.id,
          cycleNumber,
          nextDueAtIso,
          editorAgentId,
          draft: draftWithLineage,
          compiledAt: now,
        });

        if (publishResult.kind === 'failed') {
          await recordCompileFailure(ctx, {
            cycle_number: cycleNumber,
            reason: publishResult.reason,
            attempt_n: 1,
            next_retry_at: new Date(now.getTime() + RETRY_INTERVAL_MS).toISOString(),
          });
          continue;
        }

        if (publishResult.kind === 'duplicate') {
          ctx.logger?.info?.('compile-bulletin: duplicate (idempotency); advancing next_due_at', {
            companyId: company.id,
            cycleNumber,
          });
        }

        // A verified publish (or an idempotent duplicate) is a clean
        // bulletin-compile cycle — reset the shared circuit-breaker counter so
        // a transient earlier failure does not carry over.
        recordSuccess(BULLETIN_COMPILE_AGENT_KEY);

        // 7. Advance next_due_at to tomorrow's 06:30 ET instant.
        const newNextDueAt = computeNextDueAt(now);
        await ctx.db.execute(
          `UPDATE plugin_clarity_pack_cdd6bda4bd.bulletins
             SET next_due_at = $1
           WHERE cycle_number = $2 AND company_id = $3`,
          [newNextDueAt.toISOString(), cycleNumber, company.id],
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
