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
// NOTE: the EXACT column references below (active_subscription_cents,
// author_role, tags @> ARRAY[...]) are sensible v1 defaults; the registry
// SHAPE (5 slots, parameterized SQL, format, displayName) is the locked
// contract. Plan 03-03's Countermoves dry-run validates the real schema and
// refines the SQL. computeStandingNumbers catches a per-slot query error and
// defaults that slot to 0, so a column-not-found never aborts a compile.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';
import type { StandingNumberSlot } from '../../shared/types.ts';

/** v1 final 5 slots. SQL targets coreReadTables; $1 is always companyId. */
export const STANDING_NUMBER_SLOTS: readonly StandingNumberSlot[] = [
  {
    key: 'mrr',
    displayName: 'MRR',
    sql: 'SELECT COALESCE(SUM(active_subscription_cents), 0)::bigint AS value FROM public.companies WHERE id = $1',
    params: ['<companyId>'],
    format: 'currency',
  },
  {
    key: 'briefs_sent_week',
    displayName: 'Briefs sent · this week',
    sql: "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'done' AND tags @> ARRAY['brief'] AND updated_at >= now() - interval '7 days'",
    params: ['<companyId>'],
    format: 'count',
  },
  {
    key: 'reply_rate_7d',
    displayName: 'Cold reply rate · 7d',
    sql: "WITH outbound AS (SELECT COUNT(*)::numeric AS n FROM public.issues WHERE company_id = $1 AND tags @> ARRAY['cold-email'] AND updated_at >= now() - interval '7 days'), replies AS (SELECT COUNT(*)::numeric AS n FROM public.issue_comments c JOIN public.issues i ON c.issue_id = i.id WHERE i.company_id = $1 AND i.tags @> ARRAY['cold-email'] AND c.created_at >= now() - interval '7 days' AND c.author_role = 'prospect') SELECT CASE WHEN (SELECT n FROM outbound) = 0 THEN 0 ELSE (SELECT n FROM replies) / (SELECT n FROM outbound) END AS value",
    params: ['<companyId>'],
    format: 'pct',
  },
  {
    key: 'discoveries_7d',
    displayName: 'Discoveries booked · 7d',
    sql: "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND tags @> ARRAY['discovery-booked'] AND updated_at >= now() - interval '7 days'",
    params: ['<companyId>'],
    format: 'count',
  },
  {
    key: 'refund_rate_30d',
    displayName: 'Refund rate · 30d',
    sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM public.issues WHERE company_id = $1 AND tags @> ARRAY['paying-customer'])::numeric = 0 THEN 0 ELSE (SELECT COUNT(*)::numeric FROM public.issues WHERE company_id = $1 AND tags @> ARRAY['refund'] AND updated_at >= now() - interval '30 days') / (SELECT COUNT(*)::numeric FROM public.issues WHERE company_id = $1 AND tags @> ARRAY['paying-customer']) END AS value",
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
