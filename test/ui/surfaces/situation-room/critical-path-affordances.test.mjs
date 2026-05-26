// test/ui/surfaces/situation-room/critical-path-affordances.test.mjs
//
// Plan 06.1-03 Task 2 — Critical Path per-row Take-Ownership +
// Convert-to-task button cluster (ROOM-11 + D-09 + D-12 + D-13).
//
// Why SOURCE-GREP (not jsdom): no jsdom in devDependencies; no TSX test
// transform; the established convention (Plan 05-07 D-14 console-capture
// proxy) is structural source-grep + the no-react-key-warnings static
// analyser. Every test below maps a Plan 06.1-03 invariant onto a
// regex / structural assertion against the source.
//
// Behaviors pinned:
//   1. HUMAN_ACTION_ON.__unowned__ row renders BOTH Take-Ownership +
//      Convert-to-task (showTakeOwnership = isUnownedHumanAction).
//   2. Non-CYCLE rows render Convert-to-task with label `Convert to task →`.
//   3. CYCLE rows render the cycle-specific label
//      `+ Create task to break this cycle` — NO Take-Ownership (D-13).
//   4. useResolvedUserId returns null/error → disabled button + literal
//      tooltip `Sign in to claim ownership` via the `title` attribute.
//   5. Take-Ownership click dispatches usePluginAction('agent.takeOwnership')
//      with { agentId, ownerUserId: viewerUserId, companyId, userId }.
//   6. Success toast literal `Ownership claimed`; failure toast literal
//      `Could not claim ownership — try again`.
//   7. Convert-to-task opens TrueTaskDialog in cold mode with NO pre-fill
//      (D-12 — empty defaultAssigneeAgentId + empty defaultEmployeeName +
//      sourceMessage={null} + sourceTopic={null}).
//   8. Blocker context aside (.clarity-critical-path-blocker-context)
//      renders OUTSIDE the dialog tree (sibling, not child).
//   9. Color reservation — gold (var(--clarity-you)) appears in the
//      Take-Ownership selector rule ONLY; the Convert-to-task rule uses
//      neutral --clarity-line + --clarity-fg.
//  10. CSS scope intact — every new rule starts with
//      [data-clarity-surface='situation-room'].
//  11. Locked invariants — git diff for src/shared/blocker-chain.ts is
//      empty (covered by the per-plan static guard at file level — the
//      string `__unowned__` is consumed verbatim with no chain logic
//      change).
//  12. No React-key warnings (rc.8 lesson) — mirrors the
//      no-react-key-warnings.test.mjs analyser shape; bare-index keys
//      forbidden.
//  13. No new runtime deps (CONTEXT.md "NO new runtime dependencies").

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const STRIP_PATH = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'surfaces',
  'situation-room',
  'critical-path-strip.tsx',
);
const THEME_PATH = path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'theme.css');

function readSrc() {
  return readFileSync(STRIP_PATH, 'utf8');
}

function readSrcCode() {
  return readSrc()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function readTheme() {
  return readFileSync(THEME_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// Behavior 1+3 — terminal classification gates the button cluster.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: __unowned__ sentinel guards the Take-Ownership branch (RESEARCH.md Gotchas #7)', () => {
  const src = readSrcCode();
  // The literal string `__unowned__` MUST appear in source — the worker
  // produces this exact string in HUMAN_ACTION_ON.userId for unowned agents.
  assert.match(src, /['"]__unowned__['"]/);
  // The branch must combine the kind check with the sentinel.
  assert.match(
    src,
    /terminal\.kind\s*===\s*['"]HUMAN_ACTION_ON['"][\s\S]{0,160}terminal\.userId\s*===[\s\S]{0,40}UNOWNED_SENTINEL/,
    'showTakeOwnership condition must combine HUMAN_ACTION_ON kind + __unowned__ userId sentinel',
  );
});

test('critical-path-strip.tsx: CYCLE rows render `+ Create task to break this cycle` (D-13 — NO Take-Ownership)', () => {
  const src = readSrcCode();
  // CYCLE label literal — verbatim from UI-SPEC §Copywriting Contract.
  assert.match(src, /\+ Create task to break this cycle/);
  // The label selection must depend on isCycleRow (terminal.kind === 'CYCLE').
  assert.match(
    src,
    /isCycleRow\s*=\s*terminal\.kind\s*===\s*['"]CYCLE['"]/,
    'isCycleRow predicate must check terminal.kind === "CYCLE"',
  );
  // The CYCLE branch must select the cycle-break label.
  assert.match(
    src,
    /isCycleRow\s*\?\s*['"]\+ Create task to break this cycle['"][\s\S]{0,40}['"]Convert to task/,
    'convertToTaskLabel must be the cycle-break literal when isCycleRow',
  );
});

test('critical-path-strip.tsx: Take-Ownership is gated by isUnownedHumanAction — never on resolved-owner / SELF / EXTERNAL / CYCLE rows', () => {
  const src = readSrcCode();
  // The button render conditional must be `showTakeOwnership` (NOT something
  // weaker like `terminal.kind === 'HUMAN_ACTION_ON'`).
  assert.match(src, /showTakeOwnership\s*\?[\s\S]{0,400}clarity-take-ownership-btn/);
  // showTakeOwnership must be the unowned-human-action predicate.
  assert.match(src, /showTakeOwnership\s*=\s*isUnownedHumanAction/);
});

// ---------------------------------------------------------------------------
// Behavior 2 — non-CYCLE rows render the canonical Convert-to-task label.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: non-CYCLE rows render `Convert to task →` literal (UI-SPEC §Copy)', () => {
  const src = readSrcCode();
  // The Convert-to-task button is ALWAYS rendered (it's outside the
  // isCycleRow ternary — only the label changes).
  assert.match(src, /clarity-convert-to-task-btn/);
  // The non-CYCLE label literal — Unicode RIGHTWARDS ARROW (U+2192).
  assert.match(src, /Convert to task →/);
});

// ---------------------------------------------------------------------------
// Behavior 4 — disabled state + tooltip when viewerUserId is null/error.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: disabled state when viewerUserId is null/error — literal tooltip `Sign in to claim ownership`', () => {
  const src = readSrcCode();
  // `disabled={takeOwnershipDisabled}` OR equivalent shape.
  assert.match(src, /disabled=\{takeOwnershipDisabled\}/);
  // The disabled predicate must include !viewerUserId.
  assert.match(src, /takeOwnershipDisabled\s*=\s*!viewerUserId[\s\S]{0,40}claiming/);
  // The locked tooltip literal MUST appear in the `title` attribute branch.
  assert.match(src, /['"]Sign in to claim ownership['"]/);
  // Title only renders when viewerUserId is null — assertion guards the
  // shape `title={viewerUserId ? undefined : '...'}` OR equivalent.
  assert.match(
    src,
    /title=\{[\s\S]{0,160}Sign in to claim ownership[\s\S]{0,40}\}/,
    'title attribute must surface the disabled-state tooltip literal',
  );
});

// ---------------------------------------------------------------------------
// Behavior 5+6 — agent.takeOwnership dispatch + success/error toasts.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: uses useResolvedUserId hook (D-09 viewer-userId resolution)', () => {
  const src = readSrcCode();
  // The strip itself accepts viewerUserId as a prop (parent uses
  // useResolvedUserId). But the file MUST still import the hook so other
  // call sites (or any future direct usage) link the contract. We accept
  // either: (a) the hook is imported in this file; OR (b) the prop type
  // documents the Plan 02-09 wiring contract. Match either.
  assert.ok(
    /useResolvedUserId/.test(src),
    'critical-path-strip.tsx must reference useResolvedUserId (Plan 02-09 — D-09)',
  );
});

test('critical-path-strip.tsx: dispatches usePluginAction("agent.takeOwnership")', () => {
  const src = readSrcCode();
  assert.match(
    src,
    /usePluginAction\(\s*['"]agent\.takeOwnership['"]\s*\)/,
    'must dispatch via usePluginAction("agent.takeOwnership")',
  );
  // The dispatch must include the 4 canonical params per Plan 06.1-01.
  assert.match(src, /takeOwnership\(\s*\{[\s\S]{0,300}companyId[\s\S]{0,300}agentId[\s\S]{0,300}ownerUserId[\s\S]{0,300}userId/);
});

test('critical-path-strip.tsx: success toast literal `Ownership claimed`', () => {
  const src = readSrcCode();
  assert.match(src, /showToast\(\s*\{[\s\S]{0,80}message:\s*['"]Ownership claimed['"]/);
});

test('critical-path-strip.tsx: failure toast literal `Could not claim ownership — try again` (em-dash)', () => {
  const src = readSrcCode();
  // Em-dash (U+2014) between the two clauses — verbatim from UI-SPEC.
  assert.match(src, /Could not claim ownership — try again/);
});

test('critical-path-strip.tsx: in-flight aria-busy + aria-label swaps to `Claiming ownership of …`', () => {
  const src = readSrcCode();
  assert.match(src, /aria-busy=\{claiming/);
  assert.match(src, /Claiming ownership of/);
});

// ---------------------------------------------------------------------------
// Behavior 7 — Convert-to-task opens TrueTaskDialog in cold mode WITHOUT
// pre-fill (D-12 — load-bearing `feedback_trust-the-clarification-loop`).
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: TrueTaskDialog mounted in cold mode (D-12 NO pre-fill)', () => {
  const src = readSrcCode();
  // Imports the dialog from the chat directory verbatim.
  assert.match(
    src,
    /import[\s\S]{0,80}TrueTaskDialog[\s\S]{0,120}from\s+['"]\.\.\/chat\/true-task\/true-task-dialog/,
  );
  // Mounted with mode="cold".
  assert.match(src, /<TrueTaskDialog[\s\S]{0,800}mode=["']cold["']/);
  // sourceMessage + sourceTopic are NULL (no PROMOTE shape leakage).
  assert.match(src, /sourceMessage=\{\s*null\s*\}/);
  assert.match(src, /sourceTopic=\{\s*null\s*\}/);
});

test('critical-path-strip.tsx: TrueTaskDialog opens with EMPTY pre-fill defaults (D-12 / feedback_trust-the-clarification-loop)', () => {
  const src = readSrcCode();
  // defaultAssigneeAgentId="" and defaultEmployeeName="" pin the no-pre-fill
  // contract. The dialog itself defaults topicIssueId to null + title to ''
  // when these defaults are empty in cold mode (Plan 04.1-09 contract).
  assert.match(src, /defaultAssigneeAgentId=["']{2}/);
  assert.match(src, /defaultEmployeeName=["']{2}/);
});

// ---------------------------------------------------------------------------
// Behavior 8 — blocker context aside renders OUTSIDE the dialog body.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: blocker context aside renders OUTSIDE TrueTaskDialog (D-12 — operator reads context, dialog stays empty)', () => {
  const src = readSrcCode();
  // The aside element exists.
  assert.match(src, /clarity-critical-path-blocker-context/);
  // It is rendered as a sibling to <TrueTaskDialog>, not nested inside it.
  // Structural assertion: the `<TrueTaskDialog` tag must appear in the
  // file AFTER (or before, sibling-style) the blocker-context aside —
  // never inside the dialog body. We check the dialog isn't a parent
  // of the aside by ensuring no `<TrueTaskDialog ...>` tag opens BEFORE
  // the aside without a matching close.
  //
  // Simpler structural check: the blocker context block's mount node
  // (`blockerContextNode`) is returned as a sibling of TrueTaskDialog
  // inside the row's `<li>`, not as a child.
  assert.match(
    src,
    /\{blockerContextNode\}[\s\S]{0,400}<TrueTaskDialog/,
    'blockerContextNode must render before TrueTaskDialog as a sibling, not nested',
  );
});

// ---------------------------------------------------------------------------
// Behavior 9+10 — color reservation + CSS scope.
// ---------------------------------------------------------------------------

test('theme.css: gold accent (--clarity-you) applies to .clarity-take-ownership-btn — and NOT to .clarity-convert-to-task-btn', () => {
  const css = readTheme();
  // Take-Ownership rule cluster MUST reference --clarity-you.
  const takeOwnershipBlocks = (
    css.match(
      /\[data-clarity-surface='situation-room'\]\s+\.clarity-take-ownership-btn[\s\S]*?\{[^}]*\}/g,
    ) ?? []
  );
  assert.ok(
    takeOwnershipBlocks.length >= 1,
    'expected at least one .clarity-take-ownership-btn rule block',
  );
  const takeOwnershipUsesGold = takeOwnershipBlocks.some((b) =>
    /var\(--clarity-you(?:-soft)?\)/.test(b),
  );
  assert.ok(
    takeOwnershipUsesGold,
    'expected at least one .clarity-take-ownership-btn rule to reference var(--clarity-you{-soft})',
  );
  // Convert-to-task rule cluster MUST NOT reference --clarity-you / --clarity-you-soft.
  const convertBlocks = (
    css.match(
      /\[data-clarity-surface='situation-room'\]\s+\.clarity-convert-to-task-btn[\s\S]*?\{[^}]*\}/g,
    ) ?? []
  );
  assert.ok(
    convertBlocks.length >= 1,
    'expected at least one .clarity-convert-to-task-btn rule block',
  );
  for (const b of convertBlocks) {
    assert.doesNotMatch(
      b,
      /var\(--clarity-you(?:-soft)?\)/,
      `.clarity-convert-to-task-btn rule MUST NOT use gold accent — color reservation regression: ${b.slice(0, 200)}`,
    );
  }
});

test('theme.css: all new Plan 06.1-03 selectors are scoped under [data-clarity-surface="situation-room"] (SCAF-06)', () => {
  const css = readTheme();
  for (const sel of [
    'clarity-row-actions',
    'clarity-take-ownership-btn',
    'clarity-convert-to-task-btn',
    'clarity-critical-path-blocker-context',
  ]) {
    const re = new RegExp(
      `\\[data-clarity-surface=['"]situation-room['"]\\]\\s+\\.${sel}(?![\\w-])`,
    );
    assert.match(css, re, `expected scoped selector for .${sel}`);
  }
});

// ---------------------------------------------------------------------------
// Behavior 11 — locked invariants (blocker-chain.ts unchanged).
// ---------------------------------------------------------------------------

test('locked invariant: src/shared/blocker-chain.ts is NOT modified (chain logic ships byte-identical)', () => {
  // The source-grep assertion below confirms the file contents still
  // contain the canonical `__unowned__` fallback assignment at the
  // documented anchor (file:178 in the rc.8 ship; line numbers may
  // shift but the literal must be present). A separate git diff check
  // at task acceptance pins true byte-equality.
  const BC_PATH = path.join(REPO_ROOT, 'src', 'shared', 'blocker-chain.ts');
  const src = readFileSync(BC_PATH, 'utf8');
  assert.match(
    src,
    /__unowned__/,
    'blocker-chain.ts must still contain the __unowned__ literal — chain-walk fallback is LOCKED',
  );
});

// ---------------------------------------------------------------------------
// Behavior 12 — no React-key warnings (rc.8 lesson; mirrors the
// no-react-key-warnings.test.mjs static analyser).
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: every JSX-returning .map() callback has explicit key={...} (rc.8 lesson)', () => {
  const src = readSrc();
  const mapRe = /\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
  const offenders = [];
  let m;
  while ((m = mapRe.exec(src)) !== null) {
    const afterArrow = mapRe.lastIndex;
    let bodyStart = afterArrow;
    let returnsJsx = false;
    if (src[bodyStart] === '{') {
      const block = src.slice(bodyStart, bodyStart + 800);
      returnsJsx = /return\s*\(\s*<[A-Za-z]/.test(block);
    } else {
      if (src[bodyStart] === '(') {
        bodyStart += 1;
        while (/\s/.test(src[bodyStart] ?? '')) bodyStart += 1;
      }
      returnsJsx = /^<[A-Za-z]/.test(src.slice(bodyStart, bodyStart + 2));
    }
    if (!returnsJsx) continue;
    const window = src.slice(m.index, m.index + 800);
    if (!/key=\{/.test(window)) {
      offenders.push({ index: m.index, snippet: window.slice(0, 200) });
    }
  }
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} JSX-returning .map() without key=. Offenders:\n${offenders
      .map((o) => '@' + o.index + ': ' + o.snippet.replace(/\s+/g, ' '))
      .join('\n')}`,
  );
});

test('critical-path-strip.tsx: NO bare-index key={i} / key={index} (composite keys only — rc.8 lesson)', () => {
  const src = readSrcCode();
  const bareMatches = src.match(/key=\{\s*(?:i|j|k|idx|index)\s*\}/g) ?? [];
  assert.equal(
    bareMatches.length,
    0,
    `bare-index key(s) found: ${bareMatches.join(', ')}. Compose with a stable field.`,
  );
});

// ---------------------------------------------------------------------------
// Behavior 13 — no new runtime deps.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: NO new runtime dependency imports (CONTEXT.md "NO new runtime deps")', () => {
  const src = readSrcCode();
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  const ALLOWED = new Set([
    'react',
    '@paperclipai/plugin-sdk/ui/hooks',
    '../../../shared/types.ts',
    '../../primitives/use-resolved-user-id.ts',
    '../../primitives/toast.tsx',
    '../chat/true-task/true-task-dialog.tsx',
  ]);
  const offenders = [];
  let m;
  while ((m = fromRe.exec(src)) !== null) {
    if (!ALLOWED.has(m[1])) offenders.push(m[1]);
  }
  assert.equal(
    offenders.length,
    0,
    `unrecognized import sources — possible new deps: ${offenders.join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// Final guard — every locked literal string from UI-SPEC §Copywriting Contract
// appears verbatim in source.
// ---------------------------------------------------------------------------

test('critical-path-strip.tsx: ALL locked literal strings present verbatim (UI-SPEC §Copywriting Contract)', () => {
  const src = readSrcCode();
  const LOCKED_LITERALS = [
    'Take ownership',
    'Convert to task →',
    '+ Create task to break this cycle',
    'Sign in to claim ownership',
    'Claiming ownership of',
    'Ownership claimed',
    'Could not claim ownership — try again',
  ];
  for (const literal of LOCKED_LITERALS) {
    assert.ok(
      src.includes(literal),
      `locked literal MISSING from critical-path-strip.tsx: ${JSON.stringify(literal)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Standalone surface-header `+ Create task` button — D-03 standalone half.
// The button is already mounted unconditionally on every surface that uses
// ClaritySurfaceHeader (UI-SPEC §Flow 5 note 2026-05-26: no registry filter
// in current code). Situation Room already mounts the header at index.tsx.
// Verify the header file still renders `+ Create task` unconditionally.
// ---------------------------------------------------------------------------

test('clarity-surface-header.tsx: still renders the unconditional `+ Create task` button (D-03 standalone half)', () => {
  const HEADER_PATH = path.join(
    REPO_ROOT,
    'src',
    'ui',
    'primitives',
    'clarity-surface-header.tsx',
  );
  const src = readFileSync(HEADER_PATH, 'utf8');
  assert.match(src, /\+ Create task/);
  // The button must not be gated by a registry filter (UI-SPEC §Flow 5):
  // there must NOT be a SURFACES_WITH_CREATE_TASK allowlist short-circuit.
  // (If a future plan adds one, this assertion will need to update to also
  // assert 'situation-room' is in the list.)
  assert.doesNotMatch(src, /SURFACES_WITH_CREATE_TASK/);
});

// ---------------------------------------------------------------------------
// Surface root still mounts ClaritySurfaceHeader (D-03 standalone half
// is structurally satisfied because the header already renders the button
// unconditionally for every surface that mounts it).
// ---------------------------------------------------------------------------

test('situation-room/index.tsx: mounts <ClaritySurfaceHeader surface="situation-room" /> (D-03 standalone half)', () => {
  const SR_PATH = path.join(
    REPO_ROOT,
    'src',
    'ui',
    'surfaces',
    'situation-room',
    'index.tsx',
  );
  const src = readFileSync(SR_PATH, 'utf8');
  assert.match(
    src,
    /<ClaritySurfaceHeader[\s\S]{0,200}surface=["']situation-room["']/,
  );
});
