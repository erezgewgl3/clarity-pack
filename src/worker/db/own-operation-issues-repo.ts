// src/worker/db/own-operation-issues-repo.ts
//
// Phase 16.1 Plan 16.1-01 Task 2 (D-03 / D-04) — the durable own-operation
// provenance repo. A 1:1 structural mirror of reply-resume-repo.ts: same ctx
// shape (db: PluginDatabaseClient), same host-faithful ctx.db contract
// (query = SELECT-only single statement; execute = namespace DML, returns
// rowCount only, NEVER rows / no RETURNING), same idempotency discipline
// (UNIQUE (company_id, issue_id) + ON CONFLICT DO NOTHING).
//
// WHY THIS EXISTS. The in-memory op-issue set (op-issue-set.ts) empties on every
// worker restart, so after a restart the ingress event gate could not tell that
// an incoming issue.created/updated event was Clarity reacting to its OWN write
// — the exact failure mode behind the 2026-06-04 loop storm. This table is the
// restart-safe backstop: agent-task-delivery records every op-issue it authors
// here, and the ingress gate (D-04) reads isOwnOperationIssue BEFORE any
// wake/enqueue. The in-memory set stays as a fast-path cache; this is the
// authoritative durable guard.
//
// All SQL is parameterized ($1/$2) — no string interpolation of identifiers
// (T-161-01 mitigation).

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type OwnOperationIssuesRepoCtx = {
  db: PluginDatabaseClient;
};

/**
 * Durable provenance read (D-04 ingress guard). Returns true when Clarity itself
 * authored the (company_id, issue_id) issue — the ingress event gate calls this
 * BEFORE any enqueue/wake so the plugin never reacts to its own writes. Survives
 * a worker restart (the in-memory set does not). Company-scoped: the same issue
 * id under a different company is not a match.
 */
export async function isOwnOperationIssue(
  ctx: OwnOperationIssuesRepoCtx,
  companyId: string,
  issueId: string,
): Promise<boolean> {
  const rows = await ctx.db.query<{ '?column?': number }>(
    `SELECT 1
     FROM plugin_clarity_pack_cdd6bda4bd.own_operation_issues
     WHERE company_id = $1 AND issue_id = $2
     LIMIT 1`,
    [companyId, issueId],
  );
  return rows.length > 0;
}

/**
 * Record that Clarity authored (company_id, issue_id). Carries
 * `ON CONFLICT (company_id, issue_id) DO NOTHING` — re-recording the same pair
 * is a server-side no-op (no read-then-write race, no throw). The host
 * ctx.db.execute returns rowCount only (no RETURNING), so this returns void.
 */
export async function recordOwnOperationIssue(
  ctx: OwnOperationIssuesRepoCtx,
  companyId: string,
  issueId: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.own_operation_issues
       (company_id, issue_id)
     VALUES ($1, $2)
     ON CONFLICT (company_id, issue_id) DO NOTHING`,
    [companyId, issueId],
  );
}
