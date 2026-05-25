// test/ui/chat-toast-stripe.test.mjs
//
// Plan 05-06 Task 3 (item f) — source-grep contract tests pinning the
// clarity-pack toast's visual disambiguation from host toasts.
//
// Item (f): every clarity-pack toast carries
//   - a left-edge 3px solid var(--you) stripe AND
//   - a leading `↗ ` glyph prefix via `.clarity-toast::before`.
// Both signals make clarity-pack toasts visually unmistakable against
// Paperclip host toasts (which sit bottom-LEFT).

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

test('chat.css: .clarity-toast declares a 3px solid var(--you) left-edge stripe', () => {
  // The rule body must contain the border-left declaration with the canonical
  // shape. The stripe MUST use var(--you) (the gold accent token defined at
  // the surface root) so future theme-token changes propagate.
  assert.match(
    CSS,
    /\[data-clarity-surface="chat"\]\s+\.clarity-toast\s*\{[^}]*border-left:\s*3px\s+solid\s+var\(--you\)/,
    '.clarity-toast must declare border-left: 3px solid var(--you)',
  );
});

test('chat.css: .clarity-toast::before declares the ↗ glyph prefix in var(--you)', () => {
  // The ::before pseudo-element renders the disambiguation glyph. The glyph
  // is rendered as content (NOT a separate React element) so the existing
  // toast.tsx primitive needs no change.
  assert.match(
    CSS,
    /\[data-clarity-surface="chat"\]\s+\.clarity-toast::before\s*\{[^}]*content:\s*['"]↗\s['"]/,
    '.clarity-toast::before must declare content: "↗ "',
  );
  assert.match(
    CSS,
    /\[data-clarity-surface="chat"\]\s+\.clarity-toast::before\s*\{[^}]*color:\s*var\(--you\)/,
    '.clarity-toast::before must declare color: var(--you) so the glyph reads gold',
  );
});

test('chat.css: .clarity-toast retains its original layout invariants (regression guard)', () => {
  // The stripe + glyph addition must NOT regress the existing toast contract
  // (Plan 04.1-09): position-friendly with the .clarity-toast-stack fixed
  // bottom-right container; max-width capped; entrance animation keyframe;
  // click-to-dismiss. The toast body rule still carries:
  //   - background: var(--bg-3)
  //   - color: var(--ink)
  //   - cursor: pointer
  //   - animation: clarity-toast-in
  const block = CSS.match(
    /\[data-clarity-surface="chat"\]\s+\.clarity-toast\s*\{([^}]*)\}/,
  );
  assert.ok(block, '.clarity-toast rule must exist');
  const body = block[1];
  assert.match(body, /background:\s*var\(--bg-3\)/, 'background remains --bg-3');
  assert.match(body, /color:\s*var\(--ink\)/, 'text color remains --ink');
  assert.match(body, /cursor:\s*pointer/, 'cursor: pointer for click-to-dismiss');
  assert.match(body, /animation:\s*clarity-toast-in/, 'entrance animation reference preserved');
});

test('chat.css: NO new color token introduced (item f uses existing var(--you))', () => {
  // The plan locks in: "Toast styling uses the existing `--you` gold accent
  // token (already defined in host CSS variables, used by `.flash-highlight`
  // keyframe at chat.css line 2266); no new color token introduced." A
  // regression that introduced --clarity-stripe / --toast-stripe / similar
  // would weaken the token discipline.
  assert.doesNotMatch(
    CSS,
    /--clarity-stripe\s*:|--toast-stripe\s*:/,
    'no new ad-hoc color token introduced — item (f) reuses --you',
  );
});

test('chat.css: rc.7 version invariance — no version string drift introduced by this plan', () => {
  // Sanity defense: CSS files don't carry version numbers but this assertion
  // pins that no version-flip artifact leaked into chat.css.
  // (Plan 05-10 owns the v1.0.0 final flip; package.json + src/manifest.ts
  // are the canonical sources — those are checked by the plan-level grep
  // gate in 05-06-PLAN.md <verify>.)
  assert.doesNotMatch(CSS, /\/\*\s*Plan 05-10\b/, 'Plan 05-06 must not borrow Plan 05-10 markers');
});
