// test/migrations/no-procedural-blocks.test.mjs
//
// Paperclip's plugin SQL validator rejects anonymous procedural blocks at
// install time with the message:
//
//     API error 400: Plugin SQL contains a disallowed statement or clause:
//     \bdo\s+(?:\$\$|language\b)
//
// Discovered during the Plan 02-04 install rehearsal on Countermoves
// Hostinger, 2026-05-14 -- 0003_situation_and_optin.sql had a defensive
// `DO $$ ... END $$;` existence-guard that blew up the install. This
// regression test scans every migrations/*.sql with the same regex the
// host enforces, so the next migration that introduces a procedural block
// fails `pnpm test` BEFORE an install attempt instead of mid-install.
//
// Comments are stripped before the scan to match the coexistence-check
// pattern (Paperclip's validator may or may not strip them; we are stricter
// only inside SQL bodies). If a future migration legitimately needs PL/pgSQL
// (e.g. a CREATE FUNCTION ... LANGUAGE plpgsql), the right fix is to file
// a Paperclip host issue for an opt-in capability rather than relax this
// test -- the plugin trust model assumes no procedural code in plugin DDL.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

// Verbatim from the API error message surfaced by Paperclip during the
// 2026-05-14 install attempt. Case-insensitive match per the `i` flag.
const FORBIDDEN_PATTERN = /\bdo\s+(?:\$\$|language\b)/i;

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

for (const f of files) {
  test(`Migration ${f} contains no DO procedural blocks (Paperclip plugin SQL validator)`, () => {
    const stripped = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    const match = stripped.match(FORBIDDEN_PATTERN);
    assert.equal(
      match,
      null,
      `migration ${f} contains a procedural block matching ${FORBIDDEN_PATTERN}; ` +
        `Paperclip's plugin SQL validator will reject this at install time. ` +
        `Match: ${match?.[0] ?? '<none>'}. ` +
        `Remove the procedural block; rely on the migration runner's ordering ` +
        `guarantee and CREATE TABLE IF NOT EXISTS for idempotency.`,
    );
  });
}
