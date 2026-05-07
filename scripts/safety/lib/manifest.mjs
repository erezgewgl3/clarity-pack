// scripts/safety/lib/manifest.mjs
//
// Manifest emit / read / verify primitives for snapshot directories.
//
// The manifest is the *contract* of every snapshot. Every artifact
// (postgres.dump or pglite-datadir.tar.gz, plus instance-fs.tar.gz) is
// referenced by relative path with a streaming sha256 digest so a restore
// can detect tampering or corruption BEFORE running anything destructive.
//
// All hashes are computed via a streaming pipeline (node:stream/promises +
// node:crypto) so multi-GB artifacts don't get loaded into memory.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_VERSION = 1;

// The 12 documented top-level fields the manifest contract requires.
// Keep this in lockstep with PLAN 01-01 <interfaces> SnapshotManifest.
const REQUIRED_FIELDS = [
  'snapshotId',
  'createdAt',
  'createdBy',
  'paperclipVersion',
  'paperclipMode',
  'paperclipHome',
  'paperclipInstanceId',
  'installedPlugins',
  'lockfileSha256',
  'artifacts',
  'verifiedAt',
  'verifiedSmokeChecks',
  'gateMaxAgeMinutes'
];

/**
 * Streaming sha256 of a file. Returns the hex digest as a lower-case string.
 * Streams via node:stream/promises.pipeline so a 5GB artifact does not OOM.
 */
export async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Write a SnapshotManifest payload to <dir>/manifest.json (2-space JSON).
 * The schemaVersion field is stamped so future manifest schema bumps can
 * be detected at read time.
 */
export async function writeManifest(dir, payload) {
  const enriched = { schemaVersion: MANIFEST_VERSION, ...payload };
  const target = path.join(dir, MANIFEST_FILENAME);
  await writeFile(target, JSON.stringify(enriched, null, 2) + '\n', 'utf8');
}

/**
 * Read <dir>/manifest.json and return the parsed object.
 * Throws with a clear message if any required field is missing.
 */
export async function readManifest(dir) {
  const target = path.join(dir, MANIFEST_FILENAME);
  const raw = await readFile(target, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `manifest.json at ${target} is not valid JSON: ${err.message}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`manifest.json at ${target} is not a JSON object`);
  }
  if (parsed.schemaVersion === undefined) {
    throw new Error(
      'snapshot pre-dates v0.1 manifest schema (no schemaVersion field) — ' +
        'this snapshot cannot be restored by clarity-safety v0.1'
    );
  }
  const missing = REQUIRED_FIELDS.filter((f) => !(f in parsed));
  if (missing.length > 0) {
    throw new Error(
      `manifest.json at ${target} is missing required field(s): ${missing.join(
        ', '
      )}`
    );
  }
  return parsed;
}

/**
 * Re-hash every artifact recorded in the manifest and compare to the
 * sha256 stamped at snapshot time. Returns:
 *   { ok: true }  — every artifact verified
 *   { ok: false, mismatches: ['db'|'fs'] }  — at least one mismatch
 *
 * Restore MUST call this before any destructive step (tar.x, pg_restore,
 * loadDataDir, fs.rename) so a corrupted snapshot fails fast and clearly.
 */
export async function verifyManifest(dir) {
  const manifest = await readManifest(dir);
  const mismatches = [];
  for (const [key, art] of Object.entries(manifest.artifacts ?? {})) {
    if (!art || typeof art.path !== 'string' || typeof art.sha256 !== 'string') {
      mismatches.push(key);
      continue;
    }
    const artifactPath = path.isAbsolute(art.path)
      ? art.path
      : path.join(dir, art.path);
    let actual;
    try {
      actual = await sha256OfFile(artifactPath);
    } catch (err) {
      // Missing or unreadable artifact is itself a mismatch.
      mismatches.push(key);
      continue;
    }
    if (actual !== art.sha256) mismatches.push(key);
  }
  if (mismatches.length > 0) return { ok: false, mismatches };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Plan 02 augmentation — atomic write helpers used by verify.mjs.
// The original writeManifest above is preserved byte-identical for
// backward compat with Plan 01's M-series tests.
//
// writeManifestAtomic writes to <dir>/manifest.json.tmp and renames into
// place via fs.rename (atomic on the same filesystem on POSIX; effectively
// atomic on Windows for files that are not open). This guarantees a power
// cut during writeVerifiedFlag leaves the manifest either at its old
// content or its new content — never half-written.
// ---------------------------------------------------------------------------

/**
 * Atomically write a manifest payload to <dir>/manifest.json.
 *
 *   1. Serialize payload to <dir>/manifest.json.tmp (with the schemaVersion
 *      stamp — kept in lockstep with writeManifest so reads of either are
 *      uniform).
 *   2. fs.rename to <dir>/manifest.json.
 *
 * Any partial write to the .tmp file is discarded by the rename — readers
 * never see a torn file.
 */
export async function writeManifestAtomic(dir, payload) {
  const enriched = { schemaVersion: MANIFEST_VERSION, ...payload };
  const finalPath = path.join(dir, MANIFEST_FILENAME);
  const tmpPath = finalPath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(enriched, null, 2) + '\n', 'utf8');
  await rename(tmpPath, finalPath);
}

/**
 * Read-modify-write helper. Reads the existing manifest, calls fn(manifest)
 * to compute the new payload (sync or async), and writes it atomically.
 * Returns the new payload.
 *
 * fn may mutate the manifest in place and return it, or return a new
 * object. Either is fine — only the return value is what gets written.
 */
export async function updateManifest(dir, fn) {
  const m = await readManifest(dir);
  const next = await fn(m);
  await writeManifestAtomic(dir, next);
  return next;
}
