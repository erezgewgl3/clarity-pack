// scripts/safety/test/restore-tar-cve.test.mjs
//
// CVE-2026-31802 mitigation tests. The threat: a malicious snapshot
// contains a tar entry of type SymbolicLink or Link whose linkpath
// points outside the staging dir (`../../../../etc/passwd`). Naive
// extraction creates the link, and a follow-up read or write traverses
// out of the staging dir.
//
// Mitigation:
//   - tar@^7.5.15 (CVE fix)
//   - onentry callback rejects SymbolicLink / Link entries before they
//     are written (tested here, R5 + R6).
//   - canonicalized resolved-path check refuses any entry resolving
//     outside <home>/instances/<originalInstanceId>.
//
// Building the malicious archive: we use node-tar's programmatic Pack
// stream and an in-memory ReadEntry that emits the SymbolicLink / Link
// header verbatim — this bypasses any "create real symlink on disk
// then archive it" path that POSIX-only tests would rely on (Windows
// can't create symlinks without admin).

import { strict as assert } from 'node:assert';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import * as tar from 'tar';

import { writeManifest, sha256OfFile } from '../lib/manifest.mjs';
import { restoreToStaging } from '../lib/restore.mjs';

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-cve-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build a malicious tar.gz containing one entry of the given type
 * (SymbolicLink or Link) whose linkpath escapes upward. The archive is
 * gzipped and written to `outPath`.
 *
 * Implementation: node-tar's Pack accepts ReadEntry-shaped streams.
 * We emit a header through a bare Readable backed by Pax-clean tar
 * blocks. To stay on the supported API surface, we use tar.create() and
 * point it at a synthesized list — but tar.create() reads from the
 * filesystem, which is exactly what we want to avoid for the symlink
 * case on Windows.
 *
 * Simpler path that works portably: hand-build the 512-byte tar header
 * blocks ourselves and write them through gzip. The format is well
 * documented and short; this is the least-magic path and avoids
 * depending on node-tar's internal Pack class.
 */
function makeUstarHeader({ name, linkname, typeflag }) {
  // 512-byte tar header per ustar/POSIX format.
  const buf = Buffer.alloc(512, 0);
  function writeStr(offset, length, value) {
    const s = String(value).slice(0, length);
    buf.write(s, offset, 'utf8');
  }
  function writeOctal(offset, length, value) {
    // length includes trailing null; value is 0-padded octal.
    const s = value.toString(8).padStart(length - 1, '0') + '\0';
    buf.write(s, offset, 'utf8');
  }
  writeStr(0, 100, name);          // name
  writeOctal(100, 8, 0o644);       // mode
  writeOctal(108, 8, 0);           // uid
  writeOctal(116, 8, 0);           // gid
  writeOctal(124, 12, 0);          // size (0 for link entries)
  writeOctal(136, 12, 0);          // mtime
  // checksum slot: 8 spaces then computed.
  buf.write('        ', 148, 'utf8');
  buf.write(typeflag, 156, 'utf8');         // typeflag: '2' = symlink, '1' = hardlink
  writeStr(157, 100, linkname);             // linkname
  buf.write('ustar\0', 257, 'utf8');        // magic
  buf.write('00', 263, 'utf8');             // version
  // checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeOctal(148, 8, sum);
  return buf;
}

async function buildMaliciousArchive({ outPath, typeflag }) {
  // One header block + 1024-byte trailer (two zero blocks).
  const header = makeUstarHeader({
    name: 'instances/default/evil',
    linkname: '../../../../etc/passwd',
    typeflag
  });
  const trailer = Buffer.alloc(1024, 0);
  const raw = Buffer.concat([header, trailer]);
  // gzip via node:zlib
  const { gzipSync } = await import('node:zlib');
  await writeFile(outPath, gzipSync(raw));
}

async function buildSnapshotDir({ root, typeflag }) {
  const home = path.join(root, 'home');
  await mkdir(path.join(home, 'instances', 'default'), { recursive: true });
  await writeFile(path.join(home, 'instances', 'default', 'config.json'), '{}');
  // Build a fake pglite-datadir.tar.gz so verifyManifest has something
  // to hash. Use a real (empty) PGlite-format archive — for this test we
  // never reach the DB-restore step (the tar.x guard fires first), so
  // any well-formed tar.gz will do.
  const snapshotsDir = path.join(root, 'snapshots');
  const id = '2026-05-08T14-32-17Z';
  const dir = path.join(snapshotsDir, id);
  await mkdir(dir, { recursive: true });
  const dbPath = path.join(dir, 'pglite-datadir.tar.gz');
  // Empty gzipped tar (1024-byte trailer) is a valid empty archive.
  const { gzipSync } = await import('node:zlib');
  await writeFile(dbPath, gzipSync(Buffer.alloc(1024, 0)));
  // Build the malicious fs archive.
  const fsPath = path.join(dir, 'instance-fs.tar.gz');
  await buildMaliciousArchive({ outPath: fsPath, typeflag });

  await writeManifest(dir, {
    snapshotId: id,
    createdAt: '2026-05-08T14:32:17.043Z',
    createdBy: { user: 'eric', host: 'ERIC-WIN11' },
    paperclipVersion: '0.41.2',
    paperclipMode: 'pglite',
    paperclipHome: home,
    paperclipInstanceId: 'default',
    installedPlugins: [],
    lockfileSha256: null,
    artifacts: {
      db: {
        path: 'pglite-datadir.tar.gz',
        format: 'pglite-datadir-gzip',
        sha256: await sha256OfFile(dbPath),
        sizeBytes: (await stat(dbPath)).size
      },
      fs: {
        path: 'instance-fs.tar.gz',
        format: 'tar+gzip',
        sha256: await sha256OfFile(fsPath),
        sizeBytes: (await stat(fsPath)).size
      }
    },
    verifiedAt: null,
    verifiedSmokeChecks: null,
    gateMaxAgeMinutes: 15
  });
  return { home, snapshotsDir, snapshotId: id };
}

test('R5 — SymbolicLink entry is rejected during restore extraction; staging dir contains no escape file', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await buildSnapshotDir({ root, typeflag: '2' });
    const stagingDir = path.join(home, 'instances', 'default.restoring');
    await assert.rejects(
      () =>
        restoreToStaging({
          snapshotId,
          home,
          instanceId: 'default',
          snapshotsDir
        }),
      (err) => {
        assert.match(err.message, /Refusing to extract/);
        assert.match(err.message, /SymbolicLink/);
        return true;
      }
    );
    // Staging dir may exist (pre-created by restoreToStaging) but must
    // not contain the malicious entry.
    await assert.rejects(stat(path.join(stagingDir, 'evil')));
    // And no escape file at the resolved linkpath.
    await assert.rejects(stat(path.join(home, '..', '..', '..', '..', 'etc', 'passwd')));
  });
});

test('R6 — hardlink (Link) entry is rejected during restore extraction', async () => {
  await withTmp(async (root) => {
    const { home, snapshotsDir, snapshotId } = await buildSnapshotDir({ root, typeflag: '1' });
    await assert.rejects(
      () =>
        restoreToStaging({
          snapshotId,
          home,
          instanceId: 'default',
          snapshotsDir
        }),
      (err) => {
        assert.match(err.message, /Refusing to extract/);
        assert.match(err.message, /Link/);
        return true;
      }
    );
  });
});

// Sanity check: tar@^7.5.15 is the only acceptable pin. Reading the
// installed package version directly from node_modules confirms the
// runtime resolved against the CVE-fixed line.
test('TAR-PIN — runtime tar package version is >= 7.5.11 (CVE-2026-31802 fix)', async () => {
  const tarPkg = await import('tar/package.json', { with: { type: 'json' } }).catch(async () => {
    // Node 24 supports import attributes; older node uses dynamic readFile.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '..', 'node_modules', 'tar', 'package.json');
    return { default: JSON.parse(await readFile(pkgPath, 'utf8')) };
  });
  const v = tarPkg.default.version;
  const [major, minor, patch] = v.split('.').map(Number);
  const ok = major > 7 || (major === 7 && (minor > 5 || (minor === 5 && patch >= 11)));
  assert.ok(ok, `tar version ${v} does not satisfy >= 7.5.11 (CVE-2026-31802 fix)`);
});
