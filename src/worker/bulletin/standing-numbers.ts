// src/worker/bulletin/standing-numbers.ts
//
// Plan 03-02 — Pre-defined SQL registry for the Bulletin's Standing Numbers
// panel. Every number is grep-able to this file's SQL (BULL-05). NO
// LLM-generated numbers anywhere.
//
// T-03-10 (SQL injection): every `sql` string is a static module-level
// constant; the ONLY bound parameter is `$1` (companyId). No template
// literals, no string concatenation — the standing-numbers source-grep test
// asserts `/\$\{[^}]*\}/` never matches.
//
// NOTE: the 5 slots below are agent-operations metrics; every column is
// verified present against the live Paperclip schema in
// 03-10-SCHEMA-FINDINGS.md §2. The registry SHAPE (5 slots, parameterized
// SQL, format, displayName) is the locked contract; the specific numbers are
// planner's discretion per 03-CONTEXT.md line 92. computeStandingNumbers
// catches a per-slot query error and defaults that slot to 0, so a
// column-not-found never aborts a compile.
//
// SELF-COUNT EXCLUSION (debug verifier-counts-own-issue, 2026-05-17; broadened
// by debug bulletin-compile-cadence-runaway, 2026-05-18 v0.6.6). The
// bulletin-compile pipeline delivers the compile prompt as an operation issue
// ASSIGNED to the Editor-Agent (deliverAgentTask, originKind
// `plugin:clarity-pack:operation:bulletin-compile`) and PUBLISHES the bulletin
// itself as a `public.issues` row whose `origin_kind` is the plain
// `plugin:clarity-pack` namespace. BOTH are Clarity Pack's OWN issues and
// neither belongs in an agent-operations count.
//
// v0.6.6 broadening: the original exclusion was scoped to the
// `plugin:clarity-pack:operation:%` SUB-namespace, so a freshly-PUBLISHED
// bulletin issue (`origin_kind = 'plugin:clarity-pack'`, no `:operation:`
// segment) slipped past the filter and counted itself in `completed_7d` when it
// transitioned to `done` mid-compile (the 2026-05-18 drill pinned `a26ea0fb`
// "Bulletin No. 6" doing exactly this). The filter is therefore widened to the
// WHOLE `plugin:clarity-pack%` namespace — every Clarity-Pack-origin issue
// (operation issues AND published bulletins) is excluded. This is defensible
// regardless: a clarity-pack surface artifact is never an "agent-operations"
// metric. (Bug 2's verifier re-grounding makes the verifier-race moot on its
// own; this stays as defence-in-depth so the LIVE numbers the agent is HANDED
// are themselves clean.)
//
// `origin_kind` is the persisted discriminator — see 03-10-SCHEMA-FINDINGS.md
// §2; the plugin has no `issues.tags`/`metadata` column, and `surfaceVisibility`
// is not the persisted column name. The LIKE pattern is a static literal inside
// the module-constant SQL string — `$1` (companyId) remains the SOLE bound
// parameter, so the T-03-10 SQL-injection invariant holds. The exclusion is
// scoped to `plugin:clarity-pack%` and so does NOT touch any human-board issue
// or another plugin's issues. The prefix MUST stay in sync with
// OPERATION_ORIGIN_KIND_PREFIX in src/worker/agents/agent-task-delivery.ts.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';
import type { StandingNumberSlot } from '../../shared/types.ts';

/**
 * SQL fragment excluding every Clarity-Pack-origin issue (operation issues AND
 * published bulletins) from a `public.issues` count. Kept as a single static
 * module constant so the slot SQL below stays a plain string literal (no
 * template-literal interpolation — T-03-10). The pattern `plugin:clarity-pack%`
 * covers BOTH the `plugin:clarity-pack:operation:%` operation sub-namespace and
 * the plain `plugin:clarity-pack` origin a published bulletin issue carries.
 * `origin_kind` is nullable on `public.issues`; `NOT LIKE` evaluates to NULL
 * (not TRUE) for a NULL origin_kind, which would silently DROP every human
 * issue — so the predicate is `(origin_kind IS NULL OR origin_kind NOT LIKE …)`.
 */
const EXCLUDE_OPERATION_ISSUES_SQL =
  "AND (origin_kind IS NULL OR origin_kind NOT LIKE 'plugin:clarity-pack%')";

/**
 * v1 final 5 slots — agent-operations metrics over public.issues /
 * public.companies. SQL targets coreReadTables; $1 is always companyId.
 * Columns verified live in 03-10-SCHEMA-FINDINGS.md §2.
 */
export const STANDING_NUMBER_SLOTS: readonly StandingNumberSlot[] = [
  {
    key: 'open_issues',
    displayName: 'Open issues',
    sql:
      "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status NOT IN ('done','cancelled') AND hidden_at IS NULL " +
      EXCLUDE_OPERATION_ISSUES_SQL,
    params: ['<companyId>'],
    format: 'count',
  },
  {
    key: 'completed_7d',
    displayName: 'Issues completed · 7d',
    sql:
      "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'done' AND completed_at >= now() - interval '7 days' " +
      EXCLUDE_OPERATION_ISSUES_SQL,
    params: ['<companyId>'],
    format: 'count',
  },
  {
    key: 'blocked_issues',
    displayName: 'Blocked · awaiting action',
    sql:
      "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'blocked' AND hidden_at IS NULL " +
      EXCLUDE_OPERATION_ISSUES_SQL,
    params: ['<companyId>'],
    format: 'count',
  },
  {
    key: 'agent_spend_mtd',
    displayName: 'Agent spend · MTD',
    sql: 'SELECT ROUND(COALESCE(spent_monthly_cents,0) / 100.0)::bigint AS value FROM public.companies WHERE id = $1',
    params: ['<companyId>'],
    format: 'currency',
  },
  {
    key: 'budget_used_pct',
    displayName: 'Budget used · MTD',
    sql: "SELECT CASE WHEN COALESCE(budget_monthly_cents,0) = 0 THEN 0 ELSE spent_monthly_cents::numeric / budget_monthly_cents::numeric END AS value FROM public.companies WHERE id = $1",
    params: ['<companyId>'],
    format: 'pct',
  },
];

/** Narrow ctx shape — just the db client + an optional logger. */
export type StandingNumbersCtx = {
  db: Pick<PluginDatabaseClient, 'query'>;
  logger?: { warn?(...a: unknown[]): void };
};

/**
 * Execute each slot's SQL against ctx.db.query and return a map of key→value.
 * A failing slot is caught, logged, and defaults to 0 — the failed-compile
 * banner (Plan 03-04) surfaces a persistent zero; a single bad slot never
 * aborts the whole compile.
 */
export async function computeStandingNumbers(
  ctx: StandingNumbersCtx,
  companyId: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const slot of STANDING_NUMBER_SLOTS) {
    try {
      const params = slot.params.map((p) => (p === '<companyId>' ? companyId : p));
      const rows = await ctx.db.query<{ value: number }>(slot.sql, params);
      out[slot.key] = Number(rows[0]?.value ?? 0);
    } catch (e) {
      ctx.logger?.warn?.('standing-numbers: slot query failed', {
        slot: slot.key,
        err: (e as Error).message,
      });
      out[slot.key] = 0;
    }
  }
  return out;
}
