// test/worker/editor-agent-key-consistency.test.mjs
//
// Regression guard for the Plan 03-05 Countermoves drill bug (2026-05-15).
//
// `ctx.agents.managed.reconcile(agentKey, companyId)` resolves a manifest-
// declared managed agent BY KEY. If the key passed by worker code does not
// EXACTLY equal the `agentKey` string in `manifest.agents[]`, the host throws
// and the caller silently bails — `compile-bulletin.ts` had defined a local
// `EDITOR_AGENT_KEY = 'clarity-pack-editor-agent'` (the value of the unrelated
// EDITOR_AGENT_ID_TAG) while the manifest declares `agentKey: 'editor-agent'`,
// so the bulletin compile job died at reconcile every single minute with no
// bulletin and no failure row.
//
// `editor.ts` is the single source of truth for the Editor-Agent key. This
// test asserts the manifest agrees with it — any future drift fails `pnpm
// test` before an install.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import manifest from '../../src/manifest.ts';
import { EDITOR_AGENT_KEY } from '../../src/worker/agents/editor.ts';

test('manifest declares a managed agent whose agentKey equals editor.ts EDITOR_AGENT_KEY', () => {
  assert.ok(Array.isArray(manifest.agents), 'manifest.agents[] must exist');
  const keys = manifest.agents.map((a) => a.agentKey);
  assert.ok(
    keys.includes(EDITOR_AGENT_KEY),
    `manifest.agents[] declares ${JSON.stringify(keys)} but worker code resolves ` +
      `the Editor-Agent by EDITOR_AGENT_KEY='${EDITOR_AGENT_KEY}'. These MUST match — ` +
      `ctx.agents.managed.reconcile() throws on an unknown key and the caller bails silently.`,
  );
});

test('EDITOR_AGENT_KEY is the literal "editor-agent" (the manifest value)', () => {
  // Pins the constant so a rename touches both sides deliberately.
  assert.equal(EDITOR_AGENT_KEY, 'editor-agent');
});
