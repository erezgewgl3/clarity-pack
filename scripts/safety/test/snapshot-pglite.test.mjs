// scripts/safety/test/snapshot-pglite.test.mjs
//
// PGlite end-to-end tests:
//   S1 — full snapshot in pglite mode produces manifest + db artifact + fs tar; sha256 matches.
//   S2 — fs tar excludes node_modules/ and .cache/; includes config.json, sample.txt,
//        master.key, plugins/package.json, plugins/pnpm-lock.yaml.
//   S3 — excludeSecrets:true omits secrets/ from the tar; manifest.artifacts.fs.excludeSecrets:true.
//   S1-cache-A — claude-prompt-cache/ excluded by default (defect 2 from 2026-05-12 drill).
//   S1-cache-B — includeCaches:true re-enables capture.
//   S1-cache-C — nested claude-prompt-cache/ at any depth is excluded.
//   S1-cache-D — substring matches (claude-prompt-caches-archive, claude-prompt-cache.md) NOT excluded.

import { strict as assert } from 'node:assert';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as tar from 'tar';

import { sha256OfFile, readManifest } from '../lib/manifest.mjs';
import { snapshot } from '../lib/snapshot.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clarity-safety-pglite-'));
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

async function listTarEntries(tgzPath) {
  const entries = [];
  await tar.t({
    file: tgzPath,
    onentry: (entry) => entries.push(entry.path)
  });
  return entries;
}

async function seedPGlite(home) {
  // Run a 1-row write into the PGlite datadir under
  //   <home>/instances/default/db/
  // then close so the WASM lock is released before snapshot runs.
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.join(home, 'instances', 'default', 'db');
  const db = new PGlite(dataDir);
  await db.exec("CREATE TABLE IF NOT EXISTS canary (id integer PRIMARY KEY, label text)");
  await db.exec("INSERT INTO canary VALUES (1, 'snapshot-test') ON CONFLICT (id) DO NOTHING");
  await db.close();
}

test('S1 — pglite-mode snapshot writes manifest + pglite-datadir.tar.gz + instance-fs.tar.gz; sha256 matches', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
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
    assert.equal(manifest.artifacts.db.format, 'pglite-datadir-gzip');
    const dbAbs = path.join(outDir, manifest.artifacts.db.path);
    const fsAbs = path.join(outDir, manifest.artifacts.fs.path);
    assert.equal(await sha256OfFile(dbAbs), manifest.artifacts.db.sha256);
    assert.equal(await sha256OfFile(fsAbs), manifest.artifacts.fs.sha256);
    assert.equal(manifest.artifacts.db.path, 'pglite-datadir.tar.gz');
    assert.equal(manifest.artifacts.fs.path, 'instance-fs.tar.gz');
  });
});

test('S2 — fs tar excludes node_modules and .cache; includes the expected fixture files', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));

    // Must NOT contain regenerable junk.
    for (const e of entries) {
      assert.ok(!/\/plugins\/node_modules\//.test(e), `unexpected node_modules entry: ${e}`);
      assert.ok(!/\/plugins\/\.cache\//.test(e), `unexpected .cache entry: ${e}`);
    }
    // Must contain the expected fixture files.
    const expected = [
      'instances/default/config.json',
      'instances/default/data/storage/sample.txt',
      'instances/default/secrets/master.key',
      'instances/default/plugins/package.json',
      'instances/default/plugins/pnpm-lock.yaml'
    ];
    for (const want of expected) {
      assert.ok(
        entries.includes(want) || entries.includes(want + '\n'),
        `missing tar entry ${want}\nentries:\n${entries.join('\n')}`
      );
    }
  });
});

test('S3 — excludeSecrets:true omits secrets/master.key and is recorded in manifest', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      excludeSecrets: true,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));
    for (const e of entries) {
      assert.ok(!/\/secrets\//.test(e), `unexpected secrets entry: ${e}`);
    }
    const manifest = await readManifest(outDir);
    assert.equal(manifest.artifacts.fs.excludeSecrets, true);
  });
});

// ---------------------------------------------------------------------------
// Cache-directory exclusion (defect 2 from the 2026-05-12 rehearsal drill).
// claude-prompt-cache/ directories contain symlinks that point outside the
// instance tree (Claude Code skill caches symlink into the user's home dir).
// They are regenerable cache content and must be excluded from snapshots
// by default; an opt-in `includeCaches` re-enables capture.
// ---------------------------------------------------------------------------

async function seedCacheDirs(home, opts = {}) {
  // Adds a `claude-prompt-cache/` directory inside the instance and (when
  // opts.nested) a deeply-nested one inside plugins/. Sibling names that
  // are NOT segment-exact matches are added to exercise the precision of
  // the predicate.
  const inst = path.join(home, 'instances', 'default');
  await mkdir(path.join(inst, 'claude-prompt-cache'), { recursive: true });
  await writeFile(path.join(inst, 'claude-prompt-cache', 'entry.json'), '{"cached": true}');
  if (opts.nested) {
    const nested = path.join(inst, 'plugins', 'kitchen-sink', 'claude-prompt-cache');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'something.json'), '{}');
  }
  if (opts.lookalikes) {
    // Directory whose name is a SUPERSET of the exclude token — must
    // remain captured.
    await mkdir(path.join(inst, 'claude-prompt-caches-archive'), { recursive: true });
    await writeFile(path.join(inst, 'claude-prompt-caches-archive', 'keep.md'), 'keep me');
    // File at instance root whose basename is a substring match — must
    // remain captured (the predicate matches *segments*, not arbitrary
    // path components).
    await writeFile(path.join(inst, 'claude-prompt-cache.md'), 'sibling file, not a dir');
  }
}

test('S1-cache-A — claude-prompt-cache/ at instance root is excluded by default', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    await seedCacheDirs(home);
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));
    for (const e of entries) {
      assert.ok(
        !/(^|\/)claude-prompt-cache(\/|$)/.test(e),
        `unexpected claude-prompt-cache entry: ${e}`
      );
    }
    // Ordinary fixture entries are still present.
    assert.ok(
      entries.includes('instances/default/config.json'),
      `expected config.json in entries:\n${entries.join('\n')}`
    );
  });
});

test('S1-cache-B — includeCaches:true re-enables capture of claude-prompt-cache/', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    await seedCacheDirs(home);
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      includeCaches: true,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));
    // The opt-in re-enables capture.
    const hasCacheEntry = entries.some((e) =>
      /(^|\/)claude-prompt-cache(\/|$)/.test(e)
    );
    assert.ok(
      hasCacheEntry,
      `expected at least one claude-prompt-cache entry with includeCaches:true. entries:\n${entries.join('\n')}`
    );
  });
});

test('S1-cache-C — nested claude-prompt-cache/ at any depth is excluded by default', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    await seedCacheDirs(home, { nested: true });
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));
    // Neither the root-level nor the plugins/kitchen-sink/claude-prompt-cache
    // dir survives.
    for (const e of entries) {
      assert.ok(
        !/(^|\/)claude-prompt-cache(\/|$)/.test(e),
        `unexpected claude-prompt-cache entry at any depth: ${e}`
      );
    }
  });
});

test('S1-cache-D — segment-exact predicate does not over-exclude lookalike names', async () => {
  await withTmp(async (root) => {
    const home = path.join(root, 'home');
    await copyFakeInstance(home);
    await seedPGlite(home);
    await seedCacheDirs(home, { lookalikes: true });
    const outDir = path.join(root, 'snap');
    await snapshot({
      home,
      instanceId: 'default',
      mode: 'pglite',
      outDir,
      _paperclipCli: stubCli,
      silent: true
    });
    const entries = await listTarEntries(path.join(outDir, 'instance-fs.tar.gz'));

    // The exact-match exclusion still fires for the seeded
    // claude-prompt-cache/ dir.
    for (const e of entries) {
      assert.ok(
        !/(^|\/)claude-prompt-cache(\/|$)/.test(e),
        `unexpected claude-prompt-cache entry: ${e}`
      );
    }
    // But lookalikes are kept (substring is not a match for the
    // segment-exact predicate).
    const hasArchive = entries.some((e) =>
      e.includes('claude-prompt-caches-archive/keep.md')
    );
    const hasSiblingFile = entries.some((e) =>
      e === 'instances/default/claude-prompt-cache.md' ||
      e === 'instances/default/claude-prompt-cache.md\n'
    );
    assert.ok(hasArchive, `expected claude-prompt-caches-archive/keep.md present. entries:\n${entries.join('\n')}`);
    assert.ok(hasSiblingFile, `expected claude-prompt-cache.md (file, not dir) present. entries:\n${entries.join('\n')}`);
  });
});
