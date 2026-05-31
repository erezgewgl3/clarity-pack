// test/ui/no-react-key-warnings.test.mjs
//
// Plan 02-08 Task 3 RED — DEV-07 closure. Static-analysis source-grep that
// catches the common React-key-warning shapes:
//   - Array.prototype.map(...) callback returning JSX without an explicit
//     key={...} prop on the returned element.
//   - Fragment list with multiple children but no keys.
//
// Static analysis catches the obvious cases. Live console-error capture
// happens in the Plan 02-08 Task 4 manual rehearsal (Section C / DevTools
// console check).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// rc.8 Phase B 2026-05-26 — anti-regression for the operator-message-
// vanishing bug. The UI's belt-and-suspenders runtime-noise filter
// MUST allowlist comments whose chat_messages.sender_kind is 'user',
// matching the worker classifier (chat-messages.ts handler). The
// previous shape (authorType-only) caused every operator-sent message
// to render briefly via the optimistic overlay, then disappear when
// the next poll's reconciliation logic dropped the optimistic AND the
// UI's own filter then dropped the server message.
const REPO_ROOT_FOR_SENDER_KIND_GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('message-thread.tsx: runtime-noise filter MUST exempt senderKind:user (rc.8 Phase B anti-regression)', () => {
  const src = readFileSync(
    path.join(REPO_ROOT_FOR_SENDER_KIND_GUARD, 'src/ui/surfaces/chat/message-thread.tsx'),
    'utf8',
  );
  // Either the literal "senderKind !== 'user'" OR the conjunctive guard
  // (msg.senderKind !== 'user' && ...). Match either single-quote or
  // double-quote string form.
  const hasAllowlist =
    /senderKind\s*!==?\s*['"]user['"]/.test(src) ||
    /senderKind\s*===?\s*['"]user['"]/.test(src);
  assert.ok(
    hasAllowlist,
    'message-thread.tsx must allowlist senderKind:user in its runtime-noise filter — else operator chat messages vanish',
  );
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FILES = [
  'src/ui/components/enable-clarity-cta.tsx',
  'src/ui/surfaces/situation-room/index.tsx',
  // Plan 09-02 — the dead AgentCard grid + critical-path-strip + artifact-chip-
  // row are deleted (R1). The actionable cockpit's new map()-bearing components
  // are audited here: the grouped strip, the per-state employee row, the owner-
  // picker popover, and the merged blocked-backlog expander.
  'src/ui/surfaces/situation-room/employee-row-strip.tsx',
  'src/ui/surfaces/situation-room/employee-row.tsx',
  'src/ui/surfaces/situation-room/owner-picker-popover.tsx',
  'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx',
  'src/ui/surfaces/situation-room/needs-you-banner.tsx',
  // GAP 7 (Plan 04-05 round 3) — the live re-drill console flooded with
  // "Each child in a list should have a unique key" warnings attributed to
  // ChatPageBody / RosterRail / Composer / ContextRail / PersistedMessage.
  // Every Array.prototype.map(...) callback in the Employee Chat surface that
  // returns JSX must carry an explicit stable key= so the warnings stay gone.
  'src/ui/surfaces/chat/index.tsx',
  'src/ui/surfaces/chat/roster-rail.tsx',
  'src/ui/surfaces/chat/topic-strip.tsx',
  'src/ui/surfaces/chat/context-rail.tsx',
  'src/ui/surfaces/chat/composer.tsx',
  'src/ui/surfaces/chat/message-thread.tsx',
  // Plan 05-07 Task 2 (D-14) — extended FILES set to cover the direct
  // child render-path dependencies audited per-component. The companion
  // gate `chat-react-key-console-capture.test.mjs` enforces the same
  // rules plus the audit-annotation + no-bare-index-key invariants.
  'src/ui/surfaces/chat/active-tasks-owned.tsx',
  'src/ui/surfaces/chat/archive-topic-button.tsx',
  'src/ui/surfaces/chat/true-task/true-task-dialog.tsx',
  'src/ui/surfaces/chat/true-task/inline-task-card.tsx',
  'src/ui/surfaces/chat/true-task/chat-task-status-pill.tsx',
  'src/ui/surfaces/reader/ref-card.tsx',
];

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

for (const rel of FILES) {
  test(`${rel}: every Array.prototype.map callback returning JSX has an explicit key={...} (DEV-07)`, () => {
    const src = readSrc(rel);
    // Find every .map( occurrence whose callback DIRECTLY RETURNS JSX, and
    // require a key={ in that callback body.
    //
    // A JSX-returning map callback starts, immediately after the `=>`, with
    // either `<` (concise JSX) or `(` then `<` (parenthesised JSX) — e.g.
    // `.map((emp) => (<button …`. State-update / projection maps such as
    // `prev.map((o) => (o.x ? {…} : o))` or `xs.map((m) => m.body.trim())`
    // start with `(<ident>` or `(<cond>` — NOT `(<` — so they are correctly
    // excluded. This avoids the false positives the old crude 600-char
    // window scan produced on non-JSX maps.
    const mapRe = /\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
    let m;
    let offenders = [];
    while ((m = mapRe.exec(src)) !== null) {
      // Position just after the `=>` and its whitespace.
      const afterArrow = mapRe.lastIndex;
      let bodyStart = afterArrow;
      let returnsJsx = false;
      if (src[bodyStart] === '{') {
        // Block body — JSX-returning iff a `return (<` (modulo whitespace)
        // appears inside the block.
        const block = src.slice(bodyStart, bodyStart + 800);
        returnsJsx = /return\s*\(\s*<[A-Za-z]/.test(block);
      } else {
        // Concise body — peek past an optional opening paren.
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
      `${rel}: found ${offenders.length} .map(...) callback(s) returning JSX without key=. Offenders:\n${offenders.map(o => '@' + o.index + ': ' + o.snippet.replace(/\s+/g, ' ')).join('\n')}`,
    );
  });
}

test('EnableClarityCta source has no array-prop child render (single root only) (DEV-07)', () => {
  const src = readSrc('src/ui/components/enable-clarity-cta.tsx');
  // The component should return one root <div> with text/element children
  // (not an array). Negative check: no `{[<Foo/>, <Bar/>]}` shape.
  assert.doesNotMatch(src, /\{\s*\[[^[\]]*<[A-Z]/, 'EnableClarityCta should not render an array of JSX inline');
});

test('SituationRoom employee-row-strip.tsx has explicit key on the EmployeeRow map (regression)', () => {
  const src = readSrc('src/ui/surfaces/situation-room/employee-row-strip.tsx');
  // The grouped strip maps rows → <EmployeeRow key={row.agentId} …>.
  assert.match(src, /<EmployeeRow\b[\s\S]{0,120}key=\{|key=\{[\s\S]{0,200}<EmployeeRow\b/);
});
