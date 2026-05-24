// test/ui/continue-in-chat-button-d9.test.mjs
//
// Plan 04.2-06 D9 — source-grep contract test. The Reader-header
// Continue-in-chat button must NEVER leak the assignee's agent UUID into the
// visible button text. Pre-D9 fallback was `result.assigneeAgentId ||
// 'this employee'`, which made the button render
// "Continue in chat with 618ebd0d-4d39-45f4-8380-3b30b205d02d →" on the
// 2026-05-24 Countermoves drill. The fix consumes a new `assigneeName`
// field that chat.openForIssue resolves server-side via ctx.agents.get(...)
// and falls back to the friendly literal 'this employee' when the lookup
// degrades — NEVER to the UUID.
//
// Same source-grep idiom as chat-url-params.test.mjs (Node's test runner
// does not load .tsx).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'continue-in-chat-button.tsx',
);

function code() {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('D9 — ChatOpenForIssueResult type carries optional assigneeName', () => {
  const src = code();
  assert.match(
    src,
    /assigneeName\?:\s*string\s*\|\s*null/,
    'expected the ChatOpenForIssueResult type to expose assigneeName?: string | null',
  );
});

test('D9 — employeeLabel falls back to "this employee", NOT to assigneeAgentId', () => {
  const src = code();
  // The exact fallback expression: prefer assigneeName, else friendly literal.
  assert.match(
    src,
    /employeeLabel\s*=\s*\(?\s*typeof\s+result\.assigneeName[\s\S]{0,80}result\.assigneeName\s*\)?\s*\|\|\s*'this employee'/,
    'expected employeeLabel = (typeof result.assigneeName === "string" && result.assigneeName) || "this employee"',
  );
  // The defect form is explicitly forbidden.
  assert.doesNotMatch(
    src,
    /employeeLabel\s*=\s*result\.assigneeAgentId\s*\|\|/,
    'employeeLabel must NOT fall back to result.assigneeAgentId — that leaks the raw UUID into the visible button label (drill defect D9)',
  );
});
