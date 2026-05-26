// test/ui/situation-room.test.mjs
//
// Plan 02-04 Task 2 RED — Situation Room source contract. SOURCE-GREP test
// (Node 24 doesn't load .tsx through the test runtime). Verifies:
//   - file structure: situation-room/index.tsx + agent-card.tsx +
//     critical-path-strip.tsx + artifact-chip-row.tsx (Plan 06.1-03;
//     REPLACED artifacts-shipped-shelf.tsx per D-02) + awaiting-you-pill.tsx
//     + sparkline.tsx
//   - index.tsx wraps in <ClaritySurfaceRoot name="situation-room"> (SCAF-06)
//   - calls usePollWithLeader for 'situation.snapshot' (ROOM-07)
//   - reads situationRefreshIntervalMs via useInstanceConfig (D-03 config)
//   - mounts <PauseBanner /> (D-07 reused from 02-03)
//   - gates on useOptIn — opted-out renders <EnableClarityCta />
//   - renders <CriticalPathStrip>, <AgentCard>, <AwaitingYouPill>
//     (Plan 06.1-03: <ArtifactsShippedShelf> is DELETED per D-02; the
//     per-agent inline ArtifactChipRow inside AgentCard supersedes it.)

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'situation-room');

function readSrc(rel) {
  return readFileSync(path.join(ROOM_DIR, rel), 'utf8');
}

const REQUIRED_FILES = [
  'index.tsx',
  'agent-card.tsx',
  'critical-path-strip.tsx',
  // Plan 06.1-03 (D-02) — artifacts-shipped-shelf.tsx is DELETED.
  // The per-agent inline ArtifactChipRow replaces it.
  'artifact-chip-row.tsx',
  'awaiting-you-pill.tsx',
  'sparkline.tsx',
];

for (const f of REQUIRED_FILES) {
  test(`Situation Room: ${f} exists`, () => {
    assert.ok(existsSync(path.join(ROOM_DIR, f)), `expected ${f}`);
  });
}

test('Situation Room: index.tsx exports SituationRoom + wraps in <ClaritySurfaceRoot name="situation-room"> (SCAF-06)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function SituationRoom/);
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']situation-room["']/);
});

test('Situation Room: index.tsx uses usePollWithLeader (ROOM-07 leader-elected polling)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /usePollWithLeader\b/);
});

test('Situation Room: index.tsx reads situationRefreshIntervalMs from useInstanceConfig (D-03)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /useInstanceConfig\b/);
  assert.match(src, /situationRefreshIntervalMs/);
});

test('Situation Room: index.tsx mounts <PauseBanner /> (D-07 footer on every Clarity surface)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /PauseBanner\b/);
});

test('Situation Room: index.tsx calls useOptIn() (OPTIN-02 gate)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /useOptIn\b/);
});

test('Situation Room: index.tsx renders <EnableClarityCta /> when opted-out (OPTIN-02)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /EnableClarityCta\b/);
});

test('Situation Room: index.tsx renders <CriticalPathStrip>, <AgentCard>, <AwaitingYouPill> (Plan 06.1-03: <ArtifactsShippedShelf> DELETED per D-02)', () => {
  const rawSrc = readSrc('index.tsx');
  for (const name of ['CriticalPathStrip', 'AgentCard', 'AwaitingYouPill']) {
    assert.match(rawSrc, new RegExp(`<${name}\\b`), `renders <${name} />`);
  }
  // Negative assertion — the deleted shelf mount must NOT be re-introduced.
  // Strip block + line comments first so the doc-comment that documents the
  // deletion (mentions the literal `<ArtifactsShippedShelf />`) does not
  // false-trip the assertion.
  const codeOnly = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    codeOnly,
    /<ArtifactsShippedShelf\b/,
    'index.tsx must not mount <ArtifactsShippedShelf /> — file was deleted in Plan 06.1-03 per D-02',
  );
});

test('Situation Room: index.tsx queries situation.snapshot via usePollWithLeader', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /['"]situation\.snapshot['"]/);
});

test('Situation Room: index.tsx pings active-viewer (ROOM-05)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /situation\.active-viewer-ping/);
});

test('Situation Room: sparkline.tsx is pure SVG (no charting library)', () => {
  const src = readSrc('sparkline.tsx');
  assert.match(src, /<svg\b/);
  assert.match(src, /<polyline\b|<path\b/);
  // No external charting library imports
  assert.doesNotMatch(src, /from\s+['"](recharts|chart\.js|d3|victory|nivo)/);
});

test('Situation Room: awaiting-you-pill.tsx uses useHostNavigation (SCAF-09 no raw <a href>)', () => {
  const src = readSrc('awaiting-you-pill.tsx');
  assert.match(src, /useHostNavigation\b/);
});

// ---------------------------------------------------------------------------
// useInstanceConfig — option (b) FALLBACK per 02-01 Check F
// ---------------------------------------------------------------------------

const USE_INSTANCE_CONFIG = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'primitives',
  'use-instance-config.ts',
);

test('useInstanceConfig: file exists at src/ui/primitives/', () => {
  assert.ok(existsSync(USE_INSTANCE_CONFIG), `expected ${USE_INSTANCE_CONFIG}`);
});

test('useInstanceConfig: wraps usePluginData on clarity-pack/get-instance-config (02-01 Check F FALLBACK)', () => {
  const src = readFileSync(USE_INSTANCE_CONFIG, 'utf8');
  assert.match(src, /usePluginData/);
  assert.match(src, /clarity-pack\/get-instance-config/);
  // Must NOT import useInstanceConfig from the SDK (it doesn't exist at 2026.512.0)
  assert.doesNotMatch(src, /import\s*\{[^}]*useInstanceConfig[^}]*\}\s*from\s+['"]@paperclipai\/plugin-sdk/);
});

// ---------------------------------------------------------------------------
// Manifest contract
// ---------------------------------------------------------------------------

const MANIFEST = path.resolve(HERE, '..', '..', 'src', 'manifest.ts');

test('Manifest: declares instanceConfigSchema with situationRefreshIntervalMs (D-03 configurable cadence)', () => {
  const src = readFileSync(MANIFEST, 'utf8');
  assert.match(src, /instanceConfigSchema/);
  assert.match(src, /situationRefreshIntervalMs/);
});

test('Manifest: declares jobs[] with recompute-situation entry on cron */1 * * * *', () => {
  const src = readFileSync(MANIFEST, 'utf8');
  assert.match(src, /jobs:\s*\[/);
  assert.match(src, /recompute-situation/);
  assert.match(src, /\*\/1\s*\*\s*\*\s*\*\s*\*/);
});

test('Manifest: declares jobs.schedule capability (PLUGIN_SPEC §17)', () => {
  const src = readFileSync(MANIFEST, 'utf8');
  assert.match(src, /['"]jobs\.schedule['"]/);
});
