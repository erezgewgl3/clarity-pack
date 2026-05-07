// scripts/safety/test/verify.test.mjs
//
// V1–V8 — verify.mjs orchestrates restoreToStaging → smoke → atomic
// manifest write-back of verifiedAt/verifiedSmokeChecks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verify, writeVerifiedFlag } from '../lib/verify.mjs';
import {
  writeManifestAtomic,
  readManifest,
  updateManifest
} from '../lib/manifest.mjs';
import { startStubServer } from './fixtures/stub-paperclip-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(HERE, '..', 'cli.mjs');

async function makeFakeSnapshotDir({ snapshotId, paperclipVersion, installedPlugins }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clarity-verify-'));
  const dir = path.join(root, snapshotId);
  await mkdir(dir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    snapshotId,
    createdAt: new Date().toISOString(),
    createdBy: { user: 'test', host: 'test-host' },
    paperclipVersion,
    paperclipMode: 'pglite',
    paperclipHome: '/tmp/fake',
    paperclipInstanceId: 'default',
    installedPlugins,
    lockfileSha256: null,
    artifacts: {
      db: { path: 'fake.dump', sha256: 'a'.repeat(64), sizeBytes: 0 },
      fs: { path: 'fake.tar.gz', sha256: 'a'.repeat(64), sizeBytes: 0 }
    },
    verifiedAt: null,
    verifiedSmokeChecks: null,
    gateMaxAgeMinutes: 15
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { snapshotsDir: root, snapshotDir: dir };
}

/**
 * Stub _restoreToStaging that does NOT touch the filesystem. Returns
 * the staging dir path the verify orchestrator will use for inspection.
 */
function makeRestoreStub(stagingInstanceDir) {
  return async (_opts) => ({
    stagingInstanceDir,
    stagingDbName: 'paperclip_restoring',
    manifest: { snapshotId: _opts.snapshotId },
    smokeApiUrl: undefined
  });
}

test('V1 — writeManifestAtomic writes via .tmp + rename; no stale .tmp; JSON parseable', async () => {
  const { snapshotDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-00-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  // Read existing manifest, modify, write atomically.
  const m1 = await readManifest(snapshotDir);
  m1.verifiedAt = '2026-05-08T15:01:00Z';
  await writeManifestAtomic(snapshotDir, m1);
  // Tmp file must not exist after success.
  let tmpExists = false;
  try {
    await access(path.join(snapshotDir, 'manifest.json.tmp'));
    tmpExists = true;
  } catch {}
  assert.equal(tmpExists, false, 'manifest.json.tmp must be cleaned up by rename');
  // JSON is parseable and reflects the new content.
  const m2 = await readManifest(snapshotDir);
  assert.equal(m2.verifiedAt, '2026-05-08T15:01:00Z');
  // updateManifest works the same way.
  const m3 = await updateManifest(snapshotDir, (m) => {
    m.verifiedSmokeChecks = ['health', 'issues'];
    return m;
  });
  assert.deepEqual(m3.verifiedSmokeChecks, ['health', 'issues']);
  const m4 = await readManifest(snapshotDir);
  assert.deepEqual(m4.verifiedSmokeChecks, ['health', 'issues']);
});

test('V2 — manual strategy happy path: smoke PASS → manifest verifiedAt set, checks recorded', async () => {
  const stub = await startStubServer();
  const { snapshotsDir, snapshotDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-10-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]
  });
  try {
    const fakeStaging = path.join(os.tmpdir(), 'fake-staging-v2');
    const r = await verify({
      snapshotId: '2026-05-08T15-10-00Z',
      home: '/tmp/fake-home',
      instanceId: 'default',
      strategy: 'manual',
      smokeApiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotsDir,
      _restoreToStaging: makeRestoreStub(fakeStaging)
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(typeof r.verifiedAt, 'string');
    assert.match(r.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Array.isArray(r.verifiedSmokeChecks));
    assert.ok(r.verifiedSmokeChecks.length > 0);
    // Manifest on disk reflects verifiedAt.
    const m = await readManifest(snapshotDir);
    assert.equal(m.verifiedAt, r.verifiedAt);
    assert.deepEqual(m.verifiedSmokeChecks, r.verifiedSmokeChecks);
  } finally {
    await stub.close();
  }
});

test('V3 — manual strategy on smoke FAIL: manifest verifiedAt remains null; staging preserved', async () => {
  const stub = await startStubServer({ mode: 'down' });
  const { snapshotsDir, snapshotDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-20-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  try {
    const fakeStaging = path.join(os.tmpdir(), 'fake-staging-v3');
    const r = await verify({
      snapshotId: '2026-05-08T15-20-00Z',
      home: '/tmp/fake-home',
      instanceId: 'default',
      strategy: 'manual',
      smokeApiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotsDir,
      _restoreToStaging: makeRestoreStub(fakeStaging)
    });
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'health');
    assert.match(r.reason ?? '', /500|HTTP 5/);
    assert.equal(r.stagingInstanceDir, fakeStaging, 'staging dir reported for inspection');
    // Manifest unchanged.
    const m = await readManifest(snapshotDir);
    assert.equal(m.verifiedAt, null);
    assert.equal(m.verifiedSmokeChecks, null);
  } finally {
    await stub.close();
  }
});

test('V4 — auto strategy returns ok:false with not-implemented reason', async () => {
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-30-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  const r = await verify({
    snapshotId: '2026-05-08T15-30-00Z',
    home: '/tmp/fake-home',
    instanceId: 'default',
    strategy: 'auto',
    altPort: 3101,
    companyId: 'c1',
    snapshotsDir
  });
  assert.equal(r.ok, false);
  assert.equal(r.failedCheck, 'strategy');
  assert.match(r.reason ?? '', /auto strategy not implemented in v1/);
  assert.match(r.reason ?? '', /strategy=manual/);
});

test('V5 — maxRehearsalTimeMs deadline aborts smoke; reason equals "rehearsal time exceeded" EXACTLY; manifest unchanged', async () => {
  const stub = await startStubServer({ mode: 'healthy', delayMs: 10000 });
  const { snapshotsDir, snapshotDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-40-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  try {
    const fakeStaging = path.join(os.tmpdir(), 'fake-staging-v5');
    const t0 = Date.now();
    const r = await verify({
      snapshotId: '2026-05-08T15-40-00Z',
      home: '/tmp/fake-home',
      instanceId: 'default',
      strategy: 'manual',
      smokeApiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      maxRehearsalTimeMs: 200,
      snapshotsDir,
      _restoreToStaging: makeRestoreStub(fakeStaging)
    });
    const dt = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'rehearsal time exceeded'); // EXACT equality
    assert.ok(dt < 1500, `expected deadline to abort fast; saw ${dt}ms`);
    // Manifest unchanged.
    const m = await readManifest(snapshotDir);
    assert.equal(m.verifiedAt, null);
  } finally {
    await stub.close();
  }
});

test('V6 — staging preserved on FAIL (verify never deletes staging)', async () => {
  // We assert via the returned stagingInstanceDir field. The actual
  // staging dir would be created by restoreToStaging; we stub it here so
  // we can verify the orchestrator is not the one wiping it.
  const stub = await startStubServer({ mode: 'down' });
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T15-50-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  try {
    const fakeStaging = path.join(os.tmpdir(), 'fake-staging-v6-preserved');
    let restoreCalled = false;
    const restoreStub = async (opts) => {
      restoreCalled = true;
      return makeRestoreStub(fakeStaging)(opts);
    };
    const r = await verify({
      snapshotId: '2026-05-08T15-50-00Z',
      home: '/tmp/fake-home',
      instanceId: 'default',
      strategy: 'manual',
      smokeApiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotsDir,
      _restoreToStaging: restoreStub
    });
    assert.equal(restoreCalled, true);
    assert.equal(r.ok, false);
    assert.equal(r.stagingInstanceDir, fakeStaging);
  } finally {
    await stub.close();
  }
});

test('V7 — CLI dispatch: clarity-safety verify --help exits 0', async () => {
  const child = spawn(process.execPath, [CLI_PATH, 'verify', '--help'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
  const code = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 0)));
  assert.equal(code, 0);
  assert.match(stdout, /Usage: clarity-safety verify/);
});

test('V8 — manual strategy without --smoke-api-url throws with runbook hint suffix', async () => {
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T16-00-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  let caught;
  try {
    await verify({
      snapshotId: '2026-05-08T16-00-00Z',
      home: '/tmp/fake-home',
      instanceId: 'default',
      strategy: 'manual',
      // smokeApiUrl deliberately omitted
      companyId: 'c1',
      snapshotsDir
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected verify to throw when smokeApiUrl is missing');
  assert.match(caught.message, /strategy=manual requires --smoke-api-url/);
  assert.ok(
    caught.message.endsWith('See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.'),
    `expected message to END with runbook hint; saw: ${caught.message}`
  );
});

test('V_writeVerifiedFlag — exported helper sets verifiedAt + verifiedSmokeChecks atomically', async () => {
  const { snapshotDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T16-10-00Z',
    paperclipVersion: '0.41.2',
    installedPlugins: []
  });
  const ts = '2026-05-08T16:11:00Z';
  await writeVerifiedFlag(snapshotDir, ts, ['health', 'issues']);
  const m = await readManifest(snapshotDir);
  assert.equal(m.verifiedAt, ts);
  assert.deepEqual(m.verifiedSmokeChecks, ['health', 'issues']);
  // No stale tmp file.
  let tmpExists = false;
  try {
    await stat(path.join(snapshotDir, 'manifest.json.tmp'));
    tmpExists = true;
  } catch {}
  assert.equal(tmpExists, false);
});
