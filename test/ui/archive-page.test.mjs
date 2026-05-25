// test/ui/archive-page.test.mjs
//
// Plan 05-08 Task 4 — source-grep contract tests for the new ArchivePage.
//
// Pins the load-bearing shape:
//   AP1: three-gate composition (opt-in, companyId, userId) with the same
//        fallbacks as bulletin/index.tsx + chat/index.tsx.
//   AP2: dispatches chat.archivedTopics with { companyId, userId } and
//        WITHOUT employeeAgentId — the Plan 05-08 Task 2 company-scoped path.
//   AP3: checkbox selection state + sticky bulk action bar.
//   AP4: bulk-unarchive click dispatches chat.topic.bulkUnarchive +
//        toast "N topics unarchived" (no confirmation modal).
//   AP5: search input filters by title case-insensitively.
//   AP6: employee filter populated from chat.roster.
//   AP7: NO_UUID_LEAK — rendered rows show employee names (resolved via
//        roster), NEVER raw UUIDs.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PAGE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'archive',
  'archive-page.tsx',
);
const SRC = readFileSync(ARCHIVE_PAGE, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('AP-file: archive-page.tsx exists at expected path', () => {
  assert.ok(existsSync(ARCHIVE_PAGE), 'src/ui/surfaces/archive/archive-page.tsx must exist');
});

test('AP-export: exports ArchivePage as a named function', () => {
  assert.match(SRC, /export function ArchivePage/);
});

// ---- AP1 — three-gate composition (opt-in -> companyId -> userId) -------

test('AP1: three-gate composition (useOptIn -> useResolvedCompanyId -> useResolvedUserId)', () => {
  const c = code(SRC);
  assert.match(c, /useOptIn/);
  assert.match(c, /useResolvedCompanyId/);
  assert.match(c, /useResolvedUserId/);
  // Opt-in gate renders EnableClarityCta surfaceName="Archive".
  assert.match(c, /EnableClarityCta\s+surfaceName=["']Archive["']/);
});

test('AP1: error fallback for missing companyId / userId', () => {
  const c = code(SRC);
  assert.match(c, /no-company-context/);
  assert.match(c, /no-user-context/);
});

// ---- AP2 — chat.archivedTopics dispatch shape ---------------------------

test('AP2: ArchivePage fetches chat.archivedTopics WITHOUT employeeAgentId', () => {
  const c = code(SRC);
  assert.match(c, /usePluginData[\s\S]*chat\.archivedTopics/);
  // The fetch params object includes companyId + userId but NOT employeeAgentId.
  // Find the chat.archivedTopics call and inspect its surrounding region.
  const call = c.match(/usePluginData<[^>]*>\(\s*['"]chat\.archivedTopics['"]\s*,\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(call, 'usePluginData call for chat.archivedTopics is present');
  assert.doesNotMatch(call[0], /employeeAgentId/);
});

// ---- AP3 — checkbox selection + sticky bulk action bar ------------------

test('AP3: row checkboxes + sticky bulk action bar with N count', () => {
  const c = code(SRC);
  // Selection Set state.
  assert.match(c, /selected/);
  assert.match(c, /Selected\s*\(\{?\s*selected\.size\s*\}?\)/);
  // Sticky bulk bar region.
  assert.match(c, /clarity-archive-bulk-bar/);
  assert.match(c, /role=["']checkbox["']|type=["']checkbox["']/);
});

// ---- AP4 — bulk-unarchive dispatches chat.topic.bulkUnarchive + toast ---

test('AP4: bulk-unarchive click dispatches chat.topic.bulkUnarchive', () => {
  const c = code(SRC);
  assert.match(c, /usePluginAction\(\s*['"]chat\.topic\.bulkUnarchive['"]\s*\)/);
  // The handler passes companyId, userId, topicIssueIds.
  assert.match(c, /topicIssueIds/);
});

test('AP4: success path fires toast "N topics unarchived" (no confirmation modal)', () => {
  const c = code(SRC);
  assert.match(c, /showToast/);
  assert.match(c, /topics unarchived/);
  // No confirmation modal — should not call window.confirm.
  assert.doesNotMatch(c, /window\.confirm/);
});

// ---- AP5 — search input filters by title case-insensitively -------------

test('AP5: search input filters rows by title case-insensitively', () => {
  const c = code(SRC);
  assert.match(c, /searchQuery/);
  assert.match(c, /toLowerCase\(\)/);
  assert.match(c, /\.includes\(/);
});

// ---- AP6 — employee filter from chat.roster -----------------------------

test('AP6: employee filter dropdown populated from chat.roster', () => {
  const c = code(SRC);
  assert.match(c, /usePluginData<RosterResult>\(\s*['"]chat\.roster['"]/);
  assert.match(c, /All employees/);
});

// ---- AP7 — NO_UUID_LEAK: employee name lookup, fallback to literal ------

test('AP7: row shows employee NAME (from roster lookup), never raw UUID', () => {
  const c = code(SRC);
  // Render uses employeeNameById.get(...) ?? 'unassigned' — NEVER a UUID.
  assert.match(c, /employeeNameById\.get/);
  // The literal fallback (never the UUID itself).
  assert.match(c, /'unassigned'|"unassigned"/);
  // No place falls back to row.employeeAgentId for display.
  assert.doesNotMatch(c, /row\.employeeAgentId\s*\}\s*</);
});

// ---- security: no dangerouslySetInnerHTML, no raw fetch -----------------

test('AP-sec: archive-page.tsx uses no dangerouslySetInnerHTML / no raw fetch', () => {
  const c = code(SRC);
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(c, /\bfetch\s*\(/);
});
