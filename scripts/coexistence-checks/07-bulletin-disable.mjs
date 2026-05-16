#!/usr/bin/env node
// scripts/coexistence-checks/07-bulletin-disable.mjs
//
// COEXIST-07 - disabling clarity-pack must preserve Daily Bulletin records:
// canonical bulletin issues live in public.issues, while plugin metadata and
// errata tables remain additive-only. This script is static defense-in-depth:
// migrations must not destroy bulletin state, and worker code must not delete
// bulletin issues.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const WORKER_DIR = path.join(REPO_ROOT, 'src', 'worker');
const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'manifest.ts');

function fail(msg) {
  console.error(`COEXIST-07 violation: ${msg}`);
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

if (existsSync(MIGRATIONS_DIR)) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    if (/\bDROP\s+TABLE\b[\s\S]*\b(?:bulletins|bulletin_errata|public\.issues)\b/i.test(sql)) {
      fail(`migrations/${f} contains DROP TABLE for bulletin or issue data`);
    }
    if (/\bDELETE\s+FROM\s+public\.issues\b/i.test(sql)) {
      fail(`migrations/${f} deletes public.issues rows; bulletin issues must survive disable`);
    }
    if (/\bALTER\s+TABLE\b[\s\S]*\b(?:bulletins|bulletin_errata|public\.issues)\b[\s\S]*\bDROP\s+COLUMN\b/i.test(sql)) {
      fail(`migrations/${f} drops a bulletin or issue column`);
    }
    if (/\bDROP\s+SCHEMA\s+plugin_clarity_pack/i.test(sql)) {
      fail(`migrations/${f} drops the plugin namespace`);
    }
  }
}

for (const f of walk(WORKER_DIR)) {
  const src = readFileSync(f, 'utf8');
  if (/\bctx\.issues\.delete\s*\(/.test(src)) {
    fail(`${path.relative(REPO_ROOT, f)} calls ctx.issues.delete; bulletin issues must persist`);
  }
}

if (existsSync(MANIFEST_PATH)) {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');
  if (/\b(onUninstall|destructiveUninstall|purgeOnDisable)\b/i.test(manifest)) {
    fail('src/manifest.ts declares a destructive uninstall hook');
  }
}

console.log('COEXIST-07 OK: bulletin issues and metadata are preserve-on-disable');
process.exit(0);
