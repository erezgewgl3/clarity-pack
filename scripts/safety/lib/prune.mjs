// scripts/safety/lib/prune.mjs
//
// Periodically delete old snapshots while preserving:
//   1. Every snapshot younger than minAgeMs (default 24h) — never deleted.
//   2. The newest `keepVerified` verified snapshots (verifiedAt !== null).
//   3. The newest `keep` unverified snapshots.
//
// Returns a deletion plan; with dryRun=false, also performs the rmrf.
// Crash-safe: rmdir failures are surfaced per-snapshot but don't abort
// the whole prune; the caller decides whether to retry.

import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { listSnapshots } from './list.mjs';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prune snapshots in <snapshotsDir>.
 *
 * opts:
 *   keep          — number of newest unverified snapshots to keep (default 10)
 *   keepVerified  — number of newest verified snapshots to keep (default 3)
 *   dryRun        — if true, return the plan without deleting (default false)
 *   minAgeMs      — never delete a snapshot younger than this (default 24h)
 *
 * Returns:
 *   { toKeep: [{id, ...}], toDelete: [{id, ...}] }
 * Note: snapshots younger than minAgeMs are always in toKeep regardless of
 * the keep/keepVerified caps.
 */
export async function pruneSnapshots(snapshotsDir, opts = {}) {
  const keep = Number.isInteger(opts.keep) ? opts.keep : 10;
  const keepVerified = Number.isInteger(opts.keepVerified) ? opts.keepVerified : 3;
  const dryRun = opts.dryRun === true;
  const minAgeMs = Number.isFinite(opts.minAgeMs) ? opts.minAgeMs : ONE_DAY_MS;

  const all = await listSnapshots(snapshotsDir);
  const minAgeMinutes = minAgeMs / 60000;

  const tooYoung = [];
  const eligible = [];
  for (const s of all) {
    if (s.ageMinutes < minAgeMinutes) tooYoung.push(s);
    else eligible.push(s);
  }

  const verified = eligible.filter((s) => s.verifiedAt !== null);
  const unverified = eligible.filter((s) => s.verifiedAt === null);
  // listSnapshots already sorts newest-first; slice from the front.
  const verifiedKeep = verified.slice(0, keepVerified);
  const unverifiedKeep = unverified.slice(0, keep);
  const verifiedDelete = verified.slice(keepVerified);
  const unverifiedDelete = unverified.slice(keep);

  const toKeep = [...tooYoung, ...verifiedKeep, ...unverifiedKeep];
  const toDelete = [...verifiedDelete, ...unverifiedDelete];

  if (!dryRun) {
    for (const s of toDelete) {
      const dir = path.join(snapshotsDir, s.id);
      try {
        // Sanity: confirm dir still exists before rm. Avoids a rare race
        // where two prune invocations see the same plan.
        await stat(dir);
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        // Re-throw so the caller knows pruning was incomplete.
        throw err;
      }
    }
  }
  return { toKeep, toDelete };
}
