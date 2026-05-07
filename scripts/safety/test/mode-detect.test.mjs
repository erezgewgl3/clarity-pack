// scripts/safety/test/mode-detect.test.mjs
//
// Covers D1–D4: mode detection from fixture configs + ENOENT-aware hint.

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DetectError, detectMode } from '../lib/mode-detect.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('D1 — pglite fixture returns "pglite"', async () => {
  const got = await detectMode(path.join(FIXTURES, 'paperclip-pglite-config.json'));
  assert.equal(got, 'pglite');
});

test('D2 — postgres fixture returns "postgres"', async () => {
  const got = await detectMode(path.join(FIXTURES, 'paperclip-postgres-config.json'));
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
