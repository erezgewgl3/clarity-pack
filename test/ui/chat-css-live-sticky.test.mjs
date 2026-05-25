// test/ui/chat-css-live-sticky.test.mjs
//
// Plan 05-06 Task 3 (item e) — source-grep contract tests for the LIVE
// indicator sticky restore. The deterministic computed-style convergence
// gate lives in test/ui/chat-live-sticky.test.mjs (Playwright-driven). This
// file pins the CSS-side invariants:
//
//   1. The .auto-refresh `position: sticky; top: 0` declaration is preserved.
//   2. The .messages overflow-y: auto declaration is preserved (this is the
//      scroll container that establishes the sticky context).
//   3. No ancestor of .messages in the chat surface tree declares any of:
//      overflow: hidden / overflow-x / overflow-y on a hidden value;
//      transform: any value other than none; filter; backdrop-filter;
//      contain; will-change: transform. Per CSS spec these all create a new
//      containing block / formatting context that breaks position: sticky's
//      ancestor chain.
//
// The ancestor chain (JSX → CSS class):
//   ClaritySurfaceRoot [data-clarity-surface="chat"]
//     > .clarity-chat-shell                (the grid)
//       > main.thread                       (the middle column)
//         > Composer/MessageThread
//           > .messages                     (the scroll container)
//             > .auto-refresh               (sticky to top of .messages)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CSS = readFileSync(
  path.join(ROOT, 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);

// Helper: extract the body of the first rule matching a selector regex from
// the CSS source. Returns null when no rule matches.
function ruleBody(re) {
  const m = CSS.match(re);
  return m ? m[1] : null;
}

test('chat.css: .auto-refresh keeps position: sticky; top: 0 (sticky declaration preserved)', () => {
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.auto-refresh\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.auto-refresh rule must exist');
  assert.match(body, /position:\s*sticky/, 'position: sticky declaration preserved');
  assert.match(body, /top:\s*0\b/, 'top: 0 declaration preserved');
});

test('chat.css: .messages keeps overflow-y: auto (the scroll container that establishes the sticky context)', () => {
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.messages\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.messages rule must exist');
  assert.match(body, /overflow-y:\s*auto/, '.messages overflow-y: auto preserved (sticky scroll context)');
});

test('chat.css: .clarity-chat-shell does NOT declare any sticky-context breaker', () => {
  // The shell sits between the surface root and main.thread. Anything from the
  // CSS spec's sticky-context-breaker set (overflow: hidden / transform /
  // filter / backdrop-filter / contain / will-change: transform) here would
  // strand .auto-refresh.
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.clarity-chat-shell\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.clarity-chat-shell rule must exist');
  assert.doesNotMatch(body, /overflow:\s*hidden/, '.clarity-chat-shell must not declare overflow: hidden');
  assert.doesNotMatch(body, /overflow-x:\s*hidden/, '.clarity-chat-shell must not declare overflow-x: hidden');
  assert.doesNotMatch(body, /overflow-y:\s*hidden/, '.clarity-chat-shell must not declare overflow-y: hidden');
  assert.doesNotMatch(body, /\btransform:/, '.clarity-chat-shell must not declare a transform');
  assert.doesNotMatch(body, /\bfilter:/, '.clarity-chat-shell must not declare a filter');
  assert.doesNotMatch(body, /backdrop-filter:/, '.clarity-chat-shell must not declare backdrop-filter');
  assert.doesNotMatch(body, /\bcontain:/, '.clarity-chat-shell must not declare contain');
  assert.doesNotMatch(body, /will-change:\s*transform/, '.clarity-chat-shell must not declare will-change: transform');
});

test('chat.css: .thread (the middle column wrapping MessageThread) does NOT declare any sticky-context breaker', () => {
  // .thread is the direct ancestor of .messages. Any context-breaker here is
  // the most likely culprit if sticky is misbehaving.
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.thread\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.thread rule must exist');
  assert.doesNotMatch(body, /overflow:\s*hidden/, '.thread must not declare overflow: hidden');
  assert.doesNotMatch(body, /overflow-x:\s*hidden/, '.thread must not declare overflow-x: hidden');
  assert.doesNotMatch(body, /overflow-y:\s*hidden/, '.thread must not declare overflow-y: hidden');
  assert.doesNotMatch(body, /overflow-x:\s*auto/, '.thread must not declare overflow-x: auto (creates a scroll context that strands sticky in .messages — Plan 05-06 item e named breaker)');
  assert.doesNotMatch(body, /\btransform:/, '.thread must not declare a transform');
  assert.doesNotMatch(body, /\bfilter:/, '.thread must not declare a filter');
  assert.doesNotMatch(body, /backdrop-filter:/, '.thread must not declare backdrop-filter');
  assert.doesNotMatch(body, /\bcontain:/, '.thread must not declare contain');
  assert.doesNotMatch(body, /will-change:\s*transform/, '.thread must not declare will-change: transform');
});

test('chat.css: the surface root [data-clarity-surface="chat"] declarations do NOT include a sticky-context breaker', () => {
  // The surface root sits at the top of the ancestor chain. Token blocks
  // (--bg, --line, etc.) live here; layout properties should NOT.
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s*\{([^}]*)\}/,
  );
  assert.ok(body, 'the surface root token block must exist');
  // Sticky-context-breaker scan (light — the surface root is a token block
  // not a layout block, but defense-in-depth).
  assert.doesNotMatch(body, /overflow:\s*hidden/, 'surface root must not declare overflow: hidden');
  assert.doesNotMatch(body, /\btransform:/, 'surface root must not declare a transform');
  assert.doesNotMatch(body, /\bcontain:/, 'surface root must not declare contain');
});

test('chat.css: .clarity-chat-shell > .thread responsive override does NOT introduce a sticky-context breaker', () => {
  // Plan 04.1-10 drill fix #2b added `.clarity-chat-shell > .thread,
  // .clarity-chat-shell > main { min-width: 0 }`. min-width: 0 is NOT a
  // sticky-context breaker per the CSS spec, but the rule body is the
  // canonical place where a future overflow-x: auto retrofit would land —
  // pin it for regression.
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.clarity-chat-shell\s*>\s*\.thread,\s*[\s\S]*?\.clarity-chat-shell\s*>\s*main\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.clarity-chat-shell > .thread, > main rule must exist');
  assert.doesNotMatch(body, /overflow-x:\s*auto/, 'the responsive .thread rule must not introduce overflow-x: auto (would strand sticky in .messages)');
  assert.doesNotMatch(body, /overflow:\s*hidden/, 'must not introduce overflow: hidden');
  assert.doesNotMatch(body, /\btransform:/, 'must not introduce a transform');
});

test('chat.css: item (e) AUDIT FINDING — the .auto-refresh has its top: 0 anchor preserved (no offset drift)', () => {
  // Plan 05-06 item (e) AUDIT: the LIVE indicator was reported "floating
  // mid-thread" in the Plan 04.1-11 drill. The audit traced the full ancestor
  // chain from .messages upward (surface root → .clarity-chat-shell → .thread
  // → .messages → .auto-refresh) and found NO classic sticky-context breaker
  // (overflow: hidden, transform, filter, contain, will-change) on any
  // ancestor. The .auto-refresh declaration itself is canonical: position:
  // sticky; top: 0. The element STICKS at top: 0 of .messages — the scroll
  // container .messages establishes the sticky context via its overflow-y:
  // auto declaration. The "floating mid-thread" symptom most likely
  // originated from a transient .messages-height-collapse state during one
  // of the 04.1-10 layout retrofits (.thread min-height: 0 + .messages flex:
  // 1) and resolved itself by 1.0.0-rc.7. This audit is a regression guard:
  // if a future plan re-introduces a breaker on .thread / .clarity-chat-shell
  // / surface root, the test fires.
  const body = ruleBody(
    /\[data-clarity-surface="chat"\]\s+\.auto-refresh\s*\{([^}]*)\}/,
  );
  assert.ok(body, '.auto-refresh rule must exist');
  assert.match(body, /position:\s*sticky/);
  // The top: 0 anchor MUST be unchanged. A non-zero top would mean the
  // indicator sticks below the .messages content edge, which would re-create
  // the "floating mid-thread" perception.
  assert.match(body, /top:\s*0\b/, 'top: 0 anchor must NOT drift');
});
