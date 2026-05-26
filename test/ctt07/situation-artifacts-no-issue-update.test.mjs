// test/ctt07/situation-artifacts-no-issue-update.test.mjs
//
// Phase 6.1 Plan 02 -- CTT-07 invariant source-grep gate for the new
// situation.artifacts data handler.
//
// CTT-07 invariant from Plan 04.1-07: plugin actions / data handlers NEVER
// mutate host-issue state. Test 11 in situation-artifacts.test.mjs pins
// the invariant at runtime; this source-grep test pins it at the source
// level so a future refactor cannot silently introduce the call site by
// routing the invocation through an alias or a re-export.
//
// Pattern matches the existing CTT-07 source-grep tests used in other
// Phase 4.1 / Phase 5 / Phase 6.1 handlers (Plan 06.1-01 agent-take-
// ownership source-grep is the closest fork target).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HANDLERS = [
  path.join(REPO_ROOT, 'src', 'worker', 'handlers', 'situation-artifacts.ts'),
];

for (const handlerPath of HANDLERS) {
  test(`CTT-07 source-grep: ${path.basename(handlerPath)} contains no ctx.issues.update call site`, () => {
    const src = readFileSync(handlerPath, 'utf8');
    // Strip comments before scanning so an explanatory mention in a
    // docstring (e.g. "this handler does NOT mutate host issue state")
    // does not trip the gate.
    const stripped = src
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      (stripped.match(/ctx\.issues\.update/g) ?? []).length,
      0,
      `${path.basename(handlerPath)} must not contain ctx.issues.update`,
    );
    assert.equal(
      (stripped.match(/issues\.update\s*\(/g) ?? []).length,
      0,
      `${path.basename(handlerPath)} must not contain issues.update(`,
    );
  });
}
