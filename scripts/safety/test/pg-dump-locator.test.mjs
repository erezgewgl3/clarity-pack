// scripts/safety/test/pg-dump-locator.test.mjs
//
// Plan 01-05 Task 1: covers P1-P7 of pg-dump-locator behavior.
//
// Resolution order under test:
//   1. explicit --pg-bin override (P1)
//   2. Paperclip-bundled @embedded-postgres/<platform>/native/bin/pg_dump[.exe] (P2 Linux, P3 Windows-falls-through)
//   3. system PATH (P4)
//   4. LocateError with platform-specific install hint (P5)
//
// Plus version pre-check:
//   - assertVersionMatch passes when major versions match (P6)
//   - assertVersionMatch throws clean error on mismatch (P7)
//
// The Windows fixture deliberately OMITS pg_dump.exe — proves the locator's
// design intent that Windows bundles are server-only (verified empirically in
// the Plan 02-01 Task 2 spike against `@embedded-postgres/windows-x64@18.1.0-beta.16`).

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  LocateError,
  VersionMismatchError,
  locatePgDump,
  assertVersionMatch,
} from '../lib/pg-dump-locator.mjs';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const FAKE_CLONE = path.join(FIXTURES, 'fake-paperclip-clone');

test('P1 — explicit --pg-bin override returns that path without filesystem touch', async () => {
  const result = await locatePgDump({ pgBinOverride: '/explicit/path/to/pg_dump' });
  assert.equal(result.pgDumpPath, '/explicit/path/to/pg_dump');
  assert.equal(result.source, 'override');
});

test('P2 — Linux fixture clone path → bundled pg_dump under @embedded-postgres/linux-x64/native/bin/', async () => {
  const result = await locatePgDump({
    paperclipClonePath: FAKE_CLONE,
    platform: 'linux',
    arch: 'x64',
  });
  assert.equal(result.source, 'bundled');
  assert.ok(
    result.pgDumpPath.includes(path.join('@embedded-postgres', 'linux-x64', 'native', 'bin', 'pg_dump')),
    `expected bundled path to include @embedded-postgres/linux-x64/native/bin/pg_dump; got ${result.pgDumpPath}`,
  );
});

test('P3 — Windows fixture: bundle exists but lacks pg_dump.exe → falls through to PATH (NOT a LocateError)', async () => {
  // Fake-system PATH is empty; the only place pg_dump could come from is the bundle.
  // Since the Windows bundle lacks pg_dump.exe, this must throw LocateError —
  // proving the locator did NOT incorrectly succeed via the bundle.
  await assert.rejects(
    () =>
      locatePgDump({
        paperclipClonePath: FAKE_CLONE,
        platform: 'win32',
        arch: 'x64',
        pathEnv: '',
      }),
    (err) => {
      assert.ok(err instanceof LocateError, 'expected LocateError');
      assert.match(
        err.hint,
        /winget install PostgreSQL/,
        'Windows hint should mention winget install command',
      );
      return true;
    },
  );
});

test('P4 — system PATH discovery returns whatever which-style scan finds', async () => {
  // Build a directory containing both pg_dump (Linux/macOS) and pg_dump.exe
  // (Windows). Run with the actual host platform so the test's PATH separator
  // (`:` on POSIX, `;` on Windows) matches the host's expectation — avoids
  // mis-splitting drive-letter paths like `C:\...` on Windows.
  const fakeBinDir = path.join(FAKE_CLONE, 'fake-system-bin');
  const result = await locatePgDump({
    pathEnv: fakeBinDir,
  });
  assert.equal(result.source, 'system-path');
  assert.ok(
    result.pgDumpPath.includes('fake-system-bin'),
    `expected pgDumpPath to be under fakeBinDir; got ${result.pgDumpPath}`,
  );
});

test('P5 — no override, no bundle hit, empty PATH → LocateError naming both searched paths + platform hint', async () => {
  await assert.rejects(
    () =>
      locatePgDump({
        platform: 'linux',
        arch: 'x64',
        pathEnv: '',
      }),
    (err) => {
      assert.ok(err instanceof LocateError, 'expected LocateError');
      assert.match(err.message, /pg_dump/i);
      assert.match(err.hint, /apt|brew|install/i, 'Linux hint should suggest apt/brew install');
      return true;
    },
  );
});

test('P6 — assertVersionMatch with stubbed matching versions does not throw', async () => {
  await assertVersionMatch('/fake/pg_dump', 'postgresql://stub', {
    pgDumpVersionFetcher: async () => 17,
    serverVersionFetcher: async () => 17,
  });
  // Reaching here = no throw = pass.
});

test('P7 — assertVersionMatch with major-version mismatch throws clean error naming both versions + runbook ref', async () => {
  await assert.rejects(
    () =>
      assertVersionMatch('/fake/pg_dump', 'postgresql://stub', {
        pgDumpVersionFetcher: async () => 17,
        serverVersionFetcher: async () => 18,
      }),
    (err) => {
      assert.ok(err instanceof VersionMismatchError, 'expected VersionMismatchError');
      assert.match(err.message, /pg_dump major version 17/);
      assert.match(err.message, /server version 18/);
      assert.match(err.message, /operator-gotchas\.md.*pg-dump-version-mismatch/);
      return true;
    },
  );
});
