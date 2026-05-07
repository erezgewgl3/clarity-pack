// scripts/safety/test/restore.test.mjs
//
// Covers R1, R2, R3, R4, R7, R8, R9.
//   R1 — verifyManifest gate (sha256 mismatch refuses before any destructive step)
//   R2 — invalid snapshotId rejected with no FS access
//   R3 — sibling-staging dir is real; live dir untouched
//   R4 — pglite restore happy path: staged dir contains state X (1 row)
//   R7 — atomicSwap moves live → pre-restore-<ts>, staging → live
//   R8 — live target without override is refused
//   R9 — pg_restore mocked spawn argv shape; stagingDb = paperclip_restoring
//
// CVE-2026-31802 (R5, R6) lives in restore-tar-cve.test.mjs.

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { sha256OfFile, readManifest, writeManifest } from '../lib/manifest.mjs';
import { snapshot } from '../lib/snapshot.mjs';
import {
  atomicSwap,
  rejectIfLiveTargetWithoutOverride,
  restoreToStaging
} from '../lib/restore.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-restore-'));
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

async function takePgliteSnapshot(root, opts = {}) {
  const home = path.join(root, 'home');
  await copyFakeInstance(home);
  // Seed the PGlite datadir with a known row for R4.
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.join(home, 'instances', 'default', 'db');
  const db = new PGlite(dataDir);
  await db.exec("CREATE TABLE IF NOT EXISTS canary (id integer PRIMARY KEY, label text)");
  await db.exec("INSERT INTO canary VALUES (1, 'state-X') ON CONFLICT (id) DO NOTHING");
  await db.close();
  const snapshotsDir = path.join(root, 'snapshots');
  await mkdir(snapshotsDir, { recursive: true });
  const id = '2026-05-08T14-32-17Z';
  const outDir = path.join(snapshotsDir, id);
  await snapshot({
    home,
    instanceId: 'default',
    mode: 'pglite',
    outDir,
    snapshotId: id,
    _paperclipCli: stubCli,
    silent: true,
    ...(opts.snapshotOverrides ?? {})
  });
  return { home, snapshotsDir, snapshotId: id };
}

test('R1 — restoreToStaging refuses before any FS work when sha256 mismatch', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await takePgliteSnapshot(root);
    // Mutate exactly 1 byte of the db artifact (after manifest sha256 was stamped).
    const dbPath = path.join(snapshotsDir, snapshotId, 'pglite-datadir.tar.gz');
    const buf = await readFile(dbPath);
    buf[100] = (buf[100] + 1) & 0xff;
    await writeFile(dbPath, buf);

    // Live dir SHA before the destructive call.
    const canary = path.join(home, 'instances', 'default', 'config.json');
    const beforeSha = await sha256OfFile(canary);

    await assert.rejects(
      () =>
        restoreToStaging({
          snapshotId,
          home,
          instanceId: 'default',
          snapshotsDir
        }),
      (err) => {
        assert.match(err.message, /sha256 mismatch/);
        return true;
      }
    );

    // Live dir is byte-identical.
    assert.equal(await sha256OfFile(canary), beforeSha);
    // No staging dir was created.
    await assert.rejects(stat(path.join(home, 'instances', 'default.restoring')));
  });
});

test('R2 — invalid snapshotId is rejected with "invalid snapshotId" and no FS access', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir } = await takePgliteSnapshot(root);
    for (const bad of ['../etc/passwd', '; rm -rf ~', '2026-05-08T14:32:17Z', '']) {
      await assert.rejects(
        () =>
          restoreToStaging({
            snapshotId: bad,
            home,
            instanceId: 'default',
            snapshotsDir
          }),
        (err) => {
          assert.match(err.message, /invalid snapshotId/);
          return true;
        }
      );
    }
  });
});

test('R3 — sibling-staging dir is created; live dir is byte-identical to before', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await takePgliteSnapshot(root);
    const canary1 = path.join(home, 'instances', 'default', 'config.json');
    const canary2 = path.join(home, 'instances', 'default', 'data', 'storage', 'sample.txt');
    const before = [await sha256OfFile(canary1), await sha256OfFile(canary2)];
    const result = await restoreToStaging({
      snapshotId,
      home,
      instanceId: 'default',
      snapshotsDir
    });
    assert.equal(result.stagingInstanceDir, path.join(home, 'instances', 'default.restoring'));
    // Live dir untouched.
    const after = [await sha256OfFile(canary1), await sha256OfFile(canary2)];
    assert.deepEqual(after, before);
    // Staging dir contains the same files (extracted from the tar).
    await stat(path.join(result.stagingInstanceDir, 'config.json'));
    await stat(path.join(result.stagingInstanceDir, 'data', 'storage', 'sample.txt'));
  });
});

test('R4 — pglite restore staging contains state-X (the snapshot row)', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await takePgliteSnapshot(root);
    // Mutate the live dir to state Y (5 rows).
    const { PGlite } = await import('@electric-sql/pglite');
    const liveDataDir = path.join(home, 'instances', 'default', 'db');
    const liveDb = new PGlite(liveDataDir);
    await liveDb.exec("INSERT INTO canary VALUES (2, 'state-Y'), (3, 'state-Y'), (4, 'state-Y'), (5, 'state-Y') ON CONFLICT (id) DO NOTHING");
    const liveCount = await liveDb.query('SELECT count(*)::int AS n FROM canary');
    assert.equal(liveCount.rows[0].n, 5);
    await liveDb.close();

    const { stagingInstanceDir } = await restoreToStaging({
      snapshotId,
      home,
      instanceId: 'default',
      snapshotsDir
    });
    const stagedDb = new PGlite(path.join(stagingInstanceDir, 'db'));
    const stagedCount = await stagedDb.query('SELECT count(*)::int AS n FROM canary');
    assert.equal(stagedCount.rows[0].n, 1, 'staged dir should have state-X (1 row)');
    await stagedDb.close();

    // Live dir should still have state-Y.
    const liveDb2 = new PGlite(liveDataDir);
    const liveCount2 = await liveDb2.query('SELECT count(*)::int AS n FROM canary');
    assert.equal(liveCount2.rows[0].n, 5, 'live dir should still have state-Y');
    await liveDb2.close();
  });
});

test('R7 — atomicSwap moves live to pre-restore-<ts>, staging to live', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await takePgliteSnapshot(root);
    // Drop a sentinel canary into the live dir so we can confirm it
    // ends up in the pre-restore-* backup post-swap.
    const sentinel = path.join(home, 'instances', 'default', 'sentinel.txt');
    await writeFile(sentinel, 'live-canary');

    const { stagingInstanceDir } = await restoreToStaging({
      snapshotId,
      home,
      instanceId: 'default',
      snapshotsDir
    });
    const swap = await atomicSwap(home, 'default', stagingInstanceDir);
    // Old live → preRestoreBackup; staging → live.
    assert.match(path.basename(swap.preRestoreBackup), /^default\.pre-restore-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
    await stat(path.join(swap.preRestoreBackup, 'sentinel.txt'));
    await stat(path.join(home, 'instances', 'default', 'config.json'));
    // Staging dir is now gone (renamed into live).
    await assert.rejects(stat(stagingInstanceDir));
  });
});

test('R8 — live target without iKnowWhatImDoing is refused', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await takePgliteSnapshot(root);
    await assert.rejects(
      () =>
        restoreToStaging({
          snapshotId,
          home,
          instanceId: 'default',
          targetInstanceId: 'default', // same as live → refuse
          snapshotsDir
        }),
      (err) => {
        assert.match(err.message, /refusing to restore over the live instance/);
        return true;
      }
    );
    // Direct call also refused.
    assert.throws(
      () => rejectIfLiveTargetWithoutOverride({ instanceId: 'default', targetInstanceId: 'default' }),
      /refusing to restore over the live instance/
    );
    // With override → no throw.
    rejectIfLiveTargetWithoutOverride({
      instanceId: 'default',
      targetInstanceId: 'default',
      iKnowWhatImDoing: true
    });
  });
});

test('R9 — pg_restore argv: --single-transaction --clean --if-exists --no-owner --no-privileges --dbname <stagingDsn> <dump>; stagingDb = paperclip_restoring; password via env', async () => {
  await withTmp(async (root) => {
    // Build a postgres-mode snapshot dir (we hand-craft it; we don't run
    // pg_dump). The artifact bytes themselves are arbitrary — the test
    // only exercises the argv shape via the mocked spawn.
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const snapshotsDir = path.join(root, 'snapshots');
    const id = '2026-05-08T14-32-17Z';
    const outDir = path.join(snapshotsDir, id);
    await mkdir(outDir, { recursive: true });
    const fakeDump = Buffer.alloc(64, 0xab);
    Buffer.from('PGDMP', 'utf8').copy(fakeDump, 0);
    await writeFile(path.join(outDir, 'postgres.dump'), fakeDump);
    // Use the snapshot's own tar build for the fs artifact — leverages
    // the production code path so we don't reinvent tar.
    const { snapshot } = await import('../lib/snapshot.mjs');
    // snapshot() expects pglite mode if we call it without a spawn stub;
    // simpler: hand-build a 1-file tar.
    const tarMod = await import('tar');
    await tarMod.c(
      { gzip: true, file: path.join(outDir, 'instance-fs.tar.gz'), cwd: home, portable: true },
      ['instances/default']
    );
    const dbSha = await sha256OfFile(path.join(outDir, 'postgres.dump'));
    const fsSha = await sha256OfFile(path.join(outDir, 'instance-fs.tar.gz'));
    const dbSize = (await stat(path.join(outDir, 'postgres.dump'))).size;
    const fsSize = (await stat(path.join(outDir, 'instance-fs.tar.gz'))).size;
    await writeManifest(outDir, {
      snapshotId: id,
      createdAt: '2026-05-08T14:32:17.043Z',
      createdBy: { user: 'eric', host: 'ERIC-WIN11' },
      paperclipVersion: '0.41.2',
      paperclipMode: 'postgres',
      paperclipHome: home,
      paperclipInstanceId: 'default',
      installedPlugins: [],
      lockfileSha256: null,
      artifacts: {
        db: { path: 'postgres.dump', format: 'pg_dump-custom-zstd6', sha256: dbSha, sizeBytes: dbSize },
        fs: { path: 'instance-fs.tar.gz', format: 'tar+gzip', sha256: fsSha, sizeBytes: fsSize }
      },
      verifiedAt: null,
      verifiedSmokeChecks: null,
      gateMaxAgeMinutes: 15
    });
    // Mocked pg_restore spawn — just exits 0.
    let captured = {};
    const spawnStub = (cmd, args, opts) => {
      captured = { cmd, args: args.slice(), env: { ...(opts?.env ?? {}) } };
      const child = new EventEmitter();
      child.stdout = Readable.from([]);
      child.stderr = Readable.from([]);
      queueMicrotask(() => child.emit('close', 0));
      return child;
    };
    await restoreToStaging({
      snapshotId: id,
      home,
      instanceId: 'default',
      snapshotsDir,
      dbUrl: 'postgresql://paperclip:s3cr3t@h:5432/paperclip',
      _spawn: spawnStub
    });
    assert.equal(captured.cmd, 'pg_restore');
    // Argv shape: --single-transaction, --clean, --if-exists, --no-owner,
    // --no-privileges, --dbname <stagingDsn>, <dump>.
    assert.equal(captured.args[0], '--single-transaction');
    assert.equal(captured.args[1], '--clean');
    assert.equal(captured.args[2], '--if-exists');
    assert.equal(captured.args[3], '--no-owner');
    assert.equal(captured.args[4], '--no-privileges');
    assert.equal(captured.args[5], '--dbname');
    // 6 = staging DSN. Must end in `paperclip_restoring`, NOT `paperclip`.
    assert.match(captured.args[6], /paperclip_restoring$/);
    // Last argv slot is the dump path.
    assert.equal(captured.args[7], path.join(outDir, 'postgres.dump'));
    assert.equal(captured.args.length, 8);
    // No literal password in argv.
    for (const a of captured.args) {
      assert.ok(!/s3cr3t/.test(a), `argv leaked password: ${a}`);
      assert.ok(!/--password/.test(a), `argv leaked --password flag: ${a}`);
    }
    // PGPASSWORD on env.
    assert.equal(captured.env.PGPASSWORD, 's3cr3t');
  });
});
