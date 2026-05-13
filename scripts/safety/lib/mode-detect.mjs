// scripts/safety/lib/mode-detect.mjs
//
// Read a Paperclip instance config.json and decide whether the install is
// running in PGlite (embedded WASM) mode or hosted Postgres mode. The two
// backends share zero tooling — getting this wrong silently produces a
// half-snapshot (Pitfall 1 in 01-RESEARCH.md), so detection is a hard
// fail-fast with a platform-aware install hint.

import { readFile } from 'node:fs/promises';

/**
 * DetectError carries a human-readable hint alongside the message so the
 * CLI can surface the next-step command to the operator without the user
 * having to dig into the implementation.
 */
export class DetectError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'DetectError';
    this.hint = hint;
  }
}

/**
 * Detect Paperclip's DB mode by reading config.json.
 *
 * Resolution order:
 *   1. database.driver === 'pglite'              → 'pglite'
 *   2. database.driver === 'postgres'            → 'postgres'
 *   3. database.mode === 'embedded-postgres'     → 'postgres'  (Paperclip-managed
 *                                                  native PG server; same wire
 *                                                  protocol as hosted, so snapshot
 *                                                  treats it identically. Caller
 *                                                  derives dbUrl from
 *                                                  embeddedPostgresPort.)
 *   4. database.connectionString set             → 'postgres' (postgres:// implies hosted)
 *   5. otherwise                                 → DetectError with --mode hint
 */
export async function detectMode(configPath) {
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new DetectError(
        `config.json not found at ${configPath}`,
        'verify PAPERCLIP_HOME and --instance-id; the snapshot CLI looks for ' +
          '<home>/instances/<id>/config.json'
      );
    }
    throw new DetectError(
      `failed to read config.json at ${configPath}: ${err.message}`,
      'check filesystem permissions on the Paperclip instance dir'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DetectError(
      `config.json at ${configPath} is not valid JSON: ${err.message}`,
      'config.json is not valid JSON; restore from a known-good Paperclip ' +
        'install or set --mode=pglite|postgres explicitly'
    );
  }
  const db = parsed && typeof parsed === 'object' ? parsed.database : null;
  if (db && typeof db === 'object') {
    if (db.driver === 'pglite') return 'pglite';
    if (db.driver === 'postgres') return 'postgres';
    if (db.mode === 'embedded-postgres') return 'postgres';
    if (typeof db.connectionString === 'string' && db.connectionString.length > 0) {
      return 'postgres';
    }
  }
  throw new DetectError(
    'Cannot determine Paperclip DB mode from config.json',
    'set --mode=pglite|postgres explicitly on the snapshot CLI invocation'
  );
}

// Hardcoded creds for Paperclip's embedded-postgres dev server.
// Source: paperclipai/paperclip@master server/src/index.ts (verbatim).
// Not config-driven — the dev-runner always uses these.
const EMBEDDED_PG_USER = 'paperclip';
const EMBEDDED_PG_PASSWORD = 'paperclip';
const EMBEDDED_PG_DATABASE = 'paperclip';
const EMBEDDED_PG_HOST = '127.0.0.1';

/**
 * Detect Paperclip's DB mode AND derive a dbUrl when possible.
 *
 * Returns `{ mode, dbUrl, source }` where source is one of:
 *   - 'embedded-postgres-derived' — built from database.embeddedPostgresPort + hardcoded creds
 *   - 'config.connectionString'   — taken verbatim from database.connectionString
 *   - 'pglite-no-url'             — pglite mode; dbUrl is null
 *
 * Throws DetectError if the mode is postgres but no connection info is reachable
 * (operator must pass --db-url to recover).
 *
 * Plan 01-05 Task 2 — eliminates the manual `--db-url=postgresql://paperclip:paperclip@127.0.0.1:54329/paperclip`
 * workaround from the Plan 02-01 Task 2 smoke spike.
 */
export async function detectConnectionConfig(configPath) {
  // First resolve the mode using the existing detectMode logic; that also
  // produces the DetectError variants for missing/malformed config.
  const mode = await detectMode(configPath);
  if (mode === 'pglite') {
    return { mode: 'pglite', dbUrl: null, source: 'pglite-no-url' };
  }

  // For postgres mode, re-read the config to inspect connection-shape fields.
  // (detectMode does not return the parsed object; a second small read keeps
  // the function signatures simple. config.json is tiny.)
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const db = parsed?.database ?? null;

  if (typeof db?.connectionString === 'string' && db.connectionString.length > 0) {
    return {
      mode: 'postgres',
      dbUrl: db.connectionString,
      source: 'config.connectionString',
    };
  }

  if (db?.mode === 'embedded-postgres' && typeof db.embeddedPostgresPort === 'number') {
    const dbUrl = `postgresql://${EMBEDDED_PG_USER}:${EMBEDDED_PG_PASSWORD}@${EMBEDDED_PG_HOST}:${db.embeddedPostgresPort}/${EMBEDDED_PG_DATABASE}`;
    return {
      mode: 'postgres',
      dbUrl,
      source: 'embedded-postgres-derived',
    };
  }

  throw new DetectError(
    'Cannot derive dbUrl: config.json has postgres-mode database but no connectionString and no embeddedPostgresPort',
    'pass --db-url=postgresql://user:pass@host:port/db on the snapshot CLI invocation, ' +
      'or correct config.json to include either database.connectionString (hosted Postgres) ' +
      'or database.embeddedPostgresPort (embedded-postgres dev mode)',
  );
}
