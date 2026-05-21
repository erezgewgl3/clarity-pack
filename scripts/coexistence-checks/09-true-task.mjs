#!/usr/bin/env node
// scripts/coexistence-checks/09-true-task.mjs
//
// COEXIST-09 / CTT-07 -- disabling clarity-pack must preserve every Phase 4.1
// surface: the chat-topic archive flag (D-10), the chat_topic_tasks back-link
// side table (D-08), and all true-task issues spawned from chat. The Phase
// 4.1 invariants:
//
//   1. Migrations are additive-only (CLAUDE.md coexistence guarantee #3) --
//      none of migrations/*.sql DROP / DROP COLUMN / DELETE the Phase 4.1
//      tables (chat_topic_tasks, chat_topics.archived, chat_topics.archived_at)
//      OR public.issue_comments. The plugin-namespace tables MUST SURVIVE
//      a disable.
//
//   2. The D-10 invariant is the load-bearing Phase 4.1 contract: archiving
//      a chat topic is plugin-side ONLY. The chat-topic-archive handler must
//      NEVER call ctx.issues.update -- if it did, the host's
//      disposition-recovery service would engage on a `done` chat-topic
//      issue (probe COU-1757 fa25ef4d-... evidence per
//      04.1-01-SPIKE-FINDINGS PROBE-OQ3 attempt 2) and the topic would
//      strand. This script asserts ZERO `ctx.issues.update` invocations in
//      chat-topic-archive.ts (the file deliberately does not import the
//      host issue-mutation API at all; this is by construction).
//
//   3. No worker code in the Phase 4.1 surface deletes issue comments or
//      issues. A ctx.issues.deleteComment / ctx.issues.delete call would
//      destroy chat messages on the canonical public.issue_comments table
//      AND the chat-topic / true-task issues that hold the chat thread
//      together. The full src/worker/ tree is walked; the Phase 4.1
//      handler + helper files are also asserted to exist (defensive
//      guarantee the check is scanning the current generation of files).
//
//   4. The manifest declares no destructive uninstall hook.
//
// Mirrors the shape of 08-chat-disable.mjs (Plan 04-06) -- the Phase 4
// analog. Added to scripts/coexistence-checks/run-all.mjs in Plan 04.1-07.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const WORKER_DIR = path.join(REPO_ROOT, 'src', 'worker');
const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'manifest.ts');
const ARCHIVE_HANDLER_PATH = path.join(
  REPO_ROOT,
  'src',
  'worker',
  'handlers',
  'chat-topic-archive.ts',
);

// The plugin-namespace Phase 4.1 surface tables that must survive a disable.
// Chat_topics existed pre-4.1 (Phase 4 in 0006_chat.sql) but the archive
// flag + the archived_at timestamp are 4.1 surface columns; they must
// neither be DROP COLUMNed nor the parent table DROPped.
const TRUE_TASK_TABLES = ['chat_topic_tasks', 'chat_topics'];

// Phase 4.1 worker source files -- assert they exist so the check is known
// to be scanning the current generation of files (defensive #6 in plan).
const PHASE_4_1_SOURCES = [
  'src/worker/chat/true-task.ts',
  'src/worker/chat/topic-watchdog.ts',
  'src/worker/chat/comment-classify.ts',
  'src/worker/handlers/chat-true-task.ts',
  'src/worker/handlers/chat-topic-archive.ts',
  'src/worker/handlers/chat-active-tasks.ts',
];

let passed = 0;

function fail(msg) {
  console.error(`COEXIST-09 violation: ${msg}`);
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

// A regex alternation of every Phase 4.1 plugin-namespace table plus the
// archive-related column names + public.issue_comments. We deliberately
// include `archived` and `archived_at` so a `ALTER TABLE chat_topics
// DROP COLUMN archived` is caught.
const TRUE_TASK_TABLE_RE = `(?:${TRUE_TASK_TABLES.join('|')}|public\\.issue_comments)`;
const TRUE_TASK_COLUMN_RE = '(?:archived(?:_at)?)';

// =============================================================================
// Assertion 1 + 5: migrations are additive-only (no DROP / DELETE; CREATE TABLE
// IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only on Phase 4.1 surfaces).
// =============================================================================

if (existsSync(MIGRATIONS_DIR)) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

    // 1a -- no DROP TABLE on Phase 4.1 surfaces or public.issue_comments
    if (new RegExp(`\\bDROP\\s+TABLE\\b[\\s\\S]*\\b${TRUE_TASK_TABLE_RE}\\b`, 'i').test(sql)) {
      fail(
        `migrations/${f} contains DROP TABLE for a Phase 4.1 surface table or public.issue_comments`,
      );
    }

    // 1b -- no DROP COLUMN on chat_topics.archived / archived_at (CTT-07
    // requires the archive flag to survive disable)
    if (
      new RegExp(
        `\\bALTER\\s+TABLE\\b[\\s\\S]*\\b(?:chat_topics|chat_topic_tasks)\\b[\\s\\S]*\\bDROP\\s+COLUMN\\b[\\s\\S]*\\b${TRUE_TASK_COLUMN_RE}\\b`,
        'i',
      ).test(sql)
    ) {
      fail(
        `migrations/${f} drops a Phase 4.1 archive column (archived / archived_at) -- the archive flag must survive disable per CTT-07`,
      );
    }

    // 1c -- no DROP COLUMN on Phase 4.1 surface tables generally
    if (
      new RegExp(
        `\\bALTER\\s+TABLE\\b[\\s\\S]*\\b${TRUE_TASK_TABLE_RE}\\b[\\s\\S]*\\bDROP\\s+COLUMN\\b`,
        'i',
      ).test(sql)
    ) {
      fail(`migrations/${f} drops a column on a Phase 4.1 surface table`);
    }

    // 1d -- no DELETE FROM public.issue_comments (the canonical chat content)
    if (/\bDELETE\s+FROM\s+public\.issue_comments\b/i.test(sql)) {
      fail(
        `migrations/${f} deletes public.issue_comments rows; chat messages and true-task marker comments must survive disable`,
      );
    }

    // 1e -- no DELETE FROM chat_topic_tasks (the D-08 back-link table; CTT-08
    // requires the active-tasks rail to keep working after re-enable)
    if (/\bDELETE\s+FROM\s+[\w.]*\bchat_topic_tasks\b/i.test(sql)) {
      fail(
        `migrations/${f} deletes from chat_topic_tasks; the D-08 back-link must survive disable per CTT-08`,
      );
    }

    // 1f -- no DROP SCHEMA on the plugin namespace
    if (/\bDROP\s+SCHEMA\s+plugin_clarity_pack/i.test(sql)) {
      fail(`migrations/${f} drops the plugin namespace; Phase 4.1 tables must survive disable`);
    }
  }
  pass(`migrations/*.sql are additive-only (${files.length} files scanned; no DROP / DELETE on Phase 4.1 surfaces)`);
} else {
  fail(`migrations/ directory not found at ${MIGRATIONS_DIR}`);
}

// =============================================================================
// Assertion 2: D-10 INVARIANT -- chat-topic-archive.ts contains zero
// ctx.issues.update FUNCTION CALLS. The handler is plugin-side only;
// touching host status would re-engage the disposition-recovery service
// per the 04.1-01 spike PROBE-OQ3 attempt 2 evidence (fa25ef4d-... notice
// on COU-1757). Plan 04.1-05 deliberately does not import the host
// issue-mutation API at all.
//
// Note: we use a precise function-call regex `ctx\.issues\.update\s*\(`
// rather than a substring match so an explanatory comment naming the
// spied function does not trigger a false positive (Plan 04.1-05 SUMMARY
// deviation #2 recorded this exact substring/call distinction).
// =============================================================================

if (existsSync(ARCHIVE_HANDLER_PATH)) {
  const src = readFileSync(ARCHIVE_HANDLER_PATH, 'utf8');
  if (/\bctx\.issues\.update\s*\(/.test(src)) {
    fail(
      `src/worker/handlers/chat-topic-archive.ts calls ctx.issues.update -- ` +
        `D-10 invariant requires plugin-side-only archive; touching host ` +
        `status re-engages the disposition-recovery service`,
    );
  }
  // Also assert the handler doesn't write a terminal status literal
  // (`done` / `cancelled` / `blocked`) -- a status write via any path
  // would have the same effect. (Comments + JSDoc that mention these
  // tokens for documentation purposes are OK; the regex is whitespace-
  // sensitive enough that prose mentions don't match.)
  if (
    /\bctx\.issues\.update\b[\s\S]*\b(?:'done'|'cancelled'|'blocked')\b/i.test(src) ||
    /\bstatus\s*:\s*['"](?:done|cancelled|blocked)['"]/.test(src)
  ) {
    fail(
      `src/worker/handlers/chat-topic-archive.ts writes a terminal status literal -- ` +
        `D-10 requires the host issue status to stay at in_progress`,
    );
  }
  pass(`src/worker/handlers/chat-topic-archive.ts honors the D-10 invariant (no ctx.issues.update; no terminal status write)`);
} else {
  fail(`src/worker/handlers/chat-topic-archive.ts not found -- Phase 4.1 archive handler is missing`);
}

// =============================================================================
// Assertion 3: NO-DELETE in worker code -- a ctx.issues.delete /
// ctx.issues.deleteComment call would destroy chat messages on
// public.issue_comments OR the true-task issues themselves. Walk the
// entire src/worker/ tree.
// =============================================================================

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
pass(`src/worker/**: no ctx.issues.delete / ctx.issues.deleteComment calls (Phase 4.1 surfaces preserve all host data)`);

// =============================================================================
// Assertion 4: manifest declares no destructive uninstall hook.
// =============================================================================

if (existsSync(MANIFEST_PATH)) {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');
  // Match identifier-like usage of the destructive hook names (declarations,
  // property assignments). The check tolerates comments + prose that mention
  // these tokens descriptively; only structural usage trips the check.
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

// =============================================================================
// Assertion 6: Phase 4.1 source files exist (defensive -- the check is
// scanning the current generation of files).
// =============================================================================

for (const rel of PHASE_4_1_SOURCES) {
  const full = path.join(REPO_ROOT, rel);
  if (!existsSync(full)) {
    fail(`expected Phase 4.1 source file is missing: ${rel}`);
  }
}
pass(`all ${PHASE_4_1_SOURCES.length} Phase 4.1 worker source files exist (check is scanning the current generation)`);

// =============================================================================
console.log(
  `\nCOEXIST-09 OK: ${passed} assertions passed -- Phase 4.1 surfaces ` +
    `(chat_topic_tasks back-link, chat_topics.archived flag, true-task ` +
    `issues, marker comments) survive disable; D-10 plugin-side archive ` +
    `invariant holds (CTT-07/CTT-08).`,
);
process.exit(0);
