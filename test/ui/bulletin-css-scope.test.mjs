// test/ui/bulletin-css-scope.test.mjs
//
// Plan 03-03 Task 1 RED — bulletin.css surface-scope contract.
//
// SCAF-06 / COEXIST-01: every rule in the bulletin surface stylesheet must be
// scoped to [data-clarity-surface="bulletin"] so plugin CSS never bleeds into
// the host page. Also verifies the warm-paper palette custom properties and
// the Fraunces / Newsreader / JetBrains Mono font setup are present, plus the
// responsive @media breakpoint, and that the stylesheet does NOT @import host
// CSS.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BULLETIN_CSS = path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'bulletin.css');

function readCss() {
  return readFileSync(BULLETIN_CSS, 'utf8');
}

/**
 * Flatten a CSS source into top-level (selector, body) rule pairs, descending
 * into @media / @supports wrappers. Mirrors test/ui/clarity-pack-css-rules.mjs.
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
        // descend into at-rule
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
      rules.push({ selector: prelude, body: stripped.slice(cursor + 1, scan - 1) });
      cursor = scan;
      continue;
    }
    cursor += 1;
  }
  return rules;
}

test('bulletin.css: file exists', () => {
  assert.ok(existsSync(BULLETIN_CSS), 'expected src/ui/styles/bulletin.css');
});

test('bulletin.css: every rule selector is scoped to [data-clarity-surface="bulletin"]', () => {
  const rules = parseRules(readCss());
  assert.ok(rules.length > 0, 'expected at least one CSS rule');
  const offenders = rules.filter((r) => !/\[data-clarity-surface="bulletin"\]/.test(r.selector));
  assert.equal(
    offenders.length,
    0,
    `every rule must be scoped to [data-clarity-surface="bulletin"]. Offenders:\n${offenders
      .map((o) => o.selector)
      .join('\n')}`,
  );
});

test('bulletin.css: warm-paper palette custom properties all defined', () => {
  const css = readCss();
  for (const v of [
    '--paper',
    '--paper-2',
    '--ink',
    '--ink-2',
    '--muted',
    '--rule',
    '--terracotta',
    '--moss',
    '--gold',
  ]) {
    assert.ok(new RegExp(`${v}\\s*:`).test(css), `missing CSS custom property ${v}`);
  }
});

test('bulletin.css: Fraunces / Newsreader / JetBrains Mono fonts referenced', () => {
  const css = readCss();
  for (const family of ['Fraunces', 'Newsreader', 'JetBrains Mono']) {
    assert.ok(css.includes(family), `missing font family ${family}`);
  }
});

test('bulletin.css: responsive @media (max-width: 1100px) rule present', () => {
  assert.match(readCss(), /@media[^{]*max-width:\s*1100px/);
});

test('bulletin.css: does NOT @import host CSS', () => {
  const css = readCss();
  // a Google Fonts @import is fine; a same-origin/relative host-css @import is not.
  const imports = css.match(/@import[^;]+;/g) ?? [];
  for (const imp of imports) {
    assert.ok(
      /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(imp),
      `bulletin.css must not @import host CSS — offending: ${imp}`,
    );
  }
});
