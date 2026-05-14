#!/usr/bin/env node
// scripts/coexistence-checks/05-chat-comment-coexistence-stub.mjs
//
// COEXIST-05 STUB — Phase 4 ships the real chat surface with messages
// persisting as ordinary public.issue_comments (Decision #1). For Phase 2
// we cannot run the full disable-the-plugin-and-confirm-classic-comments-
// still-render check (the chat surface doesn't exist yet), so this check
// guards the structural invariant that supports Decision #1: clarity-pack
// must NOT create its own chat_messages table.
//
// Phase 4 replaces this with a real integration check.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

function fail(msg) {
  console.error(`COEXIST-05-stub violation: ${msg}`);
  process.exit(1);
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.log('COEXIST-05-stub OK: no migrations/ directory (skipping)');
  process.exit(0);
}

// Strip SQL comments so a doc-comment about chat_messages doesn't trip the check.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
for (const f of files) {
  const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  if (/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[\w.]*\bchat_messages\b/i.test(sql)) {
    fail(
      `${f} creates a chat_messages table — message content must live in public.issue_comments (Decision #1).`,
    );
  }
}

console.log('COEXIST-05-stub OK: Phase 4 will replace this with the real disable-plugin/messages-still-visible test');
process.exit(0);
