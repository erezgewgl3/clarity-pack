// test/ui/ac-checklist-autostatus.test.mjs
//
// Plan 05-03 (DIST-03) — source-grep contract test. The Reader's AC checklist
// must render a side-by-side auto-status indicator whose JSX:
//   1. consumes `autoStatus?: AcAutoStatusMap | null` as an OPTIONAL prop so
//      every existing call site (loading branch, prior cached payload) keeps
//      compiling unchanged;
//   2. gates the indicator render on `auto.detected === true` (no rendering
//      when the marker did not match the AC item);
//   3. NEVER references `sourceAuthorAgentId` in the rendered JSX
//      (NO_UUID_LEAK rule, same family as D9/D10 in Plan 04.2-06).
//
// Source-grep idiom (Node's test runner does not load .tsx), same as
// continue-in-chat-button-d9.test.mjs / topic-strip-d10.test.mjs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'ac-checklist.tsx',
);

function code() {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('DIST-03 — ac-checklist.tsx exports the AcAutoStatusMap type', () => {
  const src = code();
  assert.match(
    src,
    /export\s+type\s+AcAutoStatusMap\s*=/,
    'expected `export type AcAutoStatusMap = ...` so ReaderViewReady can thread the shape through',
  );
  assert.match(
    src,
    /export\s+type\s+AcAutoStatusEntry\s*=/,
    'expected the per-entry type to be exported alongside the map type',
  );
});

test('DIST-03 — AcChecklist accepts optional autoStatus?: AcAutoStatusMap | null prop', () => {
  const src = code();
  assert.match(
    src,
    /autoStatus\?:\s*AcAutoStatusMap\s*\|\s*null/,
    'expected `autoStatus?: AcAutoStatusMap | null` on the AcChecklist props so existing call sites keep compiling',
  );
});

test('DIST-03 — indicator JSX is gated on detected === true', () => {
  const src = code();
  // The render must guard on `detected === true`. The exact form is
  // `auto?.detected === true ?` so a present-but-not-detected entry, an
  // absent map key, or a null map all collapse to "no indicator".
  assert.match(
    src,
    /auto(?:\?)?\.detected\s*===\s*true/,
    'expected the auto-status indicator JSX to be gated on `auto.detected === true`',
  );
});

test('DIST-03 — NO_UUID_LEAK: indicator JSX never references sourceAuthorAgentId directly', () => {
  const src = code();
  // The type may DECLARE sourceAuthorAgentId (so downstream tooling can read
  // it). The rendered JSX MUST NOT reference it. Inspect JSX-shaped lookups
  // only: any `.sourceAuthorAgentId` access in the AcChecklist FUNCTION body
  // (i.e. between the function declaration and the closing brace) is a
  // regression. The TYPE block above can name the field.
  const fnMatch = src.match(/export\s+function\s+AcChecklist[\s\S]*$/);
  assert.ok(fnMatch, 'expected to find the AcChecklist function declaration');
  const fnBody = fnMatch[0];
  assert.doesNotMatch(
    fnBody,
    /\.sourceAuthorAgentId\b/,
    'AcChecklist must NOT reference `.sourceAuthorAgentId` in JSX — that would leak the raw UUID (NO_UUID_LEAK; same family as Plan 04.2-06 D9)',
  );
  // The friendly fallback IS expected — pinned so a future refactor cannot
  // silently drop it back to the UUID. Accept either single or double quotes
  // (Prettier may rewrite).
  assert.match(
    fnBody,
    /auto\.sourceAuthorName\s*\?\?\s*(['"])agent\1/,
    'expected `auto.sourceAuthorName ?? "agent"` so the indicator falls back to a friendly literal, NEVER to the UUID',
  );
});
