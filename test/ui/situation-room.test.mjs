// test/ui/situation-room.test.mjs
//
// Plan 09-02 Task 3 — REWRITE for the actionable cockpit (grid → groups).
//
// The Phase 2/6.1 Situation Room rendered a flat AgentCard grid + critical-path
// strip + awaiting-you pill. Plan 09-02 replaces all of that with ONE
// three-group people view (Needs you / Working / Idle, always all three per
// D-03), fed solely by situation_employees + the worker `group` field (R2 — no
// client re-sort). This source-grep contract asserts the new structure and the
// absence of every deleted surface (R1).
//
// SOURCE-GREP test (Node doesn't load .tsx through the test runtime).

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

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ---------------------------------------------------------------------------
// File structure — the new component set; the dead grid components are gone (R1)
// ---------------------------------------------------------------------------

const REQUIRED_FILES = [
  'index.tsx',
  'employee-row.tsx',
  'employee-row-strip.tsx',
  'needs-you-banner.tsx',
  'owner-picker-popover.tsx',
  'blocked-backlog-expander.tsx',
  'sparkline.tsx',
];

for (const f of REQUIRED_FILES) {
  test(`Situation Room: ${f} exists`, () => {
    assert.ok(existsSync(path.join(ROOM_DIR, f)), `expected ${f}`);
  });
}

const DELETED_FILES = [
  'agent-card.tsx',
  'artifact-chip-row.tsx',
  'org-blocked-backlog-banner.tsx',
  'critical-path-strip.tsx',
  'awaiting-you-pill.tsx',
];

for (const f of DELETED_FILES) {
  test(`Situation Room (R1): ${f} is DELETED`, () => {
    assert.ok(!existsSync(path.join(ROOM_DIR, f)), `expected ${f} to be deleted`);
  });
}

// ---------------------------------------------------------------------------
// index.tsx — surface scaffolding preserved
// ---------------------------------------------------------------------------

test('Situation Room: index.tsx exports SituationRoom + wraps in <ClaritySurfaceRoot name="situation-room"> (SCAF-06)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function SituationRoom/);
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']situation-room["']/);
});

test('Situation Room: index.tsx uses usePollWithLeader (ROOM-07 leader-elected polling)', () => {
  assert.match(readSrc('index.tsx'), /usePollWithLeader\b/);
});

test('Situation Room: index.tsx reads situationRefreshIntervalMs from useInstanceConfig (D-03)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /useInstanceConfig\b/);
  assert.match(src, /situationRefreshIntervalMs/);
});

test('Situation Room: index.tsx mounts <PauseBanner /> (D-07)', () => {
  assert.match(readSrc('index.tsx'), /PauseBanner\b/);
});

test('Situation Room: index.tsx calls useOptIn() + renders <EnableClarityCta /> when opted-out (OPTIN-02)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /useOptIn\b/);
  assert.match(src, /EnableClarityCta\b/);
});

test('Situation Room: index.tsx queries situation.snapshot + pings active-viewer', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /['"]situation\.snapshot['"]/);
  assert.match(src, /situation\.active-viewer-ping/);
});

// ---------------------------------------------------------------------------
// R1 — the dead grid + dead pipelines are gone from index.tsx (code, not prose)
// ---------------------------------------------------------------------------

test('Situation Room (R1): index.tsx has NO clarity-agent-grid / AgentCard / situation.artifacts in code', () => {
  const code = stripComments(readSrc('index.tsx'));
  assert.doesNotMatch(code, /clarity-agent-grid/);
  assert.doesNotMatch(code, /<AgentCard/);
  assert.doesNotMatch(code, /AgentEmployee/);
  assert.doesNotMatch(code, /usePluginData<[^>]*>\(\s*['"]situation\.artifacts['"]/);
  assert.doesNotMatch(code, /['"]situation\.artifacts['"]/);
});

test('Situation Room (R6): index.tsx mounts NO standalone OrgBlockedBacklogBanner / CriticalPathStrip / AwaitingYouPill', () => {
  const code = stripComments(readSrc('index.tsx'));
  assert.doesNotMatch(code, /<OrgBlockedBacklogBanner/);
  assert.doesNotMatch(code, /<CriticalPathStrip/);
  assert.doesNotMatch(code, /<AwaitingYouPill/);
});

// ---------------------------------------------------------------------------
// R2 / D-03 — three group sections, always all three, fed by worker group
// ---------------------------------------------------------------------------

test('Situation Room (D-03): the strip renders exactly three groups — needs_you / working / idle', () => {
  const src = readSrc('employee-row-strip.tsx');
  assert.match(src, /needs_you/);
  assert.match(src, /working/);
  assert.match(src, /idle/);
  // GROUP_ORDER literal proves the three-section, fixed-order render.
  assert.match(src, /GROUP_ORDER/);
});

test('Situation Room (D-03): an empty group still renders a "— none —" branch', () => {
  assert.match(readSrc('employee-row-strip.tsx'), /— none —/);
});

test('Situation Room (R2): the strip partitions by the worker row.group — NO client-side .sort()', () => {
  const src = readSrc('employee-row-strip.tsx');
  assert.match(src, /row\.group/);
  // No re-sort of the worker order.
  assert.doesNotMatch(stripComments(src), /\.sort\(/);
});

test('Situation Room (R6): the BlockedBacklogExpander is mounted by the strip (end of Needs-you)', () => {
  const src = readSrc('employee-row-strip.tsx');
  assert.match(src, /<BlockedBacklogExpander/);
  assert.match(src, /group === 'needs_you'/);
});

// ---------------------------------------------------------------------------
// sparkline — pure SVG (regression; the component is retained)
// ---------------------------------------------------------------------------

test('Situation Room: sparkline.tsx is pure SVG (no charting library)', () => {
  const src = readSrc('sparkline.tsx');
  assert.match(src, /<svg\b/);
  assert.match(src, /<polyline\b|<path\b/);
  assert.doesNotMatch(src, /from\s+['"](recharts|chart\.js|d3|victory|nivo)/);
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

test('Manifest (Plan 09-01): the recompute-situation cron job is REMOVED; jobs[] keeps compile-bulletin', () => {
  const raw = readFileSync(MANIFEST, 'utf8');
  const codeOnly = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.match(codeOnly, /jobs:\s*\[/);
  assert.ok(
    !/recompute-situation/.test(codeOnly),
    'recompute-situation job key must be absent from manifest code',
  );
  assert.match(codeOnly, /compile-bulletin/);
});

test('Manifest (Plan 09-01): capabilities[] includes issues.update (first core-issue mutation, R8)', () => {
  assert.match(readFileSync(MANIFEST, 'utf8'), /['"]issues\.update['"]/);
});

test('Manifest: declares jobs.schedule capability (PLUGIN_SPEC §17)', () => {
  assert.match(readFileSync(MANIFEST, 'utf8'), /['"]jobs\.schedule['"]/);
});

test('Manifest (Plan 09-02 / R1): the dead situationArtifactsWindow config key is REMOVED', () => {
  const raw = readFileSync(MANIFEST, 'utf8');
  const codeOnly = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/situationArtifactsWindow\s*:/.test(codeOnly),
    'situationArtifactsWindow config key must be gone with the deleted handler',
  );
});
