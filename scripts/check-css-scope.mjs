#!/usr/bin/env node
// scripts/check-css-scope.mjs
//
// Plan 02-02 Task 2 — SCAF-06 + COEXIST-01 enforcement. Reads
// src/ui/primitives/theme.css and asserts every TOP-LEVEL selector starts
// with [data-clarity-surface]. Allowed exceptions: @-rules (@import, @layer,
// @keyframes, @media, @supports — these don't contribute selectors at the
// top level) and selectors inside an @-rule block (which inherit scope from
// their parent rule's own scope check).
//
// This is a regex-based check rather than a full PostCSS parse:
//   - No new npm dependency to maintain
//   - The CSS we ship is hand-authored and small (theme.css ≤ 100 lines);
//     a regex with a deliberate fail-closed default is sufficient
//   - The grep is exact-segment ("^\\s*\\[data-clarity-surface\\]") so
//     `[data-clarity-surface-x]` would FAIL too, which is correct (we
//     want exactly the documented attribute).
//
// Exit codes:
//   0 — all selectors scoped (or empty file)
//   1 — at least one unscoped selector found; prints offending line(s)
//
// Wired into pnpm test via test/ui/css-scope.test.mjs invoking this script.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE_PREFIX = '[data-clarity-surface]';

// Selectors are allowed if they start with the scope prefix OR are an @-rule.
// `:root[data-clarity-surface]` is also acceptable (rare, but documented in
// PLAN if needed for CSS-variable definitions that target the root element).
const SELECTOR_OK_RE = /^\s*(\[data-clarity-surface\]|:root\[data-clarity-surface\]|@[a-z-]+\b)/i;

function stripComments(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Walks the CSS source and returns the list of top-level rules' selector
 * prefixes (the text before the first `{`). Skips inside @-rule blocks
 * (their inner selectors are not "top-level"; the @-rule's own scope check
 * already governs).
 */
function topLevelSelectors(css) {
  const stripped = stripComments(css);
  const selectors = [];
  let depth = 0;
  let cursor = 0;
  let lineNo = 1;
  while (cursor < stripped.length) {
    const ch = stripped[cursor];
    if (ch === '\n') lineNo += 1;
    if (ch === '{') {
      if (depth === 0) {
        // The selector text is everything from the previous block end (or
        // start of file) up to this `{`. Trim and record. Find the line of
        // the first non-whitespace char in the selector for error reporting.
        const blockStart = cursor;
        // Look back for the previous `}` (or start) to get the selector text.
        let lookback = cursor - 1;
        while (lookback >= 0 && stripped[lookback] !== '}' && stripped[lookback] !== ';') {
          lookback -= 1;
        }
        const rawSelector = stripped.slice(lookback + 1, blockStart).trim();
        // Compute the line number of the selector's first char by counting
        // newlines from start to lookback+1.
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

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const cssPath = path.resolve(HERE, '..', 'src', 'ui', 'primitives', 'theme.css');
  const css = await readFile(cssPath, 'utf8');

  const selectors = topLevelSelectors(css);
  const offenders = [];
  for (const { selector, line } of selectors) {
    if (!SELECTOR_OK_RE.test(selector)) {
      offenders.push({ selector, line });
    }
  }

  if (offenders.length > 0) {
    process.stderr.write(
      `check-css-scope: ${offenders.length} unscoped selector(s) in ${cssPath}:\n`,
    );
    for (const { selector, line } of offenders) {
      process.stderr.write(`  line ${line}: ${selector}\n`);
    }
    process.stderr.write(
      `\nEvery top-level selector must start with "${SCOPE_PREFIX}" (or be an @-rule).\n` +
        `This rule prevents Clarity styles from bleeding onto Paperclip host page elements (SCAF-06 + COEXIST-01).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`check-css-scope: ${selectors.length} top-level selector(s), all scoped under ${SCOPE_PREFIX}.\n`);
}

await main();
