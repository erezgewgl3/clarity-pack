// scripts/safety/lib/gate.mjs
//
// SAFE-05 — pre-flight refuse-or-run wrapper around an inner command.
//
// gate(opts) reads the latest snapshot's manifest from <snapshotsDir>,
// confirms (a) it exists, (b) verifiedAt is non-null, (c) verifiedAt is
// within `maxAgeMinutes` (default 15) of now, and on success spawns the
// inner command with cross-spawn (`shell: false`, argv-array, stdio
// inherited). The exit code is propagated verbatim.
//
// Bypass path is dual-control:
//   - innerCommand must contain the literal token '--gate-bypass', AND
//   - env CLARITY_SAFETY_BYPASS=I_KNOW=<unix-epoch-ms> must be set with
//     the timestamp within BYPASS_ENV_FRESHNESS_MS (60_000) of now.
// Every honored bypass is appended to runbook/REHEARSAL.md (or stderr if
// unwritable) via logBypass — the audit log mitigates T-03-05 (Repudiation).
//
// Security: gate forwards argv via spawn's argv-array overload; no shell
// interpolation of user-supplied strings (T-03-02 mitigation). The
// `--gate-bypass` flag in argv alone never bypasses — without the fresh
// env timestamp, the gate refuses anyway.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import spawn from 'cross-spawn';

import { listSnapshots } from './list.mjs';
import { readManifest } from './manifest.mjs';

/**
 * The freshness window for CLARITY_SAFETY_BYPASS=I_KNOW=<ms>. A bypass
 * is honored only when the env timestamp is within this many ms of now.
 * 60 seconds is intentional: it forces the operator to type the env var
 * with a freshly-computed `Date.now()` AT INVOCATION time, which means
 * the bypass cannot be persisted in a shell rc, dotenv, or CI config.
 */
const BYPASS_ENV_FRESHNESS_MS = 60_000;

/**
 * Predicate: is this manifest "fresh and verified" relative to `now`?
 *
 * Returns:
 *   { ok: true }                                          — verifiedAt set + within window
 *   { ok: false, reason: 'snapshot-not-verified' }        — verifiedAt is null/missing
 *   { ok: false, reason: 'snapshot-stale' }               — verifiedAt > maxAgeMinutes
 *
 * Note: gate consults `verifiedAt`, NOT `createdAt`. SAFE-05 requires the
 * snapshot to have passed restore+smoke verification, not merely existed.
 */
export function isFreshAndVerified(manifest, maxAgeMinutes, now = new Date()) {
  if (!manifest || !manifest.verifiedAt) {
    return { ok: false, reason: 'snapshot-not-verified' };
  }
  const verifiedMs = Date.parse(manifest.verifiedAt);
  if (!Number.isFinite(verifiedMs)) {
    return { ok: false, reason: 'snapshot-not-verified' };
  }
  const ageMs = now.getTime() - verifiedMs;
  if (ageMs > maxAgeMinutes * 60_000) {
    return { ok: false, reason: 'snapshot-stale' };
  }
  return { ok: true };
}

/**
 * Find the newest snapshot under `snapshotsDir` whose manifest is readable.
 * Returns { snapshotId, manifest } or null if none exists. ENOENT on the
 * directory itself is treated as null (no snapshots yet).
 *
 * listSnapshots already silently skips dirs with malformed manifests, so
 * this helper inherits that disposition — a snapshot with broken JSON
 * surfaces as "no-snapshot" to the operator (the user-visible remediation
 * is the same: take a fresh snapshot).
 */
export async function findLatestSnapshot(snapshotsDir) {
  let items;
  try {
    items = await listSnapshots(snapshotsDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  if (!items || items.length === 0) return null;
  const newest = items[0]; // listSnapshots returns newest-first
  let manifest;
  try {
    manifest = await readManifest(path.join(snapshotsDir, newest.id));
  } catch (err) {
    // listSnapshots already filtered unreadable manifests. If we still
    // hit one here it means a TOCTOU race between the listing and the
    // read; report null and let the gate refuse with no-snapshot.
    return null;
  }
  return { snapshotId: newest.id, manifest };
}

/**
 * Parse + validate the CLARITY_SAFETY_BYPASS env var. Returns:
 *   { allowed: true }                                          — fresh + valid
 *   { allowed: false }                                          — env not set
 *   { allowed: false, reason: 'bypass-env-malformed' }         — wrong shape
 *   { allowed: false, reason: 'bypass-env-stale' }             — too old / future
 */
export function checkBypassEnv(env, now = new Date()) {
  const v = env && typeof env.CLARITY_SAFETY_BYPASS === 'string' ? env.CLARITY_SAFETY_BYPASS : '';
  if (!v) return { allowed: false };
  const m = /^I_KNOW=(\d+)$/.exec(v);
  if (!m) return { allowed: false, reason: 'bypass-env-malformed' };
  const ts = Number.parseInt(m[1], 10);
  if (!Number.isFinite(ts)) return { allowed: false, reason: 'bypass-env-malformed' };
  const age = now.getTime() - ts;
  if (age < 0 || age > BYPASS_ENV_FRESHNESS_MS) {
    return { allowed: false, reason: 'bypass-env-stale' };
  }
  return { allowed: true };
}

/**
 * Append a bypass audit entry to <rehearsalLogPath>. If the file is
 * unwritable (read-only FS, permission denied, ENOENT on parent dir),
 * the event is emitted to stderr instead — never silently dropped.
 *
 * Format: a single line beginning with `[BYPASS]` so a grep over
 * REHEARSAL.md surfaces every bypass invocation in chronological order.
 */
async function logBypass(rehearsalLogPath, innerCommand, reason) {
  const line =
    `\n[BYPASS] ${new Date().toISOString()} ` +
    `cmd=${(innerCommand ?? []).join(' ')} ` +
    `reason=${reason ?? ''}\n`;
  try {
    await fs.appendFile(rehearsalLogPath, line, 'utf8');
  } catch (err) {
    process.stderr.write(
      `warning: bypass log write to ${rehearsalLogPath} failed (${err.message ?? err}); event: ${line}`
    );
  }
}

/**
 * Spawn the inner command with cross-spawn (shell: false). Returns a
 * GateResult-shaped object with forwarded:true and the propagated exit
 * code. Rejects on the underlying spawn error (ENOENT on the executable,
 * permission denied, etc.) — the caller surfaces the error to stderr.
 */
function runInner(_spawn, innerCommand, bypassed) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = innerCommand;
    let child;
    try {
      child = _spawn(cmd, args, { shell: false, stdio: 'inherit' });
    } catch (err) {
      reject(err);
      return;
    }
    if (!child || typeof child.on !== 'function') {
      // Mock spawn that returned a non-emitter — surface as a programming error.
      reject(new Error('gate: _spawn did not return a ChildProcess-like object'));
      return;
    }
    child.on('error', reject);
    child.on('exit', (code) => resolve({ forwarded: true, exitCode: code, bypassed }));
  });
}

/**
 * gate(opts) — refuse-or-run.
 *
 * @param {object} opts
 * @param {number} [opts.maxAgeMinutes=15]   SAFE-05 verbatim default.
 * @param {string} opts.snapshotsDir
 * @param {string[]} opts.innerCommand        argv array; shell: false.
 * @param {NodeJS.ProcessEnv} [opts.env=process.env]
 * @param {string} [opts.rehearsalLogPath]    bypass audit target.
 * @param {Function} [opts._spawn=spawn]      injection seam for tests.
 * @returns {Promise<GateResult>}
 */
export async function gate(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('gate: opts is required');
  }
  const {
    maxAgeMinutes = 15,
    snapshotsDir,
    innerCommand,
    env = process.env,
    rehearsalLogPath = path.join(process.cwd(), 'runbook', 'REHEARSAL.md'),
    _spawn = spawn
  } = opts;

  if (!Array.isArray(innerCommand) || innerCommand.length === 0) {
    throw new Error('gate: opts.innerCommand must be a non-empty argv array');
  }
  if (typeof snapshotsDir !== 'string' || snapshotsDir.length === 0) {
    throw new Error('gate: opts.snapshotsDir is required');
  }

  // ---- Bypass path -----------------------------------------------------
  // The flag in argv ALONE never bypasses; the env timestamp is the second
  // factor. Without both, we fall through to the standard refuse-or-run.
  const wantsBypass = innerCommand.includes('--gate-bypass');
  if (wantsBypass) {
    const bypassCheck = checkBypassEnv(env);
    if (bypassCheck.allowed) {
      await logBypass(rehearsalLogPath, innerCommand, 'CLARITY_SAFETY_BYPASS valid');
      return runInner(_spawn, innerCommand, /* bypassed */ true);
    }
    const reason = bypassCheck.reason ?? 'missing';
    return {
      forwarded: false,
      exitCode: null,
      refusalReason: 'snapshot-not-verified',
      remediation:
        `--gate-bypass requested but CLARITY_SAFETY_BYPASS=I_KNOW=<unix-epoch-ms-within-last-60s> ` +
        `is missing or invalid (${reason}). Set the env var and retry, or take a fresh ` +
        `snapshot:\n  pnpm clarity-safety snapshot\n  pnpm clarity-safety verify <new-snapshot-id>`
    };
  }

  // ---- Normal path -----------------------------------------------------
  let latest;
  try {
    latest = await findLatestSnapshot(snapshotsDir);
  } catch (err) {
    return {
      forwarded: false,
      exitCode: null,
      refusalReason: 'manifest-unreadable',
      remediation:
        `Latest snapshot manifest could not be read: ${err.message ?? err}. ` +
        `Take a fresh snapshot:\n  pnpm clarity-safety snapshot\n` +
        `  pnpm clarity-safety verify <new-snapshot-id>`
    };
  }

  if (!latest) {
    return {
      forwarded: false,
      exitCode: null,
      refusalReason: 'no-snapshot',
      remediation:
        'No fresh + verified snapshot found. Run:\n' +
        '  pnpm clarity-safety snapshot\n' +
        '  pnpm clarity-safety verify <new-snapshot-id>'
    };
  }

  const fresh = isFreshAndVerified(latest.manifest, maxAgeMinutes);
  if (!fresh.ok) {
    const remediation =
      fresh.reason === 'snapshot-not-verified'
        ? `Latest snapshot ${latest.snapshotId} is unverified (verifiedAt is null). Run:\n` +
          `  pnpm clarity-safety verify ${latest.snapshotId}`
        : `Latest snapshot ${latest.snapshotId} is older than ${maxAgeMinutes} minute(s). Run:\n` +
          `  pnpm clarity-safety snapshot\n` +
          `  pnpm clarity-safety verify <new-snapshot-id>`;
    return {
      forwarded: false,
      exitCode: null,
      refusalReason: fresh.reason,
      remediation
    };
  }

  return runInner(_spawn, innerCommand, /* bypassed */ false);
}

// Re-export the constant so callers (and tests) can introspect the window.
export { BYPASS_ENV_FRESHNESS_MS };
