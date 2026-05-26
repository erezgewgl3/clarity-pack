// test/ui/surfaces/situation-room/artifact-chip-row.test.mjs
//
// Plan 06.1-03 Task 1 — ArtifactChipRow source contract.
//
// Why SOURCE-GREP (not jsdom): the Clarity Pack repo has NO jsdom in
// devDependencies, NO TSX test transform, NO test-renderer. Adding any of
// those is a new-runtime-dep checkpoint and explicitly out of scope for
// Phase 6.1 (CONTEXT.md: "NO new runtime dependencies"). Every existing
// UI test in test/ui/ is a source-grep / static-analysis test reading
// .tsx as text — this file follows the same convention. The "real-DOM
// render" semantic from PLAN.md maps to: structural source-grep + the
// no-react-key-warnings.test.mjs static analyser (Plan 05-07 D-14
// console-capture proxy).
//
// Coverage:
//   1. File exists at the canonical path.
//   2. Component exports ArtifactChipRow.
//   3. Empty input branch returns null (no DOM emitted — D-02 / UI-SPEC
//      §Edge Cases row 1).
//   4. Non-empty branch renders `.clarity-artifact-chip-row` container.
//   5. Chip rendering delegates to AttachmentChipWithPreview (D-11 / Plan
//      05-11 hotfix-2 shell reused — no new popover shell).
//   6. > 5 chips: first 5 + a `+{N-5} more` chip (D-10 / UI-SPEC §Copy
//      "+N more" affordance).
//   7. Every .map() callback returning JSX has a stable key={...} (rc.8
//      Phase B lesson — zero React-key warnings; mirrors
//      `no-react-key-warnings.test.mjs` static analyser).
//   8. NO new runtime dependency imports (no @paperclip/* additions; no
//      raw fetch; matches CONTEXT.md "NO new runtime deps" constraint).
//   9. Tooling — visible chip count is 5 (the locked constant per UI-SPEC
//      §Copywriting Contract).
//
// CTT-07 / D-11 — the chip click DOES NOT navigate; the preview opens in
// the existing AttachmentChipWithPreview popover (zero rabbit-holes). The
// behaviour is inherited from the imported shell — this test asserts the
// inheritance via the import statement.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SRC_PATH = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'surfaces',
  'situation-room',
  'artifact-chip-row.tsx',
);

function readSrc() {
  return readFileSync(SRC_PATH, 'utf8');
}

test('artifact-chip-row.tsx: file exists at canonical path', () => {
  assert.ok(existsSync(SRC_PATH), `expected ${SRC_PATH}`);
});

test('artifact-chip-row.tsx: exports ArtifactChipRow', () => {
  const src = readSrc();
  assert.match(src, /export\s+function\s+ArtifactChipRow\b/);
});

test('artifact-chip-row.tsx: empty-input branch returns null (D-02 / UI-SPEC §Edge Cases)', () => {
  const raw = readSrc();
  // Strip block + line comments so explanatory prose between the guard
  // expression and the `return null` does not blow the regex window.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(
    src,
    /artifacts\.length\s*===\s*0[\s\S]{0,80}return\s+null/,
    'empty-input branch must return null for D-02 empty-window contract',
  );
});

test('artifact-chip-row.tsx: renders `.clarity-artifact-chip-row` container', () => {
  const src = readSrc();
  assert.match(src, /className=["']clarity-artifact-chip-row["']/);
  // data-testid pins the container for downstream tooling / future jsdom drills.
  assert.match(src, /data-testid=["']clarity-artifact-chip-row["']/);
});

test('artifact-chip-row.tsx: imports + delegates chip-click to AttachmentChipWithPreview (D-11; Plan 05-11 hotfix-2 shell)', () => {
  const src = readSrc();
  assert.match(src, /import[\s\S]{0,80}AttachmentChipWithPreview[\s\S]{0,120}from\s+['"]\.\.\/chat\/attachment-chip-with-preview/);
  assert.match(src, /<AttachmentChipWithPreview\b/);
});

test('artifact-chip-row.tsx: overflow > 5 renders `+{N-5} more` chip (D-10 / UI-SPEC §Copy)', () => {
  const src = readSrc();
  // The literal mono-suffix string from UI-SPEC §Copywriting Contract.
  // Match the template-literal shape `+${overflow} more` (overflow = N - 5).
  assert.match(src, /\+\$\{(?:overflow|N\s*-\s*5)[^}]*\}\s+more/);
  // Visible chip count locked to 5.
  assert.match(src, /(?:VISIBLE_CHIP_COUNT|TOP_N|MAX_VISIBLE)\s*=\s*5\b/);
});

test('artifact-chip-row.tsx: every JSX-returning .map() callback has explicit key={...} (rc.8 lesson — zero React-key warnings)', () => {
  const src = readSrc();
  // Mirror the no-react-key-warnings.test.mjs static analyser.
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

test('artifact-chip-row.tsx: NO bare-index key={i} / key={index} (composite keys only — rc.8 lesson)', () => {
  const raw = readSrc();
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const bareMatches = src.match(/key=\{\s*(?:i|j|k|idx|index)\s*\}/g) ?? [];
  assert.equal(
    bareMatches.length,
    0,
    `bare-index key(s) found: ${bareMatches.join(', ')}. Compose with a stable field (e.g. artifact id).`,
  );
});

test('artifact-chip-row.tsx: NO new runtime dependency imports (CONTEXT.md "NO new runtime deps")', () => {
  const src = readSrc();
  // Match every import block (single- or multi-line — flat-out import ... from '...').
  // We collect the literal source path of every `from '...'` statement and check
  // each against the allow-list. NO new dep packages can be introduced in this
  // plan; React + the existing chat/attachment-chip-with-preview are the
  // load-bearing modules.
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  const allowedRe = /^(react|\.\.\/chat\/attachment-chip-with-preview(?:\.tsx)?)$/;
  let m;
  const offenders = [];
  while ((m = fromRe.exec(src)) !== null) {
    const spec = m[1];
    if (!allowedRe.test(spec)) {
      offenders.push(spec);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `unrecognized import sources — possible new deps: ${offenders.join(', ')}`,
  );
});

test('artifact-chip-row.tsx: visible chip cap is exactly 5 (UI-SPEC locked constant)', () => {
  const src = readSrc();
  // Cap declared as VISIBLE_CHIP_COUNT = 5 and used with slice(0, VISIBLE_CHIP_COUNT).
  assert.match(src, /VISIBLE_CHIP_COUNT\s*=\s*5\b/);
  assert.match(src, /slice\(0,\s*VISIBLE_CHIP_COUNT\)/);
});

// ---------------------------------------------------------------------------
// Companion assertions on the parent (agent-card.tsx) — Plan 06.1-03 Task 1.
// ---------------------------------------------------------------------------

const AGENT_CARD = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'surfaces',
  'situation-room',
  'agent-card.tsx',
);

test('agent-card.tsx: imports ArtifactChipRow', () => {
  const src = readFileSync(AGENT_CARD, 'utf8');
  assert.match(src, /import[\s\S]{0,80}ArtifactChipRow[\s\S]{0,80}from\s+['"]\.\/artifact-chip-row/);
});

test('agent-card.tsx: renders <ArtifactChipRow ... /> (UI-SPEC §Visual Hierarchy Lock #3)', () => {
  const src = readFileSync(AGENT_CARD, 'utf8');
  assert.match(src, /<ArtifactChipRow\b/);
});

test('agent-card.tsx: removes deprecated `.clarity-agent-artifact` placeholder (UI-SPEC §Visual Hierarchy Lock #5)', () => {
  const src = readFileSync(AGENT_CARD, 'utf8');
  // The dashed-border placeholder block is gone — the new chip row supersedes it.
  assert.doesNotMatch(
    src,
    /className=["']clarity-agent-artifact["']/,
    'agent-card.tsx must not render the deprecated .clarity-agent-artifact placeholder',
  );
});

// ---------------------------------------------------------------------------
// Companion assertions on the surface root (index.tsx) — Plan 06.1-03 Task 1.
// ---------------------------------------------------------------------------

const SITUATION_INDEX = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'surfaces',
  'situation-room',
  'index.tsx',
);

test('situation-room/index.tsx: NO longer imports or mounts ArtifactsShippedShelf (D-02)', () => {
  const raw = readFileSync(SITUATION_INDEX, 'utf8');
  // Strip block + line comments so the historical-reference doc-comment
  // mentioning the deleted component does not false-trip the assertion.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const importMatches = src.match(/\bimport[\s\S]{0,200}ArtifactsShippedShelf/g) ?? [];
  assert.equal(
    importMatches.length,
    0,
    'index.tsx must not import ArtifactsShippedShelf — deleted in Plan 06.1-03',
  );
  assert.doesNotMatch(src, /<ArtifactsShippedShelf\b/);
});

test('situation-room/index.tsx: calls usePluginData("situation.artifacts") (ROOM-10 / Plan 06.1-02 consumer)', () => {
  const src = readFileSync(SITUATION_INDEX, 'utf8');
  assert.match(src, /usePluginData[\s\S]{0,80}['"]situation\.artifacts['"]/);
});

test('situation-room/index.tsx: threads artifacts={...} into each AgentCard (per-agent fan-out)', () => {
  const src = readFileSync(SITUATION_INDEX, 'utf8');
  assert.match(src, /<AgentCard[\s\S]{0,200}artifacts=\{/);
});

test('situation-room/index.tsx: imports useResolvedUserId + threads viewerUserId into CriticalPathStrip (D-09)', () => {
  const src = readFileSync(SITUATION_INDEX, 'utf8');
  assert.match(src, /import[\s\S]{0,80}useResolvedUserId/);
  assert.match(src, /<CriticalPathStrip[\s\S]{0,400}viewerUserId=\{/);
});

// ---------------------------------------------------------------------------
// CSS guard — deleted-shelf rule cluster must be GONE; new chip-row rules
// must be PRESENT and scoped (SCAF-06).
// ---------------------------------------------------------------------------

const THEME_CSS = path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'theme.css');

test('theme.css: orphaned shelf selectors are DELETED (D-02 cluster cleanup)', () => {
  const css = readFileSync(THEME_CSS, 'utf8');
  const ORPHANED = [
    'clarity-artifacts-shelf',
    'clarity-artifacts-heading',
    'clarity-artifacts-list',
    'clarity-artifact-item',
    'clarity-artifact-title',
    'clarity-artifact-author',
    'clarity-artifact-preview',
  ];
  for (const cls of ORPHANED) {
    // The rule selector form `.classname` must not appear as a CSS selector
    // anywhere. (Comments referencing the deleted classnames are fine — we
    // strip block + line comments before checking.)
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const ruleRe = new RegExp(`\\.${cls}(?![\\w-])\\s*\\{`, 'g');
    const matches = stripped.match(ruleRe) ?? [];
    assert.equal(matches.length, 0, `orphaned rule for .${cls} still present in theme.css`);
  }
});

test('theme.css: new chip-row selectors are PRESENT + scoped under [data-clarity-surface="situation-room"]', () => {
  const css = readFileSync(THEME_CSS, 'utf8');
  for (const sel of [
    'clarity-artifact-chip-row',
    'clarity-artifact-chip-row-more',
  ]) {
    const re = new RegExp(
      `\\[data-clarity-surface=['"]situation-room['"]\\]\\s+\\.${sel}(?![\\w-])`,
    );
    assert.match(css, re, `expected scoped selector for .${sel}`);
  }
});

test('artifacts-shipped-shelf.tsx: file is DELETED', () => {
  const SHELF_PATH = path.join(
    REPO_ROOT,
    'src',
    'ui',
    'surfaces',
    'situation-room',
    'artifacts-shipped-shelf.tsx',
  );
  assert.ok(
    !existsSync(SHELF_PATH),
    `artifacts-shipped-shelf.tsx must be deleted per D-02; found at ${SHELF_PATH}`,
  );
});
