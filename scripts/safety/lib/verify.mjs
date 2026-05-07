// scripts/safety/lib/verify.mjs
//
// verify orchestrates: restoreToStaging → smoke (against operator-managed
// sibling Paperclip) → atomic manifest write-back of verifiedAt +
// verifiedSmokeChecks. The maxRehearsalTimeMs budget is enforced via a
// deadline AbortSignal composed into smoke's per-check timeouts, so a
// budget overrun aborts the in-flight check and surfaces the EXACT reason
// 'rehearsal time exceeded' (B3 fix from the iteration-2 checker).
//
// Strategy:
//   - 'manual' (v1 default): operator has manually started a sibling
//     Paperclip pointing at the staging dir; verify just smokes its URL.
//     If --smoke-api-url is missing, error message ends with the runbook
//     hint so operators don't reach for --gate-bypass (W9 fix).
//   - 'auto' (v2 stub): not implemented; returns ok:false with a hint to
//     use --strategy=manual and read runbook/rehearsal-drill.md.
//
// On smoke PASS: manifest is updated atomically; verifiedAt + verifiedSmokeChecks
// are set; staging dir remains in place for the operator/runbook to atomic-swap
// (Plan 03).
//
// On smoke FAIL (or rehearsal budget overrun): manifest is UNCHANGED
// (verifiedAt remains null), staging dir is preserved for inspection.

import path from 'node:path';

import { restoreToStaging } from './restore.mjs';
import { smoke } from './smoke.mjs';
import { readManifest, writeManifestAtomic } from './manifest.mjs';

const RUNBOOK_HINT = 'See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.';
const DEFAULT_REHEARSAL_BUDGET_MS = 5 * 60 * 1000;

export async function verify(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('verify: opts is required');
  }
  const {
    snapshotId,
    home,
    instanceId,
    strategy = 'manual',
    smokeApiUrl,
    altPort,
    apiKey,
    companyId,
    editorAgentId,
    maxRehearsalTimeMs = DEFAULT_REHEARSAL_BUDGET_MS,
    snapshotsDir,
    dbUrl,
    targetInstanceId,
    targetDb,
    _restoreToStaging,
    _smoke
  } = opts;

  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    throw new Error('verify: opts.snapshotId is required');
  }
  if (typeof companyId !== 'string' || companyId.length === 0) {
    throw new Error('verify: opts.companyId is required');
  }
  if (typeof snapshotsDir !== 'string' || snapshotsDir.length === 0) {
    throw new Error('verify: opts.snapshotsDir is required');
  }

  // ---- Strategy gating ---------------------------------------------------
  if (strategy === 'auto') {
    void altPort; // accepted but unused in v1
    return {
      ok: false,
      failedCheck: 'strategy',
      reason:
        'auto strategy not implemented in v1; use --strategy=manual and start a sibling Paperclip yourself. ' +
        RUNBOOK_HINT,
      stagingInstanceDir: ''
    };
  }
  if (strategy !== 'manual') {
    throw new Error(`verify: unknown strategy: ${strategy}`);
  }
  if (!smokeApiUrl) {
    // W9 fix — point operators at the runbook so they don't reach for --gate-bypass.
    throw new Error(
      'strategy=manual requires --smoke-api-url pointing at a sibling-staged Paperclip. ' +
        RUNBOOK_HINT
    );
  }

  // ---- 1. restoreToStaging ----------------------------------------------
  // verifyManifest (sha256 every artifact) runs inside restoreToStaging
  // before any destructive step, so we don't need to call it here.
  const restoreFn = _restoreToStaging ?? restoreToStaging;
  const stagingInfo = await restoreFn({
    snapshotId,
    home,
    instanceId,
    snapshotsDir,
    targetInstanceId,
    targetDb,
    dbUrl
  });

  // ---- 2. smoke against the running sibling Paperclip --------------------
  // Outer deadline is the rehearsal budget. Smoke's per-check timeout is
  // independent (default 5s). Whichever fires first wins; when the
  // deadline wins, smoke surfaces reason: 'rehearsal time exceeded'.
  const deadlineCtrl = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineCtrl.abort(new Error('rehearsal time exceeded')),
    maxRehearsalTimeMs
  );
  const smokeFn = _smoke ?? smoke;
  let smokeResult;
  try {
    smokeResult = await smokeFn({
      apiUrl: smokeApiUrl,
      apiKey,
      companyId,
      editorAgentId,
      snapshotId,
      snapshotsDir,
      deadline: deadlineCtrl.signal
    });
  } finally {
    clearTimeout(deadlineTimer);
  }

  // ---- 3. On FAIL: preserve staging dir; manifest unchanged --------------
  if (!smokeResult.ok) {
    return {
      ok: false,
      failedCheck: smokeResult.failedCheck ?? 'unknown',
      reason: smokeResult.reason ?? 'smoke returned ok:false without a reason',
      stagingInstanceDir: stagingInfo.stagingInstanceDir
    };
  }

  // ---- 4. On PASS: atomic write-back of verifiedAt + verifiedSmokeChecks --
  const verifiedAt = new Date().toISOString();
  const passedChecks = smokeResult.checks
    .filter((c) => c.status === 'pass')
    .map((c) => c.name);
  const snapshotDir = path.join(snapshotsDir, snapshotId);
  await writeVerifiedFlag(snapshotDir, verifiedAt, passedChecks);

  return {
    ok: true,
    verifiedAt,
    verifiedSmokeChecks: passedChecks,
    stagingInstanceDir: stagingInfo.stagingInstanceDir
  };
}

/**
 * Read the manifest, set verifiedAt + verifiedSmokeChecks, write it back
 * atomically. Exported so callers (and tests) can mark a snapshot
 * verified without going through the full verify() flow.
 */
export async function writeVerifiedFlag(snapshotDir, verifiedAt, checks) {
  const m = await readManifest(snapshotDir);
  m.verifiedAt = verifiedAt;
  m.verifiedSmokeChecks = checks;
  await writeManifestAtomic(snapshotDir, m);
}
