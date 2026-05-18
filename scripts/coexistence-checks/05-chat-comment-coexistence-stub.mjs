#!/usr/bin/env node
// scripts/coexistence-checks/05-chat-comment-coexistence-stub.mjs
//
// COEXIST-05 — CHAT-02 structural invariant for the Employee Chat surface.
//
// Decision #1 / CHAT-02: chat messages persist as ordinary
// public.issue_comments rows; message CONTENT never lives in a clarity-pack
// table. Disabling the plugin leaves every message visible as ordinary
// threaded comments in classic Paperclip.
//
// HISTORY: the Phase 2 STUB forbade a chat_messages table outright. Phase 4
// RESEARCH D-09 then resolved decisively that ctx.issues.createComment
// accepts no metadata field and public.issue_comments has no supersedes
// column — so a plugin-namespace chat_messages SIDE TABLE is MANDATORY to
// hold the message_uuid -> comment_id idempotency map, the D-11 supersedes
// link and the D-13 pin flag. That side table maps IDs only.
//
// The real CHAT-02 invariant is therefore NOT "no chat_messages table" but
// "the chat_messages table must NOT carry a `body` column" — content stays
// in public.issue_comments. This check enforces exactly that, against every
// migrations/*.sql file. Plan 04-02 replaced the stub rule with this one.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

function fail(msg) {
  console.error(`COEXIST-05 violation: ${msg}`);
  process.exit(1);
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.log('COEXIST-05 OK: no migrations/ directory (skipping)');
  process.exit(0);
}

// Strip SQL comments so a doc-comment doesn't trip the check.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// Extract the parenthesised column body of a `CREATE TABLE ... chat_messages
// ( ... )` block from comment-stripped SQL.
function chatMessagesTableBody(sql) {
  const m = sql.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w.]*\bchat_messages\b\s*\(([\s\S]*?)\)\s*;/i,
  );
  return m ? m[1] : null;
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
for (const f of files) {
  const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  const body = chatMessagesTableBody(sql);
  if (!body) continue;
  // CHAT-02: the side table maps IDs only. A `body` column would mean message
  // content lives in a clarity-pack table — a coexistence violation.
  if (/(^|,)\s*body\s+/i.test(body)) {
    fail(
      `${f} chat_messages declares a body column — message content must live ` +
        `in public.issue_comments, not a clarity-pack table (Decision #1 / CHAT-02).`,
    );
  }
}

console.log(
  'COEXIST-05 OK: chat_messages (if present) is an ID-mapping side table with no body column (CHAT-02)',
);
process.exit(0);
