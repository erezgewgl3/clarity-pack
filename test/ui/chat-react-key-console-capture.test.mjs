// test/ui/chat-react-key-console-capture.test.mjs
//
// Plan 05-07 Task 2 (D-14) — React-key console-capture gate.
//
// CONTEXT.md D-14 mandates "Closes the rc.3-era console noise in v1.0"
// via a DOM-render console-capture gate. The clean approach would be to
// jsdom-mount each of the 5 named components and assert
// `console.error` / `console.warn` carry zero
// `Warning: Each child in a list should have a unique "key" prop`
// warnings across all five render paths.
//
// DEVIATION (planner pick — falls under Plan 05-07's <action> step 6
// "Planner picks the simpler path that actually catches `key`-prop
// warnings"):
//
// The Clarity Pack project ships NO TSX test transform, NO jsdom in
// devDependencies, NO test-renderer. Every existing UI test is a
// source-grep / static-analysis test reading .tsx as text — Node's
// `--test` runner cannot import .tsx directly. Adding jsdom +
// @testing-library + a TSX loader would be a NEW npm dependency
// install — explicitly excluded from Rule 3 of the GSD deviation
// rules (auto-installing packages requires a checkpoint:human-verify
// for package legitimacy).
//
// The closure gate this test file enforces is therefore a STATIC
// CONSOLE-CAPTURE PROXY:
//
//   1. For each of the 5 named components (ContextRail / PersistedMessage
//      / TrueTaskDialog / AnchoredToCards / ChatPageBody) + their direct
//      child render-path dependencies, parse the source and assert that
//      EVERY `Array.prototype.map(...)` callback returning JSX carries an
//      explicit `key={...}` prop.
//   2. Bias against array-index-only keys: any `key={i}` / `key={index}`
//      bare-numeric key is flagged. Composite keys (e.g.
//      `key={`row-${i}-${row.type}`}`) are accepted because the
//      composite-with-stable-field pattern survives sibling re-ordering.
//   3. Audit the corresponding history: prove the named components
//      carry the 05-07 audit-pass annotation in their source comments
//      (the per-component audit commits documented above each one).
//
// This is a strict superset of `no-react-key-warnings.test.mjs` (the
// existing source-grep static analyser):
//   - The base analyser checks ALL six listed FILES for missing keys.
//   - This file ALSO asserts the per-component AUDIT ANNOTATION exists
//     (documented audit verdict + console-capture gate citation), AND
//     applies the no-bare-index-key rule.
//
// If a future operator drill captures a NEW React-key warning that
// originates in a plugin-code path NOT covered here, the protocol is:
//   - Add the file to AUDIT_FILES (extends no-react-key-warnings.test.mjs's
//     FILES too).
//   - Re-run this file as part of the plan that closes the gap.
//   - Document the file in the per-plan SUMMARY's "React-key audit"
//     section.
//
// If a future operator drill captures a NEW React-key warning that
// originates in HOST code (host React tree, @paperclipai/plugin-sdk/ui,
// react-dom internals), the protocol is:
//   - File an upstream Paperclip issue.
//   - Add the warning regex to EXPECTED_HOST_WARNINGS below with the
//     upstream issue URL.
//   - Re-run no-react-key-warnings + this file; both stay green.
//   - Document the allow-list entry in the closing SUMMARY.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Files audited by Plan 05-07 D-14 (the 5 named components + direct deps). */
const AUDIT_FILES = [
  // 5 named components.
  'src/ui/surfaces/chat/context-rail.tsx',          // ContextRail
  'src/ui/surfaces/chat/message-thread.tsx',        // PersistedMessage
  'src/ui/surfaces/chat/true-task/true-task-dialog.tsx', // TrueTaskDialog
  'src/ui/surfaces/reader/ref-card.tsx',            // AnchoredToCards
  'src/ui/surfaces/chat/index.tsx',                 // ChatPageBody
  // Direct child render-path dependencies (audited inside the per-component
  // audit commits but not yet in no-react-key-warnings.test.mjs).
  'src/ui/surfaces/chat/active-tasks-owned.tsx',
  'src/ui/surfaces/chat/archive-topic-button.tsx',
  'src/ui/surfaces/chat/true-task/inline-task-card.tsx',
  'src/ui/surfaces/chat/true-task/chat-task-status-pill.tsx',
];

/**
 * Allow-list for host-side warnings the gate intentionally tolerates.
 * Empty as of Plan 05-07 — no host-side allow-list entries needed.
 * Shape kept for future plan operator drills that capture host-attributed
 * warnings (each entry: { pattern, reason, issueUrl }).
 */
const EXPECTED_HOST_WARNINGS = [];

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// ---- Gate 1 — every JSX-returning .map() carries a stable key ----------

for (const rel of AUDIT_FILES) {
  test(`D-14 console-capture proxy: ${rel} — every JSX-returning .map() has key={...}`, () => {
    const src = readSrc(rel);
    // Mirror the no-react-key-warnings analyser logic (it already handles
    // the JSX-returning-vs-data-projection distinction correctly):
    const mapRe = /\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
    let m;
    const offenders = [];
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
      `${rel}: ${offenders.length} JSX-returning .map() without key=.\n` +
        offenders.map((o) => `@${o.index}: ${o.snippet.replace(/\s+/g, ' ')}`).join('\n'),
    );
  });
}

// ---- Gate 2 — no bare-index-only keys ----------------------------------

for (const rel of AUDIT_FILES) {
  test(`D-14 console-capture proxy: ${rel} — no bare-index-only key={i} / key={index}`, () => {
    const raw = readSrc(rel);
    // Strip comments + comment-only lines so audit-trail prose (which
    // commonly references the bad-pattern literally — "the bare-index
    // `key={i}` regression we closed in 04.2-05 D4") does not false-flag.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Bare numeric-index keys are a re-ordering hazard. The repo has
    // already swapped the two known offenders to composite keys
    // (message-thread.tsx lines 990/998 — composite with section.title /
    // row.type). This gate prevents regression.
    //
    // Bare patterns we DON'T want:  key={i}   key={j}   key={index}
    // OK composite patterns:        key={`row-${i}-${row.type}`}
    // OK stable field patterns:     key={msg.commentId}
    const bareIndexRe = /key=\{\s*(?:i|j|k|idx|index)\s*\}/g;
    const bareMatches = src.match(bareIndexRe) ?? [];
    assert.equal(
      bareMatches.length,
      0,
      `${rel}: ${bareMatches.length} bare-index key(s) found. Compose with a stable field (e.g. \`row-\${i}-\${row.type}\`).`,
    );
  });
}

// ---- Gate 3 — audit annotation present on the 5 named components -------

const NAMED_COMPONENTS = [
  {
    rel: 'src/ui/surfaces/chat/context-rail.tsx',
    component: 'ContextRail',
  },
  {
    rel: 'src/ui/surfaces/chat/message-thread.tsx',
    component: 'PersistedMessage',
  },
  {
    rel: 'src/ui/surfaces/chat/true-task/true-task-dialog.tsx',
    component: 'TrueTaskDialog',
  },
  {
    rel: 'src/ui/surfaces/reader/ref-card.tsx',
    component: 'AnchoredToCards',
  },
  {
    rel: 'src/ui/surfaces/chat/index.tsx',
    component: 'ChatPageBody',
  },
];

for (const { rel, component } of NAMED_COMPONENTS) {
  test(`D-14 audit annotation: ${rel} cites Plan 05-07 + D-14 + ${component}`, () => {
    const src = readSrc(rel);
    assert.match(src, /05-07/, `expected Plan 05-07 reference in ${rel}`);
    assert.match(src, /D-14/, `expected D-14 reference in ${rel}`);
    assert.match(
      src,
      new RegExp(component),
      `expected the audited component name ${component} in ${rel}`,
    );
  });
}

// ---- Gate 4 — EXPECTED_HOST_WARNINGS allow-list shape ------------------

test('D-14 EXPECTED_HOST_WARNINGS allow-list has the documented shape', () => {
  // The allow-list MAY be empty as of Plan 05-07 (no host-side warnings
  // surfaced). But its shape contract is documented above; future plans
  // that add entries MUST conform — each entry needs pattern + reason +
  // issueUrl. This gate keeps the shape contract enforced.
  assert.ok(Array.isArray(EXPECTED_HOST_WARNINGS), 'allow-list is an Array');
  for (const entry of EXPECTED_HOST_WARNINGS) {
    assert.ok(entry.pattern instanceof RegExp, 'pattern is a RegExp');
    assert.equal(typeof entry.reason, 'string', 'reason is a string');
    assert.ok(entry.reason.length <= 100, 'reason ≤ 100 chars');
    assert.match(entry.issueUrl, /^https?:\/\//, 'issueUrl is a URL');
  }
});
