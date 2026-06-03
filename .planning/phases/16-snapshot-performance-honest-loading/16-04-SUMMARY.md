---
phase: 16-snapshot-performance-honest-loading
plan: 04
wave: 4
status: complete
requirements: [SNAP-01, SNAP-02, SNAP-03]
version_shipped: 1.4.5
deployed_to: BEAAA
deploy_date: 2026-06-03
---

# 16-04 SUMMARY — Wave C (SWR serve-last-good) + Phase 16 live close

## What shipped

**Task 1 — SWR snapshot cache + extracted pure `buildNeedsYou` + handler serve-last-good** (commit `39498c5`)
- `src/worker/situation/snapshot-cache.ts` (new): `readLatestSnapshot(ctx, companyId)` (`SELECT payload, taken_at ... WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1`) and `writeSnapshot(ctx, companyId, payload, contentHash)` (`INSERT ... VALUES (now(), $1, $2::jsonb, $3) ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING` via `ctx.db.execute`) + an FNV-1a `hashViewerInvariantSlice`. **WARNING 5 confirmed against migrations/0003 line 43** — ON CONFLICT target is `computed_for_company_id` (NOT `company_id`); no `viewer_user_id` column.
- `build-employees-rollup.ts`: extracted exported pure `buildNeedsYou(rows, viewerUserId): NeedsYou` from the partition/count/topAction block; `buildEmployeesRollup` now calls it (single shared `partitionNeedsYouRows`, no inlined duplicate). Added `blockerChain.awaitedUserId` so the cached viewer-invariant row carries the AWAITING_HUMAN terminal metadata needed to re-partition per viewer.
- `situation-room.ts`: serve-last-good SWR. Fresh cached row (< `FRESHNESS_MS`) → serve cached viewer-invariant slice immediately, recompute `needsYou` + `pulse` per call via `buildNeedsYou`, fire-and-forget revalidate **inside handler scope** (`void (async () => {…})()` — NO cron, NO setInterval). Miss/stale → recompute synchronously, serve, write back. Return shape unchanged: `{org_blocked_backlog, situation_employees, needsYou, pulse, taken_at}`.

**Task 2 — OPTIONAL index migration: SKIPPED** (commit `41ff616`)
- No `migrations/0017_*.sql` created. The SWR read is a single-row most-recent `SELECT` on a small, content-hash-deduped table; live `snap.stage` totals (below) confirm the cost is the prefetch + relations BFS, never a snapshot-table read. Re-evaluation hook (the exact additive `CREATE INDEX IF NOT EXISTS situation_snapshots_company_taken_idx ON ...situation_snapshots (computed_for_company_id, taken_at DESC)`) recorded in `16-04-TASK2-DECISION.md` should a future drill show otherwise.

**Version bump** (commit `b6bc499`): 1.4.4 → **1.4.5** in BOTH `package.json` and `src/manifest.ts` (host reads `dist/manifest.js` built from `src/manifest.ts` — plugin-version-bump-two-sources).

## FRESHNESS_MS
`FRESHNESS_MS = 60_000` (60s, per RESEARCH OQ#3 / matching the legacy on-view recompute cadence). Module constant in `src/worker/handlers/situation-room.ts`.

## Local verification (pre-deploy)
- `node --test snapshot-cache.test.mjs` — 11/11 pass (incl. T-16-03: two distinct `viewerUserId` over identical cached rows → distinct `needsYou.count`, no cross-viewer leak).
- `build-employees-rollup.test.mjs` — 28/28 pass (behavior-preserving extraction).
- Combined situation/snapshot suites (snapshot-cache + build-employees-rollup + snapshot-prefetch + snapshot-degrade) — **53/53 pass**.
- `tsc --noEmit` clean. Build gates: SDK inlined (`paperclipInvocation`=5 ≥5), `dist/manifest.js` shows `version: '1.4.5'`.
- Tarball: `clarity-pack-1.4.5.tgz` · sha256 `5d5c953ff67ffae4f5ab82dbcb3b74a7931a93f96f55c6b4c9dc877bd6845e40` · 766,815 B (remote sha256 verified byte-identical).

## Live BEAAA drill (Task 3) — 2026-06-03, /BEAAA/situation-room via localhost:3100 tunnel

**Deploy:** DEPLOY-RUNBOOK Path A. `paperclipai` invoked as `npx -y paperclipai` (run-user `beai-agent`); install source `/home/beai-agent/clarity-pack-build/package` (npm install materialized node_modules). Upgrade path: `plugin uninstall clarity-pack` → `plugin install` → `pm2 restart paperclip`. Pre-deploy list `version=1.4.4` → post `key=clarity-pack status=ready version=1.4.5 id=a763176a-2f4d-4986-b190-b5151e42cc00` (UUID preserved — COEXIST #6).

**Bookend:** automated DO daily backup (satisfies bookended-by-snapshots per autonomous-deploy-authorization — no manual snapshot) + proven uninstall→reinstall rollback (v1.4.4 uninstalled cleanly during this very deploy; the change is read-path-only + additive, no migration, so disable/uninstall preserves data).

**Timings vs the recorded SNAP-03 baseline (cold 25.7s, 6/6 snapshot calls 200, no 502):**

| Load | worker `snap.stage` (prefetch / org-backlog / employees-rollup) | worker total | client wall-clock (incl. tunnel RTT) | HTTP |
|------|------------------------------------------------------------------|--------------|--------------------------------------|------|
| **Cold** (worker just pm2-restarted) | 1575 / 5 / 15 ms | **~1.6s** | **2,012 ms** | 200 |
| **Warm** (reload within 60s window) | 149* / 2 / 10 ms | — (served from cache) | **492 ms** | 200 |

\* The warm load's 149ms prefetch is the **fire-and-forget background revalidate** firing *after* the cached viewer-invariant slice was served — the defining SWR serve-last-good signature (response did not wait on it).

- **SNAP-01 (eliminate the 25.7s cold near-cliff):** cold 2.0s client / 1.6s worker = **~12.8× faster than the 25.7s baseline**, far under the 30s host timeout and under the ~5s p95 target. **Never 502** (worker tail clean; `situation.snapshot` 200).
- **SNAP-02 (degrade-safe):** the room rendered fully and honestly on cold load — 0 need-you / 1 in-motion (Actuary→BEAAA-617) / 18 watch + "+51 more" expander, every Watch row with a deterministic terminal line ("agent stuck") and Assign-owner/Open↗ actions; no blank, no forever-spinner. The 16-03 bounded-pool + per-call deadline floor (already in this build) backs the per-row UNCLASSIFIED floor; degrade logic is unit-proven (snapshot-degrade 53/53). No live fault was injected this drill.
- **SNAP-03 (measured vs baseline):** above table is the bookended before/after record.
- **No cross-viewer leak:** `needsYou` recomputed per call via the pure `buildNeedsYou` over the cached viewer-invariant slice; cache carries no viewer-scoped count (T-16-03).
- **Legibility:** all human-facing text is agent names + BEAAA-### keys; zero raw/partial UUIDs observed.

**LIVE-CHECK column back-fill (16-01):** confirmed by construction — the prefetch SELECT returned 200 and the rollup populated with correct owner names + issue keys, proving every projected snake_case column on `public.issues` / `public.agents` exists (a functional pass stronger than a `\d` dump; psql not run — embedded-PG password is host-held).

**Worker health:** `pm2` reports `paperclip cpu=0% mem=95mb` — near-idle. No CPU spike, no notification storm attributable to the worker.

## Observations / out-of-scope
- **Host-side anomaly (NOT Clarity, flagged for operator):** an intermittent Drizzle "Failed query" on `heartbeat_runs` inside `@paperclipai/server` (core route `agents.js:2471` → `heartbeat.js`), `limit 200`. The browser's own `heartbeat-runs?limit=200` call returned 200. Consistent with the v1.4.3 finding that host-Postgres/agent churn is the company's, not Clarity's. Out of Phase 16 scope.
- **Deviations (executor Rule 3):** two superseded test assertions updated to the SWR contract — `situation-room-handler.test.mjs` (now asserts SWR read + write-back, replacing the obsolete Plan-09-01 "NO situation_snapshots SELECT" invariant) and `snapshot-prefetch.test.mjs` (excludes the SWR namespace read from the public.* prefetch SELECT count). Both files directly exercise the modified handler.
- Pre-existing out-of-scope failures (CHAT/CTT REQUIREMENTS doc-traceability rows + flaky chat watchdog timing test) untouched — see `deferred-items.md`.

## Requirement status
- **SNAP-01** ✓ — 25.7s cold near-cliff eliminated (2.0s cold / 0.49s warm, never 502).
- **SNAP-02** ✓ — degrade-safe rollup (bounded pool + deadline floor + honest full render).
- **SNAP-03** ✓ — bookended before/after measured live vs the confirm-first 25.7s baseline.
