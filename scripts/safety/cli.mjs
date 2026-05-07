#!/usr/bin/env node
// scripts/safety/cli.mjs
//
// Subcommand dispatcher for `pnpm clarity-safety`.
// Subcommands handled here: snapshot | restore | list | prune
// Subcommands stubbed (defer to plan 02 / 03): smoke | verify | gate
//
// Hand-rolled argv parsing — research's "Don't Hand-Roll" table places
// the threshold for `commander` at >4 subcommands; we have 7 but only 4
// need parsing logic, so the dispatcher stays small.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { listSnapshots } from './lib/list.mjs';
import { pruneSnapshots } from './lib/prune.mjs';
import { snapshot } from './lib/snapshot.mjs';
import { restoreToStaging } from './lib/restore.mjs';
import { resolvePaperclipHome, resolveSnapshotsDir, isValidSnapshotId } from './lib/paths.mjs';
import { detectMode } from './lib/mode-detect.mjs';
import * as paperclipCli from './lib/paperclip-cli.mjs';

const SUBCOMMANDS = ['snapshot', 'restore', 'smoke', 'verify', 'gate', 'list', 'prune'];

function printRootHelp() {
  process.stdout.write(
    [
      'Usage: clarity-safety <subcommand> [options]',
      '',
      'Subcommands:',
      '  snapshot   Capture a Paperclip install (DB + filesystem + manifest).',
      '  restore    Restore a snapshot into a sibling staging dir (never live).',
      '  smoke      [plan-02] Smoke-test a restored env against its manifest.',
      '  verify     [plan-02] Restore-to-staging then smoke; sets verifiedAt.',
      '  gate       [plan-03] Refuse-or-run wrapper around an inner command.',
      '  list       Enumerate snapshots under .planning/snapshots/.',
      '  prune      Delete old snapshots; preserves <24h.',
      '',
      'Common flags:',
      '  --paperclip-home <path>   default: $PAPERCLIP_HOME or platform default',
      '  --instance-id <id>        default: $PAPERCLIP_INSTANCE_ID or "default"',
      '  --help, -h                show this help',
      ''
    ].join('\n')
  );
}

/**
 * Parse `--flag value` and `--flag=value` into a flat object. Booleans
 * are inferred when the flag is followed by another flag or end-of-argv.
 */
function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        out[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          out[key] = true;
        } else {
          out[key] = next;
          i++;
        }
      }
    } else {
      out._.push(tok);
    }
  }
  return out;
}

function repoRootFromCli() {
  // The CLI lives at scripts/safety/cli.mjs → repoRoot is two dirs up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

async function runSnapshot(flags) {
  const home = flags['paperclip-home'] ?? resolvePaperclipHome();
  const instanceId = flags['instance-id'] ?? process.env.PAPERCLIP_INSTANCE_ID ?? 'default';
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  let mode = flags.mode;
  if (!mode) {
    mode = await detectMode(path.join(home, 'instances', instanceId, 'config.json'));
  }
  const snapshotIdNow = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
  const outDir = flags.out ?? path.join(snapshotsDir, snapshotIdNow);
  const result = await snapshot({
    home,
    instanceId,
    mode,
    outDir,
    dbUrl: flags['db-url'],
    excludeSecrets: flags['exclude-secrets'] === true,
    includeLogs: flags['include-logs'] !== false,
    paperclipCli,
    snapshotId: snapshotIdNow
  });
  process.stdout.write(`snapshot: ${result.snapshotId}\nlocation: ${outDir}\n`);
  return 0;
}

async function runRestore(flags) {
  const snapshotId = flags._[0];
  if (!snapshotId) {
    process.stderr.write('restore: snapshot id required (positional argument)\n');
    return 1;
  }
  if (!isValidSnapshotId(snapshotId)) {
    process.stderr.write(`restore: invalid snapshotId: ${snapshotId}\n`);
    return 1;
  }
  const home = flags['paperclip-home'] ?? resolvePaperclipHome();
  const instanceId = flags['instance-id'] ?? process.env.PAPERCLIP_INSTANCE_ID ?? 'default';
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const result = await restoreToStaging({
    snapshotId,
    home,
    instanceId,
    snapshotsDir,
    targetInstanceId: flags['target-instance-id'],
    targetDb: flags['target-db'],
    iKnowWhatImDoing: flags['i-know-what-im-doing'] === true,
    dbUrl: flags['db-url']
  });
  process.stdout.write(
    `restore staged at: ${result.stagingInstanceDir}\n` +
      `staging db:        ${result.stagingDbName}\n` +
      'next: pnpm clarity-safety verify <snapshot-id>  (plan 02)\n'
  );
  return 0;
}

async function runList(_flags) {
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const list = await listSnapshots(snapshotsDir);
  if (list.length === 0) {
    process.stdout.write('no snapshots found at ' + snapshotsDir + '\n');
    return 0;
  }
  process.stdout.write('id                          size       verified  age (min)\n');
  for (const s of list) {
    process.stdout.write(
      `${s.id}  ${String(s.sizeBytes).padStart(10)}  ${s.verifiedAt ? 'yes' : 'no '}  ${s.ageMinutes.toFixed(1)}\n`
    );
  }
  return 0;
}

async function runPrune(flags) {
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const opts = {
    keep: flags.keep !== undefined ? Number(flags.keep) : 10,
    keepVerified: flags['keep-verified'] !== undefined ? Number(flags['keep-verified']) : 3,
    dryRun: flags['dry-run'] === true
  };
  const plan = await pruneSnapshots(snapshotsDir, opts);
  process.stdout.write(
    `keep:   ${plan.toKeep.length}\n` +
      `delete: ${plan.toDelete.length}${opts.dryRun ? ' (dry-run; nothing deleted)' : ''}\n`
  );
  for (const s of plan.toDelete) process.stdout.write(`  - ${s.id}\n`);
  return 0;
}

function runStub(name, planRef) {
  process.stderr.write(
    `${name} subcommand lands in ${planRef}; not yet implemented in plan 01-01\n`
  );
  return 2;
}

async function main(argv) {
  const [, , sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    printRootHelp();
    return 0;
  }
  if (!SUBCOMMANDS.includes(sub)) {
    process.stderr.write(`unknown subcommand: ${sub}\n`);
    printRootHelp();
    return 1;
  }
  const flags = parseFlags(rest);
  if (flags.help === true || flags.h === true) {
    printRootHelp();
    return 0;
  }
  switch (sub) {
    case 'snapshot':
      return runSnapshot(flags);
    case 'restore':
      return runRestore(flags);
    case 'list':
      return runList(flags);
    case 'prune':
      return runPrune(flags);
    case 'smoke':
      return runStub('smoke', 'plan 02');
    case 'verify':
      return runStub('verify', 'plan 02');
    case 'gate':
      return runStub('gate', 'plan 03');
  }
  return 1;
}

main(process.argv)
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  });
