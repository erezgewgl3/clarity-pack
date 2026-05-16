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
  getBulletinByCycle,
  getNextDueAtForCompany,
  listErrataByCycle,
  upsertBulletin,
  recordCompileFailure,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';
import { computeStandingNumbers, STANDING_NUMBER_SLOTS } from '../bulletin/standing-numbers.ts';
import { computeFactsTable } from '../bulletin/facts-table.ts';
import { compilePass1 } from '../bulletin/compile-pass-1.ts';
import { verifyDraft } from '../bulletin/bulletin-verifier.ts';
import { publishBulletin, type PublishBulletinArgs } from '../bulletin/publish.ts';
import {
  recordFailure,
  recordSuccess,
  isCircuitOpenDurable,
  BULLETIN_COMPILE_AGENT_KEY,
} from '../agents/circuit-breaker.ts';
// EDITOR_AGENT_KEY is the manifest agents[] key — the SINGLE source of truth
// lives in editor.ts and MUST equal manifest.agents[].agentKey ('editor-agent').
// Do NOT redefine it here: a local copy with the wrong string ('clarity-pack-
// editor-agent', the value of the unrelated EDITOR_AGENT_ID_TAG) made every
// ctx.agents.managed.reconcile() throw "reconcile failed" — the compile-bulletin
// job silently bailed before compiling. Surfaced by the Plan 03-05 drill.
import { EDITOR_AGENT_KEY } from '../agents/editor.ts';
// Plan 03-06 — production LLM invocation via the operation-issue handoff
// (Path (d)). Plan 03-05's sessionLlmAdapter is superseded: the host discards
// the session prompt before it reaches the agent (PR #3106). The compile
// prompt is now delivered as the body of an operation issue ASSIGNED to the
// Editor-Agent; the agent's heartbeat reads it and posts the BulletinDraft
// JSON as a comment. See 03-AGENT-INVOCATION-GAP-RESEARCH.md.
import { deliveryLlmAdapter } from '../agents/agent-task-delivery.ts';
// Plan 03-03 — cycle-start department reconcile + deterministic lineage build.
import { reconcileDepartments } from '../bulletin/department-reconcile.ts';
import { groupLineageThreads, type ActivityEvent } from '../bulletin/lineage-grouper.ts';
import type { BulletinDraft, StandingNumberRow } from '../../shared/types.ts';

/** Retry spacing for a failed compile cycle (D-22 — 15 minutes). */
const RETRY_INTERVAL_MS = 15 * 60 * 1000;

export function computeCompileRetry(
  priorFailureCount: number,
  now: Date,
): { attemptN: number; nextRetryAt: string } {
  return {
    attemptN: Math.max(0, priorFailureCount) + 1,
    nextRetryAt: new Date(now.getTime() + RETRY_INTERVAL_MS).toISOString(),
  };
}

async function countCompileFailuresForCycle(
  ctx: BulletinsRepoCtx,
  cycleNumber: number,
): Promise<number> {
  try {
    const rows = await ctx.db.query<{ failure_count?: number; count?: number; n?: number }>(
      `SELECT COUNT(*)::int AS failure_count
       FROM plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures
       WHERE cycle_number = $1`,
      [cycleNumber],
    );
    const raw = rows[0]?.failure_count ?? rows[0]?.count ?? rows[0]?.n ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function recordCycleCompileFailure(
  ctx: BulletinsRepoCtx,
  args: { cycleNumber: number; reason: string; now: Date },
): Promise<void> {
  const priorFailureCount = await countCompileFailuresForCycle(ctx, args.cycleNumber);
  const retry = computeCompileRetry(priorFailureCount, args.now);
  await recordCompileFailure(ctx, {
    cycle_number: args.cycleNumber,
    reason: args.reason,
    attempt_n: retry.attemptN,
    next_retry_at: retry.nextRetryAt,
  });
}

async function buildPriorCycleErratumSnapshot(
  ctx: BulletinsRepoCtx,
  companyId: string,
  cycleNumber: number,
): Promise<PublishBulletinArgs['priorCycleErratumSnapshot']> {
  if (cycleNumber <= 1) return undefined;
  const priorCycle = cycleNumber - 1;
  const priorBulletin = await getBulletinByCycle(ctx, companyId, priorCycle);
  if (!priorBulletin?.published_issue_id) return undefined;
  const errata = (await listErrataByCycle(ctx, companyId, priorCycle)).filter(
    (row) => !row.applied_to_issue_comment_id,
  );
  if (errata.length === 0) return undefined;
  return {
    priorIssueId: priorBulletin.published_issue_id,
    erratumIds: errata.map((row) => row.id),
    erratumBodies: errata.map((row) => row.body_md),
  };
}

/**
 * Render a thrown value as a string for a log MESSAGE (not metadata).
 * The Paperclip host forwards only a fixed set of plugin-log fields and drops
 * arbitrary metadata keys like `err`, so the error must live in the message
 * string itself to survive into `~/paperclip-run.log`. Surfaced Plan 03-05.
 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

/** v1 default departments — Plan 03-03 reads these from instanceConfig. */
const DEFAULT_DEPARTMENTS = ['Production', 'Sales', 'Customer', 'Builder'];

/**
 * Context shape the compile-bulletin job needs. Extends BulletinsRepoCtx so
 * the repo functions accept it directly.
 *
 * There is no synthetic `llm` member. The job builds a real
 * `deliveryLlmAdapter` per company from `ctx.issues` + the resolved
 * `editorAgentId` (Plan 03-06 — the operation-issue handoff) and passes it
 * into `compilePass1` as an argument. Every member below is a real
 * `PluginContext` field; `ctx.issues` carries `create`/`list`/`requestWakeup`/
 * `listComments` for the handoff.
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
        //
        // cycle_number 0 is a SENTINEL: the bootstrap row is a schedule
        // carrier, not a real bulletin. Real bulletins start at cycle 1
        // (MAX(published cycle) + 1 with no published rows = 1). Letting
        // upsertBulletin auto-assign here would make the bootstrap row cycle 1
        // too, and the first real compile's publishBulletin INSERT (cycle 1)
        // would then collide on the bulletins primary key — its
        // `ON CONFLICT (next_due_at, content_hash)` clause does NOT catch a PK
        // conflict, so the INSERT throws and the first bulletin can never
        // publish. Surfaced by the Plan 03-03 Countermoves drill 2026-05-15.
        if (!nextDueAtIso) {
          const nextDueAt = computeNextDueAt(now);
          await upsertBulletin(ctx, {
            cycle_number: 0,
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
          ctx.logger?.warn?.(`compile-bulletin: editor-agent reconcile failed: ${errText(e)}`, {
            companyId: company.id,
          });
          continue;
        }
        if (!editorAgentId) {
          ctx.logger?.warn?.('compile-bulletin: no editor-agent id', {
            companyId: company.id,
          });
          continue;
        }

        // Plan 03-06 — breaker-aware resume of the Editor-Agent.
        //
        // The manifest declares the Editor-Agent `status: 'paused'` (a
        // coexistence-friendly default — Eric reviews the agent before
        // anything runs). On a FRESH install the first compile hits a paused
        // agent that no one has ever run, and resuming it is legitimate.
        //
        // BUT a paused agent whose circuit breaker is OPEN was paused BY the
        // breaker (D-06 — recordFailure pauses after MAX_CONSECUTIVE_FAILURES).
        // Auto-resuming it is the resume-defeats-breaker loop: the live Plan
        // 03-04 drill saw `attempt_n` run from 466 → 470 because the job
        // resumed the agent on every fire (03-AGENT-INVOCATION-GAP-RESEARCH.md
        // "Secondary Bug"). So resume ONLY when the breaker is NOT open.
        //
        // `isCircuitOpenDurable` reads the durable `editor_agent_failures`
        // table, so the breaker latches across worker restarts — the
        // in-memory counter alone would forget the trip on reboot. When the
        // breaker IS open we leave the agent paused, warn, and `continue` the
        // company: the operator must click Resume (D-06 — no auto-resume).
        //
        // `resume` flips `paused → idle` only; a `terminated`/
        // `pending_approval` agent rejects resume (host-enforced) — a real
        // operator-action failure, warned + skipped, not a compile bug.
        try {
          const agent = await ctx.agents.get(editorAgentId, company.id);
          if (agent?.status === 'paused') {
            if (await isCircuitOpenDurable(ctx, BULLETIN_COMPILE_AGENT_KEY)) {
              ctx.logger?.warn?.(
                `compile-bulletin: Editor-Agent is paused AND the bulletin-compile ` +
                  `circuit breaker is open — not resuming (D-06: operator must click ` +
                  `Resume). companyId=${company.id} agentId=${editorAgentId}`,
              );
              continue;
            }
            await ctx.agents.resume(editorAgentId, company.id);
            ctx.logger?.info?.('compile-bulletin: resumed paused Editor-Agent', {
              companyId: company.id,
              agentId: editorAgentId,
            });
          }
        } catch (e) {
          ctx.logger?.warn?.(`compile-bulletin: editor-agent resume failed: ${errText(e)}`, {
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
          ctx.logger?.warn?.(`compile-bulletin: lineage activities fetch failed: ${errText(e)}`, {
            companyId: company.id,
          });
        }
        const lineageThreads = groupLineageThreads(lineageActivities, { maxDeltaSec: 300 });

        // 2. Compute standing numbers (verified-numerics pre-LLM).
        let standingValues: Record<string, number>;
        try {
          standingValues = await computeStandingNumbers(ctx, company.id);
        } catch (e) {
          ctx.logger?.warn?.(`compile-bulletin: standing-numbers failed: ${errText(e)}`, {
            companyId: company.id,
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
        //
        // Plan 03-06: build the REAL operation-issue-backed LlmAdapter. Its
        // `complete()` creates an operation issue assigned to the Editor-Agent
        // (originKind `plugin:clarity-pack:operation:bulletin-compile`,
        // operationId `cycle-N`), wakes the agent, and polls for the agent's
        // BulletinDraft-JSON result comment — the discarded-session-prompt
        // path is gone. A delivery timeout, a create failure, or an
        // unparseable result all surface as a pass-1 throw routed through the
        // existing catch → recordCompileFailure block below — no new failure
        // machinery.
        const llm = deliveryLlmAdapter(ctx, {
          agentId: editorAgentId,
          companyId: company.id,
          operationKind: 'bulletin-compile',
          operationId: `cycle-${cycleNumber}`,
          title: `Compile Daily Bulletin — cycle ${cycleNumber}`,
        });
        let draft: BulletinDraft;
        try {
          draft = await compilePass1(ctx, {
            companyId: company.id,
            cycleNumber,
            factsTable,
            standingNumbers: standingNumberRows,
            departments: DEFAULT_DEPARTMENTS,
            editorAgentId,
            llm,
          });
        } catch (e) {
          // recordFailure already invoked inside compilePass1.
          await recordCycleCompileFailure(ctx, {
            cycleNumber,
            reason: `pass-1 failed: ${(e as Error).message}`,
            now,
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
            // editorAgentId is the resolved UUID — guaranteed non-null here by
            // the `if (!editorAgentId) continue` guard earlier in the loop. It
            // must be a real UUID: recordFailure's breaker-trip path calls
            // ctx.agents.pause(agentId), which the host rejects if it is not.
            agentId: editorAgentId,
            companyId: company.id,
            reason,
          });
          await recordCycleCompileFailure(ctx, {
            cycleNumber,
            reason,
            now,
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
        const priorCycleErratumSnapshot = await buildPriorCycleErratumSnapshot(
          ctx,
          company.id,
          cycleNumber,
        );

        // 6. Publish — two-phase write.
        const publishResult = await publishBulletin(ctx, {
          companyId: company.id,
          cycleNumber,
          nextDueAtIso,
          editorAgentId,
          draft: draftWithLineage,
          compiledAt: now,
          priorCycleErratumSnapshot,
        });

        if (publishResult.kind === 'failed') {
          await recordCycleCompileFailure(ctx, {
            cycleNumber,
            reason: publishResult.reason,
            now,
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
        ctx.logger?.warn?.(`compile-bulletin: per-company iteration failed: ${errText(e)}`, {
          companyId: company.id,
        });
      }
    }
  });
}
