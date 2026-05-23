// test/ci/check-a11y.test.mjs
//
// Plan 05-02 (DIST-05) — pins the check-a11y.mjs static analyzer at GREEN
// against the current source. CI's a11y-check workflow runs the script
// directly; this test ensures local TDD catches a violation before it
// reaches CI.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'scripts', 'check-a11y.mjs');

test('check-a11y: src/ui/**/*.tsx is GREEN against the static a11y rules', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    console.error('check-a11y output:\n' + (r.stdout ?? '') + '\n' + (r.stderr ?? ''));
  }
  assert.equal(r.status, 0, 'check-a11y must exit 0 — see stderr for any violation list');
});
