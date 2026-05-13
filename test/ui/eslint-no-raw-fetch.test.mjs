// test/ui/eslint-no-raw-fetch.test.mjs
//
// Plan 02-02 Task 2 — drives the eslint binary as a subprocess against the
// three fixtures: ui-raw-fetch (must FAIL), ui-raw-anchor (must FAIL on the
// anchor rule), ui-clean (must PASS). Direct binary invocation avoids the
// `eslint --rulesdir` deprecation + sidesteps eslint's Node-API churn between
// 8/9/10 (the rule plugin is registered via eslint.config.js, so the
// subprocess just uses the project's flat config).

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function runEslint(target) {
  return spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['eslint', target],
    { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
  );
}

test('clarity/no-raw-fetch-in-ui — fixture with raw fetch() exits non-zero with the rule name in stdout', () => {
  const result = runEslint('test/fixtures/ui-raw-fetch/src/ui/bad-fetch.tsx');
  assert.notEqual(result.status, 0, 'expected eslint to fail on raw-fetch fixture');
  assert.match(
    result.stdout + result.stderr,
    /no-raw-fetch-in-ui/,
    'lint output must mention the rule name',
  );
});

test('clarity/no-raw-anchor-to-host-paths — fixture with <a href="/issues/..."> exits non-zero with the rule name', () => {
  const result = runEslint('test/fixtures/ui-raw-anchor/src/ui/bad-anchor.tsx');
  assert.notEqual(result.status, 0, 'expected eslint to fail on raw-anchor fixture');
  assert.match(
    result.stdout + result.stderr,
    /no-raw-anchor-to-host-paths/,
    'lint output must mention the rule name',
  );
});

test('clean fixture (no raw fetch / no raw anchor) passes eslint', () => {
  const result = runEslint('test/fixtures/ui-clean/src/ui/clean.tsx');
  assert.equal(
    result.status,
    0,
    `expected clean fixture to lint clean; stdout: ${result.stdout}; stderr: ${result.stderr}`,
  );
});
