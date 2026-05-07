// scripts/safety/test/snapshot-postgres-mock.test.mjs
//
// Postgres-mode tests that NEVER spawn real pg_dump. The snapshot CLI's
// _spawn injection point is exercised with a stub that:
//   • records argv + env it was called with,
//   • writes a fake postgres.dump file,
//   • emits exit code 0 (or ENOENT for the install-hint test).
//
// S5 — argv shape locked: --format=custom --compress=zstd:6 --no-owner
//      --no-privileges --file=<outDir>/postgres.dump --dbname=<dsn>
//      AND PGPASSWORD env carries the password (Security Domain T2).
// S6 — pg_dump missing → throws with platform-specific install hint.

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { snapshot } from '../lib/snapshot.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-pg-'));
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
    return [];
  }
};

/**
 * Build a stub spawn that synthesises a pg_dump child process. Records
 * the argv + env it was called with; writes a fake postgres.dump (32
 * bytes of 0xab plus `PGDMP` magic prefix); emits exit code 0.
 */
function makePgDumpSpawnStub(captured) {
  return (cmd, args, opts) => {
    captured.cmd = cmd;
    captured.args = args.slice();
    captured.env = opts && opts.env ? { ...opts.env } : {};
    const child = new EventEmitter();
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    // Find --file=<path> in argv, write a fake dump there.
    const fileFlag = args.find((a) => a.startsWith('--file='));
    queueMicrotask(async () => {
      if (fileFlag) {
        const target = fileFlag.slice('--file='.length);
        const buf = Buffer.alloc(64, 0xab);
        Buffer.from('PGDMP', 'utf8').copy(buf, 0);
        await writeFile(target, buf);
      }
      child.emit('close', 0);
    });
    return child;
  };
}

test('S5 — pg_dump argv is exactly [--format=custom, --compress=zstd:6, --no-owner, --no-privileges, --file=, --dbname=]; PGPASSWORD via env, never argv', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    const captured = {};
    const spawnStub = makePgDumpSpawnStub(captured);
    const dbUrl = 'postgresql://paperclip:s3cr3t@localhost:5432/paperclip';
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'postgres',
      outDir,
      dbUrl,
      _spawn: spawnStub,
      _paperclipCli: stubCli,
      silent: true
    });
    assert.equal(captured.cmd, 'pg_dump');
    // First five argv slots are locked verbatim by the plan.
    assert.equal(captured.args[0], '--format=custom');
    assert.equal(captured.args[1], '--compress=zstd:6');
    assert.equal(captured.args[2], '--no-owner');
    assert.equal(captured.args[3], '--no-privileges');
    assert.equal(captured.args[4], `--file=${path.join(outDir, 'postgres.dump')}`);
    // The 6th slot is --dbname=<sanitized DSN>. Sanitization MUST strip
    // the password from the DSN — Security Domain T2 (argv is visible to
    // `ps`).
    assert.match(captured.args[5], /^--dbname=postgresql:\/\//);
    assert.equal(captured.args.length, 6);

    // Argv must NEVER contain --password or the password literal.
    for (const a of captured.args) {
      assert.ok(!/--password/.test(a), `argv leaked --password flag: ${a}`);
      assert.ok(!/s3cr3t/.test(a), `argv leaked password literal: ${a}`);
    }
    // PGPASSWORD must be present in env, exactly the URL's password.
    assert.equal(captured.env.PGPASSWORD, 's3cr3t');
    // PGUSER mirrors the URL's username so libpq still authenticates as
    // the right role even though the DSN's userinfo was stripped.
    assert.equal(captured.env.PGUSER, 'paperclip');
  });
});

test('S6 — pg_dump ENOENT throws with platform-specific install hint', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    const outDir = path.join(root, 'snap');
    const enoentSpawn = (_cmd, _args, _opts) => {
      const err = new Error('spawn pg_dump ENOENT');
      err.code = 'ENOENT';
      throw err;
    };
    await assert.rejects(
      () =>
        snapshot({
          home,
          instanceId: 'default',
          mode: 'postgres',
          outDir,
          dbUrl: 'postgresql://u@h:5432/p',
          _spawn: enoentSpawn,
          _paperclipCli: stubCli,
          silent: true
        }),
      (err) => {
        assert.match(err.message, /pg_dump.*not on PATH/);
        // Platform-specific hint must be present.
        if (process.platform === 'win32') {
          assert.match(err.message, /winget install PostgreSQL\.PostgreSQL\.17/);
        } else if (process.platform === 'darwin') {
          assert.match(err.message, /brew install postgresql@17/);
        } else {
          assert.match(err.message, /postgresql-client-17|postgresql17/);
        }
        return true;
      }
    );
  });
});
