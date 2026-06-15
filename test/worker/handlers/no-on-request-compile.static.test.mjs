// test/worker/handlers/no-on-request-compile.static.test.mjs
//
// Phase 19 Plan 19-02 Task 3 (CARD-01 anti-regression) — the STATIC gate that
// forbids an on-request action-card compile in ANY data handler.
//
// WHY THIS EXISTS. CARD-01 took ALL action-card AI work OFF the HTTP request
// path: the situation.snapshot DATA handler is now READ-CACHED-ONLY and never
// calls driveActionCardsStep (the on-request compile that caused the 502 +
// BEAAA-2092 notification storm). This test is the CONTRACT that fails the build
// the instant a future edit re-introduces a driveActionCardsStep call (or import)
// inside any src/worker/handlers/* file — so a storm-prone, request-path-compile
// build can never be reinstalled on BEAAA.
//
// Mirrors the 16.1 no-wake static gate (test/loop/no-wake-from-ingress.test.mjs):
// strip comments first (a docstring mention of driveActionCardsStep — which the
// CARD-01 cleanup deliberately leaves behind to document the deletion — must NOT
// trip the gate), then scan the remaining CODE for the forbidden token.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const HANDLERS_DIR = path.join(REPO_ROOT, 'src', 'worker', 'handlers');

// The forbidden on-request compile entrypoint. A handler may READ cached cards
// (getActionCardsBySources) but must NEVER drive a compile on the request path.
const FORBIDDEN_TOKEN = 'driveActionCardsStep';

/** Strip line + block comments so a docstring mention never trips the gate. */
function stripComments(src) {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Recursively collect every *.ts file under dir. */
function collectTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('CARD-01 static gate: NO data handler under src/worker/handlers/ references driveActionCardsStep (in code)', () => {
  const files = collectTsFiles(HANDLERS_DIR);
  assert.ok(files.length > 0, 'expected to find handler .ts files to scan');

  const offenders = [];
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (code.includes(FORBIDDEN_TOKEN)) {
      offenders.push(path.relative(REPO_ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${FORBIDDEN_TOKEN} must NOT appear in any data handler's CODE — an on-request ` +
      `compile reignites the 502 + BEAAA-2092 storm (CARD-01). Offenders: ${offenders.join(', ')}`,
  );
});

test('CARD-01 static gate: the gate is comment-aware — a docstring mention is allowed, a call is not (self-test)', () => {
  // Prove the strip is real: a fixture with the token ONLY in a comment passes;
  // the same token in code fails. This guards the gate itself from a false-OK if
  // someone breaks stripComments.
  const commentOnly = stripComments(`// driveActionCardsStep is deleted here\nconst x = 1;`);
  assert.ok(!commentOnly.includes(FORBIDDEN_TOKEN), 'comment mention is stripped (allowed)');

  const codeForm = stripComments(`await driveActionCardsStep(ctx, {});`);
  assert.ok(codeForm.includes(FORBIDDEN_TOKEN), 'a real call survives stripping (would fail the gate)');
});
