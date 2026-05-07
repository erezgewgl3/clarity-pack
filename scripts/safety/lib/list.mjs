// scripts/safety/lib/list.mjs
//
// Enumerate snapshots under <snapshotsDir>/<id>/ and report id, createdAt,
// total artifact size, verifiedAt, and ageMinutes. Sorted newest-first by
// createdAt. Skips any directory whose name does not match the strict
// snapshot-id regex (defense-in-depth against stray dirs).

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readManifest } from './manifest.mjs';
import { isValidSnapshotId } from './paths.mjs';

/**
 * List snapshots in <snapshotsDir>.
 *
 * Returns an array of:
 *   { id, createdAt, sizeBytes, verifiedAt, ageMinutes }
 * sorted by createdAt descending (newest first). A snapshot whose
 * manifest.json fails to parse is silently skipped — the caller may want
 * to prune it manually.
 */
export async function listSnapshots(snapshotsDir) {
  let entries;
  try {
    entries = await readdir(snapshotsDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const now = Date.now();
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidSnapshotId(entry.name)) continue;
    const dir = path.join(snapshotsDir, entry.name);
    let manifest;
    try {
      manifest = await readManifest(dir);
    } catch {
      // Skip unreadable / pre-v0.1 manifests; the operator can prune by hand.
      continue;
    }
    const dbSize =
      manifest.artifacts && manifest.artifacts.db && Number.isFinite(manifest.artifacts.db.sizeBytes)
        ? manifest.artifacts.db.sizeBytes
        : 0;
    const fsSize =
      manifest.artifacts && manifest.artifacts.fs && Number.isFinite(manifest.artifacts.fs.sizeBytes)
        ? manifest.artifacts.fs.sizeBytes
        : 0;
    const createdAtMs = Date.parse(manifest.createdAt);
    const ageMinutes = Number.isFinite(createdAtMs)
      ? Math.max(0, (now - createdAtMs) / 60000)
      : Number.POSITIVE_INFINITY;
    out.push({
      id: manifest.snapshotId,
      createdAt: manifest.createdAt,
      sizeBytes: dbSize + fsSize,
      verifiedAt: manifest.verifiedAt ?? null,
      ageMinutes
    });
  }
  out.sort((a, b) => {
    // Lexicographic sort on ISO-8601 createdAt is equivalent to chronological.
    if (a.createdAt < b.createdAt) return 1;
    if (a.createdAt > b.createdAt) return -1;
    return 0;
  });
  return out;
}
