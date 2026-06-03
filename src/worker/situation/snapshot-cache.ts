// src/worker/situation/snapshot-cache.ts
//
// Plan 16-04 Task 1 (Wave C) — the stale-while-revalidate (SWR) repo for the
// Situation Room. A 1:1 structural mirror of src/worker/db/tldr-cache.ts (the
// canonical most-recent-row SELECT + ON-CONFLICT-DO-NOTHING namespace INSERT
// repo): same ctx shape (db: PluginDatabaseClient), same host-faithful ctx.db
// contract (query = SELECT-only single statement; execute = namespace DML,
// returns rowCount, NEVER rows — see reply-resume-repo.ts:71).
//
// What it caches: ONLY the VIEWER-INVARIANT slice of the snapshot — the org
// blocked backlog rows, the per-employee rollup rows (WITH each row's
// blockerChain terminal metadata, so buildNeedsYou can re-partition per viewer),
// and the pulse. It does NOT cache the viewer-scoped needsYou count (T-16-03 —
// the handler recomputes that per call via buildNeedsYou(rows, viewerUserId) so a
// company-keyed cache can never leak one viewer's count to another).
//
// CONSTRAINT-COLUMN NAME (WARNING 5): the situation_snapshots UNIQUE constraint
// is UNIQUE (computed_for_company_id, content_hash) — migrations/0003 line 43.
// The column is `computed_for_company_id`, NOT `company_id`. The ON CONFLICT
// target below matches the migration verbatim. There is NO viewer_user_id column
// (the viewer-invariant-cache design makes one unnecessary) and the read filters
// on computed_for_company_id = $1 only (T-16-04 — company-scoped, parameterized,
// no prefix literal).
//
// Additive-only: this repo REUSES the existing situation_snapshots table (no DDL,
// no migration); plugin disable/uninstall preserves the data by construction.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

import type { OrgBlockedBacklog } from '../handlers/org-blocked-backlog.ts';
import type { SituationEmployeeRow } from './build-employees-rollup.ts';
import type { PulseSummary } from './build-pulse-summary.ts';

/** The ctx contract the SWR repo needs — query (SELECT-only) + execute
 *  (namespace DML). Mirrors ReplyResumeRepoCtx / TldrCacheCtx. */
export type SnapshotCacheCtx = {
  db: Pick<PluginDatabaseClient, 'query' | 'execute'>;
};

/**
 * The VIEWER-INVARIANT slice persisted in situation_snapshots.payload. Every
 * field here is the same for any viewer of the company; the viewer-scoped
 * needsYou count is deliberately NOT a member (T-16-03). The employee rows carry
 * their blockerChain terminal metadata (terminalKind + awaitedUserId) so
 * buildNeedsYou can re-partition the viewer-targeted set on read with no fetch.
 */
export type ViewerInvariantSlice = {
  org_blocked_backlog: OrgBlockedBacklog;
  situation_employees: SituationEmployeeRow[];
  pulse: PulseSummary;
};

/** A cached read — the persisted slice plus the timestamp the SWR freshness
 *  window is measured against. */
export type SnapshotCacheRead = {
  payload: ViewerInvariantSlice;
  takenAt: string; // ISO / timestamptz round-trip
};

/** Raw snake_case row from the most-recent-snapshot SELECT. */
type SnapshotSqlRow = {
  payload: ViewerInvariantSlice | string | null;
  taken_at: string | null;
};

/**
 * Read the single MOST-RECENT snapshot row for a company (ORDER BY taken_at DESC
 * LIMIT 1) or null when none exists. Mirrors tldr-cache.ts:97-111. The payload
 * jsonb arrives as a parsed object through the host bridge, but is defensively
 * JSON.parse'd when the bridge hands back a string.
 */
export async function readLatestSnapshot(
  ctx: SnapshotCacheCtx,
  companyId: string,
): Promise<SnapshotCacheRead | null> {
  const rows = await ctx.db.query<SnapshotSqlRow>(
    `SELECT payload, taken_at
     FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots
     WHERE computed_for_company_id = $1
     ORDER BY taken_at DESC
     LIMIT 1`,
    [companyId],
  );
  const row = rows[0];
  if (!row || row.payload == null || row.taken_at == null) return null;
  let payload: ViewerInvariantSlice;
  if (typeof row.payload === 'string') {
    try {
      payload = JSON.parse(row.payload) as ViewerInvariantSlice;
    } catch {
      return null; // a corrupt payload is treated as a cache miss (recompute fresh)
    }
  } else {
    payload = row.payload;
  }
  return { payload, takenAt: row.taken_at };
}

/**
 * Insert the viewer-invariant slice. If (computed_for_company_id, content_hash)
 * already exists, the insert is a no-op — an identical snapshot deduplicates
 * server-side without a read-then-write race (WARNING 5: the ON CONFLICT target
 * is the migrations/0003 line 43 constraint, NOT `company_id`). The payload is
 * bound through a `$2::jsonb` cast (the host ctx.db.execute bridge serializes the
 * parameter as a scalar; the cast is unambiguous). ctx.db.execute returns
 * rowCount only (no RETURNING), so this returns void.
 */
export async function writeSnapshot(
  ctx: SnapshotCacheCtx,
  companyId: string,
  payload: ViewerInvariantSlice,
  contentHash: string,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.situation_snapshots
       (taken_at, computed_for_company_id, payload, content_hash)
     VALUES (now(), $1, $2::jsonb, $3)
     ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING`,
    [companyId, JSON.stringify(payload), contentHash],
  );
}

/**
 * A deterministic, stable content hash over the viewer-invariant slice — the
 * idempotency key for ON CONFLICT DO NOTHING. A small FNV-1a over a stable
 * JSON.stringify (the slice is plain JSON; key order is stable for the same
 * builder output) avoids a node:crypto dependency in the worker bundle and is
 * sufficient for dedup (collisions only cost a skipped write of an identical
 * payload, never a wrong serve).
 */
export function hashViewerInvariantSlice(slice: ViewerInvariantSlice): string {
  const json = JSON.stringify(slice);
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
