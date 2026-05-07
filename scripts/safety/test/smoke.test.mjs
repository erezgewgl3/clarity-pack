// scripts/safety/test/smoke.test.mjs
//
// SM1–SM11 — smoke.mjs runs the 5-check pass against a stub server,
// composes per-check timeouts with an outer deadline AbortSignal, and
// cross-checks plugin set + version against the snapshot manifest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { smoke } from '../lib/smoke.mjs';
import { startStubServer } from './fixtures/stub-paperclip-server.mjs';

/**
 * Build a tmp snapshot dir with a manifest.json that satisfies
 * readManifest's REQUIRED_FIELDS contract. Caller passes overrides.
 */
async function makeFakeSnapshotDir({ snapshotId, paperclipVersion, installedPlugins }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clarity-smoke-'));
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

test('SM1 — all 5 checks pass on healthy stub', async () => {
  const stub = await startStubServer();
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo'
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    // 5 base checks all pass
    const names = r.checks.map((c) => c.name);
    assert.deepEqual(names, ['health', 'issues', 'agents', 'plugins', 'heartbeat']);
    assert.ok(r.checks.every((c) => c.status === 'pass'));
  } finally {
    await stub.close();
  }
});

test('SM2 — 5xx on /health is FAIL with health failedCheck', async () => {
  const stub = await startStubServer({ mode: 'down' });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo'
    });
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'health');
    assert.match(r.reason ?? '', /500|HTTP 5/);
  } finally {
    await stub.close();
  }
});

test('SM3 — 4xx on heartbeat is PASS (server-alive), not FAIL', async () => {
  const stub = await startStubServer({ mode: 'heartbeat-401' });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo'
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const heartbeat = r.checks.find((c) => c.name === 'heartbeat');
    assert.equal(heartbeat.status, 'pass');
    assert.match(heartbeat.detail ?? '', /401|server-alive/);
  } finally {
    await stub.close();
  }
});

test('SM4 — per-check timeout aborts within ~timeoutMs (not full upstream delay)', async () => {
  const stub = await startStubServer({ mode: 'healthy', delayMs: 8000 });
  try {
    const t0 = Date.now();
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      timeoutMs: 500
    });
    const dt = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'health');
    assert.ok(dt < 2500, `expected <2500ms, saw ${dt}ms (timeout did not fire)`);
  } finally {
    await stub.close();
  }
});

test('SM5 — cross-check pass: plugin set equality + version equality', async () => {
  const stub = await startStubServer();
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T14-32-17Z',
    paperclipVersion: '0.41.2',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]
  });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotId: '2026-05-08T14-32-17Z',
      snapshotsDir
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const pluginCheck = r.checks.find((c) => c.name === 'plugin-list-cross-check');
    assert.equal(pluginCheck.status, 'pass');
    const versionCheck = r.checks.find((c) => c.name === 'version-cross-check');
    assert.equal(versionCheck.status, 'pass');
  } finally {
    await stub.close();
  }
});

test('SM6 — cross-check FAIL on plugin drift (extra rogue)', async () => {
  const stub = await startStubServer({ mode: 'plugin-drift' });
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T14-32-18Z',
    paperclipVersion: '0.41.2',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]
  });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotId: '2026-05-08T14-32-18Z',
      snapshotsDir
    });
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'plugin-list-cross-check');
    assert.match(r.reason ?? '', /rogue/);
  } finally {
    await stub.close();
  }
});

test('SM7 — cross-check FAIL on version drift (manifest 0.41.2 vs reported 0.42.0)', async () => {
  const stub = await startStubServer({ mode: 'version-drift' });
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T14-32-19Z',
    paperclipVersion: '0.41.2',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]
  });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotId: '2026-05-08T14-32-19Z',
      snapshotsDir
    });
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'version-cross-check');
    assert.match(r.reason ?? '', /0\.41\.2/);
    assert.match(r.reason ?? '', /0\.42\.0/);
  } finally {
    await stub.close();
  }
});

test('SM8 — editorAgentId omitted: heartbeat skipped, not failed; ok=true', async () => {
  const stub = await startStubServer();
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1'
      // no editorAgentId
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const heartbeat = r.checks.find((c) => c.name === 'heartbeat');
    assert.equal(heartbeat.status, 'skipped');
    assert.match(heartbeat.detail ?? '', /editor-agent/i);
    // Other 4 checks pass
    assert.ok(
      ['health', 'issues', 'agents', 'plugins'].every(
        (n) => r.checks.find((c) => c.name === n)?.status === 'pass'
      )
    );
  } finally {
    await stub.close();
  }
});

test('SM9 — network failure on /health is FAIL with redacted reason', async () => {
  // Boot then close to get a definitively closed port.
  const stub = await startStubServer();
  const closedUrl = stub.baseUrl;
  await stub.close();
  const r = await smoke({
    apiUrl: closedUrl,
    apiKey: 'sekret-bearer',
    companyId: 'c1',
    editorAgentId: 'agent-foo'
  });
  assert.equal(r.ok, false);
  assert.equal(r.failedCheck, 'health');
  assert.ok(
    !String(r.reason ?? '').includes('sekret-bearer'),
    `apiKey leaked into reason: ${r.reason}`
  );
});

test('SM10 — outer deadline AbortSignal: aborts in-flight check with reason "rehearsal time exceeded"', async () => {
  const stub = await startStubServer({ mode: 'healthy', delayMs: 10000 });
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error('rehearsal time exceeded')), 50);
    const t0 = Date.now();
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      timeoutMs: 5000, // larger than deadline so we know deadline wins
      deadline: ctrl.signal
    });
    const dt = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.failedCheck, 'health');
    assert.equal(r.reason, 'rehearsal time exceeded');
    assert.ok(dt < 1500, `expected deadline to abort fast; saw ${dt}ms`);
  } finally {
    await stub.close();
  }
});

test('SM11 — version-cross-check skipped when /health body lacks paperclipVersion; plugin-list still pass', async () => {
  const stub = await startStubServer({ mode: 'healthy-noversion' });
  const { snapshotsDir } = await makeFakeSnapshotDir({
    snapshotId: '2026-05-08T14-32-20Z',
    paperclipVersion: '0.41.2',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]
  });
  try {
    const r = await smoke({
      apiUrl: stub.baseUrl,
      companyId: 'c1',
      editorAgentId: 'agent-foo',
      snapshotId: '2026-05-08T14-32-20Z',
      snapshotsDir
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const versionCheck = r.checks.find((c) => c.name === 'version-cross-check');
    assert.equal(versionCheck.status, 'skipped');
    assert.match(
      versionCheck.detail ?? '',
      /paperclipVersion|did not report/i,
      `expected detail to mention version not reported; got: ${versionCheck.detail}`
    );
    const pluginCheck = r.checks.find((c) => c.name === 'plugin-list-cross-check');
    assert.equal(pluginCheck.status, 'pass');
  } finally {
    await stub.close();
  }
});
