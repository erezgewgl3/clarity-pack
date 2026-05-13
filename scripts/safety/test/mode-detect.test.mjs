// scripts/safety/test/mode-detect.test.mjs
//
// Covers D1–D4: mode detection from fixture configs + ENOENT-aware hint.

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DetectError, detectMode, detectConnectionConfig } from '../lib/mode-detect.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('D1 — pglite fixture returns "pglite"', async () => {
  const got = await detectMode(path.join(FIXTURES, 'paperclip-pglite-config.json'));
  assert.equal(got, 'pglite');
});

test('D2 — postgres fixture returns "postgres"', async () => {
  const got = await detectMode(path.join(FIXTURES, 'paperclip-postgres-config.json'));
  assert.equal(got, 'postgres');
});

test('D2b — embedded-postgres fixture returns "postgres" (Paperclip dev mode; same wire protocol as hosted)', async () => {
  const got = await detectMode(path.join(FIXTURES, 'paperclip-embedded-postgres-config.json'));
  assert.equal(got, 'postgres');
});

test('D3 — malformed fixture throws DetectError with --mode hint', async () => {
  await assert.rejects(
    () => detectMode(path.join(FIXTURES, 'paperclip-malformed-config.json')),
    (err) => {
      assert.ok(err instanceof DetectError, 'error should be a DetectError');
      assert.match(err.hint, /set --mode=pglite\|postgres explicitly/);
      return true;
    }
  );
});

test('D4 — nonexistent path throws DetectError with ENOENT-aware hint, not raw fs error', async () => {
  await assert.rejects(
    () => detectMode(path.join(FIXTURES, 'this-config-does-not-exist.json')),
    (err) => {
      assert.ok(err instanceof DetectError, 'error should be a DetectError');
      assert.doesNotMatch(err.message, /ENOENT/);
      assert.match(err.hint, /PAPERCLIP_HOME/);
      return true;
    }
  );
});

// Plan 01-05 Task 2: detectConnectionConfig — derives dbUrl alongside mode.

test('D5 — embedded-postgres fixture → derived dbUrl with hardcoded paperclip:paperclip creds and the configured port', async () => {
  const got = await detectConnectionConfig(
    path.join(FIXTURES, 'paperclip-embedded-postgres-config.json'),
  );
  assert.equal(got.mode, 'postgres');
  assert.equal(got.dbUrl, 'postgresql://paperclip:paperclip@127.0.0.1:54329/paperclip');
  assert.equal(got.source, 'embedded-postgres-derived');
});

test('D6 — postgres-with-connectionString fixture → dbUrl is the connectionString verbatim', async () => {
  const got = await detectConnectionConfig(
    path.join(FIXTURES, 'paperclip-postgres-config.json'),
  );
  assert.equal(got.mode, 'postgres');
  assert.equal(got.dbUrl, 'postgresql://paperclip@localhost:5432/paperclip');
  assert.equal(got.source, 'config.connectionString');
});

test('D7 — pglite fixture → dbUrl is null with explicit source label', async () => {
  const got = await detectConnectionConfig(
    path.join(FIXTURES, 'paperclip-pglite-config.json'),
  );
  assert.equal(got.mode, 'pglite');
  assert.equal(got.dbUrl, null);
  assert.equal(got.source, 'pglite-no-url');
});

test('D8 — embedded-postgres without embeddedPostgresPort → DetectError with --db-url hint', async () => {
  await assert.rejects(
    () =>
      detectConnectionConfig(
        path.join(FIXTURES, 'paperclip-embedded-postgres-no-port-config.json'),
      ),
    (err) => {
      assert.ok(err instanceof DetectError, 'expected DetectError');
      assert.match(err.hint, /--db-url/);
      return true;
    },
  );
});
