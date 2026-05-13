// scripts/safety/lib/pg-dump-locator.mjs
//
// Plan 01-05 Task 1: locate the pg_dump binary across platforms.
//
// Resolution order:
//   1. explicit { pgBinOverride }
//   2. Paperclip-bundled @embedded-postgres/<platform>/native/bin/pg_dump[.exe]
//      (Linux/macOS bundles include client tools; Windows bundle is server-only
//      per Plan 02-01 SMOKE-FINDINGS Finding #2)
//   3. system PATH
//   4. LocateError with platform-specific install hint
//
// Plus assertVersionMatch for the pre-check that fires BEFORE the snapshot
// invokes pg_dump — fails fast on major-version mismatch (defect #3).

import { stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class LocateError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'LocateError';
    this.hint = hint;
  }
}

export class VersionMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VersionMismatchError';
  }
}

function exeName(platform) {
  return platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
}

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function tryBundledPath(paperclipClonePath, platform, arch) {
  // pnpm structure: node_modules/.pnpm/@embedded-postgres+<platform>-<arch>@<version>/node_modules/@embedded-postgres/<platform>-<arch>/native/bin/pg_dump[.exe]
  // Use glob to handle the version-pinned directory name without hardcoding it.
  const pattern = `node_modules/.pnpm/@embedded-postgres+${platform === 'win32' ? 'windows' : platform}-${arch}@*/node_modules/@embedded-postgres/${platform === 'win32' ? 'windows' : platform}-${arch}/native/bin/${exeName(platform)}`;
  const candidates = [];
  for await (const match of glob(pattern, { cwd: paperclipClonePath })) {
    candidates.push(path.join(paperclipClonePath, match));
  }
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function trySystemPath(pathEnv, platform) {
  if (!pathEnv) return null;
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(sep).filter(Boolean);
  const name = exeName(platform);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function platformInstallHint(platform) {
  switch (platform) {
    case 'win32':
      return 'On Windows: install PostgreSQL client tools via `winget install PostgreSQL.PostgreSQL.17` (or the major version matching your Paperclip embedded-postgres server). Then either add C:\\Program Files\\PostgreSQL\\<ver>\\bin to PATH or pass --pg-bin <path-to-pg_dump.exe>.';
    case 'darwin':
      return 'On macOS: install PostgreSQL client tools via `brew install postgresql@17` (or the major version matching your Paperclip embedded-postgres server). Then either add the keg-only bin dir to PATH or pass --pg-bin <path>.';
    default:
      return 'On Linux: install PostgreSQL client tools via `apt install postgresql-client-17` / `dnf install postgresql17` / equivalent. Then ensure pg_dump is on PATH or pass --pg-bin <path>.';
  }
}

/**
 * Locate pg_dump. Returns { pgDumpPath, source } where source is one of
 * 'override' | 'bundled' | 'system-path'. Throws LocateError on failure.
 *
 * Options:
 *   pgBinOverride — explicit path (no validation; operator-trusted)
 *   paperclipClonePath — root of a Paperclip clone whose node_modules may
 *                        contain a bundled @embedded-postgres pg_dump
 *   platform — process.platform default; injectable for cross-platform tests
 *   arch — process.arch default; injectable
 *   pathEnv — process.env.PATH default; injectable (empty string = no PATH search)
 */
export async function locatePgDump(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? '';

  if (opts.pgBinOverride) {
    return { pgDumpPath: opts.pgBinOverride, source: 'override' };
  }

  let bundledTried = null;
  if (opts.paperclipClonePath) {
    const bundled = await tryBundledPath(opts.paperclipClonePath, platform, arch);
    if (bundled) {
      return { pgDumpPath: bundled, source: 'bundled' };
    }
    bundledTried = path.join(
      opts.paperclipClonePath,
      'node_modules/.pnpm',
      `@embedded-postgres+${platform === 'win32' ? 'windows' : platform}-${arch}@*`,
      'node_modules/@embedded-postgres',
      `${platform === 'win32' ? 'windows' : platform}-${arch}`,
      'native/bin',
      exeName(platform),
    );
  }

  const sysPath = await trySystemPath(pathEnv, platform);
  if (sysPath) {
    return { pgDumpPath: sysPath, source: 'system-path' };
  }

  const searchedPaths = [
    bundledTried ? `bundled: ${bundledTried}` : null,
    `system PATH: ${pathEnv.length > 0 ? pathEnv : '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n  ');

  throw new LocateError(
    `pg_dump not found.\nSearched:\n  ${searchedPaths}`,
    platformInstallHint(platform),
  );
}

async function realPgDumpVersion(pgDumpPath) {
  // pg_dump --version output: "pg_dump (PostgreSQL) 17.9"
  const stdout = await runCapture(pgDumpPath, ['--version']);
  const match = stdout.match(/\((?:PostgreSQL\) )?(\d+)\./);
  if (!match) {
    throw new Error(`Could not parse pg_dump version from output: ${stdout}`);
  }
  return parseInt(match[1], 10);
}

async function realServerVersion(dbUrl, pgDumpPath) {
  // Use psql alongside pg_dump (both ship together in the same bin/ dir).
  // Derive psql's path from pg_dump's path to avoid a separate PATH search:
  // pg_dump and psql live as siblings in every Postgres client distribution.
  // This matters on Windows where the install dir (e.g. C:\Program Files\
  // PostgreSQL\17\bin) is often not on system PATH but explicit --pg-bin still
  // works.
  const psqlBaseName = process.platform === 'win32' ? 'psql.exe' : 'psql';
  const psqlPath = pgDumpPath
    ? path.join(path.dirname(pgDumpPath), psqlBaseName)
    : psqlBaseName;
  const stdout = await runCapture(
    psqlPath,
    [dbUrl, '-tA', '-c', "SELECT current_setting('server_version_num')::int"],
    { env: { ...process.env, PGCONNECT_TIMEOUT: '5' } },
  );
  const num = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(num)) {
    throw new Error(`Could not parse server_version_num from psql output: ${stdout}`);
  }
  return Math.floor(num / 10000);
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err || out}`));
    });
  });
}

/**
 * Assert pg_dump major version matches the live server's major version.
 * Throws VersionMismatchError on mismatch with a clean, runbook-linked message.
 *
 * Options:
 *   pgDumpVersionFetcher(path) → Promise<number>  (defaults to invoking `<path> --version`)
 *   serverVersionFetcher(dbUrl) → Promise<number> (defaults to psql round-trip)
 */
export async function assertVersionMatch(pgDumpPath, dbUrl, opts = {}) {
  const pgDumpFetcher = opts.pgDumpVersionFetcher ?? realPgDumpVersion;
  const serverFetcher = opts.serverVersionFetcher ?? realServerVersion;

  const [client, server] = await Promise.all([
    pgDumpFetcher(pgDumpPath),
    serverFetcher(dbUrl, pgDumpPath),
  ]);

  if (client !== server) {
    throw new VersionMismatchError(
      `pg_dump major version ${client} cannot dump server version ${server}. ` +
        `PostgreSQL requires matching major version. ` +
        `Install pg_dump ${server} client tools OR use restore-by-deletion fallback for throwaway dev clones ` +
        `(runbook/operator-gotchas.md §pg-dump-version-mismatch).`,
    );
  }
}
