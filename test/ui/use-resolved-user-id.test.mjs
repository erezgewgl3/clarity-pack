// test/ui/use-resolved-user-id.test.mjs
//
// Plan 02-09 Task 1 — DEV-15-STRUCTURAL closure. Source-grep + pure-function
// based (consistent with test/ui/use-resolved-company-id.test.mjs convention)
// because the project does not ship a jsdom/vitest runner.
//
// Background: Plan 02-04 + 02-08 drill (2026-05-14 / 2026-05-15) caught the
// detail-tab slot bridge returning userId=null until the host's
// authApi.getSession() resolves (TanStack-Query loading window in
// PluginBridgeScope). See .planning/phases/02-scaffold-and-surfaces/
// 02-04-DRILL-FINDINGS.md §DEV-15-STRUCTURAL.
//
// STRUCTURAL DEVIATION FROM PLAN TEXT: the plan proposed a worker-side
// `get-viewer` handler. We verified the SDK surface
// (node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1292-1345 +
// protocol.d.ts:210-217) has NO caller-identity accessor on PluginContext,
// NO envelope-level userId on GetDataParams, and ctx.http.fetch (types.d.ts:
// 386-399) is outbound Node fetch — no browser session cookies. A worker
// handler cannot resolve the viewer's identity. The plan's escape hatch
// authorized deviation; the correct fit is a UI-side fetch resolver. Plugin
// UI is same-origin trusted JS (PLUGIN_SPEC.md §19) — it can call Better
// Auth's /api/auth/get-session with credentials: 'include' directly.
//
// Resolver chain:
//   1. useHostContext().userId — when non-null AND non-empty, short-circuit.
//   2. Fire one-time fetch('/api/auth/get-session', { credentials: 'include' }).
//   3. Parse JSON; accept `{user: {id}}` (Better Auth) or `{userId}` (legacy).
//   4. Map result to ResolvedUserId discriminated union.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  decideResolvedUserId,
  parseUserIdFromSessionResponse,
} from '../../src/ui/primitives/use-resolved-user-id.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SRC = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-resolved-user-id.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Pure-function: parseUserIdFromSessionResponse
// ---------------------------------------------------------------------------

test('parseUserIdFromSessionResponse — accepts Better-Auth shape {user:{id}}', () => {
  assert.equal(
    parseUserIdFromSessionResponse({ user: { id: 'resolved-uuid', email: 'x@y' }, session: {} }),
    'resolved-uuid',
  );
});

test('parseUserIdFromSessionResponse — accepts legacy top-level {userId}', () => {
  assert.equal(parseUserIdFromSessionResponse({ userId: 'top-level-uuid' }), 'top-level-uuid');
});

test('parseUserIdFromSessionResponse — prefers user.id over top-level userId when both present', () => {
  assert.equal(
    parseUserIdFromSessionResponse({ user: { id: 'preferred' }, userId: 'fallback' }),
    'preferred',
  );
});

test('parseUserIdFromSessionResponse — returns null for missing user.id and missing userId', () => {
  assert.equal(parseUserIdFromSessionResponse({ session: {} }), null);
});

test('parseUserIdFromSessionResponse — returns null for empty-string user.id (treated as missing)', () => {
  assert.equal(parseUserIdFromSessionResponse({ user: { id: '' } }), null);
});

test('parseUserIdFromSessionResponse — returns null for empty-string userId', () => {
  assert.equal(parseUserIdFromSessionResponse({ userId: '' }), null);
});

test('parseUserIdFromSessionResponse — returns null for non-object input', () => {
  assert.equal(parseUserIdFromSessionResponse(null), null);
  assert.equal(parseUserIdFromSessionResponse(undefined), null);
  assert.equal(parseUserIdFromSessionResponse('string'), null);
  assert.equal(parseUserIdFromSessionResponse(42), null);
});

test('parseUserIdFromSessionResponse — returns null for non-string user.id', () => {
  assert.equal(parseUserIdFromSessionResponse({ user: { id: 42 } }), null);
  assert.equal(parseUserIdFromSessionResponse({ user: { id: null } }), null);
});

// ---------------------------------------------------------------------------
// Pure-function: decideResolvedUserId — the resolver decision logic
// ---------------------------------------------------------------------------

test('decideResolvedUserId — host context userId populated → short-circuit, no fetch', () => {
  const result = decideResolvedUserId({
    hostContextUserId: 'real-uuid',
    fetchState: { kind: 'idle' },
  });
  assert.deepEqual(result, { userId: 'real-uuid', loading: false, error: null });
});

test('decideResolvedUserId — empty-string host userId treated as null (must fall through to fetch)', () => {
  const result = decideResolvedUserId({
    hostContextUserId: '',
    fetchState: { kind: 'pending' },
  });
  // empty string is not a valid identity; expect loading (because we will fetch)
  assert.deepEqual(result, { userId: null, loading: true, error: null });
});

test('decideResolvedUserId — host userId null + fetch pending → loading', () => {
  const result = decideResolvedUserId({
    hostContextUserId: null,
    fetchState: { kind: 'pending' },
  });
  assert.deepEqual(result, { userId: null, loading: true, error: null });
});

test('decideResolvedUserId — host userId null + fetch resolved with userId → resolved', () => {
  const result = decideResolvedUserId({
    hostContextUserId: null,
    fetchState: { kind: 'resolved', userId: 'fetched-uuid' },
  });
  assert.deepEqual(result, { userId: 'fetched-uuid', loading: false, error: null });
});

test('decideResolvedUserId — host userId null + fetch failed → no-user-context error', () => {
  const result = decideResolvedUserId({
    hostContextUserId: null,
    fetchState: { kind: 'failed' },
  });
  assert.deepEqual(result, { userId: null, loading: false, error: 'no-user-context' });
});

test('decideResolvedUserId — host userId null + fetch resolved with null userId → no-user-context error', () => {
  // The fetch landed (200) but the session had no user.id — same effective outcome
  // as a 401/network error: we cannot identify the caller.
  const result = decideResolvedUserId({
    hostContextUserId: null,
    fetchState: { kind: 'resolved', userId: null },
  });
  assert.deepEqual(result, { userId: null, loading: false, error: 'no-user-context' });
});

// ---------------------------------------------------------------------------
// Hook source-grep: structural contract enforcement
// ---------------------------------------------------------------------------

test('hook exports useResolvedUserId as a named export', () => {
  assert.match(HOOK_SRC, /export function useResolvedUserId\b/);
});

test('hook exports the ResolvedUserId result type', () => {
  assert.match(HOOK_SRC, /export type ResolvedUserId/);
});

test('hook reads useHostContext for the primary userId path', () => {
  assert.match(HOOK_SRC, /useHostContext\(\)/);
});

test('hook calls the Better-Auth session endpoint /api/auth/get-session', () => {
  assert.match(HOOK_SRC, /\/api\/auth\/get-session/);
});

test('hook calls fetch with credentials: "include" (so the host session cookie is sent)', () => {
  assert.match(HOOK_SRC, /credentials\s*:\s*['"]include['"]/);
});

test('hook short-circuits when host context already has a real userId (no waste fetch)', () => {
  // Look for an early-return / short-circuit guard reading hostContextUserId or userId from host.
  assert.match(HOOK_SRC, /useHostContext/);
  // Sanity: the hook must NOT issue fetch unconditionally — there must be some gating logic.
  assert.match(HOOK_SRC, /if\s*\(/);
});

test('hook does NOT register a worker handler called get-viewer (structural deviation from plan text)', () => {
  // The plan text proposed a worker-side get-viewer handler; we replaced it
  // with a UI-side fetch because the SDK has no caller-identity accessor.
  // This source-grep locks the decision so a future executor doesn't
  // accidentally re-introduce a stub.
  assert.doesNotMatch(HOOK_SRC, /usePluginData[\s\S]*?['"]get-viewer['"]/);
});

test('hook uses useState/useEffect for the async fetch (React hook-rules compliance)', () => {
  assert.match(HOOK_SRC, /useState\b/);
  assert.match(HOOK_SRC, /useEffect\b/);
});

test('hook uses AbortController so unmounted components do not update state', () => {
  assert.match(HOOK_SRC, /AbortController/);
});

test('hook returns "no-user-context" error literal when fetch fails', () => {
  assert.match(HOOK_SRC, /['"]no-user-context['"]/);
});

test('hook treats empty-string useHostContext userId as null (same as opt-in-guard extractUserId convention)', () => {
  // The hook must convert "" to null before deciding whether to short-circuit.
  // We look for either a normalization step (e.g. `userId || null`,
  // `userId?.length`, or `typeof userId === 'string' && userId.length > 0`).
  const hasNormalization =
    /\.length\s*>\s*0/.test(HOOK_SRC) ||
    /typeof\s+\w+\s*===\s*['"]string['"]/.test(HOOK_SRC) ||
    /\?\s*\w+\s*:\s*null/.test(HOOK_SRC);
  assert.ok(hasNormalization, 'hook must normalize empty-string userId to null');
});
