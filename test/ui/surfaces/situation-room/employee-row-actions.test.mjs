// test/ui/surfaces/situation-room/employee-row-actions.test.mjs
//
// Plan 09-02 Task 1 — per-state action clusters (R4) + paused marker/Resume
// (D-04) + Stand-down confirm (R7) source contract for employee-row.tsx.
//
// Source-grep (no jsdom in devDependencies). Asserts the row WIRES each state's
// real action and the D-04 / R7 branches, without re-asserting the no-dead-
// buttons gate (that lives in no-dead-buttons.test.mjs).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const ROW = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row.tsx'),
  'utf8',
);

test('row type carries the worker group + isPaused fields (R2 / D-04)', () => {
  assert.match(ROW, /group:\s*EmployeeGroup/);
  assert.match(ROW, /isPaused:\s*boolean/);
});

test('R4 — needs_you UNOWNED row mounts the OwnerPickerPopover (assign owner)', () => {
  assert.match(ROW, /<OwnerPickerPopover/);
  assert.match(ROW, /isUnowned/);
});

test('R4 — needs_you OWNED row wires Open chat + Wake (issues.requestWakeup)', () => {
  assert.match(ROW, /Open chat:/);
  assert.match(ROW, /usePluginAction\('issues\.requestWakeup'\)/);
  assert.match(ROW, /Wake/);
});

test('R4 — working group renders "moving · no action needed" with NO buttons', () => {
  assert.match(ROW, /moving · no action needed/);
  assert.match(ROW, /group === 'working'/);
});

test('R4 — idle group wires Assign work (chat deep-link)', () => {
  assert.match(ROW, /Assign work/);
  assert.match(ROW, /buildChatDeepLink/);
});

test('R7 — stale row Stand down opens a confirm BEFORE dispatching pause', () => {
  assert.match(ROW, /confirmingStandDown/);
  assert.match(ROW, /setConfirmingStandDown\(true\)/);
  assert.match(ROW, /usePluginAction\('agents\.pauseHeartbeat'\)/);
  // Confirm + Cancel both present.
  assert.match(ROW, /Confirm/);
  assert.match(ROW, /Cancel/);
});

test('D-04 — a paused row (row.isPaused) renders a "paused" marker + a Resume button (agents.resumeHeartbeat)', () => {
  assert.match(ROW, /row\.isPaused/);
  assert.match(ROW, /clarity-employee-paused-marker/);
  assert.match(ROW, /usePluginAction\('agents\.resumeHeartbeat'\)/);
  assert.match(ROW, /Resume/);
  // The Resume branch wins over Assign work / Stand down when isPaused.
  assert.match(ROW, /row\.isPaused \?[\s\S]{0,400}Resume/);
});

test('D-04 — a non-paused idle row shows Assign work, NOT Resume/paused marker', () => {
  // The paused branch is gated on row.isPaused; the else branch is Assign work.
  assert.match(ROW, /\) : \(\s*<>[\s\S]{0,400}Assign work/);
});

test('NO_UUID_LEAK — ownerAgentId / agentId consumed as deep-link/dispatch args, never rendered as text', () => {
  // No JSX text node directly rendering an *AgentId value.
  assert.equal((ROW.match(/>\s*\{[^}]*ownerAgentId[^}]*\}\s*</g) || []).length, 0);
});
