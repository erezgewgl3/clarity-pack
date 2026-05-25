// test/ci/ui-bundle-size.test.mjs
//
// Plan 05-04 Task 3 (DIST-04) — pins scripts/check-ui-bundle-size.mjs at
// GREEN against the current build. Mirrors test/ci/check-a11y.test.mjs.
//
// The script self-skips if dist/ui/index.js is absent (local pre-build
// runs), so this test is meaningful in CI (which always builds first) and
// a no-op in pre-build dev loops. The check is GREEN when:
//
//   (1) dist/ui/index.js does not exist (skip), OR
//   (2) The bundle is ≤ UI_BUNDLE_BYTES_CEILING (650 kB) AND contains
//       no SheetJS sentinels.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'scripts', 'check-ui-bundle-size.mjs');

test('check-ui-bundle-size: dist/ui bundle within ceiling + no SheetJS leak', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    console.error('check-ui-bundle-size output:\n' + (r.stdout ?? '') + '\n' + (r.stderr ?? ''));
  }
  assert.equal(r.status, 0, 'check-ui-bundle-size must exit 0');
});
