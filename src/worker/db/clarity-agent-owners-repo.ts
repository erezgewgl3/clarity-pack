// src/worker/db/clarity-agent-owners-repo.ts
//
// Phase 6.1 ROOM-09 -- typed CRUD wrapper for plugin_clarity_pack_cdd6bda4bd
// .clarity_agent_owners (migration 0013).
//
// Mirrors src/worker/db/chat-topics-repo.ts header + type shape exactly:
// every function takes a `ClarityAgentOwnersRepoCtx` ({ db }) as its first
// argument, and every SQL string is fully-qualified against the deterministic
// plugin namespace plugin_clarity_pack_cdd6bda4bd literally (02-01 Finding #4
// -- no template substitution).
//
// HOST CONTRACT (SDK PluginDatabaseClient): ctx.db.query is SELECT-only;
// ctx.db.execute returns only { rowCount } -- no rows, so RETURNING is
// unavailable. The flat upsert is therefore:
//   1. INSERT ... ON CONFLICT (agent_id) DO UPDATE SET ...   (via execute)
//   2. SELECT ... WHERE agent_id = $1 LIMIT 1                (via query)
// to read the surviving row back. D-01 last-write-wins semantics fall out
// naturally from ON CONFLICT DO UPDATE.
//
// CTT-07 invariant by construction: no host-issue mutation calls in this
// repo. Every write targets the plugin namespace via ctx.db.execute.
//
// Multi-company discrimination (D-08): every row carries company_id; the
// snapshot lookup helper filters by company_id so a multi-company host
// never cross-contaminates ownership claims.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type ClarityAgentOwnersRepoCtx = {
  db: PluginDatabaseClient;
};

/** A clarity_agent_owners row -- D-01 / D-08 flat upsert shape. snake_case
 *  mirrors the SQL.  */
export type ClarityAgentOwnerRow = {
  agent_id: string;
  owner_user_id: string;
  company_id: string;
  set_at: string; // ISO
};

const CLARITY_AGENT_OWNER_COLS =
  'agent_id, owner_user_id, company_id, set_at';

/**
 * Upsert one clarity_agent_owners row, then read it back. INSERT ... ON
 * CONFLICT (agent_id) DO UPDATE -- D-01 last-write-wins. The follow-up
 * SELECT returns the surviving row so callers get the canonical set_at
 * (the server-side now() default would not be visible otherwise; here we
 * always pass set_at explicitly so the read-back round-trips it).
 */
export async function upsertClarityAgentOwner(
  ctx: ClarityAgentOwnersRepoCtx,
  row: ClarityAgentOwnerRow,
): Promise<ClarityAgentOwnerRow> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners
       (${CLARITY_AGENT_OWNER_COLS})
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id) DO UPDATE SET
       owner_user_id = EXCLUDED.owner_user_id,
       company_id    = EXCLUDED.company_id,
       set_at        = EXCLUDED.set_at`,
    [row.agent_id, row.owner_user_id, row.company_id, row.set_at],
  );

  const rows = await ctx.db.query<ClarityAgentOwnerRow>(
    `SELECT ${CLARITY_AGENT_OWNER_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners
     WHERE agent_id = $1
     LIMIT 1`,
    [row.agent_id],
  );
  return rows[0] ?? row;
}

/**
 * List every claimed-owner row for one company. Consumed by the snapshot
 * recompute job (src/worker/jobs/situation-snapshot.ts) to build the
 * side-table-wins owner lookup map BEFORE the blocker-chain walk runs.
 * Bounded by N = agents-per-company (typically < 50 on Eric's instance);
 * a PK-only scan with a company_id filter is sufficient for v1.0.
 */
export async function listClarityAgentOwnersForCompany(
  ctx: ClarityAgentOwnersRepoCtx,
  companyId: string,
): Promise<Array<{ agent_id: string; owner_user_id: string }>> {
  return ctx.db.query<{ agent_id: string; owner_user_id: string }>(
    `SELECT agent_id, owner_user_id
     FROM plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners
     WHERE company_id = $1`,
    [companyId],
  );
}
