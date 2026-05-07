// scripts/safety/lib/restore.mjs
//
// Sibling-staging restore. The live `<id>/` instance dir is NEVER touched
// until verifyManifest passes AND the smoke check (Plan 02) succeeds. The
// safety properties this module owns:
//
//   1. verifyManifest before any destructive step (sha256 every artifact).
//   2. Reject entries of type SymbolicLink or Link during tar extraction
//      (CVE-2026-31802 mitigation — research §Security Domain T1).
//   3. Reject any entry whose canonicalized resolved path escapes the
//      staging dir (defense in depth against odd-shaped paths).
//   4. Validate the snapshot id before any FS access (Security Domain T3).
//   5. Refuse to overwrite the live instance dir without an explicit
//      `iKnowWhatImDoing: true` opt-in.
//   6. Postgres restore targets `paperclip_restoring` (or opts.targetDb),
//      NEVER the live db. Argv is locked. PGPASSWORD via env, never argv.
//
// atomicSwap is exported separately and is invoked ONLY by Plan 02's
// verify after smoke passes — restoreToStaging never calls it.

import crossSpawn from 'cross-spawn';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';

import { readManifest, verifyManifest } from './manifest.mjs';
import { isValidSnapshotId, resolveInstanceDir } from './paths.mjs';

const STAGING_DB_DEFAULT = 'paperclip_restoring';

/**
 * Refuse to restore over the live instance dir unless the operator
 * explicitly accepts the risk. Pattern 4 (refuse-or-run gate) at the
 * library level — the gate subcommand wraps the install command, but
 * this guard wraps the restore call itself for callers that bypass the
 * CLI.
 */
export function rejectIfLiveTargetWithoutOverride(opts) {
  if (!opts || typeof opts !== 'object') return;
  const target = opts.targetInstanceId ?? `${opts.instanceId}.restoring`;
  if (target === opts.instanceId && opts.iKnowWhatImDoing !== true) {
    throw new Error(
      `refusing to restore over the live instance "${opts.instanceId}"; ` +
        'pass --i-know-what-im-doing to override'
    );
  }
}

/**
 * Compute the staging DB connection string by swapping the database
 * name. Username/password/host/port preserved.
 */
function withStagingDbName(dbUrl, stagingDbName) {
  try {
    const u = new URL(dbUrl);
    // pathname starts with `/`. Replace the entire trailing path segment.
    u.pathname = '/' + encodeURIComponent(stagingDbName);
    return u.toString();
  } catch {
    // Best-effort string replace. If the DSN is opaque the operator
    // should pass --target-db explicitly via the CLI.
    return dbUrl.replace(/\/[^/?#]+(\?|#|$)/, `/${stagingDbName}$1`);
  }
}

/**
 * Run pg_restore against the staging DB. Argv locked by the plan:
 *   --single-transaction  (BEGIN/COMMIT wrap; rollback on any error)
 *   --clean --if-exists   (drop then recreate; first run is safe)
 *   --no-owner --no-privileges  (security mandate; matches snapshot)
 *   --dbname <stagingDsn>
 *   <snapshotDir>/postgres.dump
 * Password via PGPASSWORD env; argv never carries the password literal.
 */
async function runPgRestore({ snapshotDumpPath, stagingDbUrl, _spawn }) {
  let pgPassword;
  let pgUser;
  let sanitizedDsn = stagingDbUrl;
  try {
    const u = new URL(stagingDbUrl);
    if (u.password) {
      pgPassword = decodeURIComponent(u.password);
      u.password = '';
    }
    if (u.username) pgUser = decodeURIComponent(u.username);
    sanitizedDsn = u.toString();
  } catch {
    // Non-URL DSN passed through verbatim.
  }
  const argv = [
    '--single-transaction',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    sanitizedDsn,
    snapshotDumpPath
  ];
  const childEnv = { ...process.env };
  if (pgPassword) childEnv.PGPASSWORD = pgPassword;
  if (pgUser && !childEnv.PGUSER) childEnv.PGUSER = pgUser;
  let child;
  try {
    child = _spawn('pg_restore', argv, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(
        'pg_restore (PostgreSQL 17 client tools) is not on PATH. ' +
          (process.platform === 'win32'
            ? 'On Windows: winget install PostgreSQL.PostgreSQL.17'
            : process.platform === 'darwin'
              ? 'On macOS: brew install postgresql@17'
              : 'On Linux: apt-get install postgresql-client-17')
      );
    }
    throw err;
  }
  return new Promise((resolve, reject) => {
    let stderrTail = '';
    if (child.stderr) {
      child.stderr.on('data', (d) => {
        stderrTail = (stderrTail + d.toString('utf8')).slice(-4096);
      });
    }
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore exited non-zero (${code}): ${stderrTail.trim()}`));
    });
  });
}

/**
 * Stage a restore from a snapshot. The live instance dir is untouched.
 *
 * Step list:
 *   1. isValidSnapshotId(opts.snapshotId)             — security gate
 *   2. snapshotDir = <repoRoot>/.planning/snapshots/<id>/
 *   3. await verifyManifest(snapshotDir)              — sha256 gate
 *   4. mode = manifest.paperclipMode  (snapshot dictates, not opts)
 *   5. rejectIfLiveTargetWithoutOverride
 *   6. Extract instance-fs.tar.gz with the CVE-2026-31802 onentry guards
 *      and a path-canonicalization check. The tar's top-level dir is
 *      `instances/<originalId>/`; we extract under <home>/ then rename
 *      to the requested targetInstanceId.
 *   7. DB restore:
 *        pglite mode   → loadDataDir(<staging>/db, gzipped tarball)
 *        postgres mode → pg_restore into <stagingDb> (paperclip_restoring)
 *   8. Return StagingInfo so Plan 02 verify can take it from here.
 */
export async function restoreToStaging(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('restoreToStaging: opts is required');
  }
  if (!isValidSnapshotId(opts.snapshotId)) {
    throw new Error(`invalid snapshotId: ${String(opts.snapshotId)}`);
  }
  if (typeof opts.home !== 'string' || opts.home.length === 0) {
    throw new Error('restoreToStaging: opts.home is required');
  }
  if (typeof opts.instanceId !== 'string' || opts.instanceId.length === 0) {
    throw new Error('restoreToStaging: opts.instanceId is required');
  }

  // Resolve snapshot dir. Caller passes either a repoRoot (we compute
  // <repoRoot>/.planning/snapshots/<id>) OR a snapshotsDir directly. We
  // prefer the explicit-snapshotsDir form to keep this lib decoupled
  // from any "find the repo root" magic.
  let snapshotDir = opts.snapshotDir;
  if (!snapshotDir) {
    if (!opts.snapshotsDir) {
      throw new Error('restoreToStaging: either opts.snapshotDir or opts.snapshotsDir must be set');
    }
    snapshotDir = path.join(opts.snapshotsDir, opts.snapshotId);
  }

  // Step 3 — sha256 every artifact BEFORE any destructive step.
  const v = await verifyManifest(snapshotDir);
  if (!v.ok) {
    throw new Error(
      `snapshot integrity check failed: sha256 mismatch on ${v.mismatches.join(', ')}`
    );
  }
  const manifest = await readManifest(snapshotDir);
  const mode = manifest.paperclipMode;

  // Step 5 — refuse live target without override.
  rejectIfLiveTargetWithoutOverride(opts);
  const targetInstanceId = opts.targetInstanceId ?? `${opts.instanceId}.restoring`;
  const stagingInstanceDir = resolveInstanceDir(opts.home, targetInstanceId);
  const stagingDbName = opts.targetDb ?? STAGING_DB_DEFAULT;

  // Step 6 — extract instance-fs.tar.gz INTO A SIBLING TMP DIR (NOT under
  // <home>/instances/). The tar ships `instances/<originalInstanceId>/...`;
  // we extract into <home>/.clarity-safety-restore-<id>/ and then move the
  // `instances/<originalInstanceId>` subtree to <stagingInstanceDir>.
  //
  // Critical invariant: the live <home>/instances/<originalInstanceId>/
  // dir is NEVER touched until/unless atomicSwap is called by Plan 02.
  const originalInstanceId = manifest.paperclipInstanceId;
  const fsArchivePath = path.join(snapshotDir, manifest.artifacts.fs.path);
  const extractRoot = path.join(
    opts.home,
    `.clarity-safety-restore-${manifest.snapshotId}`
  );
  // Wipe any prior extract root from a half-completed restore.
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });

  // Path canonicalization gate: every entry must resolve INSIDE
  // <extractRoot>/instances/<originalInstanceId>/ (or be that dir itself).
  const allowedRootResolved = path.resolve(extractRoot, 'instances', originalInstanceId);

  // CVE-2026-31802 guard. node-tar's onentry callback runs BEFORE the
  // entry is written to disk, but throws from inside onentry don't
  // propagate to the awaitable tar.x promise (the throw happens inside
  // a stream `emit`). Instead we:
  //   (a) call entry.ignore?.() so node-tar skips the malicious entry,
  //   (b) record the first violation,
  //   (c) after tar.x resolves, throw on the recorded violation.
  // This guarantees the malicious link/file never lands on disk AND
  // the caller still gets a clear rejection.
  let cveViolation = null;
  await tar.x({
    file: fsArchivePath,
    cwd: extractRoot,
    onentry: (entry) => {
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        if (cveViolation === null) {
          cveViolation = `Refusing to extract ${entry.type}: ${entry.path}`;
        }
        // Ask node-tar to skip writing this entry to disk.
        if (typeof entry.ignore === 'function') entry.ignore();
        if (typeof entry.resume === 'function') entry.resume();
        return;
      }
      const resolved = path.resolve(extractRoot, entry.path);
      if (
        resolved !== allowedRootResolved &&
        !resolved.startsWith(allowedRootResolved + path.sep)
      ) {
        if (cveViolation === null) {
          cveViolation = `Refusing to extract path outside staging dir: ${entry.path}`;
        }
        if (typeof entry.ignore === 'function') entry.ignore();
        if (typeof entry.resume === 'function') entry.resume();
        return;
      }
    }
  });
  if (cveViolation) {
    // Wipe the extract root so any partially-written non-malicious
    // entries don't linger and so the staging dir we're about to create
    // is clean.
    await rm(extractRoot, { recursive: true, force: true });
    throw new Error(cveViolation);
  }

  // Move the extracted `instances/<originalInstanceId>/` subtree to its
  // staging home. Wipe any pre-existing staging dir first (a previous
  // failed restore could have left one behind).
  const extractedInstanceDir = path.join(extractRoot, 'instances', originalInstanceId);
  await rm(stagingInstanceDir, { recursive: true, force: true });
  await mkdir(path.dirname(stagingInstanceDir), { recursive: true });
  await rename(extractedInstanceDir, stagingInstanceDir);
  // Clean up the sibling extract root (now empty apart from the
  // `instances/` shell).
  await rm(extractRoot, { recursive: true, force: true });

  // Step 7 — DB restore.
  if (mode === 'pglite') {
    const PGliteCtor = opts._pglite ?? (await import('@electric-sql/pglite')).PGlite;
    const datadirArchive = path.join(snapshotDir, manifest.artifacts.db.path);
    const tarball = await readFile(datadirArchive);
    const dataDir = path.join(stagingInstanceDir, 'db');
    // Wipe any datadir the fs tar may have included and re-load from the
    // PGlite-format archive. PGlite's datadir is authoritative for the
    // DB; the fs-tar copy is a side-effect of `tar -C <home>`.
    await rm(dataDir, { recursive: true, force: true });
    const db = new PGliteCtor({
      dataDir,
      loadDataDir: new Blob([tarball])
    });
    await db.exec('SELECT 1');
    await db.close();
  } else if (mode === 'postgres') {
    if (typeof opts.dbUrl !== 'string' || opts.dbUrl.length === 0) {
      throw new Error('restoreToStaging: opts.dbUrl is required in postgres mode');
    }
    const stagingDbUrl = withStagingDbName(opts.dbUrl, stagingDbName);
    const dumpPath = path.join(snapshotDir, manifest.artifacts.db.path);
    const spawnImpl = opts._spawn ?? crossSpawn.spawn;
    await runPgRestore({ snapshotDumpPath: dumpPath, stagingDbUrl, _spawn: spawnImpl });
  } else {
    throw new Error(`restoreToStaging: unrecognized paperclipMode in manifest: ${String(mode)}`);
  }

  return {
    stagingInstanceDir,
    stagingDbName,
    manifest,
    smokeApiUrl: undefined
  };
}

/**
 * Atomically swap the staging dir into place. Plan 02's verify calls
 * this AFTER smoke passes; restoreToStaging never does.
 *
 *   <home>/instances/<id>           → <home>/instances/<id>.pre-restore-<ts>/
 *   <home>/instances/<id>.restoring → <home>/instances/<id>/
 *
 * fs.rename is atomic on the same filesystem on POSIX; effectively
 * atomic on Windows for directories that are not open. The two-step
 * rename is the standard pattern for atomic deploys.
 */
export async function atomicSwap(home, instanceId, stagingInstanceDir) {
  const liveDir = resolveInstanceDir(home, instanceId);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
  const preRestoreBackup = path.join(home, 'instances', `${instanceId}.pre-restore-${ts}`);
  await rename(liveDir, preRestoreBackup);
  await rename(stagingInstanceDir, liveDir);
  return { preRestoreBackup };
}
