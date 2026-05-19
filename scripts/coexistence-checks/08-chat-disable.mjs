#!/usr/bin/env node
// scripts/coexistence-checks/08-chat-disable.mjs
//
// COEXIST-08 / CHAT-11 - disabling clarity-pack must preserve every chat
// message. Chat message CONTENT lives only in public.issue_comments (CHAT-02 /
// D-02): each message is an ordinary threaded comment on its topic issue, so
// disabling the plugin removes nothing user-visible -- every chat message
// stays visible as an ordinary threaded comment in classic Paperclip.
//
// The plugin-namespace chat tables (chat_topics, chat_messages,
// chat_employee_parents) hold IDs and metadata only -- never message body --
// and they must SURVIVE a disable (additive-only / COEXIST-03): disable leaves
// data intact.
//
// This script is static defense-in-depth that mirrors 07-bulletin-disable.mjs:
//   1. migrations/*.sql must not DROP / DELETE / drop-column the chat tables
//      or public.issue_comments, and must not drop the plugin namespace.
//   2. worker code must not delete issue comments (chat content) -- a
//      ctx.issues.deleteComment / ctx.issues.delete call would destroy chat
//      messages on the canonical public.issue_comments table.
//   3. the manifest must declare no destructive uninstall/disable hook.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const WORKER_DIR = path.join(REPO_ROOT, 'src', 'worker');
const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'manifest.ts');

// The plugin-namespace chat tables that must survive a disable.
const CHAT_TABLES = ['chat_topics', 'chat_messages', 'chat_employee_parents'];

function fail(msg) {
  console.error(`COEXIST-08 violation: ${msg}`);
  process.exit(1);
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

// A regex alternation of every chat table name plus public.issue_comments.
const CHAT_DATA_RE = `(?:${CHAT_TABLES.join('|')}|public\\.issue_comments)`;

if (existsSync(MIGRATIONS_DIR)) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    if (new RegExp(`\\bDROP\\s+TABLE\\b[\\s\\S]*\\b${CHAT_DATA_RE}\\b`, 'i').test(sql)) {
      fail(`migrations/${f} contains DROP TABLE for chat or issue_comments data`);
    }
    if (/\bDELETE\s+FROM\s+public\.issue_comments\b/i.test(sql)) {
      fail(
        `migrations/${f} deletes public.issue_comments rows; chat messages must survive disable`,
      );
    }
    if (
      new RegExp(
        `\\bALTER\\s+TABLE\\b[\\s\\S]*\\b${CHAT_DATA_RE}\\b[\\s\\S]*\\bDROP\\s+COLUMN\\b`,
        'i',
      ).test(sql)
    ) {
      fail(`migrations/${f} drops a chat or issue_comments column`);
    }
    if (/\bDROP\s+SCHEMA\s+plugin_clarity_pack/i.test(sql)) {
      fail(`migrations/${f} drops the plugin namespace; chat tables must survive disable`);
    }
  }
}

for (const f of walk(WORKER_DIR)) {
  const src = readFileSync(f, 'utf8');
  if (/\bctx\.issues\.deleteComment\s*\(/.test(src)) {
    fail(
      `${path.relative(REPO_ROOT, f)} calls ctx.issues.deleteComment; chat messages ` +
        `are public.issue_comments rows and must persist`,
    );
  }
  if (/\bctx\.issues\.delete\s*\(/.test(src)) {
    fail(
      `${path.relative(REPO_ROOT, f)} calls ctx.issues.delete; chat topic issues ` +
        `must persist so their comments stay visible in classic Paperclip`,
    );
  }
}

if (existsSync(MANIFEST_PATH)) {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');
  if (/\b(onUninstall|destructiveUninstall|purgeOnDisable)\b/i.test(manifest)) {
    fail('src/manifest.ts declares a destructive uninstall hook');
  }
}

console.log(
  'COEXIST-08 OK: chat messages survive disable as ordinary public.issue_comments ' +
    'threaded comments, and the plugin-namespace chat tables are preserve-on-disable (CHAT-11)',
);
process.exit(0);
