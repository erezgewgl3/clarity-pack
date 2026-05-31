// test/ui/surfaces/situation-room/no-dead-buttons.test.mjs
//
// Plan 09-02 Task 3 — R4 / R9 CI GATE (the operator's headline rule).
//
// "ensure everything we're surfacing is functional — when I click it, it does
//  what it's supposed to. There were a lot of buttons before that just didn't
//  work."  (SPEC R4 — the phase's acceptance spine.)
//
// This source-grep gate fails the build if any Situation Room action surface
// reintroduces a DEAD button:
//   (a) a `disabled` attribute on a row/banner action affordance — R4 says an
//       action that can't be performed is ABSENT, never rendered disabled
//       (this is exactly the Phase 8 `disabled={!deepLink}` / "Open chat with
//       Unassigned" seam this plan removed). The [Assign first] banner button
//       is explicitly covered (WARNING 1).
//   (b) a no-op onClick whose body is only a comment / empty block (the Phase 8
//       "affordance only" idle Assign-work / Stand-down stubs).
//
// The owner-picker popover MENU ITEMS may carry `disabled={assigning}` — that
// is a TRANSIENT in-flight guard (the item performs a real assign; it is just
// debounced while one is in flight), not a dead button. We allow `disabled={`
// bound to a busy/assigning/in-flight state expression there, and forbid any
// other disabled form on action buttons.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ---------------------------------------------------------------------------
// (a) NO `disabled` attribute on row/banner action affordances.
// employee-row.tsx + needs-you-banner.tsx must have ZERO `disabled=` in code.
// ---------------------------------------------------------------------------

const NO_DISABLED_FILES = [
  'src/ui/surfaces/situation-room/employee-row.tsx',
  'src/ui/surfaces/situation-room/needs-you-banner.tsx',
  'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx',
];

for (const rel of NO_DISABLED_FILES) {
  test(`R4 — ${rel} renders ZERO disabled action buttons`, () => {
    const code = stripComments(readSrc(rel));
    const matches = code.match(/disabled=/g) || [];
    assert.equal(
      matches.length,
      0,
      `${rel} must not render any disabled action affordance (R4 — absent, never disabled). Found ${matches.length}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// (a') The owner-picker popover may only use `disabled` as a transient in-flight
// guard (disabled={assigning} / disabled={busy}). Any other disabled form fails.
// ---------------------------------------------------------------------------

test('R4 — owner-picker-popover.tsx disabled= is ONLY a transient in-flight guard', () => {
  const code = stripComments(readSrc('src/ui/surfaces/situation-room/owner-picker-popover.tsx'));
  const all = code.match(/disabled=\{[^}]*\}/g) || [];
  const offenders = all.filter((d) => !/disabled=\{(assigning|busy|inFlight|pending)\}/.test(d));
  assert.equal(
    offenders.length,
    0,
    `owner-picker disabled= must be a busy/assigning in-flight guard only. Offenders: ${offenders.join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// (b) NO no-op onClick (a handler whose body is only a comment / empty block).
// ---------------------------------------------------------------------------

const ACTION_FILES = [
  'src/ui/surfaces/situation-room/employee-row.tsx',
  'src/ui/surfaces/situation-room/owner-picker-popover.tsx',
  'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx',
  'src/ui/surfaces/situation-room/needs-you-banner.tsx',
];

for (const rel of ACTION_FILES) {
  test(`R4 — ${rel} has NO no-op onClick (empty/comment-only handler body)`, () => {
    const src = readSrc(rel);
    // onClick={() => {  <only whitespace/comments>  }}  — the Phase 8 stub shape.
    // Match an arrow handler whose block body contains no statement (only
    // whitespace and/or // or /* */ comments).
    const noopArrow =
      /onClick=\{\s*\(\)\s*=>\s*\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*\}\s*\}/g;
    const offenders = src.match(noopArrow) || [];
    assert.equal(
      offenders.length,
      0,
      `${rel} must not bind an onClick to an empty/comment-only handler (R4 — no no-op buttons). Offenders:\n${offenders.join('\n')}`,
    );
  });
}

// ---------------------------------------------------------------------------
// (c) Positive guard — the deleted dead-grid components/handler have NO importer
// anywhere in src/ (R1 — nothing references them as live).
// ---------------------------------------------------------------------------

test('R1 — no src/ file imports a deleted Situation Room component or the situation.artifacts handler', () => {
  const SRC = path.resolve(REPO_ROOT, 'src');
  const deletedSpecifiers = [
    './agent-card',
    './artifact-chip-row',
    './org-blocked-backlog-banner.tsx',
    './org-blocked-backlog-banner\'',
    './critical-path-strip',
    './awaiting-you-pill',
    'handlers/situation-artifacts',
  ];
  // Walk src/ for .ts/.tsx and assert no `import ... from '<deleted>'`.
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
  const offenders = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const spec of deletedSpecifiers) {
      // Only flag actual import/from statements, not incidental substrings.
      const re = new RegExp(`from\\s+['"][^'"]*${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      if (re.test(src)) offenders.push(`${path.relative(REPO_ROOT, f)} imports ${spec}`);
    }
  }
  assert.equal(offenders.length, 0, `deleted components/handler must have no importer:\n${offenders.join('\n')}`);
});

import { readdirSync, statSync } from 'node:fs';
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (d) The owner-picker is sourced from chat.roster (Editor-Agent excluded
// server-side), NOT ctx.agents.list (T-09-11 / WARNING 2).
// ---------------------------------------------------------------------------

test('T-09-11 / WARNING 2 — owner-picker sources options from chat.roster, never agents.list', () => {
  const code = stripComments(readSrc('src/ui/surfaces/situation-room/owner-picker-popover.tsx'));
  assert.match(code, /usePluginData<[^>]*>\(\s*['"]chat\.roster['"]/);
  // Never a fresh agents fetch — the Editor-Agent must never become assignable.
  assert.doesNotMatch(code, /ctx\.agents\.list/);
  assert.doesNotMatch(code, /usePluginData<[^>]*>\(\s*['"]agents(\.list)?['"]/);
});

test('D-02 — owner-picker has a "Take it myself" item dispatching situation.assignOwner with takeItMyself', () => {
  const src = readSrc('src/ui/surfaces/situation-room/owner-picker-popover.tsx');
  assert.match(src, /Take it myself/);
  assert.match(src, /takeItMyself/);
  assert.match(src, /situation\.assignOwner/);
});
