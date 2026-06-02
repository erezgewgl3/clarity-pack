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
// Plan 09-04 — the SHARED dispatch site + the handler read (cross-file wiring tie).
const POPOVER = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/owner-picker-popover.tsx'),
  'utf8',
);
const HANDLER = readFileSync(
  path.join(REPO_ROOT, 'src/worker/handlers/situation-assign-owner.ts'),
  'utf8',
);

test('row type carries the worker group + isPaused fields (R2 / D-04)', () => {
  assert.match(ROW, /group:\s*EmployeeGroup/);
  assert.match(ROW, /isPaused:\s*boolean/);
});

test('R4 — needs_you UNOWNED row mounts the OwnerPickerPopover (assign owner)', () => {
  assert.match(ROW, /<OwnerPickerPopover/);
  // Plan 11-04 (D-13/SC3) — the assign cluster is gated on the engine verdict's
  // genuinely-unowned affordance (showAssign = actionAffordance === 'assign'),
  // NOT the legacy ownerName string-match.
  assert.match(ROW, /showAssign/);
  assert.match(ROW, /actionAffordance === 'assign'/);
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

test('NO_UUID_LEAK render-scan — no targetAgentUuid/targetIssueUuid in a JSX expression across the 3 blocker surfaces (Plan 11-04 / D-15 / Pitfall 5)', () => {
  // The split-identity *Uuid fields are mutation-only — they must never appear
  // inside a JSX `{...}` expression (which would render them as visible text)
  // on ANY of the three blocker surfaces. The scrubbed awaitedPartyLabel is the
  // only awaited-party display string.
  const BANNER = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/needs-you-banner.tsx'),
    'utf8',
  );
  const PANEL = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/reader/live-blocker-panel.tsx'),
    'utf8',
  );
  // A *Uuid field is "rendered" only if it appears in a JSX TEXT-NODE expression
  // — i.e. `>{ … targetAgentUuid … }<` or inside a `{` … `}` adjacent to JSX
  // tags. A bare `targetAgentUuid: string | null;` TYPE declaration is NOT a
  // render (mirrors the existing ownerAgentId scan idiom on the line above).
  const JSX_TEXT_UUID = />\s*\{[^{}]*target(Agent|Issue)Uuid[^{}]*\}\s*</g;
  for (const [name, src] of [['employee-row', ROW], ['needs-you-banner', BANNER], ['live-blocker-panel', PANEL]]) {
    assert.equal(
      (src.match(JSX_TEXT_UUID) || []).length,
      0,
      `${name}.tsx renders a *Uuid field in a JSX text node (NO_UUID_LEAK violation)`,
    );
    // Belt-and-suspenders: no template-literal interpolation of a *Uuid either.
    assert.equal(
      (src.match(/\$\{[^}]*target(Agent|Issue)Uuid[^}]*\}/g) || []).length,
      0,
      `${name}.tsx interpolates a *Uuid into a template literal (NO_UUID_LEAK violation)`,
    );
  }
  // Each surface renders the scrubbed awaitedPartyLabel (the verdict display string).
  assert.match(ROW, /awaitedPartyLabel/, 'employee-row renders awaitedPartyLabel');
  assert.match(BANNER, /awaitedPartyLabel/, 'needs-you-banner renders awaitedPartyLabel');
  assert.match(PANEL, /awaitedPartyLabel/, 'live-blocker-panel renders awaitedPartyLabel');
});

// ---------------------------------------------------------------------------
// Plan 09-04 — the popover→action→handler wiring (the checker's blocker)
// ---------------------------------------------------------------------------

test('09-04 — the SHARED popover dispatches leafIssueUuid with the ?? leafIssueId fallback', () => {
  // The dispatch object MUST carry leafIssueUuid so the handler's
  // reqStr(params,'leafIssueUuid') can never be undefined at runtime.
  assert.match(
    POPOVER,
    /leafIssueUuid:\s*leafIssueUuid\s*\?\?\s*leafIssueId/,
    'popover must dispatch leafIssueUuid: leafIssueUuid ?? leafIssueId',
  );
  // The optional prop must exist on the props type + be in the useCallback deps.
  assert.match(POPOVER, /leafIssueUuid\?:\s*string/, 'optional leafIssueUuid?: string prop');
});

test('09-04 — leafIssueUuid is in the dispatchAssign useCallback dependency array', () => {
  // The deps array (closes over leafIssueUuid) must list it so the dispatch
  // does not capture a stale value.
  assert.match(
    POPOVER,
    /\[\s*assigning,\s*assignOwner,\s*companyId,\s*leafIssueId,\s*leafIssueUuid,\s*userId,\s*onAssigned\s*\]/,
    'dispatchAssign deps must include leafIssueUuid',
  );
});

test('09-04 WIRING TIE — popover dispatches leafIssueUuid AND handler reads reqStr(params,leafIssueUuid)', () => {
  // The dispatch key and the handler read must both be present so they cannot
  // silently diverge (cross-file assertion).
  assert.match(POPOVER, /leafIssueUuid/, 'popover references leafIssueUuid');
  assert.match(
    HANDLER,
    /reqStr\(\s*params\s*,\s*'leafIssueUuid'\s*\)/,
    'handler reads reqStr(params, leafIssueUuid)',
  );
});

test('09-04 — employee-row feeds BOTH props to the OwnerPickerPopover (display + mutation)', () => {
  // The picker mount must receive the human key (display + log/echo) AND the
  // UUID (the mutation id). chain.leafIssueUuid is string|null; the prop is
  // string|undefined, so a ?? undefined coercion is type-safe and expected.
  assert.match(ROW, /leafIssueId=\{chain\.leafIssueId\}/, 'leafIssueId={chain.leafIssueId}');
  assert.match(
    ROW,
    /leafIssueUuid=\{chain\.leafIssueUuid(\s*\?\?\s*undefined)?\}/,
    'leafIssueUuid={chain.leafIssueUuid ?? undefined}',
  );
});

test('09-04 — employee-row blockerChain type mirror carries leafIssueUuid', () => {
  assert.match(ROW, /leafIssueUuid:\s*string\s*\|\s*null/, 'blockerChain type carries leafIssueUuid');
});

test('09-04 — the backlog-style single-prop mount still sends the UUID via the fallback', () => {
  // The backlog expander passes ONLY leafIssueId={row.issueId} (already a UUID).
  // The popover's ?? leafIssueId fallback feeds that same UUID as leafIssueUuid
  // WITHOUT any change to the backlog mount. Proven at the popover level: the
  // dispatch uses leafIssueUuid ?? leafIssueId, so a missing leafIssueUuid prop
  // falls back to the leafIssueId (the UUID the backlog passes).
  const EXPANDER = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx'),
    'utf8',
  );
  // The backlog mount is UNCHANGED — single leafIssueId prop, no leafIssueUuid.
  assert.match(EXPANDER, /leafIssueId=\{row\.issueId\}/, 'backlog passes leafIssueId={row.issueId}');
  assert.doesNotMatch(EXPANDER, /leafIssueUuid=/, 'backlog mount is NOT given a leafIssueUuid prop');
  // And the popover fallback covers it.
  assert.match(POPOVER, /leafIssueUuid\s*\?\?\s*leafIssueId/, 'fallback feeds the backlog UUID');
});

test('09-04 NO_UUID_LEAK — leafIssueUuid never rendered as a JSX text node (row + popover)', () => {
  // leafIssueUuid is an action arg / prop only — never a visible string.
  assert.equal(
    (ROW.match(/>\s*\{[^}]*leafIssueUuid[^}]*\}\s*</g) || []).length,
    0,
    'employee-row renders no leafIssueUuid text node',
  );
  assert.equal(
    (POPOVER.match(/>\s*\{[^}]*leafIssueUuid[^}]*\}\s*</g) || []).length,
    0,
    'popover renders no leafIssueUuid text node',
  );
  // The human display key remains the only displayed identifier.
  assert.match(ROW, /Open \$\{chain\.leafIssueId\} ↗/, 'human leafIssueId still the display id');
});
