#!/usr/bin/env node
// scripts/coexistence-checks/10-uninstall-runbook.mjs
//
// Plan 05-02 (COEXIST-05) — Uninstall runbook coexistence check.
//
// COEXIST-05: "Clean uninstall preserves data; `--purge` flag is opt-in
// only and is documented in the runbook."
//
// Data-preservation half: already proven by the Phase 4-closure drill
// (CHAT-11 evidence — issue_comments count unchanged through `disable`
// cycles; see scripts/coexistence-checks/08-chat-disable.mjs). This
// check guards the OTHER half: the README documents the uninstall flow
// and labels `--purge` as opt-in only.
//
// Fails CI if the README ever loses the uninstall+--purge documentation.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const README = path.join(REPO_ROOT, 'README.md');
const INSTALL_HELPER = path.join(REPO_ROOT, 'scripts', 'install-helper.sh');
const SAFETY_CLI = path.join(REPO_ROOT, 'scripts', 'safety', 'cli.mjs');

const failures = [];

if (!existsSync(README)) {
  failures.push('README.md is missing at the repo root');
} else {
  const md = readFileSync(README, 'utf8');

  // The runbook must reference the uninstall flow.
  if (!/##+\s*Uninstall/i.test(md) && !/\bUninstall\b/.test(md)) {
    failures.push('README does not contain an Uninstall section');
  }

  // The runbook must describe data-preserving default uninstall.
  if (!/data-preserving|preserve.*data|leaves.*data\s+intact|untouched/i.test(md)) {
    failures.push('README does not describe data-preserving default uninstall (COEXIST-05 first half)');
  }

  // The runbook must document --purge as opt-in only.
  // Accept several phrasings: "opt-in only", "is opt-in", "opt-in flag".
  if (!/--purge/.test(md)) {
    failures.push('README does not mention the --purge flag');
  } else if (!/--purge[\s\S]{0,500}(opt-in|destructive)/i.test(md)) {
    failures.push('README does not describe --purge as opt-in (or destructive) (COEXIST-05 second half)');
  }

  // The runbook must reference the safety CLI for the snapshot bookend.
  if (!/scripts\/safety/.test(md)) {
    failures.push('README does not reference scripts/safety/ (rollback flow)');
  }
}

if (!existsSync(INSTALL_HELPER)) {
  failures.push('scripts/install-helper.sh is missing (referenced by README)');
}

if (!existsSync(SAFETY_CLI)) {
  failures.push('scripts/safety/cli.mjs is missing (referenced by README)');
}

if (failures.length === 0) {
  console.log('[COEXIST-10] uninstall-runbook: PASS');
  process.exit(0);
}

console.error('[COEXIST-10] uninstall-runbook: FAIL');
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
