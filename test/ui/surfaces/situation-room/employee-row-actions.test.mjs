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

// Plan 11-07 (Task 3 / CR-01 test-gap) — the behavioral UUID-pattern guard.
// We import the REAL scrub so the render-scan asserts the rendered label string
// is UUID-free, not merely that *Uuid field names are absent from JSX. This is
// the assertion that would have CAUGHT CR-01: a terminal whose label embeds a
// raw UUID must produce an awaitedPartyLabel matching NO UUID pattern.
import { scrubHumanAction } from '../../../../src/shared/scrub-human-action.ts';

// The exact UUID shape (mirrors src/shared/scrub-human-action.ts UUID_RE).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
  // WR-02: the working-group -> in-motion fallback now lives in the shared
  // visualTierOf helper (tier-utils.ts); the row body gates the calm "moving"
  // line on visualTier === 'in-motion' (the In-motion variant).
  assert.match(ROW, /visualTier\s*===\s*'in-motion'/);
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
// Plan 11-07 (Task 3) — UPGRADED NO_UUID_LEAK render-scan for the Reader panel.
// The CR-01 test-gap: the existing scan above only checks *Uuid FIELD-NAME
// absence. CR-01 slipped through because the panel rendered RAW t.label (which
// embeds UUIDs straight off the engine), and no test asserted the rendered
// LABEL TEXT was UUID-free. These tests close that gap.
// ---------------------------------------------------------------------------

test('CR-01 source-scan — live-blocker-panel.blockerLine() reads data.awaitedPartyLabel, NOT raw t.label, for every UUID-bearing kind', () => {
  // REGRESSION PROOF: reverting Task 1 (rendering t.label) makes this FAIL,
  // because the assertion keys on awaitedPartyLabel being the rendered string
  // and on NO `t.label` survival inside blockerLine().
  const PANEL = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/reader/live-blocker-panel.tsx'),
    'utf8',
  );
  // Isolate the blockerLine() body — the function that produces the rendered
  // headline for all 8 terminal kinds.
  const m = PANEL.match(/function blockerLine\([\s\S]*?\n\}/);
  assert.ok(m, 'blockerLine() function must exist in live-blocker-panel.tsx');
  const body = m[0];
  // It renders the scrubbed display string for the UUID-bearing kinds.
  assert.match(body, /data\.awaitedPartyLabel/, 'blockerLine renders data.awaitedPartyLabel');
  // It must NOT read t.label inside any returned/rendered string. t.kind is the
  // ONLY terminal field that survives (the switch discriminant); t.label is the
  // raw leak source CR-01 was.
  assert.doesNotMatch(
    body,
    /\bt\.label\b/,
    'blockerLine() must NOT render raw t.label (CR-01 leak source) — only t.kind survives for the switch',
  );
});

test('CR-01 behavioral guard — a terminal whose label embeds a raw UUID scrubs to a UUID-FREE awaitedPartyLabel (the assertion that would have caught CR-01)', () => {
  // Feed a BlockerChainResult terminal carrying a real hex UUID in its label —
  // the exact shape the pure engine emits before the 11-06 worker scrub. The
  // scrubbed output (what the panel now renders via data.awaitedPartyLabel) must
  // match NO UUID pattern across every UUID-bearing kind. A raw-UUID render
  // (pre-fix) would FAIL this; the scrubbed render PASSES.
  const AGENT = '11111111-2222-3333-4444-555555555555';
  const VIEWER = '99999999-8888-7777-6666-555555555555';
  const LEAF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const emptyNames = new Map(); // unresolved → forces the agent#<8> short-form fallback

  /** Each UUID-bearing kind, with a label that embeds a raw UUID exactly as the
   *  pure engine would produce it. */
  const fixtures = [
    { kind: 'AWAITING_HUMAN', userId: VIEWER, label: `Waiting on ${VIEWER}` },
    { kind: 'AWAITING_AGENT_WORKING', agentId: AGENT, label: `${AGENT} is working` },
    { kind: 'AWAITING_AGENT_STUCK', agentId: AGENT, label: `${AGENT} is stuck` },
    { kind: 'SELF_RESOLVING', etaIso: '2026-06-02T00:00:00.000Z', label: `${AGENT} ETA 2026-06-02` },
    { kind: 'EXTERNAL', label: `External dependency ${LEAF}` },
    { kind: 'CYCLE', cycleNodes: [LEAF], label: `Cycle through ${LEAF}` },
    { kind: 'UNOWNED', label: `Leaf ${LEAF} has no owner` },
    { kind: 'UNCLASSIFIED', label: `Could not classify ${LEAF}` },
  ];

  for (const terminal of fixtures) {
    // Sanity: the RAW label DOES carry a UUID (so a raw-render would have leaked).
    assert.match(
      terminal.label,
      UUID_RE,
      `fixture ${terminal.kind} must embed a raw UUID so this guard is meaningful`,
    );
    const scrubbed = scrubHumanAction(terminal, VIEWER, emptyNames);
    // The scrubbed string — the value the Reader panel renders — is UUID-FREE.
    assert.doesNotMatch(
      scrubbed,
      UUID_RE,
      `scrubbed awaitedPartyLabel for ${terminal.kind} still embeds a UUID (NO_UUID_LEAK / CR-01 violation): ${scrubbed}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Plan 21-03 Task 1 (STUCK-01 / D-3) — SUPERSEDES T1-C. A Watch-tier stuck row
// now mounts the shared <ReplyInPlace variant='nudge'> (reply-to-unstick) in
// place of the former "assign an owner" copy. After the Phase-21 engine flip
// (21-01) a stuck agent carries actionAffordance 'nudge', not 'assign', so the
// OwnerPickerPopover no longer fires for stuck rows; the operator resumes the
// agent by replying in place (Shape-B answer-comment recipe). The row stays in
// the QUIET Watch tier (no Needs-you promotion). Owner reassignment stays
// reachable via Open↗ / the leaf page (21-CONTEXT Deferred Ideas).
// ---------------------------------------------------------------------------

test('21-03 — the Watch-tier stuck row mounts ReplyInPlace(variant=nudge), not the assign-owner dead-end', () => {
  // The stuck Watch branch is gated on showNudge (=== 'nudge').
  assert.match(
    ROW,
    /const showNudge = chain\?\.actionAffordance === 'nudge'/,
    'employee-row must gate the stuck branch on showNudge (actionAffordance === nudge)',
  );
  // The Watch-tier body mounts the shared primitive with variant="nudge".
  assert.match(
    ROW,
    /showNudge\s*\?[\s\S]*?<ReplyInPlace[\s\S]*?variant="nudge"/,
    'Watch-tier stuck row must mount <ReplyInPlace variant="nudge">',
  );
  // The old "assign an owner to unblock" stuck copy must be gone (superseded).
  assert.doesNotMatch(
    ROW,
    /agent stuck · assign an owner to unblock/,
    'the former "— agent stuck · assign an owner" Watch-tier copy must be removed',
  );
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

test('09-04/14-03/14-WR-02 — the backlog OwnerPickerPopover (assign) mount sends the UUID via leafIssueUuid while displaying the human key', () => {
  // Phase 09-04 original contract fed the assign mutation its UUID by passing
  // leafIssueId={row.issueId} (a UUID) and relying on the popover's
  // `leafIssueUuid ?? leafIssueId` fallback. That LEAKED the UUID to the toast
  // (NO_UUID_LEAK breach — 14-REVIEW WR-02).
  //
  // Corrected contract (14-WR-02): the assign mount now passes
  //   leafIssueId={row.identifier}                 (HUMAN key — display/echo only)
  //   leafIssueUuid={row.leafIssueUuid ?? row.issueId}   (UUID — mutation id, dispatch-only)
  // so the popover's `leafIssueUuid ?? leafIssueId` fallback STILL feeds a UUID to
  // situation.assignOwner (mutation unchanged), while the displayed/echoed id is the
  // human identifier (leak fixed). For a genuinely-unowned orphan the leaf IS the
  // orphan, so row.leafIssueUuid === row.issueId and the assign target is unchanged.
  const EXPANDER = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx'),
    'utf8',
  );
  // Isolate the OwnerPickerPopover JSX block (the assign mount).
  const ownerPickerMount = EXPANDER.match(/<OwnerPickerPopover[\s\S]*?\/>/);
  assert.ok(ownerPickerMount, 'backlog mounts OwnerPickerPopover for the assign branch');
  // The assign mount displays the HUMAN key, not the UUID (NO_UUID_LEAK).
  assert.match(
    ownerPickerMount[0],
    /leafIssueId=\{row\.identifier\}/,
    'backlog assign mount passes leafIssueId={row.identifier} (human key — no UUID leak)',
  );
  // The mutation id is carried explicitly as a UUID via leafIssueUuid.
  assert.match(
    ownerPickerMount[0],
    /leafIssueUuid=\{row\.leafIssueUuid\s*\?\?\s*row\.issueId\}/,
    'backlog assign mount carries the UUID mutation id via leafIssueUuid (leaf uuid, else root)',
  );
  // The 14-03 reply mount, by contrast, passes the leaf uuid directly.
  assert.match(
    EXPANDER,
    /leafIssueUuid=\{row\.leafIssueUuid\}/,
    'the 14-03 ReplyInPlace mount passes the LEAF uuid (row.leafIssueUuid)',
  );
  // And the popover fallback still feeds a UUID to the assign mutation.
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
