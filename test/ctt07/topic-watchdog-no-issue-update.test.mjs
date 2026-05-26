// test/ctt07/topic-watchdog-no-issue-update.test.mjs
//
// Plan B rc.8 hotfix (2026-05-26 Playwright verification) — CTT-07 invariant
// guard for topic-watchdog. The Plan 04.1-03 implementation called
// `ctx.issues.update` from `ensureTopicWakeable` to flip terminal topic
// status back to in_progress. The manifest correctly does NOT declare
// `issues.update` (per CTT-07: plugin actions NEVER mutate
// public.issues.updated_at), so every chat.messages poll triggered a
// "missing required capability" rejection and a warn-log on the host. Live
// 2026-05-26 drill caught ~4 log lines per minute on every active chat
// surface from this exact code path.
//
// Fix: remove the ctx.issues.update call. Log a hint when terminal status
// is detected; the host's disposition-recovery machinery is the rightful
// owner of issue-status restoration.
//
// This test guards against re-introducing the violation.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SRC = readFileSync(
  path.join(REPO_ROOT, 'src/worker/chat/topic-watchdog.ts'),
  'utf8',
);

test('topic-watchdog (CTT-07): ZERO ctx.issues.update call sites', () => {
  // We accept the literal string in comments (the file documents WHY the
  // call was removed) — but not as a function-call expression.
  const callExpressionMatches = SRC.match(/ctx\.issues\.update\s*\(/g) ?? [];
  assert.equal(
    callExpressionMatches.length,
    0,
    `topic-watchdog must NOT call ctx.issues.update (CTT-07 invariant). Found ${callExpressionMatches.length} call expression(s).`,
  );
});

test('topic-watchdog (CTT-07): no issues.update(...) call form either', () => {
  // Defense in depth — destructured form `const { update } = ctx.issues`
  // is unlikely but let's catch any shorthand alias too.
  const aliasedCallMatches = SRC.match(/\bissues\.update\s*\(/g) ?? [];
  // The literal `issues.update` MAY appear in comments documenting the
  // removal — we filter those by checking for code-context. The simplest
  // regex check still works: the only allowed occurrences are in comment
  // lines. Strip line-comments then re-scan.
  const stripped = SRC.split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const codeContextMatches = stripped.match(/\bissues\.update\s*\(/g) ?? [];
  assert.equal(
    codeContextMatches.length,
    0,
    `topic-watchdog code paths must NOT call issues.update. Found in code (post-comment-strip): ${codeContextMatches.length}.`,
  );
  // Sanity: the unaliased-call check above is the same shape but stricter.
  void aliasedCallMatches;
});
