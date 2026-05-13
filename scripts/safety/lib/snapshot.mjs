// scripts/safety/lib/snapshot.mjs
//
// Orchestrate a snapshot of a running Paperclip install:
//   1. Capture Paperclip version + installed plugin list (paperclip-cli).
//   2. DB dump:
//        pglite mode   → @electric-sql/pglite .dumpDataDir('gzip')
//        postgres mode → cross-spawn pg_dump --format=custom --compress=zstd:6
//                                          --no-owner --no-privileges
//                        (PGPASSWORD via env, never argv).
//   3. Filesystem tar of <home>/instances/<id>/ via tar.c with a filter
//      that excludes plugins/node_modules/, plugins/.cache/, optional
//      logs/, and (when excludeSecrets) secrets/.
//   4. Stream-sha256 every artifact + emit manifest.json.
//
// All side effects funnel through injectable `_paperclipCli`, `_pglite`,
// and `_spawn` so unit tests can exercise both modes without a live
// Paperclip / pg_dump.

import crossSpawn from 'cross-spawn';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

import { sha256OfFile, writeManifest } from './manifest.mjs';
import { isValidSnapshotId, resolveInstanceDir } from './paths.mjs';

const SCHEMA = {
  pglite: 'pglite-datadir-gzip',
  postgres: 'pg_dump-custom-zstd6'
};

// Regenerable cache directories that must never be included in a
// snapshot. They contain symlinks that point outside the instance tree
// (Claude Code skill caches symlink into the user's home dir), they
// bloat the tar by tens to hundreds of MB, and they are regenerable on
// first read. Defect 2 from the 2026-05-12 rehearsal drill (see
// runbook/REHEARSAL.md § Failed Drill Attempts).
//
// Match is POSIX-segment-exact: a path segment equal to one of these
// names triggers exclusion. Substring matches (e.g.
// `claude-prompt-caches-archive` or `claude-prompt-cache.md`) do NOT
// trigger exclusion.
const REGENERABLE_CACHE_DIRS = new Set(['claude-prompt-cache']);

function pathHasCacheSegment(posixPath) {
  // node-tar normalizes platform separators to '/', so splitting on '/'
  // gives us POSIX-style path segments on all hosts.
  const segments = posixPath.split('/');
  for (const seg of segments) {
    if (REGENERABLE_CACHE_DIRS.has(seg)) return true;
  }
  return false;
}

/**
 * Generate an ISO timestamp formatted for use as a snapshot id.
 * `2026-05-08T14:32:17.043Z` → `2026-05-08T14-32-17Z`
 */
function snapshotIdNow(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
}

/**
 * Platform-specific install hint for pg_dump when the spawn call returns
 * ENOENT. Surface it verbatim in the error message so the operator sees
 * the next-step command.
 */
function pgDumpInstallHint() {
  if (process.platform === 'win32') {
    return 'On Windows: winget install PostgreSQL.PostgreSQL.17';
  }
  if (process.platform === 'darwin') {
    return 'On macOS: brew install postgresql@17';
  }
  // Linux — apt / dnf hint.
  return 'On Linux: apt-get install postgresql-client-17  (or: dnf install postgresql17)';
}

function postgresInstallHint() {
  return 'pg_dump (PostgreSQL 17 client tools) is not on PATH. ' + pgDumpInstallHint();
}

/**
 * Replace the database name in a postgres connection string. Used so the
 * snapshot reads from the live db but a future restore writes to
 * `paperclip_restoring`. (Restore.mjs reuses the same swap.)
 */
function withDbName(_url, _dbName) {
  // Snapshot does not need to swap; this helper is exported separately
  // by restore.mjs. Kept here as a no-op sentinel for clarity.
  return _url;
}

/**
 * Run pg_dump with the research-mandated argv. Password is passed via
 * PGPASSWORD env var (NEVER argv) — Security Domain T2 mitigation.
 *
 * Argv (locked by the plan):
 *   --format=custom
 *   --compress=zstd:6
 *   --no-owner
 *   --no-privileges
 *   --file=<outDir>/postgres.dump
 *   --dbname=<dsn>
 */
async function runPgDump({ outDir, dbUrl, pgDumpPath, _spawn, logStream }) {
  // Strip the password (and userinfo) from the DSN before it lands in
  // argv. Argv is visible to anyone with `ps` privileges (Security Domain
  // T2 — Information Disclosure). PGPASSWORD env is the documented
  // out-of-band channel; PGUSER carries the role.
  let pgPassword;
  let pgUser;
  let sanitizedDbUrl = dbUrl;
  try {
    const u = new URL(dbUrl);
    if (u.password) {
      pgPassword = decodeURIComponent(u.password);
      u.password = '';
    }
    if (u.username) {
      pgUser = decodeURIComponent(u.username);
      // Keep the username on the URL too (it isn't a secret), but the env
      // var is the authoritative source for libpq.
    }
    sanitizedDbUrl = u.toString();
  } catch {
    // Non-URL DSN (e.g., libpq key=value form) — leave unchanged. The
    // operator is responsible for not embedding the password literal.
  }

  const argv = [
    '--format=custom',
    '--compress=zstd:6',
    '--no-owner',
    '--no-privileges',
    `--file=${path.join(outDir, 'postgres.dump')}`,
    `--dbname=${sanitizedDbUrl}`
  ];
  const childEnv = { ...process.env };
  if (pgPassword) childEnv.PGPASSWORD = pgPassword;
  if (pgUser && !childEnv.PGUSER) childEnv.PGUSER = pgUser;

  let child;
  try {
    child = _spawn(pgDumpPath, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(postgresInstallHint());
    }
    throw err;
  }
  return new Promise((resolve, reject) => {
    let stderrTail = '';
    if (child.stdout && logStream) child.stdout.pipe(logStream, { end: false });
    if (child.stderr) {
      child.stderr.on('data', (d) => {
        const s = d.toString('utf8');
        stderrTail = (stderrTail + s).slice(-4096);
        if (logStream) logStream.write(s);
      });
    }
    child.on('error', (err) => {
      if (err && err.code === 'ENOENT') {
        reject(new Error(postgresInstallHint()));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited non-zero (${code}): ${stderrTail.trim()}`));
    });
  });
}

/**
 * Snapshot orchestrator. See file header for the high-level flow.
 *
 * opts:
 *   home          — absolute path of PAPERCLIP_HOME
 *   instanceId    — instance dir name (default: 'default')
 *   mode          — 'pglite' | 'postgres'
 *   outDir        — absolute path of the snapshot output dir
 *   dbUrl?        — postgres mode only
 *   pgBinPath?    — postgres mode: explicit pg_dump path (skips locator search; Plan 01-05 Task 3)
 *   paperclipClonePath? — postgres mode: hint for bundled-binary discovery (Plan 01-05 Task 3)
 *   excludeSecrets? — opt-in: omit instances/<id>/secrets/ from the fs tar
 *   includeLogs?    — default true; pass false to omit instances/<id>/logs/
 *   _paperclipCli?  — override paperclip-cli helpers for tests
 *   _pglite?        — override the PGlite class for tests
 *   _spawn?         — override cross-spawn for pg_dump tests
 *   _locatePgDump?  — override locatePgDump for tests (Plan 01-05)
 *   _assertVersionMatch? — override assertVersionMatch for tests (Plan 01-05)
 *
 * Returns: { snapshotId, manifestPath }
 */
export async function snapshot(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('snapshot: opts is required');
  }
  if (typeof opts.home !== 'string' || opts.home.length === 0) {
    throw new Error('snapshot: opts.home must be a non-empty string');
  }
  if (typeof opts.instanceId !== 'string' || opts.instanceId.length === 0) {
    throw new Error('snapshot: opts.instanceId must be a non-empty string');
  }
  if (opts.mode !== 'pglite' && opts.mode !== 'postgres') {
    throw new Error(`snapshot: opts.mode must be 'pglite' or 'postgres' (got ${String(opts.mode)})`);
  }
  if (typeof opts.outDir !== 'string' || !path.isAbsolute(opts.outDir)) {
    throw new Error('snapshot: opts.outDir must be an absolute path');
  }
  const excludeSecrets = opts.excludeSecrets === true;
  const includeLogs = opts.includeLogs !== false; // default true
  const includeCaches = opts.includeCaches === true; // default false (defect 2 mitigation)

  const snapshotId = opts.snapshotId ?? snapshotIdNow();
  if (!isValidSnapshotId(snapshotId)) {
    throw new Error(`snapshot: generated snapshotId ${snapshotId} failed format check`);
  }
  await mkdir(opts.outDir, { recursive: true });

  // Capture Paperclip version + installed plugins via paperclip-cli.
  // These are metadata for the manifest, NOT load-bearing for the
  // safety property (which is the sha256-verified DB+FS bytes). When
  // paperclip-cli fails (e.g. authenticated Paperclip's /api/plugins
  // requires a Bearer token we don't have, or paperclipai's `--version`
  // returns the pnpm preamble line — see May 11 manifests), record the
  // failure in the manifest's `paperclipCliWarnings` field and keep
  // going. Server-up enforcement belongs in verify (which runs smoke),
  // not snapshot — pg_dump and the fs tar do not need the server.
  const cli = opts.paperclipCli ?? opts._paperclipCli ?? null;
  let paperclipVersion = 'unknown';
  let installedPlugins = [];
  const paperclipCliWarnings = [];
  if (cli) {
    try {
      paperclipVersion = await cli.getPaperclipVersion({ _spawn: opts._spawn });
    } catch (err) {
      paperclipCliWarnings.push({ step: 'getPaperclipVersion', message: err.message });
    }
    try {
      installedPlugins = await cli.listInstalledPlugins({ _spawn: opts._spawn });
    } catch (err) {
      paperclipCliWarnings.push({ step: 'listInstalledPlugins', message: err.message });
    }
  }

  const instanceDir = resolveInstanceDir(opts.home, opts.instanceId);
  const logPath = path.join(opts.outDir, 'stdout-stderr.log');
  const logStream = createWriteStream(logPath, { flags: 'a' });

  // 1. DB dump
  let dbArtifact;
  if (opts.mode === 'pglite') {
    const PGliteCtor = opts._pglite ?? (await import('@electric-sql/pglite')).PGlite;
    const dataDir = path.join(instanceDir, 'db');
    const db = new PGliteCtor(dataDir);
    let blob;
    try {
      blob = await db.dumpDataDir('gzip');
    } finally {
      try {
        await db.close();
      } catch {
        // ignore
      }
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const dbPath = path.join(opts.outDir, 'pglite-datadir.tar.gz');
    await writeFileAtomic(dbPath, buf);
    dbArtifact = {
      path: 'pglite-datadir.tar.gz',
      format: SCHEMA.pglite,
      sha256: await sha256OfFile(dbPath),
      sizeBytes: (await stat(dbPath)).size
    };
  } else {
    if (typeof opts.dbUrl !== 'string' || opts.dbUrl.length === 0) {
      throw new Error('snapshot: opts.dbUrl is required in postgres mode');
    }
    const spawnImpl = opts._spawn ?? crossSpawn.spawn;

    // Locate pg_dump: explicit override → bundled @embedded-postgres → system PATH.
    // Then pre-check major-version compatibility BEFORE spawning the dump.
    // Both are injectable for tests; production callers use the real implementations
    // from pg-dump-locator.mjs.
    const locatePgDumpImpl =
      opts._locatePgDump ?? (await import('./pg-dump-locator.mjs')).locatePgDump;
    const assertVersionMatchImpl =
      opts._assertVersionMatch ??
      (await import('./pg-dump-locator.mjs')).assertVersionMatch;

    const { pgDumpPath } = await locatePgDumpImpl({
      pgBinOverride: opts.pgBinPath,
      paperclipClonePath: opts.paperclipClonePath,
    });
    await assertVersionMatchImpl(pgDumpPath, opts.dbUrl);

    await runPgDump({
      outDir: opts.outDir,
      dbUrl: opts.dbUrl,
      pgDumpPath,
      _spawn: spawnImpl,
      logStream,
    });
    const dbPath = path.join(opts.outDir, 'postgres.dump');
    dbArtifact = {
      path: 'postgres.dump',
      format: SCHEMA.postgres,
      sha256: await sha256OfFile(dbPath),
      sizeBytes: (await stat(dbPath)).size
    };
  }

  // 2. Filesystem tar
  const fsRelPath = 'instance-fs.tar.gz';
  const fsAbsPath = path.join(opts.outDir, fsRelPath);
  const instanceRel = path.posix.join('instances', opts.instanceId);

  // The tar filter operates on POSIX-style relative paths (node-tar
  // normalizes platform separators). The filter is the only barrier
  // between regenerable junk and the snapshot — keep predicates explicit.
  const filter = (entryPath /* relative to cwd, posix */) => {
    if (entryPath.includes('/plugins/node_modules/') || entryPath.endsWith('/plugins/node_modules')) return false;
    if (entryPath.includes('/plugins/.cache/') || entryPath.endsWith('/plugins/.cache')) return false;
    if (!includeCaches && pathHasCacheSegment(entryPath)) return false; // defect 2 mitigation
    if (excludeSecrets && (entryPath.includes('/secrets/') || entryPath.endsWith('/secrets'))) return false;
    if (!includeLogs && (entryPath.startsWith(`${instanceRel}/logs/`) || entryPath === `${instanceRel}/logs`)) {
      return false;
    }
    return true;
  };

  await tar.c(
    {
      gzip: true,
      file: fsAbsPath,
      cwd: opts.home,
      portable: true,
      filter
    },
    [instanceRel]
  );

  const fsArtifact = {
    path: fsRelPath,
    format: 'tar+gzip',
    sha256: await sha256OfFile(fsAbsPath),
    sizeBytes: (await stat(fsAbsPath)).size,
    excludeSecrets
  };

  // 3. lockfileSha256
  const lockfilePath = path.join(instanceDir, 'plugins', 'pnpm-lock.yaml');
  let lockfileSha256 = null;
  try {
    await stat(lockfilePath);
    lockfileSha256 = await sha256OfFile(lockfilePath);
  } catch {
    // missing lockfile → null (per plan/research §3 Open Question)
  }

  // 4. Manifest
  const manifestPayload = {
    snapshotId,
    createdAt: new Date().toISOString(),
    createdBy: { user: os.userInfo().username, host: os.hostname() },
    paperclipVersion,
    paperclipMode: opts.mode,
    paperclipHome: opts.home,
    paperclipInstanceId: opts.instanceId,
    installedPlugins,
    lockfileSha256,
    artifacts: { db: dbArtifact, fs: fsArtifact },
    verifiedAt: null,
    verifiedSmokeChecks: null,
    gateMaxAgeMinutes: 15,
    ...(paperclipCliWarnings.length > 0 ? { paperclipCliWarnings } : {})
  };
  await writeManifest(opts.outDir, manifestPayload);

  // 5. Human-readable summary
  if (opts.silent !== true) {
    const lines = [
      `snapshot ${snapshotId} created`,
      `  paperclip: ${paperclipVersion} (${opts.mode})`,
      `  plugins:   ${installedPlugins.length}`,
      `  db:        ${dbArtifact.path}  (${dbArtifact.sizeBytes} bytes)`,
      `  fs:        ${fsArtifact.path}  (${fsArtifact.sizeBytes} bytes)`,
      `  location:  ${opts.outDir}`
    ];
    if (paperclipCliWarnings.length > 0) {
      lines.push(
        `  warnings:  ${paperclipCliWarnings.length} paperclip-cli step(s) failed (recorded in manifest.paperclipCliWarnings):`
      );
      for (const w of paperclipCliWarnings) {
        lines.push(`    - ${w.step}: ${w.message.split('\n')[0]}`);
      }
      lines.push('             (snapshot bytes are still sha256-verified; verify will catch real server-down conditions)');
    }
    lines.push(`to verify run: pnpm clarity-safety verify ${snapshotId}`);
    lines.push('Note: snapshot includes secrets/master.key — do not share unencrypted.');
    process.stdout.write(lines.join('\n') + '\n');
  }

  logStream.end();

  return { snapshotId, manifestPath: path.join(opts.outDir, 'manifest.json') };
}

/**
 * Write a buffer to disk through a temp file then rename — avoids leaving
 * a half-written .tar.gz around if the process is killed mid-write.
 */
async function writeFileAtomic(target, buf) {
  const { writeFile, rename } = await import('node:fs/promises');
  const tmp = target + '.tmp';
  await writeFile(tmp, buf);
  await rename(tmp, target);
}
