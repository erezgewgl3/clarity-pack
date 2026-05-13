import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

// Plan 02-02 Task 3 — manifest promoted from the 2-slot smoke shape to the
// full Phase-2 declaration. All four surfaces are declared here so 02-03 and
// 02-04 fill in real components without re-editing the manifest:
//   - Reader (detailTab + entityTypes:['issue']) — slot identity LOCKED by
//     Plan 02-01 SMOKE-FINDINGS Check B (kitchen-sink canonical pattern;
//     architectural HIGH confidence; Linux re-spike will close visual D-01)
//   - Situation Room (page route)
//   - Bulletin (page route — stub component; real Bulletin lands in Phase 3)
//   - Chat (page route — stub component; real Chat lands in Phase 4)
//   - Settings (settingsPage) for the per-user opt-in toggle (OPTIN-01)
//
// Capability list expanded per .planning/research/STACK.md capabilities table.
// Schema corrections from Plan 02-01 Task 1 (commit bef083e) still apply —
// `id` (not name), entrypoints object, ui.detailTab.register +
// instance.settings.register capabilities for those slot types.
const manifest: PaperclipPluginManifestV1 = {
  id: 'clarity-pack',
  apiVersion: 1,
  version: '0.2.0',
  displayName: 'Clarity Pack',
  description:
    'Four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of unmodified Paperclip — plain-English clarity on what every employee is doing.',
  author: 'Eric G.',
  categories: ['ui', 'automation'],
  capabilities: [
    // Slot-registration capabilities — REQUIRED for the host to accept the
    // detailTab + settingsPage + page slots below (Plan 02-01 Task 1 Finding #5).
    'ui.detailTab.register',
    'instance.settings.register',
    // Data + agents capabilities — full Phase-2 scope.
    'database.namespace.migrate',
    'database.namespace.read',
    'database.namespace.write',
    'issues.read',
    'issue.comments.read',
    'issue.documents.read',
    'issue.documents.write',
    'agents.managed',
    'events.subscribe',
  ],
  entrypoints: {
    worker: './dist/worker.js',
    ui: './dist/ui',
  },
  database: {
    migrationsDir: 'migrations',
    // SDK 2026.512.0 PluginDatabaseCoreReadTable union does NOT include
    // 'users' (verified empirically by tsc against
    // @paperclipai/plugin-sdk/dist/types.d.ts). The plan's research-doc
    // example listed 'users' from a stale SDK shape — same drift pattern as
    // the Task 1 schema corrections (manifest.id, entrypoints, etc.). If
    // we need user-row reads later (e.g. Reader view's "blocked by Eric"
    // display), we read via a worker handler that hits the host's user API
    // rather than direct DB SELECT — cleaner privilege boundary anyway.
    coreReadTables: [
      'issues',
      'issue_comments',
      'issue_documents',
      'agents',
      'companies',
      'projects',
    ],
  },
  ui: {
    slots: [
      {
        type: 'detailTab',
        id: 'clarity-reader',
        displayName: 'Reader',
        exportName: 'ReaderView',
        entityTypes: ['issue'],
      },
      {
        type: 'page',
        id: 'clarity-situation',
        displayName: 'Situation Room',
        exportName: 'SituationRoom',
        routePath: 'situation-room',
      },
      {
        type: 'page',
        id: 'clarity-bulletin',
        displayName: 'Daily Bulletin',
        exportName: 'BulletinPage',
        routePath: 'bulletin',
      },
      {
        type: 'page',
        id: 'clarity-chat',
        displayName: 'Employee Chat',
        exportName: 'ChatPage',
        routePath: 'chat',
      },
      {
        type: 'settingsPage',
        id: 'clarity-settings',
        displayName: 'Clarity Pack',
        exportName: 'SettingsPage',
      },
    ],
  },
  // agents[] lands in Plan 02-03 (Editor-Agent declaration + reconcile wiring).
};

export default manifest;
