// test/ci/uninstall-runbook.test.mjs
//
// Plan 05-02 (COEXIST-05) — pins the 10-uninstall-runbook coexistence
// check at PASS. Mirrors the CI gate locally for TDD.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  HERE,
  '..',
  '..',
  'scripts',
  'coexistence-checks',
  '10-uninstall-runbook.mjs',
);

test('coexistence: 10-uninstall-runbook passes', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    console.error('10-uninstall-runbook output:\n' + (r.stdout ?? '') + '\n' + (r.stderr ?? ''));
  }
  assert.equal(r.status, 0, '10-uninstall-runbook must exit 0 — see stderr for failures');
});
