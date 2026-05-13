import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

// Smoke-spike manifest. Plan 02-01 acceptance bar:
//   - apiVersion: 1
//   - detailTab slot with entityTypes: ['issue']  (D-01 verification gate)
//   - database.migrationsDir: 'migrations'        (D-02 verification gate)
//
// Schema corrections discovered during Plan 02-01 Task 1 (2026-05-13) vs the
// research-doc shape — plan was authored from a stale type sketch:
//   - `id` (not `name`)
//   - `description`, `author`, `categories` are REQUIRED top-level fields
//   - UI bundle path lives at `entrypoints.ui` (NOT `ui.bundleEntry`)
//   - `entrypoints.worker` is REQUIRED
//   - `ui.detailTab.register` + `instance.settings.register` capabilities required to register those slot types
const manifest: PaperclipPluginManifestV1 = {
  id: "clarity-pack",
  apiVersion: 1,
  version: "0.1.0-smoke",
  displayName: "Clarity Pack (smoke)",
  description:
    "Four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of unmodified Paperclip — plain-English clarity on what every employee is doing.",
  author: "Eric G.",
  categories: ["ui", "automation"],
  capabilities: [
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "issues.read",
    "ui.detailTab.register",
    "instance.settings.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  database: {
    migrationsDir: "migrations",
    coreReadTables: ["issues"]
  },
  ui: {
    slots: [
      {
        type: "detailTab",
        id: "clarity-reader-stub",
        displayName: "Reader (smoke)",
        exportName: "ReaderViewStub",
        entityTypes: ["issue"]
      },
      {
        type: "settingsPage",
        id: "clarity-settings-stub",
        displayName: "Clarity Pack (smoke)",
        exportName: "SettingsStub"
      }
    ]
  }
};

export default manifest;
