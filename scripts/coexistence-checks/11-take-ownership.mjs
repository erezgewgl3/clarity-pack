#!/usr/bin/env node
// scripts/coexistence-checks/11-take-ownership.mjs
//
// COEXIST-11 / ROOM-09 / CTT-07 -- disabling clarity-pack must preserve
// every Phase 6.1 surface: the plugin-namespace `clarity_agent_owners`
// side table (D-01 / D-08), the agent.takeOwnership action handler
// (CTT-07 invariant by construction), and the situation.artifacts data
// handler (ROOM-10).
//
// Phase 6.1 invariants pinned here (defense-in-depth at the build tier;
// the operator's live disable/enable drill in Plan 06.1-04 Task 3 is the
// matching runtime tier; the Plan 06.1-01 Test 10 runtime spy +
// test/ctt07/agent-take-ownership-no-issue-update.test.mjs source-grep
// are the matching unit tier):
//
//   1. Migrations are additive-only on Phase 6.1 surfaces. None of
//      migrations/*.sql DROP / DROP COLUMN / DROP SCHEMA on
//      clarity_agent_owners, its `owner_user_id` column, or the
//      plugin_clarity_pack_cdd6bda4bd namespace. The plugin-namespace
//      table MUST SURVIVE a disable (CLAUDE.md coexistence guarantee
//      #3 + #6).
//
//   2. CTT-07 invariant: agent-take-ownership.ts contains ZERO
//      ctx.issues.update function calls. The handler is plugin-
//      namespace-side only; touching host issue state would re-engage
//      the disposition-recovery service (Plan 04.1-05 precedent) and
//      contaminate the host's owner_user_id contract. Pinned by Plan
//      06.1-01 Test 10 (runtime spy across 7 code paths) AND
//      test/ctt07/agent-take-ownership-no-issue-update.test.mjs
//      (source-grep companion); this check is the third-layer
//      defense.
//
//   3. CTT-07 invariant also holds for situation-artifacts.ts (ROOM-10
//      worker tier; Plan 06.1-02 Test 11 runtime spy + source-grep
//      companion are the matching layers).
//
//   4. No worker code in the Phase 6.1 surface deletes issue comments
//      or issues. Walk the full src/worker/ tree.
//
//   5. The manifest declares no destructive uninstall hook.
//
//   6. Phase 6.1 source files exist (defensive -- the check is scanning
//      the current generation of files).
//
// Mirrors the shape of 09-true-task.mjs (Plan 04.1-07) byte-for-byte
// with the Phase 6.1 substitutions per .planning/phases/06.1-situation-
// room-spec-complete/06.1-RESEARCH.md §Pattern 6. Added to
// scripts/coexistence-checks/run-all.mjs registry as the next slot
// (slot 11 -- 10-uninstall-runbook.mjs already exists).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const WORKER_DIR = path.join(REPO_ROOT, 'src', 'worker');
const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'manifest.ts');
const TAKE_OWNERSHIP_HANDLER_PATH = path.join(
  REPO_ROOT,
  'src',
  'worker',
  'handlers',
  'agent-take-ownership.ts',
);
const SITUATION_ARTIFACTS_HANDLER_PATH = path.join(
  REPO_ROOT,
  'src',
  'worker',
  'handlers',
  'situation-artifacts.ts',
);

// The plugin-namespace Phase 6.1 surface table that must survive a
// disable. Migration 0013 ships clarity_agent_owners with 4 columns
// (agent_id PK, owner_user_id, company_id, set_at). Neither the table
// nor the owner_user_id column may be DROPped.
const TAKE_OWNERSHIP_TABLES = ['clarity_agent_owners'];

// Phase 6.1 worker source files -- assert they exist so the check is
// known to be scanning the current generation of files (defensive #6
// in plan).
const PHASE_6_1_SOURCES = [
  'src/worker/handlers/agent-take-ownership.ts',
  'src/worker/handlers/situation-artifacts.ts',
  'src/worker/db/clarity-agent-owners-repo.ts',
];

let passed = 0;

function fail(msg) {
  console.error(`COEXIST-11 violation: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  passed += 1;
  console.log(`  ok ${msg}`);
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(ent.name)) out.push(full);
  }
  return out;
}

// A regex alternation of every Phase 6.1 plugin-namespace table plus
// the owner-related column names. We deliberately include
// `owner_user_id` so a `ALTER TABLE clarity_agent_owners DROP COLUMN
// owner_user_id` is caught.
const TAKE_OWNERSHIP_TABLE_RE = `(?:${TAKE_OWNERSHIP_TABLES.join('|')})`;
const TAKE_OWNERSHIP_COLUMN_RE = '(?:owner_user_id|set_at)';

// ============================================================================
// Assertion 1: migrations are additive-only on Phase 6.1 surfaces.
// (no DROP TABLE on clarity_agent_owners; no DROP COLUMN on its core
// columns; no DROP SCHEMA on the plugin namespace.)
// ============================================================================

if (existsSync(MIGRATIONS_DIR)) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

    // 1a -- no DROP TABLE on Phase 6.1 surfaces
    if (new RegExp(`\\bDROP\\s+TABLE\\b[\\s\\S]*\\b${TAKE_OWNERSHIP_TABLE_RE}\\b`, 'i').test(sql)) {
      fail(
        `migrations/${f} contains DROP TABLE for a Phase 6.1 surface table (clarity_agent_owners)`,
      );
    }

    // 1b -- no DROP COLUMN on clarity_agent_owners.owner_user_id / set_at
    // (ROOM-09 requires the owner mapping to survive disable)
    if (
      new RegExp(
        `\\bALTER\\s+TABLE\\b[\\s\\S]*\\b${TAKE_OWNERSHIP_TABLE_RE}\\b[\\s\\S]*\\bDROP\\s+COLUMN\\b[\\s\\S]*\\b${TAKE_OWNERSHIP_COLUMN_RE}\\b`,
        'i',
      ).test(sql)
    ) {
      fail(
        `migrations/${f} drops a Phase 6.1 owner column (owner_user_id / set_at) -- ` +
          `the owner mapping must survive disable per ROOM-09`,
      );
    }

    // 1c -- no DROP COLUMN on Phase 6.1 surface tables generally
    if (
      new RegExp(
        `\\bALTER\\s+TABLE\\b[\\s\\S]*\\b${TAKE_OWNERSHIP_TABLE_RE}\\b[\\s\\S]*\\bDROP\\s+COLUMN\\b`,
        'i',
      ).test(sql)
    ) {
      fail(`migrations/${f} drops a column on a Phase 6.1 surface table (clarity_agent_owners)`);
    }

    // 1d -- no DELETE FROM clarity_agent_owners (the D-01 owner mapping
    // table; ROOM-09 requires owner-claim rows to survive disable per
    // CLAUDE.md coexistence guarantee #6)
    if (/\bDELETE\s+FROM\s+[\w.]*\bclarity_agent_owners\b/i.test(sql)) {
      fail(
        `migrations/${f} deletes from clarity_agent_owners; the owner-claim ` +
          `rows must survive disable per ROOM-09 / coexistence #6`,
      );
    }

    // 1e -- no DROP SCHEMA on the plugin namespace
    if (/\bDROP\s+SCHEMA\s+plugin_clarity_pack/i.test(sql)) {
      fail(`migrations/${f} drops the plugin namespace; Phase 6.1 tables must survive disable`);
    }
  }
  pass(`migrations/*.sql are additive-only (${files.length} files scanned; no DROP / DELETE on Phase 6.1 surfaces)`);
} else {
  fail(`migrations/ directory not found at ${MIGRATIONS_DIR}`);
}

// ============================================================================
// Assertion 2: CTT-07 INVARIANT -- agent-take-ownership.ts contains
// zero ctx.issues.update FUNCTION CALLS. The handler is plugin-namespace
// side only; touching host issue state would re-engage the disposition-
// recovery service (Plan 04.1-05 precedent) and contaminate the host's
// owner_user_id contract.
//
// Pinned by Plan 06.1-01 Test 10 (runtime spy across 7 code paths) AND
// test/ctt07/agent-take-ownership-no-issue-update.test.mjs (source-grep
// companion). This check is the third-layer defense.
//
// Note: precise function-call regex `ctx\.issues\.update\s*\(` rather
// than substring match so explanatory comments naming the spied
// function do not trigger a false positive (the Plan 04.1-05 SUMMARY
// deviation #2 documented this exact distinction).
// ============================================================================

if (existsSync(TAKE_OWNERSHIP_HANDLER_PATH)) {
  const src = readFileSync(TAKE_OWNERSHIP_HANDLER_PATH, 'utf8');
  if (/\bctx\.issues\.update\s*\(/.test(src)) {
    fail(
      `src/worker/handlers/agent-take-ownership.ts calls ctx.issues.update -- ` +
        `CTT-07 invariant requires plugin-namespace-side-only ownership; ` +
        `touching host state would corrupt the owner_user_id contract`,
    );
  }
  // Also assert the handler doesn't write a host status literal via any
  // path (defensive belt-and-suspenders; prose mentions in comments are
  // OK because the regex requires a structural object-key match).
  if (
    /\bctx\.issues\.update\b[\s\S]*\b(?:'done'|'cancelled'|'blocked')\b/i.test(src) ||
    /\bstatus\s*:\s*['"](?:done|cancelled|blocked)['"]/.test(src)
  ) {
    fail(
      `src/worker/handlers/agent-take-ownership.ts writes a terminal status ` +
        `literal -- CTT-07 requires no host state mutation in this handler`,
    );
  }
  pass(`src/worker/handlers/agent-take-ownership.ts honors the CTT-07 invariant (no ctx.issues.update; no terminal status write)`);
} else {
  fail(`src/worker/handlers/agent-take-ownership.ts not found -- Phase 6.1 ROOM-09 handler is missing`);
}

// ============================================================================
// Assertion 3: CTT-07 INVARIANT (ROOM-10 worker tier) -- situation-
// artifacts.ts contains zero ctx.issues.update function calls. The
// data handler is read-only by design; this is defense-in-depth on
// top of Plan 06.1-02 Test 11 (runtime spy) + source-grep companion.
// ============================================================================

if (existsSync(SITUATION_ARTIFACTS_HANDLER_PATH)) {
  const src = readFileSync(SITUATION_ARTIFACTS_HANDLER_PATH, 'utf8');
  if (/\bctx\.issues\.update\s*\(/.test(src)) {
    fail(
      `src/worker/handlers/situation-artifacts.ts calls ctx.issues.update -- ` +
        `ROOM-10 data handler is read-only by design; CTT-07 invariant must hold`,
    );
  }
  pass(`src/worker/handlers/situation-artifacts.ts honors the CTT-07 invariant (no ctx.issues.update)`);
} else {
  fail(`src/worker/handlers/situation-artifacts.ts not found -- Phase 6.1 ROOM-10 handler is missing`);
}

// ============================================================================
// Assertion 4: NO-DELETE in worker code -- a ctx.issues.delete /
// ctx.issues.deleteComment call would destroy chat messages on
// public.issue_comments OR the underlying issues. Walk the entire
// src/worker/ tree.
// ============================================================================

for (const f of walk(WORKER_DIR)) {
  const src = readFileSync(f, 'utf8');
  if (/\bctx\.issues\.deleteComment\s*\(/.test(src)) {
    fail(
      `${path.relative(REPO_ROOT, f)} calls ctx.issues.deleteComment; chat messages ` +
        `+ marker comments are public.issue_comments rows and must persist after disable`,
    );
  }
  if (/\bctx\.issues\.delete\s*\(/.test(src)) {
    fail(
      `${path.relative(REPO_ROOT, f)} calls ctx.issues.delete; chat-topic issues + ` +
        `true-task issues must persist so their content stays visible in classic Paperclip`,
    );
  }
}
pass(`src/worker/**: no ctx.issues.delete / ctx.issues.deleteComment calls (Phase 6.1 surfaces preserve all host data)`);

// ============================================================================
// Assertion 5: manifest declares no destructive uninstall hook.
// ============================================================================

if (existsSync(MANIFEST_PATH)) {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');
  if (
    /\bonUninstall\s*[:=(]/.test(manifest) ||
    /\bdestructiveUninstall\s*[:=]/.test(manifest) ||
    /\bpurgeOnDisable\s*[:=]/.test(manifest)
  ) {
    fail('src/manifest.ts declares a destructive uninstall hook');
  }
  pass('src/manifest.ts declares no destructive uninstall hook');
} else {
  fail(`src/manifest.ts not found at ${MANIFEST_PATH}`);
}

// ============================================================================
// Assertion 6: Phase 6.1 source files exist (defensive -- the check is
// scanning the current generation of files).
// ============================================================================

for (const rel of PHASE_6_1_SOURCES) {
  const full = path.join(REPO_ROOT, rel);
  if (!existsSync(full)) {
    fail(`expected Phase 6.1 source file is missing: ${rel}`);
  }
}
pass(`all ${PHASE_6_1_SOURCES.length} Phase 6.1 worker source files exist (check is scanning the current generation)`);

// ============================================================================
console.log(
  `\nCOEXIST-11 OK: ${passed} assertions passed -- Phase 6.1 surfaces ` +
    `(clarity_agent_owners side table, agent.takeOwnership handler, ` +
    `situation.artifacts handler) survive disable; CTT-07 invariant ` +
    `holds for both ROOM-09 + ROOM-10 worker tiers.`,
);
process.exit(0);
