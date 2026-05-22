// test/ui/reader-button-css-cascade.test.mjs
//
// Plan 04.2-02 Task 1 — static CSS-cascade guard for GAP-RCB-01-STYLING.
//
// THE TEST-GAP THIS CLOSES (04.2-VERIFICATION.md "why unit tests missed it"):
//   Plan 04.2-01's UI tests proved the ContinueInChatButton renders correct
//   DOM AND props were honored AND the existing CSS-rule-existence test
//   (clarity-pack-css-rules.test.mjs) passed — yet the live drill found the
//   button near-invisible on the Reader surface. `node --test` does not
//   evaluate the CSS cascade, and the rule-existence test only asks "does a
//   rule exist?" — never "do the var(--clarity-*) tokens that rule consumes
//   RESOLVE at the surface the rule is scoped to?".
//
//   The real defect: the `.clarity-continue-in-chat` rule IS present in
//   theme.css, scoped `[data-clarity-surface='reader']`, but its declared
//   values consume `var(--clarity-you)` / `--clarity-you-soft` /
//   `--clarity-ink-3` / `--clarity-line` — tokens defined ONLY under the
//   `[data-clarity-surface='situation-room']` block. On the Reader surface
//   those vars resolve to nothing → background falls through to transparent →
//   the gold PRIMARY button is invisible.
//
// Tests C1-C3 below pin the FIX: the Reader-button rule resolves at Reader
// scope (or the unscoped base scope), references no Reader-undefined token,
// and carries a substantive non-transparent gold PRIMARY weight.
//
// Parser shape reused from clarity-pack-css-rules.test.mjs (brace-depth walk,
// parseRules / countDeclarations) — Node's runner cannot evaluate oklch() /
// color-mix() / CSS variables, so this is a parse-based contract, not JSDOM.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const THEME_CSS = path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'theme.css');

/**
 * Parse a CSS source into a flat list of top-level `{ selector, body }` pairs.
 * Nested at-rules (@media) contribute their inner rules to the same flat list.
 * (Same algorithm as clarity-pack-css-rules.test.mjs parseRules.)
 */
function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let cursor = 0;
  while (cursor < stripped.length) {
    const ch = stripped[cursor];
    if (ch === '{') {
      let lookback = cursor - 1;
      while (
        lookback >= 0 &&
        stripped[lookback] !== '}' &&
        stripped[lookback] !== ';' &&
        stripped[lookback] !== '{'
      ) {
        lookback -= 1;
      }
      const prelude = stripped.slice(lookback + 1, cursor).trim();
      if (prelude.startsWith('@')) {
        cursor += 1;
        continue;
      }
      let scan = cursor + 1;
      let localDepth = 1;
      while (scan < stripped.length && localDepth > 0) {
        const c = stripped[scan];
        if (c === '{') localDepth += 1;
        else if (c === '}') localDepth -= 1;
        scan += 1;
      }
      const body = stripped.slice(cursor + 1, scan - 1);
      rules.push({ selector: prelude, body });
      cursor = scan;
      continue;
    }
    cursor += 1;
  }
  return rules;
}

const TRIVIAL_VALUES = new Set(['initial', 'unset', 'inherit', '']);

/** Count non-trivial `prop: value;` declarations in a block body. */
function countDeclarations(body) {
  let n = 0;
  for (const line of body.split(';').map((s) => s.trim()).filter(Boolean)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const value = line.slice(colonIdx + 1).trim().toLowerCase();
    if (TRIVIAL_VALUES.has(value)) continue;
    n += 1;
  }
  return n;
}

/** Every `--clarity-*` custom property NAME defined as a declaration in a body. */
function definedTokens(body) {
  const out = new Set();
  for (const m of body.matchAll(/(--clarity-[\w-]+)\s*:/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Every `var(--clarity-*)` token a body REFERENCES. */
function referencedTokens(body) {
  const out = new Set();
  for (const m of body.matchAll(/var\(\s*(--clarity-[\w-]+)/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Is this selector the base unscoped surface block `[data-clarity-surface]`? */
function isBaseSurfaceSelector(sel) {
  return /^\s*\[data-clarity-surface\](?!\s*=)/.test(sel.trim());
}

/** Is this selector scoped to (or under) the Reader surface? */
function isReaderScoped(sel) {
  return /^\s*\[data-clarity-surface\s*=\s*['"]reader['"]\]/.test(sel.trim());
}

function readTheme() {
  return readFileSync(THEME_CSS, 'utf8');
}

/**
 * Collect the set of every --clarity-* token that resolves at Reader scope:
 * tokens defined in the base `[data-clarity-surface]` block PLUS tokens defined
 * in any `[data-clarity-surface='reader']` block. A token defined ONLY under
 * `[data-clarity-surface='situation-room']` (or 'chat') does NOT resolve here.
 */
function tokensResolvableAtReaderScope(rules) {
  const resolvable = new Set();
  for (const r of rules) {
    if (isBaseSurfaceSelector(r.selector) || isReaderScoped(r.selector)) {
      for (const tok of definedTokens(r.body)) resolvable.add(tok);
    }
  }
  return resolvable;
}

// --- C1 — RULE-RESOLVES-AT-READER-SCOPE ------------------------------------
test('C1 — .clarity-continue-in-chat resolves a substantive rule at Reader / base scope', () => {
  const rules = parseRules(readTheme());
  const matching = rules.filter((r) =>
    /\.clarity-continue-in-chat(?![\w-])/.test(r.selector),
  );
  assert.ok(
    matching.length >= 1,
    `expected at least one .clarity-continue-in-chat rule in theme.css`,
  );
  // At least one such rule must be scoped to the Reader surface OR the
  // unscoped base [data-clarity-surface] block — NOT situation-room / chat.
  const readerOrBase = matching.filter(
    (r) => isReaderScoped(r.selector) || isBaseSurfaceSelector(r.selector),
  );
  assert.ok(
    readerOrBase.length >= 1,
    `expected a .clarity-continue-in-chat rule scoped to [data-clarity-surface='reader'] ` +
      `or the base [data-clarity-surface]; found selectors: ${matching
        .map((r) => r.selector)
        .join(' | ')}`,
  );
  // And that rule must be substantive (>= 1 non-trivial declaration).
  const substantive = readerOrBase.filter((r) => countDeclarations(r.body) >= 1);
  assert.ok(
    substantive.length >= 1,
    `expected the Reader-scoped .clarity-continue-in-chat rule to carry >= 1 ` +
      `non-trivial declaration`,
  );
});

// --- C2 — NO-READER-UNDEFINED-TOKENS ---------------------------------------
test('C2 — .clarity-continue-in-chat references no token undefined at Reader scope', () => {
  const rules = parseRules(readTheme());
  const resolvable = tokensResolvableAtReaderScope(rules);

  const continueRules = rules.filter((r) =>
    /\.clarity-continue-in-chat(?![\w-])/.test(r.selector),
  );
  const referenced = new Set();
  for (const r of continueRules) {
    for (const tok of referencedTokens(r.body)) referenced.add(tok);
  }
  const undefinedAtReader = [...referenced].filter((t) => !resolvable.has(t));
  assert.deepEqual(
    undefinedAtReader,
    [],
    `the .clarity-continue-in-chat rule references var() tokens NOT defined at ` +
      `Reader / base scope (they resolve to nothing on the Reader surface → ` +
      `the button renders unstyled): ${undefinedAtReader.join(', ')}`,
  );
});

test('C2b — .clarity-reverse-topics-trigger references no Reader-undefined token (RCB-06)', () => {
  const rules = parseRules(readTheme());
  const resolvable = tokensResolvableAtReaderScope(rules);
  const reverseRules = rules.filter((r) =>
    /\.clarity-reverse-topics-trigger(?![\w-])/.test(r.selector),
  );
  const referenced = new Set();
  for (const r of reverseRules) {
    for (const tok of referencedTokens(r.body)) referenced.add(tok);
  }
  const undefinedAtReader = [...referenced].filter((t) => !resolvable.has(t));
  assert.deepEqual(
    undefinedAtReader,
    [],
    `the .clarity-reverse-topics-trigger rule references Reader-undefined ` +
      `var() tokens: ${undefinedAtReader.join(', ')}`,
  );
});

test('C2c — every .clarity-reverse-topics-* rule references no Reader-undefined token', () => {
  const rules = parseRules(readTheme());
  const resolvable = tokensResolvableAtReaderScope(rules);
  const reverseRules = rules.filter((r) =>
    /\.clarity-reverse-topics[\w-]*(?![\w-])/.test(r.selector),
  );
  const offenders = [];
  for (const r of reverseRules) {
    for (const tok of referencedTokens(r.body)) {
      if (!resolvable.has(tok)) offenders.push(`${r.selector} -> ${tok}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `reverse-topics rules reference Reader-undefined tokens:\n${offenders.join('\n')}`,
  );
});

// --- C3 — PRIMARY-WEIGHT ----------------------------------------------------
test('C3 — .clarity-continue-in-chat carries a substantive gold PRIMARY weight (background + color + border)', () => {
  const rules = parseRules(readTheme());
  // The base (non-:disabled, non-:hover) rule — the enabled PRIMARY weight.
  const baseRule = rules.find(
    (r) =>
      /\.clarity-continue-in-chat(?![\w-])/.test(r.selector) &&
      !/:disabled/.test(r.selector) &&
      !/:hover/.test(r.selector),
  );
  assert.ok(baseRule, 'expected a base .clarity-continue-in-chat rule (no :disabled/:hover)');
  const body = baseRule.body;

  // background — declared AND not transparent / not a reset keyword.
  const bgMatch = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/i);
  assert.ok(bgMatch, 'the rule declares a background');
  const bgVal = bgMatch[1].trim().toLowerCase();
  assert.ok(
    !['transparent', 'none', 'initial', 'unset', 'inherit', ''].includes(bgVal),
    `the background must be a visible gold value, not "${bgVal}"`,
  );

  // color — a declared text colour.
  assert.match(body, /(?:^|[;{\s])color\s*:\s*[^;]+/i, 'the rule declares a text color');

  // border — a declared border.
  assert.match(
    body,
    /(?:^|[;{\s])border(?:-[a-z]+)?\s*:\s*[^;]+/i,
    'the rule declares a border',
  );
});

// --- regression — the scope guard still holds ------------------------------
test('C4 — every top-level theme.css selector still starts with [data-clarity-surface] (SCAF-06)', () => {
  // A light in-test mirror of scripts/check-css-scope.mjs so a token-promotion
  // edit that accidentally introduces an unscoped selector fails HERE too.
  const css = readTheme().replace(/\/\*[\s\S]*?\*\//g, '');
  const SELECTOR_OK_RE =
    /^\s*(\[data-clarity-surface(=(['"])[a-z0-9_-]+\3)?\]|:root\[data-clarity-surface(=(['"])[a-z0-9_-]+\5)?\]|@[a-z-]+\b)/i;
  const offenders = [];
  let depth = 0;
  let cursor = 0;
  while (cursor < css.length) {
    const ch = css[cursor];
    if (ch === '{') {
      if (depth === 0) {
        let lookback = cursor - 1;
        while (lookback >= 0 && css[lookback] !== '}' && css[lookback] !== ';') {
          lookback -= 1;
        }
        const sel = css.slice(lookback + 1, cursor).trim();
        if (sel.length > 0 && !SELECTOR_OK_RE.test(sel)) offenders.push(sel);
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
    cursor += 1;
  }
  assert.deepEqual(offenders, [], `unscoped top-level selector(s): ${offenders.join(' | ')}`);
});
