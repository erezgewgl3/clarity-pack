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
  PluginStateClient,
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
import {
  buildBulletinPrompt,
  finalizeBulletinDraft,
  estimateTokens,
  MAX_BULLETIN_TOKENS,
} from '../bulletin/compile-pass-1.ts';
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
import { EDITOR_AGENT_KEY, drainTldrOperations } from '../agents/editor.ts';
// Plan 03-06 — production LLM invocation via the operation-issue handoff
// (Path (d)). The compile prompt is delivered as the body of an operation issue
// ASSIGNED to the Editor-Agent; the agent reads it and files the BulletinDraft
// JSON as a `compile-result` issue document. See 03-AGENT-INVOCATION-GAP-RESEARCH.md.
//
// Delivery-layer rework (2026-05-28) — the synchronous in-invocation 5-min poll
// (`deliveryLlmAdapter`/`compilePass1`) is replaced by a cross-tick START/RESUME
// state machine: `startAgentTask` creates the operation issue + wakes the agent
// in ONE invocation, `pollAgentTaskResult` does ONE sleepless readback round per
// tick. paperclipai@2026.525.0 expires the invocation scope mid-poll (PR #6547),
// so no single invocation is ever held across the whole agent round-trip.
import {
  startAgentTask,
  pollAgentTaskResult,
  AGENT_TASK_DELIVERY_TIMEOUT,
} from '../agents/agent-task-delivery.ts';
// Plan 03-03 — cycle-start department reconcile + deterministic lineage build.
import { reconcileDepartments } from '../bulletin/department-reconcile.ts';
import { groupLineageThreads, type ActivityEvent } from '../bulletin/lineage-grouper.ts';
import type { BulletinDraft, FactsTable, StandingNumberRow } from '../../shared/types.ts';

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
  // Delivery-layer rework (2026-05-28) — the host KV store holding the
  // per-company `pending-compile` record (cross-tick START/RESUME) and the
  // on-demand `force-requested` marker. OPTIONAL + defensively read: older test
  // fixtures omit it, in which case the START path still does one immediate
  // poll (warm-agent path) but cannot persist a pending record across ticks.
  // Requires `plugin.state.read` (get) + `plugin.state.write` (set/delete).
  state?: PluginStateClient;
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
  | { kind: 'failed'; reason: string; cycleNumber?: number }
  // Delivery-layer rework (2026-05-28) — cross-tick outcomes:
  //   'started' — the agent task was created/woken this tick; the result will
  //               be consumed on a LATER tick (a pending record was persisted).
  //   'pending' — a prior tick's compile is still in flight; the agent has not
  //               answered yet and the deadline has not elapsed.
  | { kind: 'started'; cycleNumber?: number }
  | { kind: 'pending' };

// ---- Delivery-layer rework (2026-05-28) — cross-tick pending state ----------

/** ctx.state namespace for the per-company bulletin compile state. */
const BULLETIN_STATE_NAMESPACE = 'bulletin';
/** stateKey for the per-company in-flight compile record (cross-tick START/RESUME). */
const PENDING_COMPILE_STATE_KEY = 'pending-compile';
/** stateKey for the operator's on-demand "compile now" marker (consumed by the job). */
export const FORCE_REQUESTED_STATE_KEY = 'force-requested';

function pendingCompileScope(companyId: string) {
  return {
    scopeKind: 'company' as const,
    scopeId: companyId,
    namespace: BULLETIN_STATE_NAMESPACE,
    stateKey: PENDING_COMPILE_STATE_KEY,
  };
}

/** ScopeKey for the on-demand force-request marker. Exported for the action handler + tests. */
export function forceRequestScope(companyId: string) {
  return {
    scopeKind: 'company' as const,
    scopeId: companyId,
    namespace: BULLETIN_STATE_NAMESPACE,
    stateKey: FORCE_REQUESTED_STATE_KEY,
  };
}

/**
 * The per-company in-flight compile record persisted in ctx.state between job
 * ticks. Plain JSON (no migration — the host KV store). FROZEN inputs
 * (`standingNumberRows`, `factsTable`, `lineageThreads`) are captured at START
 * so the resume tick's verifier checks the draft against the EXACT numbers the
 * agent compiled (v0.6.6 Bug-2 — no live re-query across ticks).
 */
type PendingCompileRecord = {
  operationIssueId: string;
  operationId: string;
  cycleNumber: number;
  nextDueAtIso: string;
  standingNumberRows: StandingNumberRow[];
  factsTable: FactsTable;
  lineageThreads: BulletinDraft['lineageThreads'];
  companyName?: string;
  editorAgentId: string;
  compiledAtIso: string;
  /** start + AGENT_TASK_DELIVERY_TIMEOUT — the cross-tick give-up instant (epoch ms). */
  deadlineMs: number;
  mode: 'cron' | 'force';
};

/** The subset of frozen inputs `finishCompile` needs (a PendingCompileRecord is a superset). */
type FrozenCompileInputs = Pick<
  PendingCompileRecord,
  | 'cycleNumber'
  | 'nextDueAtIso'
  | 'standingNumberRows'
  | 'factsTable'
  | 'lineageThreads'
  | 'companyName'
  | 'editorAgentId'
  | 'compiledAtIso'
>;

/** Read the pending compile record. Defensive: no ctx.state → null (skip cross-tick logic). */
async function getPendingCompile(
  ctx: CompileBulletinCtx,
  companyId: string,
): Promise<PendingCompileRecord | null> {
  if (!ctx.state?.get) return null;
  try {
    const raw = await ctx.state.get(pendingCompileScope(companyId));
    if (raw && typeof raw === 'object') return raw as PendingCompileRecord;
    return null;
  } catch (e) {
    ctx.logger?.warn?.(`compile-bulletin: ctx.state.get(pending-compile) failed: ${errText(e)}`, {
      companyId,
    });
    return null;
  }
}

/** Persist the pending compile record (best-effort; no ctx.state → no-op). */
async function setPendingCompile(
  ctx: CompileBulletinCtx,
  companyId: string,
  record: PendingCompileRecord,
): Promise<void> {
  if (!ctx.state?.set) return;
  try {
    await ctx.state.set(pendingCompileScope(companyId), record);
  } catch (e) {
    ctx.logger?.warn?.(`compile-bulletin: ctx.state.set(pending-compile) failed: ${errText(e)}`, {
      companyId,
    });
  }
}

/** Clear the pending compile record (idempotent; no ctx.state → no-op). */
async function clearPendingCompile(ctx: CompileBulletinCtx, companyId: string): Promise<void> {
  if (!ctx.state?.delete) return;
  try {
    await ctx.state.delete(pendingCompileScope(companyId));
  } catch (e) {
    ctx.logger?.warn?.(`compile-bulletin: ctx.state.delete(pending-compile) failed: ${errText(e)}`, {
      companyId,
    });
  }
}

/**
 * Read + delete the operator's on-demand force-request marker for a company.
 * Returns `true` exactly once per marker (read-then-delete), so the next job
 * tick STARTs a force compile and the marker does not re-fire on every tick.
 * Defensive: no ctx.state → always `false`. A read/delete failure is logged and
 * treated as "no force this tick" (the daily cron path still runs).
 */
async function consumeForceRequest(ctx: CompileBulletinCtx, companyId: string): Promise<boolean> {
  if (!ctx.state?.get) return false;
  try {
    const marker = await ctx.state.get(forceRequestScope(companyId));
    if (!marker) return false;
    if (ctx.state.delete) {
      try {
        await ctx.state.delete(forceRequestScope(companyId));
      } catch (e) {
        ctx.logger?.warn?.(
          `compile-bulletin: ctx.state.delete(force-requested) failed: ${errText(e)}`,
          { companyId },
        );
      }
    }
    ctx.logger?.info?.('compile-bulletin: honoring on-demand force-request marker', { companyId });
    return true;
  } catch (e) {
    ctx.logger?.warn?.(`compile-bulletin: ctx.state.get(force-requested) failed: ${errText(e)}`, {
      companyId,
    });
    return false;
  }
}

/**
 * Finish a compile from a RAW agent result body, using the FROZEN inputs
 * captured at START. Shared by the START-immediate-ready branch and the RESUME
 * branch. Mirrors the prior inline finalize→verify→(force)dedupe→publish→advance
 * sequence exactly; the only structural change is that the inputs are FROZEN
 * (passed in) rather than freshly re-queried, and the pending record is cleared
 * on every terminal outcome.
 *
 * Failure accounting: a finalize throw or verifier rejection records the breaker
 * failure (cron only — `finalizeBulletinDraft` itself does NOT, so this helper
 * owns it); a publish failure records only the D-22 cycle failure. force never
 * records (an operator action must not trip the auto-pause breaker) and never
 * advances the daily schedule.
 */
async function finishCompile(
  ctx: CompileBulletinCtx,
  company: Company,
  frozen: FrozenCompileInputs,
  rawBody: string,
  opts: { force: boolean; now: Date; bulletinTz?: string },
): Promise<CompileForCompanyResult> {
  const { force, now, bulletinTz } = opts;
  const { cycleNumber, editorAgentId } = frozen;

  let draft: BulletinDraft;
  try {
    draft = finalizeBulletinDraft(rawBody, {
      factsTable: frozen.factsTable,
      cycleNumber: frozen.cycleNumber,
      compiledAt: new Date(frozen.compiledAtIso),
      companyName: frozen.companyName,
    });
  } catch (e) {
    const reason = `finalize failed: ${(e as Error).message}`;
    ctx.logger?.warn?.(`compile-bulletin: cycle ${cycleNumber} ${reason}`, { companyId: company.id });
    if (!force) {
      await recordFailure(ctx, {
        agentKey: BULLETIN_COMPILE_AGENT_KEY,
        agentId: editorAgentId,
        companyId: company.id,
        reason,
      });
      await recordCycleCompileFailure(ctx, { cycleNumber, reason, now });
    }
    await clearPendingCompile(ctx, company.id);
    if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
    return { kind: 'failed', reason, cycleNumber };
  }

  // Plan 03-03 — override the draft's lineageThreads with the FROZEN
  // deterministically-grouped threads (BULL-04 / D-21).
  const draftWithLineage: BulletinDraft = {
    ...draft,
    lineageThreads:
      (frozen.lineageThreads?.length ?? 0) > 0
        ? frozen.lineageThreads
        : draft.lineageThreads ?? [],
  };

  // Pass 2 — deterministic verifier against the FROZEN snapshot (v0.6.6 Bug 2).
  const verdict = verifyDraft(draftWithLineage, frozen.standingNumberRows);
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
    ctx.logger?.warn?.(`compile-bulletin: cycle ${cycleNumber} ${reason}`, { companyId: company.id });
    if (!force) {
      await recordFailure(ctx, {
        agentKey: BULLETIN_COMPILE_AGENT_KEY,
        agentId: editorAgentId,
        companyId: company.id,
        reason,
      });
      await recordCycleCompileFailure(ctx, { cycleNumber, reason, now });
    }
    await clearPendingCompile(ctx, company.id);
    if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
    return { kind: 'failed', reason, cycleNumber };
  }

  // On-demand dedupe (force only) — substance hash (masthead excluded) vs the
  // last published bulletin's. Equal → the operator's click produced nothing
  // new: return no-change, write NO row, NO advance.
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
        await clearPendingCompile(ctx, company.id);
        return {
          kind: 'no-change',
          cycleNumber: lastPublished.cycle_number,
          publishedAt: lastPublished.published_at,
        };
      }
    }
  }

  const priorCycleErratumSnapshot = await buildPriorCycleErratumSnapshot(ctx, company.id, cycleNumber);

  const publishResult = await publishBulletin(ctx, {
    companyId: company.id,
    cycleNumber,
    nextDueAtIso: frozen.nextDueAtIso,
    editorAgentId,
    draft: draftWithLineage,
    compiledAt: new Date(frozen.compiledAtIso),
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
    if (!force) await recordCycleCompileFailure(ctx, { cycleNumber, reason: publishResult.reason, now });
    await clearPendingCompile(ctx, company.id);
    if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
    return { kind: 'failed', reason: publishResult.reason, cycleNumber };
  }

  // A verified publish (or an idempotent duplicate) is a clean cycle — reset the
  // shared breaker counter, clear pending, and advance the daily schedule (cron).
  recordSuccess(BULLETIN_COMPILE_AGENT_KEY);
  await clearPendingCompile(ctx, company.id);
  if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);

  if (publishResult.kind === 'duplicate') {
    return { kind: 'duplicate', cycleNumber };
  }
  return {
    kind: 'published',
    cycleNumber,
    publishedIssueId: publishResult.publishedIssueId,
    publishedAt: publishResult.publishedAt,
  };
}

/**
 * Compile (and, unless deduped, publish) a bulletin for ONE company.
 *
 * Delivery-layer rework (2026-05-28) — a per-company START/RESUME state machine:
 *   - RESUME (a pending record exists) → one `pollAgentTaskResult` round. ready
 *     → finishCompile; past deadline → timeout failure + clear pending; else
 *     leave pending and return { kind:'pending' }.
 *   - START (no pending) → the existing gate / bootstrap / reconcile / breaker-
 *     resume / cycle / lineage / standing / facts steps, then build the prompt,
 *     `startAgentTask`, and ONE immediate `pollAgentTaskResult` (warm-agent +
 *     keeps the e2e single-fire-publishes contract). ready → finishCompile; else
 *     persist the pending record and return { kind:'started' } — NO schedule
 *     advance, NO recordSuccess at START.
 *
 * `registerCompileBulletinJob` calls it once per company with `force:false`. The
 * `bulletin.compileNow` job-side honors the force-request marker and calls it
 * with `force:true`. See CompileForCompanyOptions for the force-mode differences.
 */
export async function compileBulletinForCompany(
  ctx: CompileBulletinCtx,
  company: Company,
  opts: CompileForCompanyOptions,
): Promise<CompileForCompanyResult> {
  const { now, bulletinTz } = opts;
  // `force` may be reset to the pending record's mode on the RESUME branch
  // (a force compile that spilled across ticks must finish in force mode).
  let force = opts.force ?? false;

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
  // Delivery-layer rework — true once a pending record is known to exist for
  // this company (RESUME branch), so the catch-all clears it and advances even
  // when an UNEXPECTED throw bypassed the handled paths.
  let pendingActive = false;
  try {
    // ---- RESUME branch — a prior tick's compile is in flight ----------------
    // A pending record means an operation issue was created on an earlier tick
    // and we are waiting for the agent's result. Poll ONCE (fresh invocation);
    // never re-start while pending — that is the runaway guard (v0.6.6).
    const pending = await getPendingCompile(ctx, company.id);
    if (pending) {
      pendingActive = true;
      force = pending.mode === 'force';
      cycleNumber = pending.cycleNumber;
      editorAgentIdForCatch = pending.editorAgentId;

      const poll = await pollAgentTaskResult(ctx, {
        operationIssueId: pending.operationIssueId,
        companyId: company.id,
        operationKind: 'bulletin-compile',
        agentId: pending.editorAgentId,
      });
      if (poll.status === 'ready') {
        ctx.logger?.info?.(
          `compile-bulletin: resume tick consumed result for cycle ${pending.cycleNumber} ` +
            `(operation issue ${pending.operationIssueId})`,
          { companyId: company.id },
        );
        return await finishCompile(ctx, company, pending, poll.body, { force, now, bulletinTz });
      }
      // Not ready. Past the cross-tick deadline → give up (timeout failure).
      if (now.getTime() > pending.deadlineMs) {
        const reason = `delivery timeout (cross-tick): no result for operation issue ${pending.operationIssueId} before deadline`;
        ctx.logger?.warn?.(`compile-bulletin: cycle ${pending.cycleNumber} ${reason}`, {
          companyId: company.id,
        });
        if (!force) {
          await recordFailure(ctx, {
            agentKey: BULLETIN_COMPILE_AGENT_KEY,
            agentId: pending.editorAgentId,
            companyId: company.id,
            reason,
          });
          await recordCycleCompileFailure(ctx, { cycleNumber: pending.cycleNumber, reason, now });
        }
        await clearPendingCompile(ctx, company.id);
        if (!force) await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
        return { kind: 'failed', reason, cycleNumber: pending.cycleNumber };
      }
      // Still in flight, before the deadline — leave the record for the next tick.
      ctx.logger?.info?.(
        `compile-bulletin: cycle ${pending.cycleNumber} still awaiting agent result; will re-poll next tick`,
        { companyId: company.id },
      );
      return { kind: 'pending' };
    }

    // ---- START branch — no pending record -----------------------------------
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

    // 4. Pass 1 — DELIVERY-LAYER REWORK (2026-05-28). Build the prompt, START
    //    the agent task, and do ONE immediate poll. A warm agent answers inside
    //    this invocation and we finish now; otherwise we persist a pending
    //    record and a LATER tick (a fresh, valid invocation) consumes the result
    //    via the RESUME branch. No single invocation is held across the whole
    //    agent round-trip (paperclipai@2026.525.0 expires the scope — PR #6547).
    const companyName = (company as { name?: string }).name;
    const prompt = buildBulletinPrompt({
      cycleNumber,
      departments: DEFAULT_DEPARTMENTS,
      factsTable,
      standingNumbers: standingNumberRows,
    });

    // T-03-11 — input-token cap, enforced BEFORE the agent task is created so an
    // over-budget prompt costs nothing (the gate compilePass1 used to apply).
    const inputTokens = estimateTokens(prompt);
    if (inputTokens > MAX_BULLETIN_TOKENS) {
      const reason = `input exceeds max_tokens cap (${inputTokens} > ${MAX_BULLETIN_TOKENS})`;
      ctx.logger?.warn?.(`compile-bulletin: cycle ${cycleNumber} ${reason}`, {
        companyId: company.id,
      });
      if (!force) {
        await recordFailure(ctx, {
          agentKey: BULLETIN_COMPILE_AGENT_KEY,
          agentId: editorAgentId,
          companyId: company.id,
          reason: `input_tokens=${inputTokens} exceeds MAX_BULLETIN_TOKENS=${MAX_BULLETIN_TOKENS}`,
        });
        await recordCycleCompileFailure(ctx, { cycleNumber, reason, now });
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
      return {
        kind: 'failed',
        reason: `Bulletin compile input exceeds max_tokens cap (${inputTokens} > ${MAX_BULLETIN_TOKENS})`,
        cycleNumber,
      };
    }

    // START — idempotency-search + create the operation issue + wake the agent.
    // One invocation's worth of host calls.
    const operationId = `cycle-${cycleNumber}`;
    let startResult: { operationIssueId: string };
    try {
      startResult = await startAgentTask(ctx, {
        agentId: editorAgentId,
        companyId: company.id,
        operationKind: 'bulletin-compile',
        operationId,
        title: `Compile Daily Bulletin — cycle ${cycleNumber}`,
        prompt,
      });
    } catch (e) {
      const reason = `start failed: ${(e as Error).message}`;
      ctx.logger?.warn?.(`compile-bulletin: ${reason}`, { companyId: company.id });
      if (!force) {
        await recordCycleCompileFailure(ctx, { cycleNumber, reason, now });
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
      return { kind: 'failed', reason, cycleNumber };
    }

    // The FROZEN compile inputs — reused at finish (this tick if the agent is
    // warm, or on a later resume tick) so the verifier checks the draft against
    // the EXACT numbers the agent compiled (v0.6.6 Bug-2 — no live re-query).
    const frozen: FrozenCompileInputs = {
      cycleNumber,
      nextDueAtIso,
      standingNumberRows,
      factsTable,
      lineageThreads,
      companyName,
      editorAgentId,
      compiledAtIso: now.toISOString(),
    };

    // One immediate, sleepless poll — catches a warm agent (and keeps the e2e
    // suite's single-fire-publishes contract).
    const immediate = await pollAgentTaskResult(ctx, {
      operationIssueId: startResult.operationIssueId,
      companyId: company.id,
      operationKind: 'bulletin-compile',
      agentId: editorAgentId,
    });
    if (immediate.status === 'ready') {
      return await finishCompile(ctx, company, frozen, immediate.body, { force, now, bulletinTz });
    }

    // The agent has not answered yet. Persist the pending record so a LATER tick
    // resumes + consumes the result in a fresh invocation. CRITICAL: NO schedule
    // advance and NO recordSuccess at START — only a terminal outcome (publish /
    // no-change / timeout) does that. The pending record IS the runaway guard:
    // every subsequent due tick takes the RESUME branch (polls, never re-starts),
    // and the idempotency-list reuse is a second guard — so exactly one operation
    // issue is in flight per company.
    const record: PendingCompileRecord = {
      ...frozen,
      operationIssueId: startResult.operationIssueId,
      operationId,
      deadlineMs: now.getTime() + AGENT_TASK_DELIVERY_TIMEOUT,
      mode: force ? 'force' : 'cron',
    };
    await setPendingCompile(ctx, company.id, record);
    ctx.logger?.info?.(
      `compile-bulletin: started cycle ${cycleNumber} (operation issue ` +
        `${startResult.operationIssueId}); awaiting result on a later tick`,
      { companyId: company.id },
    );
    return { kind: 'started', cycleNumber };
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
      // Advance the schedule when this tick consumed a due slot — the START gate
      // passed OR a pending record was being resumed. Otherwise a thrown resume
      // would leave a stale past pointer and the next tick would recompile.
      if (gatePassed || pendingActive) {
        await advanceScheduleForCompany(ctx, company.id, now, bulletinTz);
      }
    }
    // Clear any pending record on an unexpected throw (best-effort, regardless
    // of mode) so a resume that blew up cannot strand the company in 'pending'
    // forever — the next tick re-STARTs cleanly.
    if (pendingActive) await clearPendingCompile(ctx, company.id);
    return {
      kind: 'failed',
      reason: `per-company iteration threw: ${(e as Error).message}`,
      cycleNumber: cycleNumber ?? undefined,
    };
  }
}

/**
 * View-driven rework (2026-05-28) — advance an EXISTING pending compile by one
 * step (RESUME only; never START). Safe to call from a valid request scope (the
 * `bulletin.byCycle` data handler, polled by the open Bulletin page) where the
 * scheduled job's scope is dead (PR #6547). Returns `{kind:'no-pending'}` and
 * makes NO host calls beyond the state read when nothing is in flight — so it is
 * a cheap, side-effect-free no-op on the common path and never bootstraps or
 * starts a compile (that is the compileNow action's job).
 */
export async function resumePendingCompile(
  ctx: CompileBulletinCtx,
  company: Company,
  opts: CompileForCompanyOptions,
): Promise<CompileForCompanyResult | { kind: 'no-pending' }> {
  const pending = await getPendingCompile(ctx, company.id);
  if (!pending) return { kind: 'no-pending' };
  // A pending record exists → compileBulletinForCompany takes the RESUME branch
  // (poll + finish), honoring the record's own mode (cron/force).
  return compileBulletinForCompany(ctx, company, opts);
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
      // loop.
      //
      // Delivery-layer rework (2026-05-28) — honor the operator's on-demand
      // marker: `bulletin.compileNow` enqueues a `force-requested` marker; this
      // tick consumes it (read-then-delete) and STARTs a force compile. A force
      // START persists a pending record with mode:'force', so subsequent resume
      // ticks finish in force mode (dedupe on, daily schedule untouched) even
      // though the marker was already consumed. When no marker is set, force is
      // false — byte-identical to the prior inline cron body (due-gate enforced).
      const force = await consumeForceRequest(ctx, company.id);
      await compileBulletinForCompany(ctx, company, { now, bulletinTz, force });

      // Delivery-layer rework (2026-05-28) — §9.2 TL;DR cross-tick drainer.
      // Consume any in-flight tldr-compile operation results the heartbeat's
      // immediate poll missed (a slow agent). Best-effort: a throw here must not
      // abort the bulletin loop, so it is isolated. drainTldrOperations has its
      // own per-operation try/catch, but the reconcile/list at its top could
      // throw — guard the whole call.
      try {
        await drainTldrOperations(ctx, company.id, now);
      } catch (e) {
        ctx.logger?.warn?.(`compile-bulletin: tldr-drainer failed: ${errText(e)}`, {
          companyId: company.id,
        });
      }
    }
  });
}
