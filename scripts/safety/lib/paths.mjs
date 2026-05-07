// scripts/safety/lib/paths.mjs
//
// Path resolution + snapshot-id validation. All cross-platform behaviour
// is concentrated here so the rest of the safety CLI never branches on
// process.platform.

import os from 'node:os';
import path from 'node:path';

const SNAPSHOT_ID_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

/**
 * Resolve the Paperclip home directory.
 * Order of precedence:
 *   1. env.PAPERCLIP_HOME if set (and non-empty)
 *   2. <user-home>/.paperclip — Windows: %USERPROFILE%\.paperclip
 *                              POSIX:   $HOME/.paperclip
 *
 * `env` defaults to process.env but is injectable so tests can simulate
 * win32 vs posix without mutating the live env.
 */
export function resolvePaperclipHome(env = process.env) {
  const override = env && typeof env.PAPERCLIP_HOME === 'string' ? env.PAPERCLIP_HOME : '';
  if (override.length > 0) return override;
  return path.join(os.homedir(), '.paperclip');
}

/**
 * Resolve the on-disk instance directory for a given Paperclip home.
 *   <home>/instances/<instanceId>
 */
export function resolveInstanceDir(home, instanceId) {
  if (typeof home !== 'string' || home.length === 0) {
    throw new Error('resolveInstanceDir: home must be a non-empty string');
  }
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    throw new Error('resolveInstanceDir: instanceId must be a non-empty string');
  }
  return path.join(home, 'instances', instanceId);
}

/**
 * Resolve the canonical snapshots directory for the clarity-pack repo.
 *   <repoRoot>/.planning/snapshots
 */
export function resolveSnapshotsDir(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error('resolveSnapshotsDir: repoRoot must be a non-empty string');
  }
  return path.join(repoRoot, '.planning', 'snapshots');
}

/**
 * Strict-format validator for snapshot ids.
 *
 * Format: ISO-8601 UTC with the colons in the time portion replaced by
 *         dashes — e.g. `2026-05-08T14-32-17Z`. This format-only check
 *         is intentional: we do NOT validate that the date is a real
 *         calendar date, only that the SHAPE prevents path traversal,
 *         shell-metacharacter injection, and accidental misreads of
 *         user input.
 *
 * Rejects: `../etc/passwd`, `; rm -rf ~`, empty string, ISO with colons.
 * Accepts: `2026-13-99T99-99-99Z` (intentional — month/day are not
 *          semantically validated; consumers should never reach this
 *          string for arithmetic).
 */
export function isValidSnapshotId(id) {
  return typeof id === 'string' && SNAPSHOT_ID_REGEX.test(id);
}
