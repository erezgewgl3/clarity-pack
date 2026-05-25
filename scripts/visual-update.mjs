#!/usr/bin/env node
// scripts/visual-update.mjs
//
// Plan 05-04 Task 4 (DIST-04) -- cross-platform `pnpm visual:update`
// wrapper. Sets UPDATE_BASELINES=1 and re-spawns `node --test
// test/visual/sketch-regression.test.mjs`. Works on PowerShell, bash,
// cmd, and CI runners without a `cross-env` dependency.
//
// The Playwright test file reads process.env.UPDATE_BASELINES; setting
// it to '1' writes the captured PNG to the baseline path instead of
// running a diff.

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', 'test/visual/sketch-regression.test.mjs'],
  {
    stdio: 'inherit',
    env: { ...process.env, UPDATE_BASELINES: '1' },
  },
);

process.exit(result.status ?? 1);
