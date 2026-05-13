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
import { detectMode, detectConnectionConfig, DetectError } from './lib/mode-detect.mjs';
import * as paperclipCli from './lib/paperclip-cli.mjs';
import { smoke } from './lib/smoke.mjs';
import { verify } from './lib/verify.mjs';
import { gate } from './lib/gate.mjs';

const SUBCOMMANDS = ['snapshot', 'restore', 'smoke', 'verify', 'gate', 'list', 'prune'];

function printRootHelp() {
  process.stdout.write(
    [
      'Usage: clarity-safety <subcommand> [options]',
      '',
      'Subcommands:',
      '  snapshot   Capture a Paperclip install (DB + filesystem + manifest).',
      '  restore    Restore a snapshot into a sibling staging dir (never live).',
      '  smoke      Smoke-test a restored env against its manifest.',
      '  verify     Restore-to-staging then smoke; sets verifiedAt.',
      '  gate       [plan-03] Refuse-or-run wrapper around an inner command.',
      '  list       Enumerate snapshots under .planning/snapshots/.',
      '  prune      Delete old snapshots; preserves <24h.',
      '',
      'Common flags:',
      '  --paperclip-home <path>   default: $PAPERCLIP_HOME or platform default',
      '  --instance-id <id>        default: $PAPERCLIP_INSTANCE_ID or "default"',
      '  --help, -h                show this help',
      '',
      'Snapshot-specific flags (postgres mode):',
      '  --db-url <dsn>            explicit postgresql:// DSN (overrides config-derived)',
      '  --pg-bin <path>           explicit path to pg_dump binary (overrides locator)',
      '  --paperclip-clone <path>  Paperclip-clone root for bundled @embedded-postgres discovery',
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
  const configPath = path.join(home, 'instances', instanceId, 'config.json');

  // Mode + dbUrl resolution (Plan 01-05 Task 3):
  // - If --db-url is explicit, use it verbatim with operator-supplied --mode (or detected).
  // - Otherwise, call detectConnectionConfig to derive both. For embedded-postgres mode
  //   this builds postgresql://paperclip:paperclip@127.0.0.1:<port>/paperclip from config.
  let mode = flags.mode;
  let dbUrl = flags['db-url'];
  if (!dbUrl && (!mode || mode === 'postgres')) {
    try {
      const conn = await detectConnectionConfig(configPath);
      mode = conn.mode;
      dbUrl = conn.dbUrl;
    } catch (err) {
      if (err instanceof DetectError) {
        process.stderr.write(`snapshot: ${err.message}\nhint: ${err.hint}\n`);
        return 1;
      }
      throw err;
    }
  } else if (!mode) {
    mode = await detectMode(configPath);
  }

  const snapshotIdNow = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
  const outDir = flags.out ?? path.join(snapshotsDir, snapshotIdNow);
  const result = await snapshot({
    home,
    instanceId,
    mode,
    outDir,
    dbUrl,
    pgBinPath: flags['pg-bin'],
    paperclipClonePath: flags['paperclip-clone'],
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

function printSmokeHelp() {
  process.stdout.write(
    [
      'Usage: clarity-safety smoke [options]',
      '',
      'Run the 5-check REST smoke pass against a Paperclip server.',
      'Optional cross-check vs a snapshot manifest (plugin set + version).',
      '',
      'Required:',
      '  --api-url <url>           e.g. http://127.0.0.1:3100',
      '  --company-id <id>         Paperclip company id for /agents endpoint',
      '',
      'Optional:',
      '  --api-key <token>         Bearer token (or PAPERCLIP_API_KEY env)',
      '  --editor-agent-id <id>    enables heartbeat check; otherwise skipped',
      '  --timeout-ms <n>          per-check timeout (default 5000)',
      '  --snapshot-id <id>        cross-check against snapshot manifest',
      ''
    ].join('\n')
  );
}

function printVerifyHelp() {
  process.stdout.write(
    [
      'Usage: clarity-safety verify <snapshot-id> [options]',
      '',
      'Restore <snapshot-id> into a sibling staging dir, smoke-test the',
      'operator-managed sibling Paperclip, and on PASS write verifiedAt +',
      'verifiedSmokeChecks back into the manifest atomically.',
      '',
      'Required:',
      '  <snapshot-id>             positional — must match snapshot-id format',
      '  --smoke-api-url <url>     URL of the sibling Paperclip you started manually',
      '  --company-id <id>         Paperclip company id for /agents endpoint',
      '',
      'Optional:',
      '  --strategy <manual|auto>  default: manual; auto is v2 stub',
      '  --api-key <token>         Bearer token (or PAPERCLIP_API_KEY env)',
      '  --editor-agent-id <id>    enables heartbeat check; otherwise skipped',
      '  --max-rehearsal-time-ms <n>  budget; default 300000 (5min)',
      '  --paperclip-home <path>   default: $PAPERCLIP_HOME or platform default',
      '  --instance-id <id>        default: $PAPERCLIP_INSTANCE_ID or "default"',
      '  --target-instance-id <id> staging dir name; default "<id>.restoring"',
      '  --target-db <name>        Postgres staging DB; default "paperclip_restoring"',
      '  --db-url <dsn>            Postgres DSN (postgres mode only)',
      '',
      'On smoke FAIL: manifest unchanged; staging dir preserved for inspection.',
      'See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.',
      ''
    ].join('\n')
  );
}

async function runVerify(flags) {
  if (flags.help === true || flags.h === true) {
    printVerifyHelp();
    return 0;
  }
  const snapshotId = flags._[0];
  if (!snapshotId) {
    process.stderr.write('verify: snapshot id required (positional argument)\n');
    return 1;
  }
  if (!isValidSnapshotId(snapshotId)) {
    process.stderr.write(`verify: invalid snapshotId: ${snapshotId}\n`);
    return 1;
  }
  const home = flags['paperclip-home'] ?? resolvePaperclipHome();
  const instanceId = flags['instance-id'] ?? process.env.PAPERCLIP_INSTANCE_ID ?? 'default';
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const strategy = flags.strategy ?? 'manual';
  const smokeApiUrl = flags['smoke-api-url'] ?? process.env.PAPERCLIP_API_URL;
  const apiKey = flags['api-key'] ?? process.env.PAPERCLIP_API_KEY;
  const companyId = flags['company-id'] ?? process.env.PAPERCLIP_COMPANY_ID;
  if (!companyId) {
    process.stderr.write('verify: --company-id (or PAPERCLIP_COMPANY_ID) is required\n');
    return 1;
  }
  const editorAgentId = flags['editor-agent-id'] ?? process.env.PAPERCLIP_AGENT_ID;
  const maxRehearsalTimeMs =
    flags['max-rehearsal-time-ms'] !== undefined
      ? Number(flags['max-rehearsal-time-ms'])
      : undefined;
  let result;
  try {
    result = await verify({
      snapshotId,
      home,
      instanceId,
      strategy,
      smokeApiUrl,
      altPort: flags['alt-port'] !== undefined ? Number(flags['alt-port']) : undefined,
      apiKey,
      companyId,
      editorAgentId,
      maxRehearsalTimeMs,
      snapshotsDir,
      dbUrl: flags['db-url'],
      targetInstanceId: flags['target-instance-id'],
      targetDb: flags['target-db']
    });
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    return 1;
  }
  if (!result.ok) {
    process.stderr.write(
      `verify FAILED at ${result.failedCheck}: ${result.reason}\n` +
        (result.stagingInstanceDir
          ? `staging dir preserved at: ${result.stagingInstanceDir}\n`
          : '')
    );
    return 1;
  }
  process.stdout.write(
    `verify PASSED\n` +
      `verifiedAt:           ${result.verifiedAt}\n` +
      `verifiedSmokeChecks: ${result.verifiedSmokeChecks.join(', ')}\n`
  );
  return 0;
}

function printGateHelp() {
  process.stdout.write(
    [
      'Usage: clarity-safety gate [options] -- <inner-command> [args...]',
      '',
      'Refuse-or-run wrapper. Forwards <inner-command> only when the',
      'latest snapshot under .planning/snapshots/ is verified AND its',
      'verifiedAt is within --max-age minutes (default 15). On refusal,',
      'prints the exact remediation commands and exits non-zero.',
      '',
      'Options:',
      '  --max-age <min>           freshness window for verifiedAt (default 15)',
      '  --help, -h                show this help',
      '',
      'Bypass (for emergencies only — every bypass is logged to runbook/REHEARSAL.md):',
      '  Add --gate-bypass to the inner command argv AND set',
      '  CLARITY_SAFETY_BYPASS=I_KNOW=$(node -e "console.log(Date.now())")',
      '  in the same shell invocation. The env timestamp must be within 60',
      '  seconds of now. Both factors are required; the flag alone is not',
      '  enough.',
      '',
      'Examples:',
      '  clarity-safety gate -- pnpm paperclipai plugin install clarity-pack',
      '  clarity-safety gate --max-age=30 -- pnpm paperclipai plugin upgrade clarity-pack',
      ''
    ].join('\n')
  );
}

async function runGate(flags) {
  if (flags.help === true || flags.h === true) {
    printGateHelp();
    return 0;
  }
  // Inner command lives after the `--` separator; parseFlags collects it
  // into flags._. If empty, the user forgot the inner command.
  const innerCommand = flags._;
  if (!innerCommand || innerCommand.length === 0) {
    process.stderr.write(
      'gate: inner command required. Pass it after `--`. Example:\n' +
        '  clarity-safety gate -- pnpm paperclipai plugin install clarity-pack\n'
    );
    return 1;
  }
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const maxAgeMinutes =
    flags['max-age'] !== undefined ? Number(flags['max-age']) : undefined;
  if (maxAgeMinutes !== undefined && !Number.isFinite(maxAgeMinutes)) {
    process.stderr.write(`gate: --max-age must be a number; got ${flags['max-age']}\n`);
    return 1;
  }
  const result = await gate({
    snapshotsDir,
    innerCommand,
    maxAgeMinutes,
    rehearsalLogPath: path.join(repoRoot, 'runbook', 'REHEARSAL.md')
  });
  if (!result.forwarded) {
    process.stderr.write(
      `gate REFUSED (${result.refusalReason}):\n${result.remediation}\n`
    );
    return 1;
  }
  if (result.bypassed) {
    process.stderr.write('gate: bypass honored; entry appended to runbook/REHEARSAL.md\n');
  }
  // Propagate the inner command's exit code verbatim.
  return typeof result.exitCode === 'number' ? result.exitCode : 0;
}

async function runSmoke(flags) {
  if (flags.help === true || flags.h === true) {
    printSmokeHelp();
    return 0;
  }
  const apiUrl = flags['api-url'] ?? process.env.PAPERCLIP_API_URL;
  const apiKey = flags['api-key'] ?? process.env.PAPERCLIP_API_KEY;
  const companyId = flags['company-id'] ?? process.env.PAPERCLIP_COMPANY_ID;
  const editorAgentId = flags['editor-agent-id'] ?? process.env.PAPERCLIP_AGENT_ID;
  if (!apiUrl) {
    process.stderr.write('smoke: --api-url (or PAPERCLIP_API_URL) is required\n');
    return 1;
  }
  if (!companyId) {
    process.stderr.write('smoke: --company-id (or PAPERCLIP_COMPANY_ID) is required\n');
    return 1;
  }
  const timeoutMs = flags['timeout-ms'] !== undefined ? Number(flags['timeout-ms']) : undefined;
  const snapshotId = flags['snapshot-id'];
  if (snapshotId !== undefined && !isValidSnapshotId(snapshotId)) {
    process.stderr.write(`smoke: invalid --snapshot-id: ${snapshotId}\n`);
    return 1;
  }
  const repoRoot = repoRootFromCli();
  const snapshotsDir = resolveSnapshotsDir(repoRoot);
  const result = await smoke({
    apiUrl,
    apiKey,
    companyId,
    editorAgentId,
    timeoutMs,
    snapshotId,
    snapshotsDir: snapshotId ? snapshotsDir : undefined
  });
  for (const c of result.checks) {
    process.stdout.write(
      `  [${c.status.padEnd(7)}] ${c.name}${c.detail ? ' — ' + c.detail : ''}\n`
    );
  }
  if (!result.ok) {
    process.stderr.write(`smoke FAILED at ${result.failedCheck}: ${result.reason}\n`);
    return 1;
  }
  process.stdout.write('smoke PASSED\n');
  return 0;
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
  // Subcommands with their own --help handler get first crack; otherwise
  // fall back to the root help.
  const SUBCOMMAND_HELP_OWNERS = new Set(['smoke', 'verify', 'gate']);
  if ((flags.help === true || flags.h === true) && !SUBCOMMAND_HELP_OWNERS.has(sub)) {
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
      return runSmoke(flags);
    case 'verify':
      return runVerify(flags);
    case 'gate':
      return runGate(flags);
  }
  return 1;
}

main(process.argv)
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  });
