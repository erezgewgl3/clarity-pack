// scripts/safety/test/snapshot.test.mjs
//
// Orchestration-only tests:
//   S4 — manifest.lockfileSha256 captures plugins/pnpm-lock.yaml hash, null when absent
//   S7 — paperclip version + plugin list capture (mocked cli, both --json and table fallback)
//   S8 — snapshot dir name format matches /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readManifest } from '../lib/manifest.mjs';
import { snapshot } from '../lib/snapshot.mjs';
import { isValidSnapshotId } from '../lib/paths.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-snap-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function copyFakeInstance(home) {
  await cp(path.join(FIXTURES, 'fake-instance'), home, { recursive: true });
}

const stubCli = {
  async getPaperclipVersion() {
    return '0.41.2';
  },
  async listInstalledPlugins() {
    return [{ id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }];
  }
};

test('S4 — manifest.lockfileSha256 captures plugins/pnpm-lock.yaml hash; null if missing', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    const lockBuf = await readFile(path.join(home, 'instances', 'default', 'plugins', 'pnpm-lock.yaml'));
    const expectedLockSha = createHash('sha256').update(lockBuf).digest('hex');
    const { snapshotId } = await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    assert.ok(isValidSnapshotId(snapshotId));
    const manifest = await readManifest(outDir);
    assert.equal(manifest.lockfileSha256, expectedLockSha);

    // Now drop the lockfile and re-snapshot — lockfileSha256 must be null.
    await rm(path.join(home, 'instances', 'default', 'plugins', 'pnpm-lock.yaml'));
    const outDir2 = path.join(root, 'snap2');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir: outDir2,
      _paperclipCli: stubCli,
      silent: true
    });
    const manifest2 = await readManifest(outDir2);
    assert.equal(manifest2.lockfileSha256, null);
  });
});

test('S7 — paperclip version + plugin list captured into manifest verbatim', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    const manifest = await readManifest(outDir);
    assert.equal(manifest.paperclipVersion, '0.41.2');
    assert.deepEqual(manifest.installedPlugins, [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ]);
  });
});

test('S8 — generated snapshotId matches the canonical regex', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    const { snapshotId } = await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    assert.match(snapshotId, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });
});

test('S9 — paperclip-cli failures (e.g. 403 on plugin list) are recorded as manifest.paperclipCliWarnings, not thrown', async () => {
  // Snapshot succeeds with paperclipVersion='unknown', installedPlugins=[],
  // and the manifest records the failure reason for diagnostics. This
  // covers the 2026-05-12 drill case where Paperclip's authenticated
  // endpoints reject `pnpm paperclipai plugin list` with 403.
  const failingCli = {
    async getPaperclipVersion() {
      throw new Error('pnpm paperclipai --version failed (exit 1): something');
    },
    async listInstalledPlugins() {
      throw new Error('pnpm paperclipai plugin list failed (exit 1): API error 403: Board access required');
    }
  };
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    const result = await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: failingCli,
      silent: true
    });
    assert.ok(isValidSnapshotId(result.snapshotId));
    const manifest = await readManifest(outDir);
    assert.equal(manifest.paperclipVersion, 'unknown');
    assert.deepEqual(manifest.installedPlugins, []);
    assert.ok(Array.isArray(manifest.paperclipCliWarnings));
    assert.equal(manifest.paperclipCliWarnings.length, 2);
    assert.equal(manifest.paperclipCliWarnings[0].step, 'getPaperclipVersion');
    assert.equal(manifest.paperclipCliWarnings[1].step, 'listInstalledPlugins');
    assert.match(manifest.paperclipCliWarnings[1].message, /403/);
  });
});

// Plan 01-05 Task 3: snapshot.mjs uses pg-dump-locator + assertVersionMatch
// for postgres mode. Both are injectable for tests.

test('S-locator-A — snapshot postgres-mode invokes pg_dump using the path returned by locatePgDump', async () => {
  // Stub locatePgDump to return a TAGGED path; stub assertVersionMatch to no-op;
  // stub spawn to capture the binary used in the spawn call. Fake spawn also
  // writes the expected postgres.dump file so the downstream sha256/manifest
  // steps don't fail on a missing file.
  let spawnedBinary = null;
  let snapOutDir = null;
  const fakeSpawn = (binary, argv, _opts) => {
    spawnedBinary = binary;
    // Extract --file=<path> from argv and write a stub dump there.
    const fileArg = argv.find((a) => typeof a === 'string' && a.startsWith('--file='));
    if (fileArg) {
      const dumpPath = fileArg.slice('--file='.length);
      // fire-and-forget — the close-event handler runs after the write below
      writeFile(dumpPath, 'fake-pg_dump-output').catch(() => {});
    }
    return {
      stdout: null,
      stderr: { on: () => {} },
      on(event, cb) {
        if (event === 'close') queueMicrotask(() => cb(0));
      },
    };
  };

  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    snapOutDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'postgres',
      outDir: snapOutDir,
      dbUrl: 'postgresql://paperclip:paperclip@127.0.0.1:54329/paperclip',
      _paperclipCli: stubCli,
      _spawn: fakeSpawn,
      _locatePgDump: async () => ({
        pgDumpPath: '/test/tagged-pg_dump-binary',
        source: 'override',
      }),
      _assertVersionMatch: async () => {},
      silent: true,
    });
    assert.equal(
      spawnedBinary,
      '/test/tagged-pg_dump-binary',
      'snapshot must use the path returned by locatePgDump for its pg_dump spawn',
    );
  });
});

test('S-locator-B — snapshot postgres-mode aborts cleanly when assertVersionMatch throws (pg_dump NOT invoked)', async () => {
  let spawnedBinary = null;
  const fakeSpawn = (binary, _argv, _opts) => {
    spawnedBinary = binary;
    return {
      stdout: null,
      stderr: { on: () => {} },
      on(event, cb) {
        if (event === 'close') queueMicrotask(() => cb(0));
      },
    };
  };

  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    await assert.rejects(
      () =>
        snapshot({
          home,
          instanceId: 'default',
          mode: 'postgres',
          outDir,
          dbUrl: 'postgresql://paperclip:paperclip@127.0.0.1:54329/paperclip',
          _paperclipCli: stubCli,
          _spawn: fakeSpawn,
          _locatePgDump: async () => ({
            pgDumpPath: '/test/should-not-be-invoked',
            source: 'override',
          }),
          _assertVersionMatch: async () => {
            const e = new Error(
              'pg_dump major version 17 cannot dump server version 18. ' +
                'PostgreSQL requires matching major version. ' +
                'Install pg_dump 18 client tools OR use restore-by-deletion fallback for throwaway dev clones ' +
                '(runbook/operator-gotchas.md §pg-dump-version-mismatch).',
            );
            e.name = 'VersionMismatchError';
            throw e;
          },
          silent: true,
        }),
      (err) => {
        assert.match(err.message, /pg_dump major version 17/);
        assert.match(err.message, /server version 18/);
        return true;
      },
    );
    assert.equal(
      spawnedBinary,
      null,
      'pg_dump must NOT have been invoked when assertVersionMatch throws',
    );
  });
});
