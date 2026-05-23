#!/usr/bin/env node
// scripts/check-a11y.mjs
//
// Phase 5 Plan 05-02 (DIST-05) — static accessibility check.
// Mirrors check-css-scope.mjs shape: walks src/ui/**/*.{ts,tsx,jsx},
// asserts three a11y rules, exits non-zero on any violation.
//
// This is the STATIC substitute for a runtime axe-core pass. A full
// dynamic a11y pass needs Playwright + axe-core against a rendered
// Paperclip dev server boot — infeasible to ship cleanly today (the
// plugin renders inside Paperclip's same-origin shell). When that
// infrastructure lands, this script can be replaced or extended.
//
// Rules:
//   R1 — every <img ...> JSX tag carries an `alt` attribute.
//   R2 — every <input>, <textarea>, <select> JSX tag carries one of:
//        `id=`, `name=`, `aria-label=`, `aria-labelledby=`.
//        (Chrome DevTools warning observed on Countermoves 2026-05-24:
//        "A form field element should have an id or name attribute.")
//   R3 — no `dangerouslySetInnerHTML` outside the file allowlist below.
//        (Already enforced piecewise by T-04.2-02-01 etc.; cross-cuts
//        as a single check here.)
//
// JSX-aware: opening-tag boundary detection tracks `{...}` brace depth
// so JSX expressions like `onChange={(e) => …}` (which contain `>` as
// part of `=>`) don't truncate the tag scan.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(HERE, '..', 'src', 'ui');
const REPO_ROOT = path.resolve(HERE, '..');

const DANGEROUS_HTML_ALLOWLIST = new Set([]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
  // Replace with spaces to keep index positions stable so line numbers match
  // the original source.
}

// Scan forward from startIdx to find the `>` that closes the JSX opening tag,
// tracking brace depth so `{...}` expressions (which may contain `>`) don't
// truncate the scan. Returns the index of the closing `>` (or -1 if not found).
function findClosingAngle(src, startIdx) {
  let depth = 0;
  let inSingleStr = false;
  let inDoubleStr = false;
  let inTpl = 0;
  let prev = '';
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    // Crude string handling — JSX attributes use single OR double quoted
    // string literals; track to skip `>` inside string values.
    if (!inSingleStr && !inDoubleStr && !inTpl) {
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (depth === 0) {
        if (c === '"') { inDoubleStr = true; continue; }
        if (c === "'") { inSingleStr = true; continue; }
        if (c === '`') { inTpl++; continue; }
        if (c === '>') return i;
      }
    } else if (inDoubleStr) {
      if (c === '"' && prev !== '\\') inDoubleStr = false;
    } else if (inSingleStr) {
      if (c === "'" && prev !== '\\') inSingleStr = false;
    } else if (inTpl) {
      if (c === '`' && prev !== '\\') inTpl--;
    }
    prev = c;
  }
  return -1;
}

const violations = [];
function pushViolation(file, line, rule, snippet) {
  violations.push({ file: path.relative(REPO_ROOT, file), line, rule, snippet });
}

function lineNumberAt(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') n++;
  return n;
}

const files = walk(UI_ROOT);

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  // Strip comments but preserve index positions so line numbers track.
  const src = stripComments(raw);

  // R1 / R2 — JSX form-control opening tags.
  const tagPattern = /<(img|input|textarea|select)\b/g;
  let m;
  while ((m = tagPattern.exec(src)) !== null) {
    const tagName = m[1];
    const tagStart = m.index;
    const closingAngle = findClosingAngle(src, tagStart + m[0].length);
    if (closingAngle === -1) continue; // ill-formed source
    const openingTag = src.slice(tagStart, closingAngle + 1);
    const line = lineNumberAt(src, tagStart);

    if (tagName === 'img') {
      if (!/\balt\s*=/.test(openingTag)) {
        pushViolation(file, line, 'R1 <img> missing alt', openingTag.replace(/\s+/g, ' ').slice(0, 100));
      }
    } else {
      // <input>, <textarea>, <select>
      // Allow <input type="hidden"> (no UX presence).
      if (tagName === 'input' && /\btype\s*=\s*['"]hidden['"]/i.test(openingTag)) continue;
      if (!/\b(id|name|aria-label|aria-labelledby)\s*=/.test(openingTag)) {
        pushViolation(
          file,
          line,
          `R2 <${tagName}> missing id/name/aria-label`,
          openingTag.replace(/\s+/g, ' ').slice(0, 100),
        );
      }
    }
  }

  // R3 — dangerouslySetInnerHTML
  if (/dangerouslySetInnerHTML/.test(src)) {
    const relFile = path.relative(REPO_ROOT, file).replaceAll('\\', '/');
    if (!DANGEROUS_HTML_ALLOWLIST.has(relFile)) {
      const lines = src.split('\n');
      lines.forEach((l, i) => {
        if (l.includes('dangerouslySetInnerHTML')) {
          pushViolation(file, i + 1, 'R3 dangerouslySetInnerHTML not on allowlist', l.trim().slice(0, 100));
        }
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`check-a11y: ${files.length} file(s) scanned, 0 violations.`);
  process.exit(0);
}

console.error(`check-a11y: ${violations.length} violation(s) in ${files.length} file(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
}
process.exit(1);
