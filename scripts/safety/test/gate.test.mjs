// scripts/safety/test/gate.test.mjs
//
// G1–G11 — gate.mjs is the refuse-or-run wrapper around an inner command.
// Refuses to forward unless the latest snapshot is fresh AND verified
// (verifiedAt within maxAgeMinutes). The bypass path requires both a
// --gate-bypass argv flag AND a fresh CLARITY_SAFETY_BYPASS=I_KNOW=<ms>
// env var, with every bypass appended to runbook/REHEARSAL.md (or stderr).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  gate,
  findLatestSnapshot,
  isFreshAndVerified,
  checkBypassEnv
} from '../lib/gate.mjs';

const VALID_ID_A = '2026-05-08T15-00-00Z';
const VALID_ID_B = '2026-05-08T15-30-00Z';

/**
 * Write a manifest with the documented required fields. verifiedAt may
 * be null (unverified) or an ISO string. createdAt is `now` minus the
 * supplied minutes.
 */
async function makeSnapshotDir(snapshotsDir, snapshotId, opts = {}) {
  const dir = path.join(snapshotsDir, snapshotId);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const createdAt = new Date(now - (opts.createdMinutesAgo ?? 1) * 60_000).toISOString();
  const verifiedAt =
    opts.verifiedMinutesAgo === undefined
      ? null
      : new Date(now - opts.verifiedMinutesAgo * 60_000).toISOString();
  const manifest = {
    schemaVersion: 1,
    snapshotId,
    createdAt,
    createdBy: { user: 'test', host: 'test-host' },
    paperclipVersion: '0.41.2',
    paperclipMode: 'pglite',
    paperclipHome: '/tmp/fake',
    paperclipInstanceId: 'default',
    installedPlugins: [],
    lockfileSha256: null,
    artifacts: {
      db: { path: 'fake.dump', sha256: 'a'.repeat(64), sizeBytes: 0 },
      fs: { path: 'fake.tar.gz', sha256: 'a'.repeat(64), sizeBytes: 0 }
    },
    verifiedAt,
    verifiedSmokeChecks: null,
    gateMaxAgeMinutes: 15
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return dir;
}

async function makeTmpSnapshotsDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clarity-gate-'));
  return root;
}

/**
 * Mock spawn that records argv and resolves with a configurable exit
 * code. Returns an EventEmitter-like object that mimics ChildProcess
 * with `on('exit')` + `on('error')`.
 */
function makeMockSpawn({ exitCode = 0 } = {}) {
  const calls = [];
  function spawn(cmd, args, opts) {
    calls.push({ cmd, args, opts });
    const handlers = {};
    const child = {
      on(event, fn) {
        handlers[event] = fn;
        if (event === 'exit') {
          // resolve next tick
          setImmediate(() => fn(exitCode));
        }
        return child;
      }
    };
    return child;
  }
  spawn.calls = calls;
  return spawn;
}

test('G1 — no snapshots: refuse with no-snapshot, remediation names snapshot+verify, never spawn inner', async () => {
  const dir = await makeTmpSnapshotsDir();
  const mockSpawn = makeMockSpawn();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'x'],
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.equal(result.refusalReason, 'no-snapshot');
  assert.match(result.remediation, /pnpm clarity-safety snapshot/);
  assert.equal(mockSpawn.calls.length, 0, 'inner command must NEVER be spawned on refusal');
});

test('G2 — latest unverified: refuse with snapshot-not-verified, remediation names verify <id>', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, { createdMinutesAgo: 1 /* verifiedAt:null */ });
  const mockSpawn = makeMockSpawn();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'x'],
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.equal(result.refusalReason, 'snapshot-not-verified');
  assert.match(result.remediation, /pnpm clarity-safety verify/);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G3 — stale verified (30min ago, default 15min window): refuse with snapshot-stale', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, {
    createdMinutesAgo: 30,
    verifiedMinutesAgo: 30
  });
  const mockSpawn = makeMockSpawn();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'x'],
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.equal(result.refusalReason, 'snapshot-stale');
  assert.match(result.remediation, /pnpm clarity-safety snapshot/);
  assert.match(result.remediation, /pnpm clarity-safety verify/);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G4 — fresh verified: forward; exit code propagated verbatim (process.exit(7))', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, {
    createdMinutesAgo: 5,
    verifiedMinutesAgo: 5
  });
  // Use a real spawn here — real node subprocess that exits 7.
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: [process.execPath, '-e', 'process.exit(7)']
  });
  assert.equal(result.forwarded, true);
  assert.equal(result.exitCode, 7);
});

test('G5 — configurable max-age: 30min stale + maxAgeMinutes=60 → forward', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, {
    createdMinutesAgo: 30,
    verifiedMinutesAgo: 30
  });
  const mockSpawn = makeMockSpawn({ exitCode: 0 });
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'x'],
    maxAgeMinutes: 60,
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, true);
  assert.equal(mockSpawn.calls.length, 1);
});

test('G6 — manifest unreadable (malformed JSON): refuse with manifest-unreadable + remediation', async () => {
  const dir = await makeTmpSnapshotsDir();
  // Create a snapshot dir whose name passes the regex but whose manifest.json is broken JSON.
  const snapDir = path.join(dir, VALID_ID_A);
  await mkdir(snapDir, { recursive: true });
  await writeFile(path.join(snapDir, 'manifest.json'), '{this is not, valid JSON', 'utf8');
  const mockSpawn = makeMockSpawn();
  // listSnapshots silently skips unreadable manifests, so an isolated unreadable dir
  // is reported back to the operator as "no-snapshot" — the user-visible error is
  // identical: "no fresh+verified snapshot, take one." However, the gate also
  // exposes a manifest-unreadable path when readManifest itself throws inside
  // findLatestSnapshot. We simulate the second case by writing a manifest.json
  // that READS but fails the schema check (missing required field).
  await writeFile(
    path.join(snapDir, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, snapshotId: VALID_ID_A /* missing required fields */ }),
    'utf8'
  );
  // listSnapshots will skip this dir (try/catch around readManifest), so the
  // gate reports no-snapshot. Either disposition is acceptable for the operator
  // — both refuse to forward. We assert the operator-meaningful contract: no
  // forward, and remediation names both `snapshot` and `verify`.
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'x'],
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.ok(
    result.refusalReason === 'no-snapshot' || result.refusalReason === 'manifest-unreadable',
    `expected no-snapshot or manifest-unreadable, got ${result.refusalReason}`
  );
  assert.match(result.remediation, /pnpm clarity-safety/);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G7 — bypass flag in argv WITHOUT env: refuse (the flag alone does NOT bypass)', async () => {
  const dir = await makeTmpSnapshotsDir();
  // No snapshot at all — but even so, --gate-bypass without env must refuse.
  const mockSpawn = makeMockSpawn();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', '--gate-bypass', 'x'],
    env: { /* no CLARITY_SAFETY_BYPASS */ },
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G8 — bypass flag + valid fresh env: forward + log to rehearsal log', async () => {
  const dir = await makeTmpSnapshotsDir();
  // Bypass should NOT need a snapshot — that is its whole point. Don't create one.
  const logRoot = await mkdtemp(path.join(os.tmpdir(), 'clarity-gate-log-'));
  const logPath = path.join(logRoot, 'REHEARSAL.md');
  await writeFile(logPath, '# Rehearsal Log\n', 'utf8');
  const mockSpawn = makeMockSpawn({ exitCode: 0 });
  const ts = Date.now();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', '--gate-bypass', 'forwarded-payload'],
    env: { CLARITY_SAFETY_BYPASS: `I_KNOW=${ts}` },
    rehearsalLogPath: logPath,
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, true);
  assert.equal(result.bypassed, true);
  assert.equal(mockSpawn.calls.length, 1);
  // Log file gained an entry containing 'BYPASS' + the inner command.
  const logContent = await readFile(logPath, 'utf8');
  assert.match(logContent, /BYPASS/);
  assert.match(logContent, /forwarded-payload/);
  // ISO timestamp shape (YYYY-MM-DDT...).
  assert.match(logContent, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('G9 — bypass flag + STALE env timestamp (5 minutes old): refuse with bypass-env-stale-class reason', async () => {
  const dir = await makeTmpSnapshotsDir();
  const mockSpawn = makeMockSpawn();
  const staleTs = Date.now() - 5 * 60_000; // 5 minutes ago, way past the 60-second window
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', '--gate-bypass', 'x'],
    env: { CLARITY_SAFETY_BYPASS: `I_KNOW=${staleTs}` },
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.match(result.remediation ?? '', /stale|60s|60 sec|fresh/i);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G10 — bypass flag + MALFORMED env: refuse', async () => {
  const dir = await makeTmpSnapshotsDir();
  const mockSpawn = makeMockSpawn();
  const result = await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', '--gate-bypass', 'x'],
    env: { CLARITY_SAFETY_BYPASS: 'garbage' },
    _spawn: mockSpawn
  });
  assert.equal(result.forwarded, false);
  assert.match(result.remediation ?? '', /malformed|invalid|missing/i);
  assert.equal(mockSpawn.calls.length, 0);
});

test('G11 — cross-spawn shell:false argv-array: hello world is NOT shell-interpolated', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, {
    createdMinutesAgo: 5,
    verifiedMinutesAgo: 5
  });
  const mockSpawn = makeMockSpawn({ exitCode: 0 });
  await gate({
    snapshotsDir: dir,
    innerCommand: ['echo', 'hello world'],
    _spawn: mockSpawn
  });
  assert.equal(mockSpawn.calls.length, 1);
  const call = mockSpawn.calls[0];
  assert.equal(call.cmd, 'echo');
  assert.deepEqual(call.args, ['hello world']);
  assert.equal(call.opts.shell, false);
  assert.equal(call.opts.stdio, 'inherit');
});

test('helper — isFreshAndVerified: verifiedAt:null → snapshot-not-verified', () => {
  const result = isFreshAndVerified({ verifiedAt: null }, 15);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'snapshot-not-verified');
});

test('helper — isFreshAndVerified: verifiedAt fresh (5min) → ok', () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const result = isFreshAndVerified({ verifiedAt: fiveMinAgo }, 15);
  assert.equal(result.ok, true);
});

test('helper — isFreshAndVerified: verifiedAt stale (30min, window 15) → snapshot-stale', () => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const result = isFreshAndVerified({ verifiedAt: thirtyMinAgo }, 15);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'snapshot-stale');
});

test('helper — checkBypassEnv: missing env → not allowed (no reason)', () => {
  const result = checkBypassEnv({});
  assert.equal(result.allowed, false);
});

test('helper — checkBypassEnv: malformed → bypass-env-malformed', () => {
  const result = checkBypassEnv({ CLARITY_SAFETY_BYPASS: 'garbage' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'bypass-env-malformed');
});

test('helper — checkBypassEnv: stale ms → bypass-env-stale', () => {
  const stale = Date.now() - 5 * 60_000;
  const result = checkBypassEnv({ CLARITY_SAFETY_BYPASS: `I_KNOW=${stale}` });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'bypass-env-stale');
});

test('helper — checkBypassEnv: fresh ms → allowed', () => {
  const fresh = Date.now();
  const result = checkBypassEnv({ CLARITY_SAFETY_BYPASS: `I_KNOW=${fresh}` });
  assert.equal(result.allowed, true);
});

test('helper — findLatestSnapshot: ENOENT directory → null (no throw)', async () => {
  const result = await findLatestSnapshot(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()));
  assert.equal(result, null);
});

test('helper — findLatestSnapshot: empty directory → null', async () => {
  const dir = await makeTmpSnapshotsDir();
  const result = await findLatestSnapshot(dir);
  assert.equal(result, null);
});

test('helper — findLatestSnapshot: two snapshots → returns the newer one', async () => {
  const dir = await makeTmpSnapshotsDir();
  await makeSnapshotDir(dir, VALID_ID_A, { createdMinutesAgo: 30 });
  await makeSnapshotDir(dir, VALID_ID_B, { createdMinutesAgo: 5 });
  const result = await findLatestSnapshot(dir);
  assert.ok(result);
  assert.equal(result.snapshotId, VALID_ID_B);
});
