// test/manifest/chat-capabilities.test.mjs
//
// Plan 04-02 Task C RED — manifest version bump + chat capability contract.
//
// Phase 4 (Employee Chat) bumps the plugin version to 0.7.0 and relies on a
// set of host capabilities for the 04-03 chat worker handlers:
//   - issue.comments.create  — Eric posts a chat message as an issue comment
//   - events.subscribe       — the stream bridge subscribes issue.comment.created
//   - agents.read            — the roster handler reads the employee list
//   - issues.create          — the + New topic flow creates the child topic issue
//
// These were all declared in Phase 2/3 and proven live on Countermoves; this
// test pins them so a future capability prune cannot silently break chat.
//
// NOTE on issues.update (D-06 auto-reopen): Phase 3's bulletin-action-approve
// handler already calls ctx.issues.update and was installed live on
// Countermoves with the current capability set — so on this host the existing
// capabilities already permit ctx.issues.update. We do NOT add an unverified
// `issues.update` string (an unrecognized capability string fails the host
// install validator); this test does not require one.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import manifest from '../../src/manifest.ts';

test('manifest version is 1.0.0 (Plan 05-10 — v1.0.0 final closure; single canonical bump for Phase 5)', () => {
  assert.equal(manifest.version, '1.0.0');
});

test('manifest declares the capabilities the chat handlers need', () => {
  const caps = new Set(manifest.capabilities);
  for (const required of [
    'issue.comments.create',
    'events.subscribe',
    'agents.read',
    'issues.create',
    'database.namespace.read',
    'database.namespace.write',
    'issue.comments.read',
  ]) {
    assert.ok(
      caps.has(required),
      `manifest.capabilities must declare "${required}" for the chat worker handlers`,
    );
  }
});

test('manifest still declares the clarity-chat page slot with exportName ChatPage', () => {
  const slot = manifest.ui?.slots?.find((s) => s.id === 'clarity-chat');
  assert.ok(slot, 'the clarity-chat page slot must remain declared');
  assert.equal(slot.exportName, 'ChatPage');
  assert.equal(slot.routePath, 'chat');
});

test('manifest coreReadTables includes issue_comments (chat search reads it)', () => {
  assert.ok(
    manifest.database?.coreReadTables?.includes('issue_comments'),
    'issue_comments must be a core read table for the CHAT-08 search handler',
  );
});
