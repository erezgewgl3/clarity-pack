#!/usr/bin/env node
// scripts/coexistence-checks/03-disable-preserves-data.mjs
//
// COEXIST-03 — disabling clarity-pack must preserve data. Code-level check:
//   - package.json has no `paperclipPlugin.uninstallScript` or any
//     destructive lifecycle hook
//   - no migration file contains DROP TABLE (additive-only — Phase 1
//     Decision; 02-01 SMOKE-FINDINGS Check D confirmed host does not invoke
//     DROP on disable, and our migrations must mirror that pact)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const PKG_PATH = path.resolve(process.cwd(), 'package.json');
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

function fail(msg) {
  console.error(`COEXIST-03 violation: ${msg}`);
  process.exit(1);
}

// Check package.json for destructive hooks.
if (existsSync(PKG_PATH)) {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  const plugin = pkg.paperclipPlugin ?? {};
  for (const k of ['uninstallScript', 'preUninstall', 'destructiveUninstall']) {
    if (plugin[k]) {
      fail(`package.json declares paperclipPlugin.${k} — destructive uninstall hooks violate COEXIST-03`);
    }
  }
  // Also forbid lifecycle scripts that would run before npm install.
  const scripts = pkg.scripts ?? {};
  for (const k of ['preuninstall', 'postuninstall']) {
    if (scripts[k]) {
      fail(`package.json declares "scripts.${k}" — destructive uninstall hooks violate COEXIST-03`);
    }
  }
}

// Check every migration file for DROP TABLE. Strip SQL line comments
// (-- ...) and block comments (/* ... */) first so a comment describing
// the validator's keyword list doesn't trigger a false positive.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

if (existsSync(MIGRATIONS_DIR)) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    if (/\bDROP\s+TABLE\b/i.test(sql)) {
      fail(`migrations/${f} contains DROP TABLE — additive-only rule violated`);
    }
  }
}

console.log('COEXIST-03 OK: no destructive uninstall, no DROP TABLE in migrations/');
process.exit(0);
