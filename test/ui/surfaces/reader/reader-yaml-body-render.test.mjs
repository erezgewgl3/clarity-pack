// test/ui/surfaces/reader/reader-yaml-body-render.test.mjs
//
// Overnight 2026-05-28 — REGRESSION FOR BEAAA-828 + WIDESPREAD READER CRASH.
//
// The Reader tab on BEAAA AriClaw rendered the host's
// "Clarity Pack: failed to render" error pill on many issues (BEAAA-828,
// BEAAA-142, BEAAA-141, BEAAA-125, BEAAA-138, BEAAA-682, BEAAA-79). The
// HOST's PluginSlotErrorBoundary catches any synchronous throw from a
// plugin slot component and replaces the entire surface with that pill,
// so a single sub-component throwing wiped the whole Reader tab.
//
// Diagnosis identified two compounding problems:
//   1. ROOT CAUSE — `buildChatDeepLink → appendHash → b64encode` called
//      raw `btoa(s)` on a JSON payload containing the issue title and
//      body. `btoa` throws `InvalidCharacterError` on any character
//      outside Latin-1 (em-dashes, smart quotes, en-dashes, CJK, emoji
//      — all common in BEAAA operator-typed titles). The throw landed
//      synchronously inside `ContinueInChatButton`'s render, which
//      mounts in the Reader header on every issue with a resolved
//      `new-topic-needed` route. Fixed in `src/ui/surfaces/chat/deep-link.mjs`
//      (UTF-8-via-binary-string pattern); see
//      `test/ui/deep-link-utf8.test.mjs` for the RED→GREEN regression.
//   2. WIDE BLAST RADIUS — ONE section's render throw took down EVERY
//      section. Fixed by wrapping each Reader sub-component in a
//      per-section `<SectionErrorBoundary>` so a future throw inside
//      any single section degrades to "Section unavailable" while the
//      rest of the tab renders normally.
//
// This file is the source-grep regression for the wide-blast-radius fix
// (#2). The structural-rendering regression for the b64 root cause (#1)
// lives in test/ui/deep-link-utf8.test.mjs.
//
// Why source-grep (not jsdom): per
// test/ui/surfaces/situation-room/artifact-chip-row.test.mjs the
// Clarity Pack repo has NO jsdom in devDependencies, NO TSX test
// transform, NO test-renderer; adding any of those is an out-of-scope
// new-runtime-dep change. Every existing UI test is a source-grep /
// static-analysis test reading `.tsx` as text. This file follows the
// same convention.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const BOUNDARY_PATH = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'primitives',
  'error-boundary.tsx',
);
const READER_INDEX_PATH = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'surfaces',
  'reader',
  'index.tsx',
);
const THEME_CSS_PATH = path.join(
  REPO_ROOT,
  'src',
  'ui',
  'primitives',
  'theme.css',
);

function readSrc(p) {
  return readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// The boundary primitive itself
// ---------------------------------------------------------------------------

test('SectionErrorBoundary primitive file exists at the canonical path', () => {
  assert.ok(existsSync(BOUNDARY_PATH), `expected ${BOUNDARY_PATH}`);
});

test('SectionErrorBoundary is a React class component with getDerivedStateFromError + componentDidCatch (the only React-built-in mechanism that catches render throws)', () => {
  const src = readSrc(BOUNDARY_PATH);
  assert.match(src, /export\s+class\s+SectionErrorBoundary\b/);
  assert.match(
    src,
    /static\s+getDerivedStateFromError\b/,
    'must implement static getDerivedStateFromError — sets fallback state synchronously when a child throws',
  );
  assert.match(
    src,
    /componentDidCatch\b/,
    'must implement componentDidCatch — surfaces the throw to console.error for operator devtools post-deploy diagnosis',
  );
});

test('SectionErrorBoundary fallback uses the locked literal "Section unavailable" and the scoped CSS class', () => {
  const src = readSrc(BOUNDARY_PATH);
  assert.match(
    src,
    /Section unavailable/,
    'locked fallback caption — pinned so the source-grep finds the wrap site verbatim',
  );
  assert.match(
    src,
    /clarity-error-boundary/,
    'fallback carries the scoped CSS class so theme.css can style it without breaking [data-clarity-surface] containment',
  );
  assert.match(
    src,
    /data-clarity-section/,
    'fallback carries the section name as a data attribute for operator screenshots + devtools forensics',
  );
});

test('SectionErrorBoundary logs the captured error to console.error so the BEAAA repro yields a real stack trace post-deploy', () => {
  const src = readSrc(BOUNDARY_PATH);
  assert.match(src, /console\.error\(/);
  assert.match(
    src,
    /clarity-pack:\s+section\s+/i,
    'log tag must include the section name so operator can filter for clarity-pack throws',
  );
});

// ---------------------------------------------------------------------------
// Reader/index.tsx wrapping — the wide-blast-radius fix
// ---------------------------------------------------------------------------

test('Reader index.tsx imports SectionErrorBoundary from the primitives directory', () => {
  const src = readSrc(READER_INDEX_PATH);
  assert.match(
    src,
    /import\s*\{\s*SectionErrorBoundary\s*\}\s*from\s*['"]\.\.\/\.\.\/primitives\/error-boundary\.tsx['"]/,
  );
});

// Every Reader sub-component that ships in the populated render path must be
// wrapped. The wrap shape is `<SectionErrorBoundary name="<kebab>" ...>...
// <Child /> ...</SectionErrorBoundary>`. The source-grep below pins each
// section name + asserts the wrap appears in the file.
const WRAPPED_SECTIONS = [
  // Surface chrome.
  { name: 'surface-header', child: 'ClaritySurfaceHeader' },
  { name: 'agent-pause-banner', child: 'AgentPauseBanner' },

  // Reader header action row.
  { name: 'continue-in-chat', child: 'ContinueInChatButton' },
  { name: 'reverse-topics', child: 'ReverseTopicsLink' },

  // Top-of-body context.
  { name: 'breadcrumb', child: 'Breadcrumb' },
  { name: 'tldr', child: 'TldrStrip' },

  // Main column.
  { name: 'prose', child: 'ProseWithRefChips' },
  { name: 'anchored-to', child: 'AnchoredToCards' },
  { name: 'deliverable', child: 'DeliverablePreview' },
  { name: 'ac-checklist', child: 'AcChecklist' },
  { name: 'activity', child: 'ActivityTimeline' },

  // Right rail.
  { name: 'live-blocker', child: 'LiveBlockerPanel' },

  // Footer.
  { name: 'pause-banner', child: 'PauseBanner' },
];

for (const { name, child } of WRAPPED_SECTIONS) {
  test(`Reader index.tsx wraps <${child} /> in a <SectionErrorBoundary name="${name}"> (wide-blast-radius fix for BEAAA-828 + repro on BEAAA-142/141/125/138/682/79)`, () => {
    const src = readSrc(READER_INDEX_PATH);
    // The wrap shape is multi-line. Match the opening boundary tag with
    // the named section, then assert the child tag appears before the
    // closing boundary tag.
    const re = new RegExp(
      `<SectionErrorBoundary\\s+name="${name}"[\\s\\S]*?<${child}\\b[\\s\\S]*?<\\/SectionErrorBoundary>`,
    );
    assert.match(
      src,
      re,
      `Reader index.tsx must wrap <${child}> in <SectionErrorBoundary name="${name}">; a section throw without this wrap propagates to the host's PluginSlotErrorBoundary and wipes the whole Reader tab.`,
    );
  });
}

test('Reader index.tsx passes resetKey={entityId} to each SectionErrorBoundary so navigation to a different issue clears any prior error state on the next tick', () => {
  const src = readSrc(READER_INDEX_PATH);
  // At least one occurrence — but ideally one per boundary. We assert
  // global presence + a count >= the number of wraps.
  const matches = src.match(/<SectionErrorBoundary\s+name="[a-z-]+"\s+resetKey=\{entityId\}/g) ?? [];
  assert.ok(
    matches.length >= WRAPPED_SECTIONS.length,
    `expected at least ${WRAPPED_SECTIONS.length} boundaries with resetKey={entityId}; got ${matches.length}.`,
  );
});

// ---------------------------------------------------------------------------
// theme.css — the scoped fallback selector
// ---------------------------------------------------------------------------

test('theme.css has a scoped .clarity-error-boundary selector under [data-clarity-surface] (CSS-scope guard intact)', () => {
  const src = readSrc(THEME_CSS_PATH);
  assert.match(
    src,
    /\[data-clarity-surface\][^{]*\.clarity-error-boundary\s*\{/,
    'the boundary fallback selector must be scoped under [data-clarity-surface] so it does not bleed onto host page elements',
  );
});
