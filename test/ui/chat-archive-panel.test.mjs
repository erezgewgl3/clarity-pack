// test/ui/chat-archive-panel.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the new archive panel.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'archive-panel.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('archive-panel.tsx: file exists at the expected path', () => {
  assert.ok(
    existsSync(path.join(CHAT_DIR, 'archive-panel.tsx')),
    'src/ui/surfaces/chat/archive-panel.tsx must exist',
  );
});

test('archive-panel.tsx: exports ArchivePanel as a named function component', () => {
  assert.match(SRC, /export function ArchivePanel/);
});

test('archive-panel.tsx: returns null when open=false (no render)', () => {
  const c = code(SRC);
  assert.match(
    c,
    /if\s*\(!open\)\s*return\s+null/,
    'must short-circuit when open is false',
  );
});

test('archive-panel.tsx: empty state renders only when archivedTopics is empty', () => {
  // Empty-state copy + a guard that hides search/footer.
  assert.match(SRC, /No archived topics\. Topics you archive will appear here\./);
  const c = code(SRC);
  assert.match(c, /totalCount\s*===?\s*0/, 'gates the empty branch on totalCount === 0');
});

test('archive-panel.tsx: each row renders click-to-open + opens onOpenTopic with topicIssueId', () => {
  const c = code(SRC);
  assert.match(c, /onClick=\{\(\)\s*=>\s*onOpenTopic\(/);
  assert.match(c, /chat-archive-panel__row/);
  assert.match(c, /↵ Click to open · read-only/);
});

test('archive-panel.tsx: Unarchive button stop-propagates AND calls onUnarchive', () => {
  const c = code(SRC);
  assert.match(
    c,
    /e\.stopPropagation\(\);\s*onUnarchive\(/,
    'unarchive button must stopPropagation before calling onUnarchive',
  );
});

test('archive-panel.tsx: real-time search filters by title (case-insensitive substring)', () => {
  const c = code(SRC);
  assert.match(c, /searchQuery/);
  assert.match(c, /toLowerCase\(\)/);
  assert.match(c, /\.includes\(/);
});

test('archive-panel.tsx: footer shows "Showing N of M" + the View all stub', () => {
  assert.match(SRC, /Showing /);
  assert.match(SRC, /View all archived/);
});

test('archive-panel.tsx: View all link is a no-op stub for Phase 4.2', () => {
  const c = code(SRC);
  // The stub must log a console.warn referencing the 4.2 deferral memory.
  assert.match(c, /console\.warn/);
  assert.match(SRC, /phase-4\.2-deferred-from-4\.1/, 'memory pointer present');
});

test('archive-panel.tsx: Escape key closes the panel', () => {
  const c = code(SRC);
  assert.match(c, /e\.key\s*===?\s*['"]Escape['"]/);
  assert.match(c, /onClose\(\)/);
});

test('archive-panel.tsx: outside-click closes the panel', () => {
  const c = code(SRC);
  // mousedown listener + Node.contains() outside-click check.
  assert.match(c, /mousedown/);
  assert.match(c, /contains\(/);
});

test('archive-panel.tsx: header has Close button + aria-label', () => {
  assert.match(SRC, /chat-archive-panel__close/);
  assert.match(SRC, /aria-label="Close archive panel"/);
});

test('archive-panel.tsx: no raw fetch / no dangerouslySetInnerHTML', () => {
  const c = code(SRC); // strip comments — the file's own header comment mentions "raw fetch"
  assert.doesNotMatch(c, /fetch\(/);
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/);
});
