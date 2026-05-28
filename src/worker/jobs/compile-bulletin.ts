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
//
// v0.6.6 — RUNAWAY-CADENCE FIX (debug bulletin-compile-cadence-runaway, Bug 1).
// The Bulletin is a DAILY artifact (cron `0 6 30 * * *` America/New_York). The
// every-minute heartbeat cron is only a "is it time yet?" hint — the real
// schedule pointer is `bulletins.next_due_at`. The 2026-05-18 drill saw the job
// re-compile + re-publish a new cycle every ~2 minutes, unbounded: the schedule
// pointer was advanced ONLY on the success/duplicate path AND only on the
// just-published per-cycle row, so any tick that hit a failure `continue`
// (verifier rejection, pass-1 throw, publish failure) left a STALE, past
// `next_due_at` on the row `getNextDueAtForCompany` reads — and the very next
// heartbeat tick re-compiled. The fix: `advanceScheduleForCompany` moves the
// pointer to the next genuine 06:30-ET slot strictly after `now`, and it runs
// on EVERY path that consumed a due tick (success AND every failure path). A
// failed cycle is retried by the D-22 15-minute retry timer
// (`bulletin_compile_failures.next_retry_at`), NOT by an every-minute recompile.

import type {
  PluginAgentsClient,
  PluginCompaniesClient,
  PluginConfigClient,
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

/**
 * Plan 04.1-11 — pure cadence gate decision.
 *
 * Returns `true` when `now` is at or past the next-due-at instant (compile may
 * proceed), `false` when the instant is still in the future (gate triggers
 * `continue`). Pure / unit-testable — extracted from the per-company loop in
 * `registerCompileBulletinJob` so the same-day-format regression
 * (`bulletin-compile-cadence-runaway.md` 2026-05-21 RE-DRILL) can be pinned
 * with a focused test without spinning up the full job ctx.
 *
 * IMPORTANT: this MUST construct `Date` objects and compare epoch ms — the
 * earlier implementation lexicographically compared `now.toISOString()`
 * (with 'T' separator) against the Postgres-format string (with space
 * separator), which reversed chronological order on same-day comparisons.
 *
 * @param now              the current instant (from job context)
 * @param nextDueAtIso     the next-due-at value as returned by Postgres
 *                         `timestamptz` (e.g. `'2026-05-21 10:30:00+00'`)
 *                         OR as written by Date.prototype.toISOString
 *                         (e.g. `'2026-05-21T10:30:00.000Z'`). Both formats
 *                         must work — `getNextDueAtForCompany` reads what
 *                         the driver returns and `upsertBulletin` writes
 *                         ISO-8601, so the value crossing this gate may be
 *                         in either shape.
 * @returns `true` if `now >= nextDueAt` (proceed to compile), `false` if
 *          `now < nextDueAt` (no-op this tick).
 */
export function isPastDue(now: Date, nextDueAtIso: string): boolean {
  return now.getTime() >= new Date(nextDueAtIso).getTime();
}

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

/**
 * v0.6.6 (Bug 1) — advance the company's bulletin schedule pointer to the next
 * genuine 06:30-ET slot strictly after `now`.
 *
 * `next_due_at` is the worker-managed source of truth for the DAILY compile
 * cadence (D-12). `getNextDueAtForCompany` reads it off the `MAX(cycle_number)`
 * row, so to guarantee the very next heartbeat tick sees a FUTURE pointer this
 * UPDATE touches EVERY bulletin row for the company — not just the row that
 * happened to publish. That is safe: `next_due_at` is a schedule pointer, not a
 * historical fact of any individual cycle, and the published bulletin's
 * identity is its `cycle_number` + `published_at` (never its `next_due_at`).
 *
 * Called on EVERY path that consumed a due tick — a verified publish, an
 * idempotent duplicate, AND every failure `continue` (verifier rejection,
 * pass-1 throw, publish failure, an unexpected per-company throw). A failed
 * cycle is re-attempted by the D-22 retry timer
 * (`bulletin_compile_failures.next_retry_at`), never by the every-minute cron.
 *
 * Best-effort: a throw here is logged and swallowed — failing to advance the
 * pointer must not abort the per-company loop, and the per-company catch-all
 * will still record the underlying failure.
 */
async function advanceScheduleForCompany(
  ctx: { db: Pick<PluginDatabaseClient, 'execute'>; logger?: PluginLogger },
  companyId: string,
  now: Date,
  tz?: string,
): Promise<void> {
  try {
    const nextDueAt = computeNextDueAt(now, tz);
    await ctx.db.execute(
      `UPDATE plugin_clarity_pack_cdd6bda4bd.bulletins
         SET next_due_at = $1
       WHERE company_id = $2`,
      [nextDueAt.toISOString(), companyId],
    );
    ctx.logger?.info?.(
      `compile-bulletin: advanced next_due_at to ${nextDueAt.toISOString()} ` +
        `(companyId=${companyId})`,
    );
  } catch (e) {
    ctx.logger?.warn?.(
      `compile-bulletin: failed to advance next_due_at: ${errText(e)} ` +
        `(companyId=${companyId})`,
    );
  }
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
  // 2026-05-28 — optional config client so the job can read the
  // operator-configurable `bulletinTimezone` (default Asia/Jerusalem) and
  // pass it to computeNextDueAt. Optional + defensively read so older test
  // fixtures that omit it still type-check and fall back to BULLETIN_TZ.
  config?: PluginConfigClient;
};

/**
 * 2026-05-28 — resolve the configured bulletin timezone, defensively.
 * Reads `bulletinTimezone` from instanceConfig; on any failure (no config
 * client, get() throws, empty/non-string value) returns undefined so the
 * caller falls back to computeNextDueAt's BULLETIN_TZ default.
 */
async function resolveBulletinTz(ctx: CompileBulletinCtx): Promise<string | undefined> {
  try {
    const raw = (await ctx.config?.get?.()) as Record<string, unknown> | undefined;
    const tz = raw?.bulletinTimezone;
    return typeof tz === 'string' && tz.trim() ? tz.trim() : undefined;
  } catch (e) {
    ctx.logger?.warn?.('compile-bulletin: config.get failed; using default timezone', {
      err: (e as Error).message,
    });
    return undefined;
  }
}

/**
 * Register the compile-bulletin job. On each fire it iterates companies; for a
 * company that is at-or-past `next_due_at` it runs the full two-pass pipeline.
 */
export function registerCompileBulletinJob(ctx: CompileBulletinCtx): void {
  ctx.jobs.register('compile-bulletin', async () => {
    const now = new Date();
    // 2026-05-28 — resolve the operator-configured bulletin timezone once per
    // tick (default Asia/Jerusalem via computeNextDueAt's BULLETIN_TZ fallback
    // when this is undefined). Passed to every computeNextDueAt call below so
    // the daily 06:30 target is in the configured zone.
    const bulletinTz = await resolveBulletinTz(ctx);

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
      // Defect D (2026-05-17 v0.6.2 re-drill). The per-company iteration tracks
      // a `cycleNumber` (set once the cycle is computed) so the catch at the
      // bottom can route an UNEXPECTED throw — a render/publish-path TypeError,
      // a bug anywhere in the per-company body that is NOT one of the handled
      // `continue`-on-failure paths — through BOTH `recordFailure` (so the D-06
      // bulletin-compile circuit breaker can trip) AND `recordCycleCompileFailure`
      // (so the D-22 failed-compile banner shows). Before this fix the catch
      // only `warn`-logged; a render TypeError thrown from `publishBulletin`'s
      // un-try-wrapped `renderBulletinIssueBody` call surfaced as
      // `job completed successfully`, the breaker never tripped, and the broken
      // loop created an operation issue every minute forever (v0.6.1 drill).
      let cycleNumber: number | null = null;
      // v0.6.6 (Bug 1) — set true once the per-company body passes the
      // `now < next_due_at` gate, i.e. this company genuinely consumed a due
      // tick. The per-company catch-all uses it to advance the schedule pointer
      // even when an UNEXPECTED throw bypassed every handled `continue` — so a
      // throw can never leave a stale past `next_due_at` and trigger the
      // every-minute recompile runaway.
      let gatePassed = false;
      // The resolved Editor-Agent UUID, captured so the catch-all `recordFailure`
      // can pause the real agent. Null until reconcile succeeds — when it is
      // still null the catch-all skips `recordFailure` (an un-resolved agent has
      // no UUID to pause; the throw is logged but the breaker is not advanced).
      let editorAgentIdForCatch: string | null = null;
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
          const nextDueAt = computeNextDueAt(now, bulletinTz);
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
        //
        // Plan 04.1-11 (2026-05-21) — DATE compare via `isPastDue` helper, NOT
        // string compare. `now.toISOString()` produces "...T..." but Postgres
        // timestamptz returns "... ..." (space separator). String-comparing
        // them with `<` reverses the chronological relation when both
        // timestamps fall on the SAME DAY (ASCII 'T' > ' '). Same-day gate
        // failure ran the compile every tick → bulletin cycle #691 on
        // Countermoves 2026-05-21 before manual SQL bleed-stop. The v0.6.6
        // fix advanced next_due_at correctly but the gate that READS it was
        // the bug. `isPastDue` is exported so test/worker/bulletin/
        // compile-bulletin-gate.test.mjs can pin the decision against both
        // timestamp formats and same-day + cross-day scenarios.
        if (!isPastDue(now, nextDueAtIso)) {
          continue;
        }

        // v0.6.6 (Bug 1) — the company is past-due; this tick is being
        // CONSUMED. From here on, EVERY exit path (publish, duplicate, every
        // failure `continue`, an unexpected throw) MUST advance the schedule
        // pointer before the loop moves on, or the next heartbeat tick
        // recompiles. `gatePassed` lets the per-company catch-all honour that
        // for the unexpected-throw path too.
        gatePassed = true;

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
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
          continue;
        }
        if (!editorAgentId) {
          ctx.logger?.warn?.('compile-bulletin: no editor-agent id', {
            companyId: company.id,
          });
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
          continue;
        }
        editorAgentIdForCatch = editorAgentId;

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
        //
        // v0.6.6 (Bug 1) — note that the breaker-open branch advances the
        // schedule pointer before `continue`. With the breaker open the
        // bulletin will not compile until the operator clicks Resume; leaving
        // `next_due_at` in the past would otherwise have the heartbeat tick
        // re-enter this branch every minute. The pointer advance plus the
        // breaker-open warn keeps the cadence at one log line per genuine slot.
        try {
          const agent = await ctx.agents.get(editorAgentId, company.id);
          if (agent?.status === 'paused') {
            if (await isCircuitOpenDurable(ctx, BULLETIN_COMPILE_AGENT_KEY)) {
              ctx.logger?.warn?.(
                `compile-bulletin: Editor-Agent is paused AND the bulletin-compile ` +
                  `circuit breaker is open — not resuming (D-06: operator must click ` +
                  `Resume). companyId=${company.id} agentId=${editorAgentId}`,
              );
              await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
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
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
          continue;
        }

        // 1. Compute the cycle number — MAX(published cycle) + 1.
        const maxRows = await ctx.db.query<{ max_cycle: number }>(
          `SELECT COALESCE(MAX(cycle_number), 0)::int AS max_cycle
           FROM plugin_clarity_pack_cdd6bda4bd.bulletins
           WHERE company_id = $1 AND compile_status = $2`,
          [company.id, 'published'],
        );
        cycleNumber = (maxRows[0]?.max_cycle ?? 0) + 1;

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
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
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
        // Defect B — the masthead is pipeline-built, not LLM-invented. Pass
        // `compiledAt` (this fire's instant) and the company display name so
        // `compilePass1`'s `buildMasthead` can populate volume/number/weekday/
        // dateText/prepareForName/cycleNumber deterministically. `company.name`
        // is the SDK `Company` display name; it is read defensively because the
        // test fakes seed companies as bare `{ id }`.
        const companyName = (company as { name?: string }).name;
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
            compiledAt: now,
            companyName,
          });
        } catch (e) {
          // recordFailure already invoked inside compilePass1.
          await recordCycleCompileFailure(ctx, {
            cycleNumber,
            reason: `pass-1 failed: ${(e as Error).message}`,
            now,
          });
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
          continue;
        }

        // 5. Pass 2 — deterministic verifier.
        //
        // v0.6.6 (Bug 2 — debug bulletin-compile-cadence-runaway). The verifier
        // validates the draft against the FROZEN `standingNumberRows` the
        // pipeline computed at compile START and HANDED the agent — NOT a fresh
        // SQL re-run at compile END. The agent takes ~50s; a live re-run would
        // see Paperclip's own board churn (`stranded_issue_recovery` issues,
        // a self-counting published bulletin) and lose every compile-window
        // race. The verifier's job is "did the agent faithfully transcribe the
        // numbers we gave it" (catches hallucination), not "do the numbers
        // still match a live re-query" (an unwinnable race). `verifyDraft` is
        // now a pure, deterministic, I/O-free function.
        const verdict = verifyDraft(draft, standingNumberRows);
        // Instrumentation (2026-05-17 v0.6.3 drill): the post-readback path used
        // to log NOTHING between `result DOCUMENT received` and the job ending,
        // so a silent publish failure was undiagnosable from the run log. These
        // info/warn lines make verify + publish outcomes visible every cycle.
        ctx.logger?.info?.('compile-bulletin: verifyDraft verdict', {
          companyId: company.id,
          cycleNumber,
          ok: verdict.ok,
        });
        if (!verdict.ok) {
          const reason =
            'mismatches' in verdict
              ? `verifier rejected: ${JSON.stringify(verdict.mismatches)}`
              : `verifier rejected: ${verdict.kind}:${verdict.slot}`;
          ctx.logger?.warn?.(`compile-bulletin: cycle ${cycleNumber} ${reason}`, {
            companyId: company.id,
          });
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
          // v0.6.6 (Bug 1) — a verifier rejection consumed a due tick. Advance
          // the daily schedule pointer so the every-minute heartbeat does NOT
          // immediately recompile; the D-22 15-minute retry timer owns the
          // re-attempt of THIS cycle.
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
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
        ctx.logger?.info?.('compile-bulletin: publishBulletin result', {
          companyId: company.id,
          cycleNumber,
          kind: publishResult.kind,
        });

        if (publishResult.kind === 'failed') {
          ctx.logger?.warn?.(
            `compile-bulletin: publish failed for cycle ${cycleNumber}: ${publishResult.reason}`,
            { companyId: company.id },
          );
          await recordCycleCompileFailure(ctx, {
            cycleNumber,
            reason: publishResult.reason,
            now,
          });
          // v0.6.6 (Bug 1) — a publish failure consumed a due tick. Advance the
          // schedule pointer; the D-22 retry timer owns the re-attempt.
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
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

        // 7. Advance next_due_at to the next genuine 06:30-ET slot.
        //
        // v0.6.6 (Bug 1) — `advanceScheduleForCompany` moves the pointer on
        // EVERY row for the company (the schedule pointer is not a per-cycle
        // historical fact). The prior implementation updated only the
        // just-published cycle's own row; combined with the failure paths that
        // never advanced at all, that left `getNextDueAtForCompany` reading a
        // stale past pointer and the every-minute cron re-publishing a fresh
        // cycle every ~2 minutes (the 2026-05-18 drill runaway).
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      } catch (e) {
        // Defect D — an UNEXPECTED throw reached the per-company catch-all (a
        // render/publish-path TypeError, or any bug not caught by one of the
        // handled `continue`-on-failure paths above). This is a genuine compile
        // failure, NOT a benign skip:
        //   - route it through `recordFailure` so the D-06 bulletin-compile
        //     circuit breaker advances (3 consecutive → the Editor-Agent is
        //     paused and the broken loop stops); and
        //   - route it through `recordCycleCompileFailure` so the D-22
        //     failed-compile banner surfaces it to the operator.
        // Before this fix the catch only `warn`-logged, so a render TypeError
        // was reported as `job completed successfully`, the breaker never
        // tripped, and the loop created an operation issue every minute (the
        // v0.6.1 drill's runaway). Both record calls are themselves wrapped so
        // a failure inside the failure-recording path cannot abort the company
        // loop.
        ctx.logger?.error?.(
          `compile-bulletin: per-company iteration failed: ${errText(e)}`,
          { companyId: company.id },
        );
        try {
          if (editorAgentIdForCatch) {
            await recordFailure(ctx, {
              agentKey: BULLETIN_COMPILE_AGENT_KEY,
              agentId: editorAgentIdForCatch,
              companyId: company.id,
              reason: `per-company iteration threw: ${(e as Error).message}`,
            });
          }
          if (cycleNumber !== null) {
            await recordCycleCompileFailure(ctx, {
              cycleNumber,
              reason: `per-company iteration threw: ${(e as Error).message}`,
              now,
            });
          }
        } catch (recErr) {
          ctx.logger?.warn?.(
            `compile-bulletin: failed to record the iteration failure: ${errText(recErr)}`,
            { companyId: company.id },
          );
        }
        // v0.6.6 (Bug 1) — if the throw happened AFTER the due-gate was passed,
        // this tick consumed the daily slot. Advance the schedule pointer so an
        // unexpected throw cannot leave a stale past `next_due_at` and trigger
        // the every-minute recompile runaway. The advance is itself best-effort
        // (its own try/catch inside), so it cannot re-throw out of the catch-all.
        if (gatePassed) {
          await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
        }
      }
    }
  });
}
