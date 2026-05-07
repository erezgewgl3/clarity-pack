// scripts/safety/test/manifest.test.mjs
//
// Covers M1 (round-trip), M2 (verify catches mutated artifact), M3 (streaming
// sha256 matches in-memory crypto digest).

import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readManifest,
  sha256OfFile,
  verifyManifest,
  writeManifest
} from '../lib/manifest.mjs';

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-manifest-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sampleManifest({ dbSha, fsSha, dbSize, fsSize }) {
  return {
    snapshotId: '2026-05-08T14-32-17Z',
    createdAt: '2026-05-08T14:32:17.043Z',
    createdBy: { user: 'eric', host: 'ERIC-WIN11' },
    paperclipVersion: '0.41.2',
    paperclipMode: 'pglite',
    paperclipHome: 'C:\\Users\\eric\\.paperclip',
    paperclipInstanceId: 'default',
    installedPlugins: [
      { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
    ],
    lockfileSha256: null,
    artifacts: {
      db: { path: 'pglite-datadir.tar.gz', format: 'pglite-datadir-gzip', sha256: dbSha, sizeBytes: dbSize },
      fs: { path: 'instance-fs.tar.gz', format: 'tar+gzip', sha256: fsSha, sizeBytes: fsSize }
    },
    verifiedAt: null,
    verifiedSmokeChecks: null,
    gateMaxAgeMinutes: 15
  };
}

test('M1 — writeManifest then readManifest round-trips all 12 fields', async () => {
  await withTmpDir(async (dir) => {
    const dbBuf = randomBytes(64);
    const fsBuf = randomBytes(128);
    await writeFile(path.join(dir, 'pglite-datadir.tar.gz'), dbBuf);
    await writeFile(path.join(dir, 'instance-fs.tar.gz'), fsBuf);
    const dbSha = createHash('sha256').update(dbBuf).digest('hex');
    const fsSha = createHash('sha256').update(fsBuf).digest('hex');
    const payload = sampleManifest({
      dbSha,
      fsSha,
      dbSize: dbBuf.length,
      fsSize: fsBuf.length
    });
    await writeManifest(dir, payload);
    const round = await readManifest(dir);

    // The 12 documented top-level fields must all survive.
    for (const field of [
      'snapshotId',
      'createdAt',
      'createdBy',
      'paperclipVersion',
      'paperclipMode',
      'paperclipHome',
      'paperclipInstanceId',
      'installedPlugins',
      'lockfileSha256',
      'artifacts',
      'verifiedAt',
      'verifiedSmokeChecks',
      'gateMaxAgeMinutes'
    ]) {
      assert.deepEqual(round[field], payload[field], `field ${field} should round-trip`);
    }
    // Plus the schemaVersion stamp the writer adds.
    assert.equal(round.schemaVersion, 1);
  });
});

test('M2 — verifyManifest detects a 1-byte mutation of the db artifact', async () => {
  await withTmpDir(async (dir) => {
    const dbBuf = Buffer.from('PGDMP' + 'a'.repeat(59));
    const fsBuf = randomBytes(128);
    const dbPath = path.join(dir, 'postgres.dump');
    const fsPath = path.join(dir, 'instance-fs.tar.gz');
    await writeFile(dbPath, dbBuf);
    await writeFile(fsPath, fsBuf);
    const dbSha = createHash('sha256').update(dbBuf).digest('hex');
    const fsSha = createHash('sha256').update(fsBuf).digest('hex');
    const payload = sampleManifest({
      dbSha,
      fsSha,
      dbSize: dbBuf.length,
      fsSize: fsBuf.length
    });
    payload.paperclipMode = 'postgres';
    payload.artifacts.db = {
      path: 'postgres.dump',
      format: 'pg_dump-custom-zstd6',
      sha256: dbSha,
      sizeBytes: dbBuf.length
    };
    await writeManifest(dir, payload);

    // Unmutated state: verify should be ok.
    const ok = await verifyManifest(dir);
    assert.deepEqual(ok, { ok: true });

    // Mutate exactly one byte in the db artifact.
    const buf = await readFile(dbPath);
    buf[10] = (buf[10] + 1) & 0xff;
    await writeFile(dbPath, buf);

    const result = await verifyManifest(dir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.mismatches, ['db']);
  });
});

test('M3 — sha256OfFile streaming matches in-memory crypto digest on a 5MB random buffer', async () => {
  await withTmpDir(async (dir) => {
    const buf = randomBytes(5 * 1024 * 1024);
    const target = path.join(dir, 'random-5mb.bin');
    await writeFile(target, buf);
    const expected = createHash('sha256').update(buf).digest('hex');
    const actual = await sha256OfFile(target);
    assert.equal(actual, expected);
  });
});
