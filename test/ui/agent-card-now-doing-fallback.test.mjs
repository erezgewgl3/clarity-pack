// test/ui/agent-card-now-doing-fallback.test.mjs
//
// Plan 02-08 Task 2 RED — agent-card now_doing null fallback (DEV-12).
//
// The Plan 02-04 drill captured agents with `now_doing: null`. AgentCard's
// current source short-circuits to null when this happens, leaving the
// "now doing" slot empty. The fallback should render state + age
// ("Standby — idle <age>" / "Working for <age>").
//
// SOURCE-GREP — Node 24 can't load .tsx directly into the test runtime.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_PATH = path.resolve(
  HERE, '..', '..', 'src', 'ui', 'surfaces', 'situation-room', 'agent-card.tsx',
);

function readSrc() {
  return readFileSync(CARD_PATH, 'utf8');
}

test('agent-card.tsx imports formatAge (the duration formatter, for now_doing fallback)', () => {
  const src = readSrc();
  assert.match(src, /\bformatAge\b/, 'expected agent-card.tsx to reference formatAge');
});

test('agent-card.tsx imports humaniseState (or uses normaliseState locally) — needed for fallback prose', () => {
  const src = readSrc();
  // Either humaniseState gets imported, or the existing normaliseState is composed.
  assert.match(src, /humaniseState|normaliseState/);
});

test('agent-card.tsx has a now_doing null fallback (not just `now_doing ? ... : null`)', () => {
  const src = readSrc();
  // The current code returns null when now_doing is null. The fallback must NOT
  // be a bare `: null` — it should resolve to a string (Standby/Working + age).
  // We grep for an absence of the old pattern `{employee.now_doing ? (...) : null}`
  // followed by something that proves a fallback exists.
  // Two acceptable shapes:
  //   {employee.now_doing ?? `Standby ...`}
  //   {employee.now_doing ? ... : (someFallbackExpression)}
  // where the fallback expression mentions employee.state or formatAge.
  assert.match(
    src,
    /now_doing\s*\?\?|now_doing\s*\?[^:]*:[\s\S]*?(formatAge|humaniseState|Standby|idle|state)/,
    'expected now_doing fallback path to reference state/age (not bare ": null")',
  );
});

test('agent-card.tsx renders <p className="clarity-now-doing"> unconditionally (DEV-12 — no empty slot)', () => {
  const src = readSrc();
  // The fallback must mean we ALWAYS render the now-doing paragraph;
  // i.e. there should be no `employee.now_doing ? ( ... ) : null` shape left.
  // Match the negative pattern explicitly.
  assert.doesNotMatch(
    src,
    /\{employee\.now_doing\s*\?\s*\([\s\S]*?\)\s*:\s*null\s*\}/,
    'agent-card.tsx still has the bare null-fallback pattern — DEV-12 not closed',
  );
});

test('agent-card.tsx does NOT concatenate role+state without separator (DEV-12 "ceoStandby" bug)', () => {
  const src = readSrc();
  // The bug shape is JSX like {employee.role}{employee.state} which renders
  // adjacent without a space.
  assert.doesNotMatch(
    src,
    /\{employee\.role\}\{employee\.state\}/,
    'agent-card.tsx must not concatenate role and state directly',
  );
});

test('agent-card.tsx exists and exports AgentCard', () => {
  const src = readSrc();
  assert.match(src, /export\s+function\s+AgentCard\b/);
});
