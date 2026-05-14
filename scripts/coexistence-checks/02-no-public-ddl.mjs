#!/usr/bin/env node
// scripts/coexistence-checks/02-no-public-ddl.mjs
//
// COEXIST-02 — clarity-pack migrations must never reference public.* as a
// DDL target. The plugin namespace is plugin_clarity_pack_cdd6bda4bd; all
// DDL must qualify with that prefix (02-01 SMOKE-FINDINGS Finding #4).
//
// Detection: grep every file under migrations/ for the substring `public.`
// in a DDL context. We deliberately accept any reference (not just CREATE/
// ALTER/DROP) because there's no legitimate reason for clarity-pack to
// touch the public schema at all — `from public.x` would also fail.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

function fail(msg) {
  console.error(`COEXIST-02 violation: ${msg}`);
  process.exit(1);
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.log('COEXIST-02 OK: no migrations/ directory (skipping)');
  process.exit(0);
}

// Strip SQL comments so a doc-comment about public.* doesn't trip the check.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
let failed = false;
for (const f of files) {
  const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  if (/\bpublic\.\w+/.test(sql)) {
    console.error(`COEXIST-02 violation: ${f} references public.* — clarity-pack DDL must use the plugin namespace only`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`COEXIST-02 OK: no public.* references in ${files.length} migration file(s)`);
process.exit(0);
