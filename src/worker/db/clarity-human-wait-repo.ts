// src/worker/db/clarity-human-wait-repo.ts
//
// Phase 17 Plan 17-01 Task 1 (WAIT-01, D-04/D-05/D-06) — the Editor-Agent
// structured human-wait cache repo.
//
// A 1:1 structural mirror of src/worker/db/action-cards-repo.ts: same ctx shape
// ({ db: PluginDatabaseClient }), same ctx.db.execute (DML) / ctx.db.query
// (SELECT-only) split, same toPgTextArrayLiteral + $N::text[] binding fix.
//
// DIVERGENCE vs action-cards-repo.ts: action_cards is append-on-change
// (UNIQUE (company_id, source_issue_id, content_hash) + ON CONFLICT DO NOTHING,
// then "most-recent per source" read). This repo holds ONE LIVE row per
// (company, issue) — D-04 self-clear SWR semantics — so the upsert is
// ON CONFLICT (company_id, issue_id) DO UPDATE (update-in-place) and the read
// returns ALL live rows for the company in one shot (one row per issue by
// construction of the UNIQUE key), which the prefetch turns into a
// Map<issue_id, row>. The self-clear is a DELETE in the repo (DML lives here,
// NEVER in the migration).
//
// text[] columns (source_revisions) are bound as a Postgres array-LITERAL
// string through a $N::text[] cast via the shared toPgTextArrayLiteral helper
// (v0.6.5 Bug 2 — the host ctx.db.execute bridge does NOT pass a JS string
// array through to the postgres driver as a native array; a cast scalar is
// unambiguous). The helper is REUSED from tldr-cache.ts verbatim, never
// re-implemented.
//
// Multi-company discrimination: every read/write is scoped by company_id; the
// UNIQUE (company_id, issue_id) constraint plus the WHERE company_id = $1
// filter keep a multi-company host from cross-contaminating waits (T-17-02).

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

import { toPgTextArrayLiteral } from './tldr-cache.ts';

/**
 * One persisted structured human-wait row — matches the columns of
 * plugin_clarity_pack_cdd6bda4bd.clarity_human_waits (migration 0018). issue_id
 * is the blocked (root) issue UUID the wait grounds in (key/dispatch only,
 * never rendered — NO_UUID_LEAK). owner_user_id is the company primary human
 * (founder, D-06). decision_one_liner is the polishTldr-voiced "what" (D-05).
 */
export type ClarityHumanWaitRow = {
  company_id: string;
  issue_id: string;
  owner_user_id: string;
  decision_one_liner: string;
  content_hash: string;
  generated_at: string; // ISO
  compiled_by_agent_id: string;
  source_revisions: string[];
};

export type ClarityHumanWaitRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * Upsert one structured human-wait row. (company_id, issue_id) is the live key:
 * a second compile of the SAME issue UPDATES the row in place (D-04 — one live
 * wait per issue, re-derived each compile). The Postgres ON CONFLICT DO UPDATE
 * clause resolves the conflict server-side — no read-then-write race.
 *
 * source_revisions is bound as an array-literal string through a $N::text[]
 * cast (v0.6.5 Bug 2 — see the file header and tldr-cache.ts).
 */
export async function upsertClarityHumanWait(
  ctx: ClarityHumanWaitRepoCtx,
  row: ClarityHumanWaitRow,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
       (company_id, issue_id, owner_user_id, decision_one_liner, content_hash, generated_at, compiled_by_agent_id, source_revisions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
     ON CONFLICT (company_id, issue_id) DO UPDATE SET
       owner_user_id        = EXCLUDED.owner_user_id,
       decision_one_liner   = EXCLUDED.decision_one_liner,
       content_hash         = EXCLUDED.content_hash,
       generated_at         = EXCLUDED.generated_at,
       compiled_by_agent_id = EXCLUDED.compiled_by_agent_id,
       source_revisions     = EXCLUDED.source_revisions`,
    [
      row.company_id,
      row.issue_id,
      row.owner_user_id,
      row.decision_one_liner,
      row.content_hash,
      row.generated_at,
      row.compiled_by_agent_id,
      toPgTextArrayLiteral(row.source_revisions),
    ],
  );
}

/**
 * List every live structured human-wait row for one company. Consumed by the
 * situation-room prefetch (Plan 17-02) to build the Map<issue_id, row> that
 * feeds applyStructuredWait on all three root-meta write sites (SC5 parity).
 * One row per issue by construction of the UNIQUE (company_id, issue_id) key;
 * a single company-scoped scan is sufficient for v1.5.
 */
export async function listClarityHumanWaitsForCompany(
  ctx: ClarityHumanWaitRepoCtx,
  companyId: string,
): Promise<ClarityHumanWaitRow[]> {
  return ctx.db.query<ClarityHumanWaitRow>(
    `SELECT company_id, issue_id, owner_user_id, decision_one_liner, content_hash, generated_at, compiled_by_agent_id, source_revisions
     FROM plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
     WHERE company_id = $1`,
    [companyId],
  );
}

/**
 * Self-clear delete (D-04). Removes the live wait for (company, issue) when the
 * comments no longer show an open human-wait (human replied, agent posted
 * progress/resolution, or the issue left blocked status). DML lives here in the
 * repo, NEVER in the migration. Idempotent: a delete of a non-existent row is a
 * no-op.
 */
export async function deleteClarityHumanWait(
  ctx: ClarityHumanWaitRepoCtx,
  companyId: string,
  issueId: string,
): Promise<void> {
  await ctx.db.execute(
    `DELETE FROM plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
     WHERE company_id = $1 AND issue_id = $2`,
    [companyId, issueId],
  );
}
