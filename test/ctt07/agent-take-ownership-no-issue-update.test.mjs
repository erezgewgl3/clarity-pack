// test/ctt07/agent-take-ownership-no-issue-update.test.mjs
//
// Phase 6.1 ROOM-09 -- CTT-07 invariant source-grep gate for the new
// agent.takeOwnership handler.
//
// The CTT-07 invariant from Plan 04.1-07: plugin actions NEVER mutate
// public.issues.updated_at -- i.e. NO ctx.issues.update call from ANY
// plugin-side handler. The runtime spy (Test 10 in
// agent-take-ownership.test.mjs) pins the invariant at runtime; this
// source-grep test pins it at the source level so a future refactor
// cannot silently introduce the call site by routing the invocation
// through an alias or a re-export.
//
// Pattern forked verbatim from test/ctt07/chat-attachment-handlers-no-
// issue-update.test.mjs (Plan 05-11). The HANDLERS array references only
// agent-take-ownership.ts -- situation-artifacts.ts ships in a later
// Phase 6.1 plan and will get its own entry then.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HANDLERS = [
  path.join(REPO_ROOT, 'src', 'worker', 'handlers', 'agent-take-ownership.ts'),
];

for (const handlerPath of HANDLERS) {
  test(`CTT-07 source-grep: ${path.basename(handlerPath)} contains no ctx.issues.update call site`, () => {
    const src = readFileSync(handlerPath, 'utf8');
    // Strip comments before scanning so an explanatory mention in a
    // docstring (e.g. "this handler does NOT call ctx.issues.update")
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
