// test/ui/topic-about-chip-rcb05.test.mjs
//
// Plan 05-07 Task 2 — GAP-RCB-05-CHIP-STYLING closure.
//
// The `.topic-about-chip` element in the topic strip wrapped two child
// buttons (the issue-id link + a × dismiss). The original pill styling
// used `border-radius: 999px` which collapsed to a circle/oval on long
// content ("About COU-2215 ↗" ≈ 13 chars at 11px font-size). The 1.0.0
// drill captured the visual gotcha; D-08 hygiene + content-length growth
// in v1.0.0 means a rectangular chip is the correct shape.
//
// The fix is CSS-ONLY: the JSX in topic-strip.tsx stays unchanged
// (T-04.2-01-03 React-text invariant + RCB-05 JSX shape preserved).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.resolve(
  HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css',
);
const TSX = path.resolve(
  HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'topic-strip.tsx',
);

function readCss() { return readFileSync(CSS, 'utf8'); }
function readTsx() { return readFileSync(TSX, 'utf8'); }

/** Extract the body of a single CSS rule block by selector. */
function ruleBlock(css, selector) {
  // Match `<selector> {` then capture everything up to the matching `}`.
  // Selector escaping: brackets, quotes, dots need to be literal.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'm');
  const match = re.exec(css);
  return match ? match[1] : null;
}

// ---- RCB-05 T1 — pill 999px is gone --------------------------------------

test('RCB-05 T1 — .topic-about-chip no longer uses border-radius: 999px', () => {
  const css = readCss();
  const body = ruleBlock(css, '[data-clarity-surface="chat"] .topic-about-chip');
  assert.ok(body !== null, 'expected .topic-about-chip rule block to exist');
  assert.doesNotMatch(
    body,
    /border-radius:\s*999px/,
    'GAP-RCB-05: the pill 999px must be removed (rectangular chip)',
  );
});

// ---- RCB-05 T2 — rectangular radius (<= 8px) ----------------------------

test('RCB-05 T2 — .topic-about-chip uses a rectangular border-radius (<= 8px)', () => {
  const css = readCss();
  const body = ruleBlock(css, '[data-clarity-surface="chat"] .topic-about-chip');
  assert.ok(body !== null, 'expected .topic-about-chip rule block to exist');
  // Pin the chosen radius literally so future drift surfaces in review.
  // 4px matches the existing rectangular-chip precedents in chat.css.
  assert.match(
    body,
    /border-radius:\s*4px/,
    'GAP-RCB-05: rectangular border-radius pinned at 4px (matches existing .btn / .qa precedents)',
  );
});

// ---- RCB-05 T3 — comment cites Plan 05-07 + RCB-05 ----------------------

test('RCB-05 T3 — chat.css comment cites Plan 05-07 + RCB-05 near the modified rule', () => {
  const css = readCss();
  // The annotation comment lands directly above the modified rule block;
  // we scan a 1200-char window above the selector for the literal Plan
  // ID + GAP ID. The window is generous because the rule's header comment
  // block carries both the historical 04.2-01 RCB-05 origin AND the new
  // 05-07 RCB-05 fix annotation, which spans several lines.
  const idx = css.indexOf('[data-clarity-surface="chat"] .topic-about-chip');
  assert.ok(idx > -1, 'expected the selector to exist in chat.css');
  const window = css.slice(Math.max(0, idx - 1200), idx);
  assert.match(window, /05-07/, 'expected Plan 05-07 reference near the modified rule');
  assert.match(window, /RCB-05/, 'expected RCB-05 GAP-ID reference near the modified rule');
});

// ---- RCB-05 T4 — JSX unchanged (CSS-only fix) ---------------------------

test('RCB-05 T4 — topic-strip.tsx JSX shape preserved (CSS-only fix)', () => {
  const tsx = readTsx();
  // The chip JSX must still render the wrapping <span class="topic-about-chip">
  // with the two child buttons. RCB-05 closure does NOT change the JSX shape.
  assert.match(
    tsx,
    /<span\s+className="topic-about-chip"/,
    'topic-about-chip wrapping <span> preserved',
  );
  assert.match(
    tsx,
    /topic-about-chip-link/,
    'topic-about-chip-link child preserved',
  );
  assert.match(
    tsx,
    /topic-about-chip-dismiss/,
    'topic-about-chip-dismiss child preserved',
  );
  // The visible label text is still "About <id> ↗".
  assert.match(
    tsx,
    /About\s+\{aboutIssueId\}\s+↗/,
    'visible label text preserved (React text, T-04.2-01-03)',
  );
});
