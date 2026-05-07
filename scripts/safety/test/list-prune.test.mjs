// scripts/safety/test/list-prune.test.mjs
//
// Covers L1 (listSnapshots), PR1 (prune dryRun preserves keep counts),
// PR2 (prune refuses to touch anything younger than minAgeMs).

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listSnapshots } from '../lib/list.mjs';
import { pruneSnapshots } from '../lib/prune.mjs';

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-list-prune-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeFakeSnapshot(snapshotsDir, opts) {
  const dir = path.join(snapshotsDir, opts.id);
  await mkdir(dir, { recursive: true });
  const dbBuf = Buffer.alloc(opts.dbSize ?? 64, 0xab);
  const fsBuf = Buffer.alloc(opts.fsSize ?? 128, 0xcd);
  const dbPath = path.join(dir, 'pglite-datadir.tar.gz');
  const fsPath = path.join(dir, 'instance-fs.tar.gz');
  await writeFile(dbPath, dbBuf);
  await writeFile(fsPath, fsBuf);
  // We don't sha256 — listSnapshots does not verify, only reads sizes.
  const manifest = {
    schemaVersion: 1,
    snapshotId: opts.id,
    createdAt: opts.createdAt,
    createdBy: { user: 'eric', host: 'ERIC-WIN11' },
    paperclipVersion: '0.41.2',
    paperclipMode: 'pglite',
    paperclipHome: '/home/eric/.paperclip',
    paperclipInstanceId: 'default',
    installedPlugins: [],
    lockfileSha256: null,
    artifacts: {
      db: { path: 'pglite-datadir.tar.gz', format: 'pglite-datadir-gzip', sha256: 'x'.repeat(64), sizeBytes: dbBuf.length },
      fs: { path: 'instance-fs.tar.gz', format: 'tar+gzip', sha256: 'y'.repeat(64), sizeBytes: fsBuf.length }
    },
    verifiedAt: opts.verifiedAt ?? null,
    verifiedSmokeChecks: opts.verifiedAt ? ['health', 'issues'] : null,
    gateMaxAgeMinutes: 15
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Set mtime so prune sees the right age. utimes is a no-op for the
  // listSnapshots path because we read createdAt from manifest, but
  // setting it makes the test intent clear.
  if (opts.mtimeMs !== undefined) {
    const t = opts.mtimeMs / 1000;
    await utimes(dir, t, t);
  }
}

// Hand-rolled snapshot id of `${ageHoursAgo} hours ago` — keeps the regex
// happy while letting us simulate ages without leaning on the system clock.
function idFromOffsetHours(hoursAgo, baseMs = Date.now()) {
  const d = new Date(baseMs - hoursAgo * 3600_000);
  // 2026-05-08T14:32:17.043Z → 2026-05-08T14-32-17Z
  return d.toISOString().replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
}

function isoFromOffsetHours(hoursAgo, baseMs = Date.now()) {
  return new Date(baseMs - hoursAgo * 3600_000).toISOString();
}

test('L1 — listSnapshots returns 3 entries newest-first; verified status preserved', async () => {
  await withTmpDir(async (snaps) => {
    const baseMs = Date.now();
    // Three snapshots: 5h, 2h, 1h ago. The 2h one is verified.
    const ids = [
      { hours: 5, verifiedAt: null },
      { hours: 2, verifiedAt: new Date(baseMs - 1.5 * 3600_000).toISOString() },
      { hours: 1, verifiedAt: null }
    ];
    for (const s of ids) {
      const id = idFromOffsetHours(s.hours, baseMs);
      const createdAt = isoFromOffsetHours(s.hours, baseMs);
      await makeFakeSnapshot(snaps, { id, createdAt, verifiedAt: s.verifiedAt });
    }
    const list = await listSnapshots(snaps);
    assert.equal(list.length, 3);
    // Sorted newest-first → 1h is index 0, 2h is index 1, 5h is index 2.
    assert.ok(list[0].createdAt > list[1].createdAt);
    assert.ok(list[1].createdAt > list[2].createdAt);
    // The 2h-ago snapshot is verified; the others are not.
    const verifiedCount = list.filter((s) => s.verifiedAt !== null).length;
    assert.equal(verifiedCount, 1);
    // sizeBytes is db + fs.
    for (const s of list) assert.ok(s.sizeBytes > 0);
  });
});

test('PR1 — prune dryRun keeps newest 1 verified + newest 1 unverified, deletes the rest', async () => {
  await withTmpDir(async (snaps) => {
    // 4 snapshots all >24h old: 2 verified (48h, 30h), 2 unverified (50h, 25h).
    // With keep=1, keepVerified=1: keep newest verified (30h) + newest unverified (25h);
    // delete: 48h (verified), 50h (unverified).
    const baseMs = Date.now();
    const cases = [
      { hours: 50, verified: false },
      { hours: 48, verified: true },
      { hours: 30, verified: true },
      { hours: 25, verified: false }
    ];
    for (const c of cases) {
      const id = idFromOffsetHours(c.hours, baseMs);
      const createdAt = isoFromOffsetHours(c.hours, baseMs);
      const verifiedAt = c.verified ? isoFromOffsetHours(c.hours - 0.1, baseMs) : null;
      await makeFakeSnapshot(snaps, { id, createdAt, verifiedAt });
    }
    const plan = await pruneSnapshots(snaps, { keep: 1, keepVerified: 1, dryRun: true });
    assert.equal(plan.toKeep.length, 2, `keep should be 2, got ${JSON.stringify(plan.toKeep.map((s) => s.id))}`);
    assert.equal(plan.toDelete.length, 2, `delete should be 2, got ${JSON.stringify(plan.toDelete.map((s) => s.id))}`);
    const keepIds = new Set(plan.toKeep.map((s) => s.id));
    const deleteIds = new Set(plan.toDelete.map((s) => s.id));
    // newest verified (30h) is kept
    assert.ok(keepIds.has(idFromOffsetHours(30, baseMs)));
    // newest unverified (25h) is kept
    assert.ok(keepIds.has(idFromOffsetHours(25, baseMs)));
    // older verified (48h) is deleted
    assert.ok(deleteIds.has(idFromOffsetHours(48, baseMs)));
    // older unverified (50h) is deleted
    assert.ok(deleteIds.has(idFromOffsetHours(50, baseMs)));
  });
});

test('PR2 — prune refuses to delete any snapshot younger than minAgeMs (default 24h)', async () => {
  await withTmpDir(async (snaps) => {
    // One snapshot 1h old; even with keep=0 keepVerified=0, it must NOT be deleted.
    const baseMs = Date.now();
    const id = idFromOffsetHours(1, baseMs);
    const createdAt = isoFromOffsetHours(1, baseMs);
    await makeFakeSnapshot(snaps, { id, createdAt, verifiedAt: null });
    const plan = await pruneSnapshots(snaps, { keep: 0, keepVerified: 0, dryRun: true });
    assert.equal(plan.toDelete.length, 0);
    assert.equal(plan.toKeep.length, 1);
    assert.equal(plan.toKeep[0].id, id);
  });
});
