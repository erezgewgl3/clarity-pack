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
//
// Quick task 260528-nns — the per-company body is now the exported
// `compileBulletinForCompany(ctx, company, { now, bulletinTz, force })` so the
// daily cron AND the on-demand `bulletin.compileNow` action share ONE pipeline
// (no fork). The cron calls it with `force:false` (behaviour byte-identical to
// the prior inline loop body: same gate, bootstrap, schedule-advance, failure
// recording, and per-company catch). `force:true` (on-demand only) bypasses the
// `now >= next_due_at` due-gate AND the bootstrap early-return, runs an
// application-level content_hash dedupe before publish (no new bulletin when the
// content is unchanged), and skips BOTH the schedule-pointer advance (the daily
// 06:30 cadence is left untouched) and the breaker failure-table recording (an
// operator-triggered compile must not trip the auto-pause breaker).

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
  getLatestPublishedBulletin,
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
import {
  publishBulletin,
  bulletinDedupeHash,
  type PublishBulletinArgs,
} from '../bulletin/publish.ts';
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
export async function resolveBulletinTz(ctx: CompileBulletinCtx): Promise<string | undefined> {
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

/** Quick task 260528-nns — options for a single-company compile. */
export type CompileForCompanyOptions = {
  /** The compile instant (one per cron tick / one per on-demand click). */
  now: Date;
  /** Resolved IANA bulletin timezone (undefined → computeNextDueAt default). */
  bulletinTz?: string;
  /**
   * On-demand mode. `false` (default) is the daily cron: due-gate enforced,
   * schedule pointer advanced, breaker failures recorded, NO dedupe. `true` is
   * the operator's "Generate bulletin now": due-gate + bootstrap bypassed,
   * content_hash dedupe active, schedule pointer + breaker recording left
   * untouched.
   */
  force?: boolean;
};

/** Quick task 260528-nns — discriminated outcome of a single-company compile. */
export type CompileForCompanyResult =
  | { kind: 'not-due' }
  | { kind: 'bootstrapped' }
  | { kind: 'published'; cycleNumber: number; publishedIssueId: string; publishedAt: string }
  | { kind: 'duplicate'; cycleNumber: number }
  | { kind: 'no-change'; cycleNumber: number; publishedAt: string | null }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string; cycleNumber?: number };

/**
 * Compile (and, unless deduped, publish) a bulletin for ONE company.
 *
 * This is the single shared pipeline. `registerCompileBulletinJob` calls it
 * once per company with `force:false` — that path is byte-for-byte the prior
 * inline loop body (every former `continue` is the same side effects followed
 * by a `return`; the per-company `catch` records + advances identically). The
 * `bulletin.compileNow` action calls it with `force:true`. See
 * CompileForCompanyOptions for the force-mode differences.
 */
export async function compileBulletinForCompany(
  ctx: CompileBulletinCtx,
  company: Company,
  opts: CompileForCompanyOptions,
): Promise<CompileForCompanyResult> {
  const { now, bulletinTz } = opts;
  const force = opts.force ?? false;

  // Defect D (2026-05-17 v0.6.2 re-drill). Track `cycleNumber` (set once the
  // cycle is computed) so the catch at the bottom can route an UNEXPECTED throw
  // — a render/publish-path TypeError, a bug anywhere in the body that is NOT
  // one of the handled failure paths — through BOTH `recordFailure` (so the
  // D-06 breaker can trip) AND `recordCycleCompileFailure` (so the D-22 banner
  // shows). [force:true skips both — an operator action must not trip the
  // auto-pause breaker.]
  let cycleNumber: number | null = null;
  // v0.6.6 (Bug 1) — true once the body passes the `now < next_due_at` gate,
  // i.e. this company genuinely consumed a due tick. The catch-all uses it to
  // advance the schedule pointer even when an UNEXPECTED throw bypassed every
  // handled path. [force:true never advances — see below.]
  let gatePassed = false;
  // The resolved Editor-Agent UUID, captured so the catch-all `recordFailure`
  // can pause the real agent. Null until reconcile succeeds.
  let editorAgentIdForCatch: string | null = null;
  try {
    const nextDueAtFromDb = await getNextDueAtForCompany(ctx, company.id);
    // The next_due_at value the published row will carry. For the cron it is
    // the scheduled pointer; for force-with-no-existing-row we compute a slot
    // for the row WITHOUT advancing any pointer (there is none to disturb).
    let nextDueAtIso = nextDueAtFromDb;

    if (!nextDueAtIso) {
      if (!force) {
        // Bootstrap (cron only): first ever compile for this company. Write a
        // 'pending' row carrying the freshly-computed next_due_at and return
        // without compiling — the next fire compiles only once now >=
        // next_due_at.
        //
        // cycle_number 0 is a SENTINEL: the bootstrap row is a schedule
        // carrier, not a real bulletin. Real bulletins start at cycle 1
        // (MAX(published cycle) + 1 with no published rows = 1). Letting
        // upsertBulletin auto-assign here would make the bootstrap row cycle 1
        // too, and the first real compile's publishBulletin INSERT (cycle 1)
        // would then collide on the bulletins primary key. Surfaced by the Plan
        // 03-03 Countermoves drill 2026-05-15.
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
        return { kind: 'bootstrapped' };
      }
      // force + first-ever: compute a next_due_at for the published row only
      // (no schedule pointer exists yet to disturb).
      nextDueAtIso = computeNextDueAt(now, bulletinTz).toISOString();
    }

    // Gate: not yet due → no-op (cron only). force bypasses the gate.
    //
    // Plan 04.1-11 (2026-05-21) — DATE compare via `isPastDue` helper, NOT
    // string compare (ASCII 'T' > ' ' reversed same-day order; cycle #691 on
    // Countermoves before the SQL bleed-stop).
    if (!force && !isPastDue(now, nextDueAtIso)) {
      return { kind: 'not-due' };
    }

    // The company is past-due (or forced); this tick is being CONSUMED. From
    // here every exit path advances the schedule pointer before returning
    // (cron only) so the next heartbeat tick does not recompile.
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
      if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      return { kind: 'skipped', reason: `Editorial Desk could not be resolved: ${(e as Error).message}` };
    }
    if (!editorAgentId) {
      ctx.logger?.warn?.('compile-bulletin: no editor-agent id', {
        companyId: company.id,
      });
      if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      return { kind: 'skipped', reason: 'Editorial Desk is not registered for this company.' };
    }
    editorAgentIdForCatch = editorAgentId;

    // Plan 03-06 — breaker-aware resume of the Editor-Agent.
    //
    // The manifest declares the Editor-Agent `status: 'paused'`. A paused agent
    // whose circuit breaker is OPEN was paused BY the breaker (D-06); auto-
    // resuming it is the resume-defeats-breaker loop (live attempt_n 466→470).
    // So resume ONLY when the breaker is NOT open. `resume` flips `paused →
    // idle`; a `terminated`/`pending_approval` agent rejects resume.
    try {
      const agent = await ctx.agents.get(editorAgentId, company.id);
      if (agent?.status === 'paused') {
        if (await isCircuitOpenDurable(ctx, BULLETIN_COMPILE_AGENT_KEY)) {
          ctx.logger?.warn?.(
            `compile-bulletin: Editor-Agent is paused AND the bulletin-compile ` +
              `circuit breaker is open — not resuming (D-06: operator must click ` +
              `Resume). companyId=${company.id} agentId=${editorAgentId}`,
          );
          if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
          return {
            kind: 'skipped',
            reason:
              'Editorial Desk is paused and the compile circuit breaker is open — resume it in the Agents panel.',
          };
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
      if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      return {
        kind: 'skipped',
        reason: `Editorial Desk unavailable — could not resume it: ${(e as Error).message}`,
      };
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
    // 1a. Reconcile department membership (idempotent — ON CONFLICT DO NOTHING
    //     keeps manual overrides). Best-effort.
    await reconcileDepartments(ctx, company.id);

    // 1b. Build deterministic lineage threads from issues updated in the last
    //     24h (the SDK has no list-activities-by-time-window tool;
    //     03-RESEARCH.md Q3/Q4). W5 (RESOLVED): `assigneeUserId` is the actor
    //     key (Issue.lastActorId/Name do not exist on the SDK Issue type).
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
      if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      return { kind: 'failed', reason: `standing-numbers failed: ${(e as Error).message}`, cycleNumber };
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

    // 4. Pass 1 — LLM produces a structured BulletinDraft via the operation-
    //    issue-backed delivery adapter (Plan 03-06). A delivery timeout, a
    //    create failure, or an unparseable result surface as a pass-1 throw.
    const llm = deliveryLlmAdapter(ctx, {
      agentId: editorAgentId,
      companyId: company.id,
      operationKind: 'bulletin-compile',
      operationId: `cycle-${cycleNumber}`,
      title: `Compile Daily Bulletin — cycle ${cycleNumber}`,
    });
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
      if (!force) {
        await recordCycleCompileFailure(ctx, {
          cycleNumber,
          reason: `pass-1 failed: ${(e as Error).message}`,
          now,
        });
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
      return { kind: 'failed', reason: `pass-1 failed: ${(e as Error).message}`, cycleNumber };
    }

    // 5. Pass 2 — deterministic verifier against the FROZEN pass-1 snapshot
    //    (v0.6.6 Bug 2 — no live SQL re-run; verifyDraft is pure).
    const verdict = verifyDraft(draft, standingNumberRows);
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
      if (!force) {
        await recordFailure(ctx, {
          agentKey: BULLETIN_COMPILE_AGENT_KEY,
          agentId: editorAgentId,
          companyId: company.id,
          reason,
        });
        await recordCycleCompileFailure(ctx, {
          cycleNumber,
          reason,
          now,
        });
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
      return { kind: 'failed', reason, cycleNumber };
    }

    // Plan 03-03 — override the draft's lineageThreads with the
    // deterministically-grouped threads (BULL-04 / D-21).
    const draftWithLineage: BulletinDraft = {
      ...draft,
      lineageThreads:
        lineageThreads.length > 0 ? lineageThreads : draft.lineageThreads ?? [],
    };

    // Quick task 260528-nns — on-demand dedupe (force only). Compare the fresh
    // draft's SUBSTANCE hash (masthead excluded — see bulletinDedupeHash) to the
    // last PUBLISHED bulletin's substance hash, recomputed from its stored
    // draft_json. Equal → the operator's click produced nothing new: return
    // no-change and write NO row (avoids a stream of identical bulletins on
    // repeated clicks). NOT the full content_hash, which bakes in the
    // ever-incrementing cycle number and so could never match. The cron path
    // never dedupes (its cycle-based idempotency in publishBulletin covers
    // re-fires).
    if (force) {
      const freshDedupe = bulletinDedupeHash(draftWithLineage);
      const lastPublished = await getLatestPublishedBulletin(ctx, company.id);
      if (lastPublished?.draft_json) {
        let lastDraft: BulletinDraft | null = null;
        try {
          lastDraft = (typeof lastPublished.draft_json === 'string'
            ? JSON.parse(lastPublished.draft_json)
            : lastPublished.draft_json) as BulletinDraft;
        } catch {
          lastDraft = null;
        }
        if (lastDraft && bulletinDedupeHash(lastDraft) === freshDedupe) {
          ctx.logger?.info?.(
            'compile-bulletin: on-demand dedupe — content unchanged since last published',
            { companyId: company.id, cycleNumber: lastPublished.cycle_number },
          );
          return {
            kind: 'no-change',
            cycleNumber: lastPublished.cycle_number,
            publishedAt: lastPublished.published_at,
          };
        }
      }
    }

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
      if (!force) {
        await recordCycleCompileFailure(ctx, {
          cycleNumber,
          reason: publishResult.reason,
          now,
        });
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
      return { kind: 'failed', reason: publishResult.reason, cycleNumber };
    }

    if (publishResult.kind === 'duplicate') {
      ctx.logger?.info?.('compile-bulletin: duplicate (idempotency); advancing next_due_at', {
        companyId: company.id,
        cycleNumber,
      });
      // A verified publish (or an idempotent duplicate) is a clean cycle —
      // reset the shared breaker counter.
      recordSuccess(BULLETIN_COMPILE_AGENT_KEY);
      if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      return { kind: 'duplicate', cycleNumber };
    }

    // A verified publish — reset the shared circuit-breaker counter so a
    // transient earlier failure does not carry over.
    recordSuccess(BULLETIN_COMPILE_AGENT_KEY);

    // 7. Advance next_due_at to the next genuine 06:30 slot (cron only). The
    //    on-demand path leaves the daily schedule pointer untouched.
    if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);

    return {
      kind: 'published',
      cycleNumber,
      publishedIssueId: publishResult.publishedIssueId,
      publishedAt: publishResult.publishedAt,
    };
  } catch (e) {
    // Defect D — an UNEXPECTED throw reached the catch-all. Route it through
    // recordFailure (D-06 breaker) + recordCycleCompileFailure (D-22 banner)
    // [cron only], then advance if the gate was passed. Both record calls are
    // themselves wrapped so a failure inside the failure-recording path cannot
    // escape the catch.
    ctx.logger?.error?.(
      `compile-bulletin: per-company iteration failed: ${errText(e)}`,
      { companyId: company.id },
    );
    if (!force) {
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
      if (gatePassed) {
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
    }
    return {
      kind: 'failed',
      reason: `per-company iteration threw: ${(e as Error).message}`,
      cycleNumber: cycleNumber ?? undefined,
    };
  }
}

/**
 * Register the compile-bulletin job. On each fire it iterates companies and
 * delegates each to `compileBulletinForCompany(..., { force: false })` — the
 * daily-cron path (due-gate + schedule advance + breaker recording).
 */
export function registerCompileBulletinJob(ctx: CompileBulletinCtx): void {
  ctx.jobs.register('compile-bulletin', async () => {
    const now = new Date();
    // 2026-05-28 — resolve the operator-configured bulletin timezone once per
    // tick (default Asia/Jerusalem via computeNextDueAt's BULLETIN_TZ fallback
    // when this is undefined). Passed to compileBulletinForCompany so the daily
    // 06:30 target is in the configured zone.
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
      // Per-company isolation: compileBulletinForCompany never throws (its own
      // catch-all returns a 'failed' result), so one company cannot abort the
      // loop. force:false → byte-identical to the prior inline cron body.
      await compileBulletinForCompany(ctx, company, { now, bulletinTz, force: false });
    }
  });
}
