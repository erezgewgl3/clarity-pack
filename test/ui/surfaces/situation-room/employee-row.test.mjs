// test/ui/surfaces/situation-room/employee-row.test.mjs
//
// Plan 08-02 Task 1 — the per-employee Situation Room row (ROOM-13/16/17).
//
// EmployeeRow renders: state dot + name + role + state pill + age + focus line,
// and — when blocked — the inline chain leaf (`└ blocked by <action> (<leaf>)`)
// plus an "Open chat with <owner>" button that navigates via the reused ROOM-09
// buildChatDeepLink employee-only carrier. idle/stale rows render an amber state
// + an "Assign work" / "Stand down" affordance (write-path deferred to v1.2.0+).
//
// Convention: source-grep (no jsdom in devDependencies). Mirrors
// org-blocked-backlog-banner.test.mjs (Plan 07-03).

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
const CSS = readFileSync(
  path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Exports + reused carriers
// ---------------------------------------------------------------------------

test('exports EmployeeRow', () => {
  assert.match(ROW, /export function EmployeeRow/);
});

test('imports buildChatDeepLink from the shared deep-link contract (reuse ROOM-09 carrier)', () => {
  assert.match(ROW, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

test('imports formatAge (reuse the age chip helper)', () => {
  assert.match(ROW, /formatAge/);
});

// ---------------------------------------------------------------------------
// Test 1 — running state renders name/role/focus/age, NO chain leaf
// ---------------------------------------------------------------------------

test('row renders name + role + focusLine + focus ref as React text nodes', () => {
  assert.match(ROW, /\{row\.name\}/);
  assert.match(ROW, /\{row\.role\}/);
  assert.match(ROW, /\{row\.focusLine\}/);
  assert.match(ROW, /row\.focusIssueId/);
});

test('row carries class clarity-employee-row + clarity-state-${row.state}', () => {
  assert.match(ROW, /clarity-employee-row/);
  assert.match(ROW, /clarity-state-\$\{row\.state\}/);
});

test('focus line is conditionally rendered only when focusLine is non-null (idle hides it)', () => {
  // Test 1 + Test 3 invariant: running shows focusLine; idle (focusLine null) hides it.
  assert.match(ROW, /row\.focusLine\s*&&/);
});

// ---------------------------------------------------------------------------
// Test 2 — blocked state renders the inline chain leaf + open-chat button
// ---------------------------------------------------------------------------

test('blocked row renders the chain leaf (humanAction) only when state === blocked', () => {
  assert.match(ROW, /row\.state === 'blocked'/);
  assert.match(ROW, /row\.blockerChain\.humanAction/);
});

test('blocked row renders an "Open chat with <owner>" button', () => {
  assert.match(ROW, /Open chat with /);
  assert.match(ROW, /row\.blockerChain\.ownerName/);
});

// ---------------------------------------------------------------------------
// M2 — leaf segment hidden when leafIssueId is null (never "()" empty parens)
// ---------------------------------------------------------------------------

test('chain leaf segment renders only when leafIssueId is non-null (M2)', () => {
  assert.match(ROW, /row\.blockerChain\.leafIssueId\s*&&/);
});

// ---------------------------------------------------------------------------
// Test 7 — deep link wiring (B1 — AGENT-uuid threading)
// ---------------------------------------------------------------------------

test('builds the deep link via buildChatDeepLink({route: employee-only}) once', () => {
  assert.equal(
    (ROW.match(/route: 'employee-only'/g) || []).length,
    1,
    'exactly one employee-only deep-link build',
  );
});

test('B1 — assigneeAgentId is row.blockerChain.ownerAgentId (an AGENT uuid)', () => {
  assert.match(ROW, /assigneeAgentId: row\.blockerChain\.ownerAgentId/);
});

test('open-chat button is disabled when the deep link is null (unresolvable prefix)', () => {
  assert.match(ROW, /disabled=\{!deepLink\}/);
});

test('open-chat onClick navigates with the deep link target', () => {
  assert.match(ROW, /navigate\(deepLink\.to\)/);
});

// ---------------------------------------------------------------------------
// Test 6 — NO_UUID_LEAK: ownerAgentId is never a visible JSX text node
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — ownerAgentId never rendered as a visible JSX text node', () => {
  // It may appear as a buildChatDeepLink argument, but never as `>{...ownerAgentId...}<`.
  assert.equal(
    (ROW.match(/>\s*\{[^}]*ownerAgentId[^}]*\}\s*</g) || []).length,
    0,
    'ownerAgentId must not appear as a visible JSX text node',
  );
});

// ---------------------------------------------------------------------------
// Test 3 / 4 — idle + stale render amber + assign/stand-down affordance
// ---------------------------------------------------------------------------

test('idle/stale rows render an action affordance (Assign work / Stand down)', () => {
  assert.match(ROW, /row\.state === 'idle' \|\| row\.state === 'stale'/);
  assert.match(ROW, /Assign work/);
  assert.match(ROW, /Stand down/);
});

test('idle/stale affordance write-path deferred is documented (v1.2.0 comment)', () => {
  assert.match(ROW, /v1\.2\.0/);
});

// ---------------------------------------------------------------------------
// Security — React text only, no innerHTML
// ---------------------------------------------------------------------------

test('row contains NO dangerouslySetInnerHTML', () => {
  assert.equal(
    (ROW.match(/dangerouslySetInnerHTML/g) || []).length,
    0,
    'row must render React text nodes only (T-08-UI-01)',
  );
});

// ---------------------------------------------------------------------------
// CSS — 5 state tokens + scoped row chrome
// ---------------------------------------------------------------------------

test('CSS defines all 5 LOCKED state tokens + unknown fallback', () => {
  for (const tok of [
    'running',
    'reviewing',
    'blocked',
    'idle',
    'stale',
    'unknown',
  ]) {
    assert.match(CSS, new RegExp(`--clarity-state-${tok}:`), `--clarity-state-${tok} token`);
  }
});

test('CSS: .clarity-employee-row is scoped under [data-clarity-surface=situation-room]', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-employee-row/);
});

test('CSS: .clarity-employee-state-dot + .clarity-employee-chain are scoped', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-employee-state-dot/);
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-employee-chain/);
});
