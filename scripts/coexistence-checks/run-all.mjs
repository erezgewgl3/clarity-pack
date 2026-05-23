#!/usr/bin/env node
// scripts/coexistence-checks/run-all.mjs
//
// Plan 02-04 Task 3 — runs the COEXIST checks sequentially, prints a summary
// table, and exits non-zero if any failed. The .github/workflows/
// coexistence.yml workflow invokes this script on every PR.
// Plan 03-04 added COEXIST-07 (bulletin-disable); Plan 04-06 added COEXIST-08
// (chat-disable / CHAT-11); Plan 04.1-07 added COEXIST-09 (true-task / Phase
// 4.1 surface preservation, CTT-07/CTT-08, D-10 invariant).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  { id: 'COEXIST-01', script: '01-original-ui-unchanged.mjs' },
  { id: 'COEXIST-02', script: '02-no-public-ddl.mjs' },
  { id: 'COEXIST-03', script: '03-disable-preserves-data.mjs' },
  { id: 'COEXIST-04', script: '04-editor-agent-no-special-privs.mjs' },
  { id: 'COEXIST-05', script: '05-chat-comment-coexistence-stub.mjs' },
  { id: 'COEXIST-06', script: '06-css-bleed-through.mjs' },
  { id: 'COEXIST-07', script: '07-bulletin-disable.mjs' },
  { id: 'COEXIST-08', script: '08-chat-disable.mjs' },
  { id: 'COEXIST-09', script: '09-true-task.mjs' },
  { id: 'COEXIST-10', script: '10-uninstall-runbook.mjs' },
];

const results = [];
for (const c of CHECKS) {
  const r = spawnSync(process.execPath, [path.join(HERE, c.script)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  const ok = r.status === 0;
  results.push({ id: c.id, script: c.script, ok, stdout: r.stdout, stderr: r.stderr });
  // Always echo the child's stdout/stderr so CI logs are useful.
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}

console.log('\n=== Coexistence checks summary ===');
let anyFailed = false;
for (const r of results) {
  const flag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${flag}] ${r.id} (${r.script})`);
  if (!r.ok) anyFailed = true;
}

process.exit(anyFailed ? 1 : 0);
