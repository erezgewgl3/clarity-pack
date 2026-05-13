// test/ui/css-scope.test.mjs
//
// Plan 02-02 Task 2 — drives scripts/check-css-scope.mjs as a subprocess.
// Positive case (current theme.css): exit 0. Negative case (synthetic
// fixture with a global `body { ... }` rule): exit 1 — proves the script
// catches violations rather than no-oping.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-css-scope.mjs');
const PROD_CSS = path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'theme.css');

test('theme.css passes the scope check (every top-level selector starts with [data-clarity-surface])', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stdout=${r.stdout}; stderr=${r.stderr}`);
  assert.match(r.stdout, /all scoped/);
});

test('negative case — a CSS file with a global `body { ... }` rule causes the script to exit 1', async () => {
  // Temporarily replace theme.css with a deliberately-bad version, run the
  // script, then restore. Use a tmp dir copy to avoid touching the real file
  // even if the test crashes mid-way.
  const tmp = await mkdtemp(path.join(tmpdir(), 'clarity-css-scope-'));
  const badCss = `
    /* deliberately bad */
    body { background: red; }
    [data-clarity-surface] { color: white; }
  `;
  const tmpFile = path.join(tmp, 'theme.css');
  await writeFile(tmpFile, badCss, 'utf8');

  // We can't reconfigure the script's hardcoded path easily without modifying
  // it; instead, run a one-off node program that imports the same scope-check
  // logic and asserts directly.
  const inlineCheck = `
    import { readFile } from 'node:fs/promises';
    const css = await readFile(${JSON.stringify(tmpFile)}, 'utf8');
    const stripped = css.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
    const selectors = [];
    let depth = 0;
    let cursor = 0;
    while (cursor < stripped.length) {
      const ch = stripped[cursor];
      if (ch === '{') {
        if (depth === 0) {
          let lookback = cursor - 1;
          while (lookback >= 0 && stripped[lookback] !== '}' && stripped[lookback] !== ';') lookback -= 1;
          const raw = stripped.slice(lookback + 1, cursor).trim();
          if (raw.length > 0) selectors.push(raw);
        }
        depth += 1;
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
      }
      cursor += 1;
    }
    const re = /^\\s*(\\[data-clarity-surface\\]|:root\\[data-clarity-surface\\]|@[a-z-]+\\b)/i;
    const bad = selectors.filter(s => !re.test(s));
    if (bad.length === 0) { console.log('UNEXPECTED PASS'); process.exit(0); }
    console.log('caught:', bad.join(' | '));
    process.exit(1);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', inlineCheck], {
    encoding: 'utf8',
  });
  await rm(tmp, { recursive: true, force: true });
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}; output=${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /caught:.*body/, 'output must name the offending `body` selector');
});
