// test/ui/agent-pause-banner.test.mjs
//
// Plan 05-05 Task 1 (D-06 + D-07) — generic paused-agent banner shared by
// Reader top-of-tab AND chat header. Three locked copies dispatch on the
// discriminated `cause` field returned by `editor.pause-status`.
//
// Same source-grep idiom as reader-userid-threading.test.mjs / reader-view.test.mjs.
// Node 24's strip-types loads .ts but not .tsx, so we pin structure via grep —
// runtime behaviour is verified live during the Phase 5 closure drill.
//
// What this test PINS (must HOLD as the contract):
//   - File exists at src/ui/primitives/agent-pause-banner.tsx and exports
//     AgentPauseBanner.
//   - Banner consumes usePluginData('editor.pause-status') with resolver-
//     sourced userId (useResolvedUserId — DEV-15-STRUCTURAL).
//   - Three locked D-07 copies appear verbatim in the source:
//       operator → "${agentName} paused by operator — ▶ Resume heartbeat"
//       budget   → "${agentName} stopped — budget exhausted; check budget caps — ▶ Resume heartbeat"
//       adapter  → "${agentName} stopped — codex adapter error ${detail}; ▶ Retry heartbeat"
//   - agentName fallback is the LITERAL 'this employee' string — NEVER a UUID.
//   - No dangerouslySetInnerHTML (R3 invariant).
//   - Mount sites: Reader index.tsx + Chat index.tsx both render the banner.
//   - Editor-only pause-banner.tsx is UNCHANGED — still carries
//     "Editorial Desk paused — last compile failed at" (D-24 / reader-view.test.mjs lock).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'src', 'ui');
const BANNER_FILE = path.join(SRC, 'primitives', 'agent-pause-banner.tsx');
const READER_FILE = path.join(SRC, 'surfaces', 'reader', 'index.tsx');
const CHAT_FILE = path.join(SRC, 'surfaces', 'chat', 'index.tsx');
const EDITOR_ONLY_FILE = path.join(SRC, 'surfaces', 'reader', 'pause-banner.tsx');

function read(p) {
  return readFileSync(p, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('agent-pause-banner.tsx file exists at src/ui/primitives/', () => {
  assert.ok(existsSync(BANNER_FILE), 'expected src/ui/primitives/agent-pause-banner.tsx');
});

test('AgentPauseBanner is exported (named export)', () => {
  assert.match(read(BANNER_FILE), /export function AgentPauseBanner/, 'named export AgentPauseBanner');
});

test('AgentPauseBanner consumes usePluginData(\'editor.pause-status\')', () => {
  const src = code(read(BANNER_FILE));
  assert.match(src, /usePluginData[\s\S]*['"]editor\.pause-status['"]/, 'wires the editor.pause-status handler');
});

test('AgentPauseBanner uses useResolvedUserId (DEV-15-STRUCTURAL — detail-tab loading window)', () => {
  const src = read(BANNER_FILE);
  assert.match(
    src,
    /import\s*\{\s*useResolvedUserId\s*\}\s*from\s*['"][^'"]*use-resolved-user-id[^'"]*['"]/,
    'imports useResolvedUserId',
  );
  assert.match(code(src), /useResolvedUserId\(\)/, 'calls useResolvedUserId()');
});

test('AgentPauseBanner — D-07 OPERATOR copy verbatim', () => {
  const src = read(BANNER_FILE);
  // "paused by operator — ▶ Resume heartbeat"
  assert.match(src, /paused by operator — ▶ Resume heartbeat/, 'operator copy locked literal');
});

test('AgentPauseBanner — D-07 BUDGET copy verbatim', () => {
  const src = read(BANNER_FILE);
  assert.match(src, /stopped — budget exhausted; check budget caps — ▶ Resume heartbeat/, 'budget copy locked literal');
});

test('AgentPauseBanner — D-07 ADAPTER copy verbatim', () => {
  const src = read(BANNER_FILE);
  assert.match(src, /stopped — codex adapter error/, 'adapter copy locked prefix');
  assert.match(src, /▶ Retry heartbeat/, 'adapter copy locked Retry-heartbeat affordance');
});

test('AgentPauseBanner — agentName fallback is the LITERAL "this employee" (NO UUID leak)', () => {
  const src = code(read(BANNER_FILE));
  assert.match(src, /['"]this employee['"]/, 'falls back to "this employee", never a UUID');
});

test('AgentPauseBanner — dismissible (× button with aria-label) AND data-clarity-region scoped', () => {
  const src = read(BANNER_FILE);
  assert.match(src, /aria-label=["']Dismiss pause banner["']/, 'dismiss button has aria-label');
  assert.match(src, /data-clarity-region=["']agent-pause-banner["']/, 'banner carries data-clarity-region for CSS scoping');
});

test('AgentPauseBanner — discriminated cause dispatch references data.cause', () => {
  const src = code(read(BANNER_FILE));
  assert.match(src, /data\.cause|cause\s*===?\s*['"]/, 'dispatches on data.cause');
});

test('AgentPauseBanner — NO dangerouslySetInnerHTML (R3 invariant)', () => {
  assert.doesNotMatch(read(BANNER_FILE), /dangerouslySetInnerHTML/);
});

test('Reader index.tsx mounts <AgentPauseBanner /> in the populated surface root', () => {
  const src = read(READER_FILE);
  assert.match(src, /<AgentPauseBanner\b/, 'Reader renders <AgentPauseBanner />');
  assert.match(
    src,
    /import\s*\{\s*AgentPauseBanner\s*\}\s*from\s*['"][^'"]*agent-pause-banner[^'"]*['"]/,
    'Reader imports AgentPauseBanner',
  );
});

test('Chat index.tsx mounts <AgentPauseBanner /> in ChatPageBody', () => {
  const src = read(CHAT_FILE);
  assert.match(src, /<AgentPauseBanner\b/, 'Chat renders <AgentPauseBanner />');
  assert.match(
    src,
    /import\s*\{\s*AgentPauseBanner\s*\}\s*from\s*['"][^'"]*agent-pause-banner[^'"]*['"]/,
    'Chat imports AgentPauseBanner',
  );
});

test('Editor-only pause-banner.tsx is UNCHANGED — still carries the locked "Editorial Desk paused — last compile failed at" literal (D-24)', () => {
  // Belt-and-suspenders: this lock also lives in reader-view.test.mjs, but
  // re-asserting here makes intent explicit: the generic banner is a NEW file
  // that coexists with the editor-only banner.
  assert.match(
    read(EDITOR_ONLY_FILE),
    /Editorial Desk paused — last compile failed at/,
    'editor-only banner literal preserved',
  );
});

test('NO UUID leak — no test-fixture UUID fragment appears as fallback in the banner source', () => {
  const src = read(BANNER_FILE);
  // The 02-03b-era test fixture UUID prefix. If this prefix ever shows up in
  // the banner source, the UUID-leak hygiene is broken.
  assert.doesNotMatch(src, /b2a22e50/, 'no UUID fragment in banner source');
});
