# Phase 16 Plan 04 — Task 2 Decision Gate (OQ#3): no migration

**Decision: SKIP `migrations/0017_situation_snapshot_index.sql`. No migration created.**

## What Task 2 gates

RESEARCH OQ#3: create an additive `(computed_for_company_id, taken_at DESC)` index
on `situation_snapshots` ONLY IF the SWR most-recent-row SELECT is itself a
measurable cost. The documented default is the NO-MIGRATION viewer-invariant-cache
design.

## Evidence the SELECT is NOT a measurable cost

- **Query shape:** `SELECT payload, taken_at FROM
  plugin_clarity_pack_cdd6bda4bd.situation_snapshots WHERE
  computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1` — a single-row
  most-recent read on a small plugin-namespace table.
- **Table population:** one logical row per company per *distinct content* —
  `writeSnapshot` uses `ON CONFLICT (computed_for_company_id, content_hash) DO
  NOTHING`, so identical recomputes deduplicate server-side and never grow the
  table. Row count for a single-tenant BEAAA box is tiny.
- **16-02/16-03 stage timings** (the prior-wave measurements): `prefetch ≈ 30ms`,
  `org-backlog ≈ 31ms`, `employees-rollup ≈ 37ms` (in-memory fake). The cold-time
  cost is the N+1 RPC fan-out + the irreducible `relations.get` BFS — NOT a
  snapshot-table read (the table was not even being read pre-16-04). Neither
  16-02-SUMMARY.md nor 16-03-SUMMARY.md flags a `situation_snapshots` SELECT as a
  cost.
- **Task-1 SWR read timing:** the `readLatestSnapshot` round-trip in
  `snapshot-cache.test.mjs` / `situation-room-handler.test.mjs` is effectively
  instant; the SWR read adds one trivial single-row SELECT to the call.

**Conclusion:** the SWR read is sub-ms on a small table; an index would be premature
optimization against no measured cost. Following the plan's documented default
(prefer the no-migration design), Task 2 SKIPS the migration.

## Re-evaluation hook (Task 3 live drill)

If the live BEAAA cold/warm drill (Task 3) shows the most-recent-row SELECT is a
measurable cost (e.g. the table has accumulated many historical rows for the
company and the `ORDER BY taken_at DESC` triggers a sort), THEN add the single
additive, namespace-qualified, procedural-block-free index:

```sql
CREATE INDEX IF NOT EXISTS situation_snapshots_company_taken_idx
  ON plugin_clarity_pack_cdd6bda4bd.situation_snapshots (computed_for_company_id, taken_at DESC);
```

and run `node --test test/migrations/no-procedural-blocks.test.mjs`. Until then,
no DDL ships (additive-only / uninstall-safe by construction — the SWR write
reuses the existing table with no schema change).
