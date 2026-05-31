// test/ui/clarity-pack-css-rules.test.mjs
//
// Plan 02-08 Task 1 — parse-based CSS rule-existence contract.
//
// Why parse-based, not JSDOM/getComputedStyle:
//   Node's test runner does not fully evaluate CSS variables, color-mix(), or
//   oklch(). A JSDOM-based "did this rule resolve a non-default style?" test
//   would be partial at best. Instead this file reads theme.css, strips block
//   comments, walks the source character-by-character tracking brace depth,
//   collects top-level (selector, declarations) pairs, and asserts that every
//   classname in AUDITED_CLASSNAMES has at least one rule with at least one
//   non-trivial declaration. "Non-trivial" excludes empty values and the three
//   reset keywords (initial / unset / inherit).
//
// The Plan 02-04 drill caught a structural test-design gap: components rendered
// AND props were honored AND unit tests passed, but visual fidelity was broken
// because none of the clarity-* classnames had CSS rules. This test ensures
// every audited classname has a rule.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const THEME_CSS = path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'theme.css');

export const AUDITED_CLASSNAMES = Object.freeze([
  // CTA (DEV-06 cluster A)
  'clarity-cta', 'clarity-cta-heading', 'clarity-cta-body',
  'clarity-cta-button', 'clarity-cta-fine',
  // Situation Room page chrome (DEV-06 cluster B)
  'clarity-room-loading', 'clarity-room-error',
  // Plan 09-02 (R1) — the dead AgentCard grid (clarity-agent-grid /
  // clarity-agent-card* / clarity-now-doing / clarity-agent-terminal*), the
  // standalone critical-path strip (clarity-critical-path*), the awaiting-you
  // pill (clarity-awaiting-you*), the org-backlog banner (clarity-blocked-*),
  // and the per-agent artifact chip row (clarity-artifact-chip-row*) were all
  // DELETED with their components + CSS. Removed from the audit set here.
  //
  // Plan 09-02 — the actionable cockpit's NEW classnames:
  // three group sections (D-03)
  'clarity-group-section', 'clarity-group-header', 'clarity-group-title',
  'clarity-group-count', 'clarity-group-rule', 'clarity-group-meta',
  'clarity-group-empty', 'clarity-group-rows',
  // grouped employee row + per-state action clusters (R4)
  'clarity-employee-row', 'clarity-employee-name', 'clarity-employee-role',
  'clarity-employee-state-pill', 'clarity-employee-actions',
  'clarity-employee-moving', 'clarity-employee-paused-marker',
  'clarity-employee-confirm',
  // shared button family (gold = ownership/chat; neutral chrome; danger)
  'clarity-btn', 'clarity-btn-gold', 'clarity-btn-danger',
  // owner-picker popover (D-01 / D-02)
  'clarity-owner-pick', 'clarity-owner-pick-pop', 'clarity-owner-pick-head',
  'clarity-owner-pick-item', 'clarity-owner-pick-self',
  // merged blocked-backlog + critical-path expander (R6)
  'clarity-orphans', 'clarity-orphan-toggle', 'clarity-orphan-list',
  'clarity-orphan-row', 'clarity-orphan-id', 'clarity-orphan-title',
  // un-frozen needs-you banner (R5)
  'clarity-needs-you-banner', 'clarity-needs-you-urgent',
  'clarity-needs-you-neutral', 'clarity-needs-you-action',
  // Sparkline (retained)
  'clarity-sparkline',
]);

// Pre-existing state-pill variants — regression check.
const PRESERVED_STATE_PILL_CLASSES = Object.freeze([
  'clarity-state-working',
  'clarity-state-stuck',
  'clarity-state-awaiting-you',
  'clarity-state-standby',
  'clarity-state-awaiting-peer',
]);

const TRIVIAL_VALUES = new Set(['initial', 'unset', 'inherit', '']);

/**
 * Parse a CSS source into a flat list of top-level `{ selector, declarations }`
 * pairs. Nested at-rules (e.g. `@media (...) { ... }`) contribute their inner
 * rules to the same flat list — for our purpose ("does this classname have a
 * rule?") the @media wrapper is irrelevant; the inner rule still applies under
 * the matching media query.
 */
function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let depth = 0;
  let cursor = 0;
  let blockStart = -1;
  // We need to recognize @media wrappers so we descend into them rather than
  // treating their bodies as opaque. We do this by tracking a stack: when we
  // see `@<word>` followed by `{` we record we're inside an at-rule and the
  // next `{` opens a nested context.
  // Strategy: when we hit `{`, look back for the selector (or @rule prelude).
  // If the prelude starts with `@` and contains keywords like media/supports/
  // container, descend (don't record this opening as a rule). Otherwise it's a
  // declaration block — record (selector, body) and skip to its closing `}`.
  while (cursor < stripped.length) {
    const ch = stripped[cursor];
    if (ch === '{') {
      // Look back for the prelude (selector or @-rule).
      let lookback = cursor - 1;
      while (lookback >= 0 && stripped[lookback] !== '}' && stripped[lookback] !== ';' && stripped[lookback] !== '{') {
        lookback -= 1;
      }
      const prelude = stripped.slice(lookback + 1, cursor).trim();
      const isAtRule = prelude.startsWith('@');
      if (isAtRule) {
        // Descend — don't record. Just consume the `{` and continue.
        depth += 1;
        cursor += 1;
        continue;
      }
      // Plain rule — find matching `}` at current depth.
      depth += 1;
      blockStart = cursor + 1;
      let scan = cursor + 1;
      let localDepth = 1;
      while (scan < stripped.length && localDepth > 0) {
        const c = stripped[scan];
        if (c === '{') localDepth += 1;
        else if (c === '}') localDepth -= 1;
        scan += 1;
      }
      const body = stripped.slice(blockStart, scan - 1);
      rules.push({ selector: prelude, body });
      cursor = scan;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
    cursor += 1;
  }
  return rules;
}

/** Count non-trivial `prop: value;` declarations in a block body. */
function countDeclarations(body) {
  const lines = body
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let n = 0;
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const value = line.slice(colonIdx + 1).trim().toLowerCase();
    if (TRIVIAL_VALUES.has(value)) continue;
    n += 1;
  }
  return n;
}

function readTheme() {
  return readFileSync(THEME_CSS, 'utf8');
}

// Test 1 — every classname has a non-trivial rule.
for (const cls of AUDITED_CLASSNAMES) {
  test(`CSS rule exists for .${cls} with at least one non-trivial declaration (DEV-06)`, () => {
    const css = readTheme();
    const rules = parseRules(css);
    const matching = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.selector));
    assert.ok(
      matching.length >= 1,
      `expected at least one rule with selector matching .${cls}; found ${matching.length} rules in ${THEME_CSS}`,
    );
    const withDecls = matching.filter((r) => countDeclarations(r.body) >= 1);
    assert.ok(
      withDecls.length >= 1,
      `expected at least one .${cls} rule with non-trivial declarations; found ${matching.length} rules but none with substantive properties (all empty/inherit/unset)`,
    );
  });
}

// Test 2 — every audited rule is scope-prefixed.
test('every audited classname rule is scope-prefixed with [data-clarity-surface] (SCAF-06 / COEXIST-01)', () => {
  const css = readTheme();
  const rules = parseRules(css);
  const offenders = [];
  for (const cls of AUDITED_CLASSNAMES) {
    const matching = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.selector));
    for (const r of matching) {
      if (!/^\s*\[data-clarity-surface/.test(r.selector)) {
        offenders.push(`${r.selector} (for .${cls})`);
      }
    }
  }
  assert.equal(offenders.length, 0, `every rule for an audited classname must start with [data-clarity-surface]. Offenders:\n${offenders.join('\n')}`);
});

// Test 3 — the group rows container uses display: flex/grid (proves the layout
// rule isn't a no-op color tweak). Plan 09-02 replaced the dead .clarity-agent-
// grid layout assertion with the live group-rows column.
test('.clarity-group-rows rule uses display: grid or flex (proves substantive layout)', () => {
  const css = readTheme();
  const rules = parseRules(css);
  const rows = rules.filter((r) => /\.clarity-group-rows(?![\w-])/.test(r.selector));
  assert.ok(rows.length >= 1, 'expected at least one .clarity-group-rows rule');
  const someDisplaysGridOrFlex = rows.some((r) => /display\s*:\s*(grid|flex)/i.test(r.body));
  assert.ok(
    someDisplaysGridOrFlex,
    `expected at least one .clarity-group-rows rule with display: grid or display: flex. Bodies:\n${rows.map((r) => r.body).join('\n---\n')}`,
  );
});

// Test 3b (R1) — the dead grid CSS is GONE.
test('R1: .clarity-agent-grid / .clarity-agent-card / .clarity-artifact-chip-row CSS is removed', () => {
  const css = readTheme();
  const rules = parseRules(css);
  for (const cls of ['clarity-agent-grid', 'clarity-agent-card', 'clarity-artifact-chip-row', 'clarity-critical-path', 'clarity-awaiting-you-pill', 'clarity-blocked-banner']) {
    const matching = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.selector));
    assert.equal(matching.length, 0, `expected NO .${cls} rule after Plan 09-02 deletion; found ${matching.length}`);
  }
});

// Test 4 — preserved state-pill variants (regression).
for (const cls of PRESERVED_STATE_PILL_CLASSES) {
  test(`preserved CSS rule for .${cls} (Plan 02-08 extends theme.css, must not delete)`, () => {
    const css = readTheme();
    const rules = parseRules(css);
    const matching = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.selector));
    assert.ok(matching.length >= 1, `expected pre-existing .${cls} rule still in theme.css`);
  });
}

// Test 5 — the built bundle picks up the new rules after build.
// Gated by RUN_BUILD_TESTS=1 because `pnpm build` is too heavy for default node --test.
// In CI / pre-rehearsal verify, set RUN_BUILD_TESTS=1.
//
// Plan 09-02 fix: the build INLINES theme.css into dist/ui/index.js as a text
// import (DEV-14 — Paperclip's host does NOT auto-load a sibling .css; there is
// no dist/ui/index.css sidecar). This test now reads the JS bundle where the
// CSS actually lives (same contract as runtime-css-injection.test.mjs). The old
// dist/ui/index.css reference was a stale sidecar that no build has emitted
// since DEV-14 — it only surfaced because this test is RUN_BUILD_TESTS-gated.
const DIST_JS = path.join(REPO_ROOT, 'dist', 'ui', 'index.js');
test('dist/ui/index.js inlines key audited classnames after build (gated on RUN_BUILD_TESTS=1)', { skip: process.env.RUN_BUILD_TESTS !== '1' }, () => {
  let js;
  try {
    js = readFileSync(DIST_JS, 'utf8');
  } catch (e) {
    assert.fail(`expected ${DIST_JS} to exist (run \`node scripts/build-ui.mjs\` first); got error: ${e.message}`);
  }
  for (const cls of ['clarity-group-section', 'clarity-cta-button', 'clarity-owner-pick-pop', 'clarity-needs-you-banner', 'clarity-employee-row']) {
    assert.ok(js.includes(cls), `dist/ui/index.js must inline ${cls}; got js of length ${js.length}`);
  }
});
