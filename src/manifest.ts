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
  // Plan 03-08 — 0.4.0: Option B document-readback. deliverAgentTask reads the
  // agent's issue document keyed `compile-result` back as the PRIMARY readback;
  // the dead Option C tool channel (03-07) is stripped. The breaker stamps this
  // version on editor_agent_failures rows (circuit-breaker.ts
  // CLARITY_PACK_VERSION, which imports manifest.version) — the 0.3.0→0.4.0 bump
  // re-scopes the durable breaker past the 3 stale plugin_version='0.3.0' rows.
  version: '0.4.0',
  displayName: 'Clarity Pack',
  description:
    'Four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of unmodified Paperclip — plain-English clarity on what every employee is doing.',
  author: 'Eric G.',
  categories: ['ui', 'automation'],
  capabilities: [
    // Slot-registration capabilities — REQUIRED for the host to accept the
    // detailTab + settingsPage + page slots below (Plan 02-01 Task 1 Finding #5).
    // ui.page.register added 2026-05-13 during Plan 02-03 Task 3 rehearsal — host
    // validator (paperclipai/paperclip@master server/src/services/plugin-validator)
    // rejected install with "Missing required capabilities for declared features:
    // ui.page.register". One cap per page-bearing slot type.
    'ui.detailTab.register',
    'ui.page.register',
    'instance.settings.register',
    // Data + agents capabilities — full Phase-2 scope.
    'database.namespace.migrate',
    'database.namespace.read',
    'database.namespace.write',
    'issues.read',
    'issue.comments.read',
    'issue.documents.read',
    'issue.documents.write',
    // Plan 02-03b Task 2 — added 2026-05-14 after API-shape diagnosis. Plan
    // 02-03 omitted these because the original handler-draft used ctx.http.fetch
    // for blockers and walked a fictional ctx.issues.ancestry. The rewritten
    // handlers use the typed SDK clients: ctx.issues.relations.get +
    // ctx.projects.get + ctx.goals.get. See 02-03b-API-SHAPES.md §§ 2, 7.
    'issue.relations.read',
    'projects.read',
    'goals.read',
    'agents.managed',
    'agents.read',
    'agents.pause',
    'agents.resume',
    // Plan 03-05 — production LLM invocation via ctx.agents.sessions
    // (03-LLM-INVOCATION-RESEARCH.md). The compile-bulletin job and the
    // Editor-Agent heartbeat TL;DR path open an agent chat session, send the
    // compile prompt, accumulate the streamed chunk events, and close — the
    // real LlmAdapter that replaces the impossible `ctx.llm` seam. Exact
    // members of PLUGIN_CAPABILITIES. `agents.resume` (above) lets the
    // compile job resume the manifest's status:'paused' Editor-Agent.
    'agent.sessions.create',
    'agent.sessions.list',
    'agent.sessions.send',
    'agent.sessions.close',
    'events.subscribe',
    'companies.read',
    // Plan 02-04 Task 2 — required for the recompute-situation 60s job
    // declared in jobs[] below (PLUGIN_SPEC §17).
    'jobs.schedule',
    // Plan 03-01 — Daily Bulletin. issues.create lets the compile pipeline
    // (Plan 03-02) persist each bulletin as a canonical Paperclip issue
    // (D-16); issue.comments.create lets Plan 03-04 append errata as a
    // comment on the prior cycle's issue (D-18).
    'issues.create',
    'issue.comments.create',
    // Plan 03-06 — ctx.issues.requestWakeup wakes the Editor-Agent immediately
    // when an operation issue is created (agent-task-delivery.ts — the
    // operation-issue task-delivery handoff that replaces the discarded
    // session prompt). Exact PLUGIN_CAPABILITIES member (SDK 2026.512.0
    // types.d.ts: "issues.wakeup for assignment wakeup requests").
    'issues.wakeup',
    // Plan 03-08 — the dead Option C `agent.tools.register` capability was
    // removed. The 2026-05-16 closure re-drill live-disproved Option C: a
    // `claude_local` managed agent's session never receives a plugin-declared
    // tool. The readback is now an issue-document poll (issue.documents.read,
    // already declared above) — no plugin tool is registered.
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
  // Plan 02-03 Task 1 — Editor-Agent (Editorial Desk) declaration. Per
  // PluginManagedAgentDeclaration shape (verified against
  // node_modules/@paperclipai/shared/dist/types/plugin.d.ts:86 + the
  // plugin-llm-wiki example at
  // paperclipai/paperclip@master:packages/plugins/plugin-llm-wiki/src/manifest.ts:152).
  //
  // Adapter preference per D-04..D-07: claude_local first (Eric's chosen
  // adapter for v1 dogfood), process fallback (host installs an in-process
  // adapter if claude_local isn't configured). The actual LLM provider is
  // configured by the operator via the Paperclip agent panel after install —
  // we never bake API keys into the plugin manifest.
  //
  // MCP server invocation is described in the adapterConfig.mcpServers map
  // (the shape the claude_local adapter expects). The version pin
  // 2026.512.0 matches @paperclipai/mcp-server's date-based npm version; npx
  // -y pulls it on first launch.
  // Plan 02-04 Task 2 — D-03 configurable cadence for Situation Room.
  // Host validates the resolved values against this JSON-schema-shaped object
  // before the worker boots; ctx.config.get() returns them. UI reads via the
  // 'clarity-pack/get-instance-config' worker handler (per 02-01 Check F
  // FALLBACK — SDK 2026.512.0 does not export useInstanceConfig).
  // Note: PaperclipPluginManifestV1 types instanceConfigSchema as JsonSchema
  // (Record<string, unknown>). Zod is the docstring-suggested authoring tool
  // for validation, but the manifest itself ships JSON-schema-shaped data.
  instanceConfigSchema: {
    type: 'object',
    properties: {
      situationRefreshIntervalMs: {
        type: 'number',
        minimum: 30_000,
        maximum: 600_000,
        default: 60_000,
        description:
          'Situation Room polling cadence in milliseconds. Mockup shows 30s; default 60s per D-03. ' +
          'Configurable via Paperclip admin UI; the running plugin picks up changes on next configChanged.',
      },
      // Plan 03-01 — Daily Bulletin config (D-20 departments, BULL-01 timezone).
      bulletinDepartments: {
        type: 'array',
        items: { type: 'string' },
        default: ['Production', 'Sales', 'Customer', 'Builder'],
        description: 'D-20: department sections rendered in the Daily Bulletin.',
      },
      bulletinTimezone: {
        type: 'string',
        default: 'America/New_York',
        description:
          'BULL-01: timezone for the 06:30 daily compile. Locked to ET for v1.',
      },
    },
  },
  // Plan 02-04 Task 2 — recompute-situation 60s cron job. The handler in
  // src/worker/jobs/situation-snapshot.ts no-ops when no row in
  // plugin_clarity_pack_cdd6bda4bd.active_viewers is < 90s old, so the
  // expensive snapshot only runs when ≥1 user has the Situation Room open.
  jobs: [
    {
      jobKey: 'recompute-situation',
      schedule: '*/1 * * * *',
      displayName: 'Recompute Situation Room snapshot',
    },
    // Plan 03-01 — fires every minute; the handler in
    // src/worker/jobs/compile-bulletin.ts reads bulletins.next_due_at and
    // only compiles when `now >= next_due_at`. The cron string is a
    // heartbeat HINT per D-12 — the worker-managed next_due_at (computed via
    // date-fns-tz in America/New_York) is the DST-safe source of truth.
    {
      jobKey: 'compile-bulletin',
      schedule: '*/1 * * * *',
      displayName: 'Compile Daily Bulletin (DST-safe; worker-managed next_due_at)',
    },
  ],
  agents: [
    {
      agentKey: 'editor-agent',
      displayName: 'Editor-Agent',
      role: 'editor',
      title: 'Editorial Desk',
      icon: 'feather',
      capabilities:
        'Compiles TL;DRs, critical-path narratives, and the Daily Bulletin from Paperclip issue + activity context. Always attributes to "Editorial Desk".',
      adapterType: 'claude_local',
      adapterPreference: ['claude_local', 'process'],
      adapterConfig: {
        // MCP server config — claude_local adapter pattern; the host wires
        // these stdio commands into the agent's tool surface at run time.
        mcpServers: {
          paperclip: {
            command: 'npx',
            args: ['-y', '@paperclipai/mcp-server@2026.512.0'],
          },
        },
      },
      // Start paused so Eric can review the agent in classic UI before
      // anything runs — coexistence-friendly default.
      status: 'paused',
      // No monthly budget cap baked into the manifest; Eric sets per-company
      // via classic admin UI. D-05 MAX_TOKENS=4000 lives in compile-tldr.ts
      // (input-side cap), not here.
      budgetMonthlyCents: 0,
      // Plan 03-08 — the Option C `permissions.pluginTools` block was removed.
      // The 2026-05-16 closure re-drill live-disproved Option C: a
      // `claude_local` managed agent's session never receives a plugin-declared
      // tool, so no plugin-tool grant is needed.
      instructions: {
        // Plan 03-08 — the agent delivers its result as an issue DOCUMENT keyed
        // `compile-result` (Option B). The 03-07 plugin-tool channel is dead.
        // NOTE: this static manifest instructions.content does
        // NOT propagate to an already-existing managed agent (reconcile() sets
        // instructions at creation only — debug doc ROOT CAUSE). The real
        // delivery contract reaches the live agent through the operation-issue
        // DESCRIPTION, which agent-task-delivery.ts appends RESULT_DELIVERY_
        // INSTRUCTION to on every compile. This content is informational only —
        // it must not contradict that description-borne instruction.
        content:
          'You are the Clarity Pack Editorial Desk. ' +
          'On each heartbeat, look in your inbox for an issue assigned to you whose originKind starts with "plugin:clarity-pack:operation:". That issue is a task from Clarity Pack — process it as follows. ' +
          'If the originKind is "plugin:clarity-pack:operation:bulletin-compile": the issue DESCRIPTION is a complete compile prompt. Follow it exactly. The prompt carries the facts table and the {{NUMBER:key}} placeholder rules — never invent numbers, use the placeholders. The result is the raw BulletinDraft JSON object (no prose preamble, no markdown code fences, no sign-off — the JSON object and nothing else). ' +
          'If the originKind is "plugin:clarity-pack:operation:tldr-compile": the issue DESCRIPTION is a TL;DR compile prompt. Follow it exactly and produce ONLY the requested TL;DR text (in the format the prompt specifies). Never write more than 8000 characters in a single TL;DR. ' +
          'When the operation is complete, deliver the result by storing it as an issue DOCUMENT on that operation issue, using the EXACT document key "compile-result" — for a bulletin-compile issue the document body is the raw BulletinDraft JSON object; for a tldr-compile issue it is the raw TL;DR text. Then mark the operation issue done. The document keyed "compile-result" is the delivery channel the Clarity Pack worker reads. ' +
          'The "Editorial Desk" voice and sign-off rule apply to NARRATIVE prose you write INSIDE a draft (for example a department editorialSummary) — but the body of the "compile-result" document is the raw JSON object (bulletin-compile) or the raw TL;DR text (tldr-compile) only. ' +
          'If you cannot produce a useful result, store a "compile-result" document whose body is the literal string "Insufficient context" — the host treats that as a graceful skip.',
      },
    },
  ],
  // Plan 03-08 — the Option C `tools[]` array (the dead result-delivery tool)
  // was removed. The 2026-05-16 closure re-drill live-disproved Option C: a
  // `claude_local` managed agent's session never receives a plugin-declared
  // tool. The Editor-Agent now delivers its result as an issue document keyed
  // `compile-result` (Option B), read back by agent-task-delivery.ts.
};

export default manifest;
