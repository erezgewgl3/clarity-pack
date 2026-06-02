// test/ui/reader-view.test.mjs
//
// Plan 02-03 Task 2 — Reader view visual + structural contract. Node 24's
// native strip-types loads .ts but not .tsx, so these tests are SOURCE-GREP
// based (same pattern as test/ui/css-scope.test.mjs and
// test/ui/eslint-no-raw-fetch.test.mjs from 02-02). They verify:
//   - every required component file exists (Task 2 file plan)
//   - each component imports / wires the right contracts
//   - the locked literal strings appear (PauseBanner message; deliverable
//     dispatch wires usePluginData('deliverable.preview') per Plan 05-04 D-24)
//   - ProseWithRefChips uses RefChip from the 02-02 primitives
//   - LiveBlockerPanel renders exactly one terminal kind (no nested chains)
//
// Run-time behavior (regex splitting, AC toggle action call, etc.) is verified
// indirectly through the manual Task 3 checkpoint against a real Paperclip
// clone. The source-grep tests pin down the structural contract; the
// integration check covers the actual rendered DOM.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader');

function readSrc(rel) {
  return readFileSync(path.join(READER_DIR, rel), 'utf8');
}

const REQUIRED_FILES = [
  'index.tsx',
  'tldr-strip.tsx',
  'ref-card.tsx',
  'prose-with-ref-chips.tsx',
  'deliverable-preview.tsx',
  'ac-checklist.tsx',
  'activity-timeline.tsx',
  'breadcrumb.tsx',
  'live-blocker-panel.tsx',
  'pause-banner.tsx',
];

for (const file of REQUIRED_FILES) {
  test(`Reader: ${file} exists`, () => {
    assert.ok(existsSync(path.join(READER_DIR, file)), `expected file ${file} to exist`);
  });
}

test('index.tsx exports ReaderView and wraps the surface in <ClaritySurfaceRoot name="reader"> (SCAF-06)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function ReaderView/, 'ReaderView named export');
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']reader["']/, 'wraps surface root with name="reader"');
});

test('index.tsx calls usePluginData with key "issue.reader"', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /usePluginData[\s\S]*['"]issue\.reader['"]/);
});

test('index.tsx imports all nine reader subcomponents (sketches mockup structure)', () => {
  const src = readSrc('index.tsx');
  const required = [
    'TldrStrip',
    'Breadcrumb',
    'ProseWithRefChips',
    'AnchoredToCards',
    'DeliverablePreview',
    'AcChecklist',
    'ActivityTimeline',
    'LiveBlockerPanel',
    'PauseBanner',
  ];
  for (const name of required) {
    assert.match(src, new RegExp(`<${name}\\b`), `Reader renders <${name} />`);
  }
});

test('prose-with-ref-chips.tsx exports ProseWithRefChips and delegates to ref-aware SafeMarkdown (READER-03, 07-04)', () => {
  // Plan 07-04 (D-I31-03) — ProseWithRefChips is rewritten to delegate to the
  // ref-aware SafeMarkdown (Task 2) instead of the old manual BEAAA-NNN regex
  // split. The RefChip is now rendered by SafeMarkdown (for a `ref` span), and
  // the instance-agnostic ref regex lives ONCE in safe-markdown.ts. READER-03
  // (chips clickable) is preserved + ENHANCED (chips now show ID — title) and
  // the markdown in the prose body now renders formatted (no more literal `##`).
  const src = readSrc('prose-with-ref-chips.tsx');
  assert.match(src, /export function ProseWithRefChips/);
  assert.match(src, /<SafeMarkdown\b/, 'delegates to SafeMarkdown');
  assert.match(src, /linkRefs/, 'enables ref-awareness on the SafeMarkdown render');
  assert.match(src, /companyPrefix/, 'threads the derived companyPrefix');
  assert.match(src, /extractCompanyPrefixFromPathname/, 'still derives the prefix instance-agnostically');
});

test('deliverable-preview.tsx exports DeliverablePreview and dispatches on data.kind via usePluginData and renders four real previewers (DIST-04)', () => {
  // Plan 05-04 D-24 — the locked deferred-message literal from Plan 02-03
  // is REMOVED in the same commit that ships the worker-handler-backed
  // dispatcher. The export contract (`export function DeliverablePreview`)
  // is preserved.
  const src = readSrc('deliverable-preview.tsx');
  assert.match(src, /export function DeliverablePreview/);
  assert.match(
    src,
    /usePluginData[\s\S]*['"]deliverable\.preview['"]/,
    'wires the deliverable.preview worker handler',
  );
  assert.match(
    src,
    /switch\s*\(\s*data\.kind\s*\)/,
    'dispatches on data.kind discriminator',
  );
  assert.match(
    src,
    /<embed[\s\S]*type=["']application\/pdf["']/,
    'pdf branch uses native <embed>',
  );
});

test('pause-banner.tsx contains the locked literal "Editorial Desk paused — last compile failed at" (D-07)', () => {
  const src = readSrc('pause-banner.tsx');
  assert.match(
    src,
    /Editorial Desk paused — last compile failed at/,
    'D-07 pause banner literal must appear verbatim (with em-dash)',
  );
});

test('pause-banner.tsx subscribes to editor.pause-status data handler', () => {
  const src = readSrc('pause-banner.tsx');
  assert.match(src, /usePluginData[\s\S]*['"]editor\.pause-status['"]/);
});

test('live-blocker-panel.tsx renders ONE typed terminal (no nested blocker chain steps; READER-08)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // The Live blocker panel renders {terminal.kind} / {terminal.label} ONCE — it must
  // NOT loop over `pathIds` (which would render the entire chain).
  assert.doesNotMatch(src, /pathIds\.map\b/, 'Live blocker panel must not iterate pathIds (single-terminal contract)');
  // It must consume the flatten-blocker-chain handler
  assert.match(src, /usePluginData[\s\S]*['"]flatten-blocker-chain['"]/);
  // It must reference a terminal object from the result
  assert.match(src, /terminal/);
});

test('live-blocker-panel.tsx gates the primary action on the engine verdict (actionAffordance), NOT on kind === HUMAN_ACTION_ON (Plan 11-04 D-13)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // The legacy kind-string gate must be gone — the panel reads the verdict.
  assert.doesNotMatch(
    src,
    /kind\s*===\s*['"]HUMAN_ACTION_ON['"]/,
    'the HUMAN_ACTION_ON primary-action gate must be removed (verdict-driven now)',
  );
  // The primary action label + render gate read actionAffordance.
  assert.match(src, /actionAffordance/, 'panel reads the verdict actionAffordance');
  // The "ON YOU" banner is the needsYou verdict signal (a person must act).
  assert.match(src, /data\.needsYou/, 'ON YOU banner gated on needsYou verdict');
});

test('live-blocker-panel.tsx renders an honest non-blank line for all 8 terminal kinds (Plan 11-04 SC1)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // blockerLine() must enumerate every one of the 8 honest kinds — the four NEW
  // kinds (AWAITING_AGENT_WORKING/STUCK, UNOWNED, UNCLASSIFIED) must not be blank.
  const EIGHT_KINDS = [
    'AWAITING_HUMAN',
    'AWAITING_AGENT_WORKING',
    'AWAITING_AGENT_STUCK',
    'SELF_RESOLVING',
    'EXTERNAL',
    'CYCLE',
    'UNOWNED',
    'UNCLASSIFIED',
  ];
  for (const kind of EIGHT_KINDS) {
    assert.match(src, new RegExp(`case ['"]${kind}['"]:`), `blockerLine handles ${kind}`);
  }
  // UNCLASSIFIED renders the honest "can't determine — open to investigate" line (D-12).
  assert.match(
    src,
    /Can't determine blocker[\s\S]*open to investigate/,
    'UNCLASSIFIED shows the honest open-to-investigate line (D-12)',
  );
});

test('live-blocker-panel.tsx never renders a raw UUID — only awaitedPartyLabel / label (NO_UUID_LEAK / D-15)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // No targetAgentUuid/targetIssueUuid may appear inside a JSX text node. The
  // panel must not even reference them (they are mutation-only on the verdict).
  assert.doesNotMatch(
    src,
    /\{[^}]*target(Agent|Issue)Uuid[^}]*\}/,
    'no *Uuid field may be rendered in a JSX expression',
  );
  // The only ownership display strings are awaitedPartyLabel + terminal.label.
  assert.match(src, /awaitedPartyLabel/, 'awaited party rendered via the scrubbed label');
});

test('live-blocker-panel.tsx: blockerLine renders the scrubbed awaitedPartyLabel — NOT t.label — for every UUID-bearing kind (Plan 11-07 / CR-01 Reader half)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // Isolate the blockerLine() function body so the scan only covers the
  // headline-render switch (the UNCLASSIFIED branch keeps its degradeReason).
  // CRLF-tolerant terminator (Plan 14-03) — the source may be saved with CRLF on
  // Windows, so the `\n}\n` close must accept an optional `\r`.
  const m = src.match(/function blockerLine\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(m, 'blockerLine() function present');
  const body = m[0];
  // CR-01 root cause: the panel rendered the RAW t.label (which embeds UUIDs
  // straight off the engine) for AWAITING_HUMAN / EXTERNAL / CYCLE / UNOWNED /
  // SELF_RESOLVING / the AWAITING_AGENT_* compound lines. After 11-06 scrubbed
  // data.awaitedPartyLabel at the worker boundary, the panel must render THAT.
  assert.doesNotMatch(
    body,
    /\bt\.label\b/,
    'blockerLine() must not read the raw t.label in any rendered string (CR-01 leak site)',
  );
  // The scrubbed awaitedPartyLabel is the awaited-party display string for the
  // UUID-bearing kinds.
  assert.match(
    body,
    /data\.awaitedPartyLabel/,
    'blockerLine() renders data.awaitedPartyLabel (the scrubbed string)',
  );
  // t.kind survives for the switch + the data-terminal-kind attribute.
  assert.match(body, /switch \(t\.kind\)/, 't.kind still drives the exhaustive switch');
});

test('live-blocker-panel.tsx: the IN-01 scrub-location comment names flatten-blocker-chain.ts (the worker handler), not the panel', () => {
  const src = readSrc('live-blocker-panel.tsx');
  assert.match(
    src,
    /flatten-blocker-chain/,
    'the invariant comment must state the scrub happens in flatten-blocker-chain.ts (IN-01)',
  );
});

test('live-blocker-panel.tsx: UNCLASSIFIED maps to the open affordance with no assign button (D-12 / SC3)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // 'open' affordance → an "Open ↗"-style label; 'assign' → the assign control.
  // The assign affordance must NOT be wired to UNCLASSIFIED — that mapping lives
  // in classifyVerdict() (worker), and UNCLASSIFIED → 'open'. Here we assert the
  // panel honours BOTH affordances distinctly so an open row never shows assign.
  assert.match(src, /case ['"]open['"]:[\s\S]*Open/, "open affordance → 'Open ↗' label");
  assert.match(src, /case ['"]assign['"]:[\s\S]*Assign owner/, "assign affordance → assign control");
  assert.match(src, /case ['"]none['"]:[\s\S]*return null/, "none affordance → no button");
});

test('ref-card.tsx renders the substantive excerpt (READER-04)', () => {
  const src = readSrc('ref-card.tsx');
  // The component must reference card.excerpt (or excerpt prop) — the
  // README-04 substantive-quote contract.
  assert.match(src, /\bexcerpt\b/);
});

test('ac-checklist.tsx wires the ac-toggle action via usePluginAction (READER-07)', () => {
  const src = readSrc('ac-checklist.tsx');
  assert.match(src, /usePluginAction[\s\S]*['"]ac-toggle['"]/);
});

test('breadcrumb.tsx uses useHostNavigation for navigation (SCAF-09 — no raw <a href>)', () => {
  const src = readSrc('breadcrumb.tsx');
  assert.match(src, /useHostNavigation\b/);
});

test('Reader bundle output (dist/ui/index.js) exports the ReaderView component', () => {
  const distPath = path.resolve(HERE, '..', '..', 'dist', 'ui', 'index.js');
  if (!existsSync(distPath)) {
    // Test is meaningful only after `pnpm build` has run; skip silently in pre-build runs.
    return;
  }
  const bundle = readFileSync(distPath, 'utf8');
  assert.match(bundle, /ReaderView/, 'built bundle includes ReaderView');
});
