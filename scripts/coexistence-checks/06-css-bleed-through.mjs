#!/usr/bin/env node
// scripts/coexistence-checks/06-css-bleed-through.mjs
//
// COEXIST-06 — Clarity Pack CSS must be scoped under [data-clarity-surface]
// so it cannot bleed onto host page elements (PITFALLS.md CSS bleed-through).
// Extends the Plan 02-02 check-css-scope.mjs (which only scans
// src/ui/primitives/theme.css) by walking ALL .css files under src/ui/.
//
// Allows: any selector starting with [data-clarity-surface] (with optional
// =value, single/double quoted, or :root[data-clarity-surface]) AND any
// @-rule (@import / @keyframes / @media / etc.).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const UI_DIR = path.resolve(process.cwd(), 'src', 'ui');

const SELECTOR_OK_RE =
  /^\s*(\[data-clarity-surface(=(['"])[a-z0-9_-]+\3)?\]|:root\[data-clarity-surface(=(['"])[a-z0-9_-]+\5)?\]|@[a-z-]+\b)/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function topLevelSelectors(css) {
  const stripped = stripComments(css);
  const selectors = [];
  let depth = 0;
  let cursor = 0;
  while (cursor < stripped.length) {
    const ch = stripped[cursor];
    if (ch === '{') {
      if (depth === 0) {
        let lookback = cursor - 1;
        while (lookback >= 0 && stripped[lookback] !== '}' && stripped[lookback] !== ';') {
          lookback -= 1;
        }
        const rawSelector = stripped.slice(lookback + 1, cursor).trim();
        const lineOfSelector =
          (stripped.slice(0, lookback + 1).match(/\n/g) ?? []).length + 1;
        if (rawSelector.length > 0) {
          selectors.push({ selector: rawSelector, line: lineOfSelector });
        }
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
    cursor += 1;
  }
  return selectors;
}

const files = walk(UI_DIR);
const violations = [];
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  for (const { selector, line } of topLevelSelectors(css)) {
    // Selectors can be comma-separated; check each branch independently.
    for (const branch of selector.split(',').map((s) => s.trim())) {
      if (!SELECTOR_OK_RE.test(branch)) {
        violations.push(`${f}:${line}: '${branch}' — must start with [data-clarity-surface]`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('COEXIST-06 violation: unscoped CSS selector(s) detected:');
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nEvery top-level selector must start with [data-clarity-surface] (or be an @-rule). ' +
      'Unscoped selectors bleed onto the host page — SCAF-06 + COEXIST-06.',
  );
  process.exit(1);
}

console.log(`COEXIST-06 OK: ${files.length} CSS file(s) scanned; all top-level selectors scoped under [data-clarity-surface]`);
process.exit(0);
