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
  // Plan 03-07 — 0.3.0: submit-compile-result tool channel + version-scoped
  // durable breaker. The breaker stamps this version on editor_agent_failures
  // rows (circuit-breaker.ts CLARITY_PACK_VERSION, which imports manifest.version).
  version: '0.3.0',
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
    // Plan 03-07 — ctx.tools.register declares the submit-compile-result tool
    // the Editor-Agent calls to hand the compiled BulletinDraft / TL;DR back to
    // the worker (Option C, the canonical plugin-llm-wiki result-readback
    // channel). Exact PLUGIN_CAPABILITIES member.
    'agent.tools.register',
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
      // Plan 03-07 — grant the managed Editor-Agent access to this plugin's
      // declared tools[]. Copied from plugin-llm-wiki's agents[] permissions
      // block (its `{ pluginTools: [PLUGIN_ID] }` form — verified verbatim from
      // paperclipai/paperclip@master packages/plugins/plugin-llm-wiki/src/
      // manifest.ts:177). Our plugin id is 'clarity-pack', so this grants the
      // Editor-Agent the submit-compile-result tool.
      //
      // Plan 03-07 OPEN QUESTION 1 — the exact permissions shape that grants a
      // managed agent a plugin tool is LOW-confidence (host-normalized, not in
      // the public SDK types). The Task-5 Countermoves drill MUST confirm the
      // Editor-Agent's tool surface includes clarity-pack:submit-compile-result.
      permissions: {
        pluginTools: ['clarity-pack'],
      },
      instructions: {
        // Plan 03-07 — the agent delivers its result by calling the
        // submit-compile-result plugin tool (Option C, canonical plugin-llm-wiki
        // pattern). The 03-06 comment/document delivery is gone — it caused the
        // output-channel mismatch the 2026-05-16 re-drill found. See
        // 03-RESULT-READBACK-RESEARCH.md. v1 ships inline; v2 may move to a
        // sibling AGENTS.md per the plugin-llm-wiki pattern.
        content:
          'You are the Clarity Pack Editorial Desk. ' +
          'On each heartbeat, look in your inbox for an issue assigned to you whose originKind starts with "plugin:clarity-pack:operation:". That issue is a task from Clarity Pack — process it as follows. ' +
          'If the originKind is "plugin:clarity-pack:operation:bulletin-compile": the issue DESCRIPTION is a complete compile prompt. Follow it exactly. The prompt carries the facts table and the {{NUMBER:key}} placeholder rules — never invent numbers, use the placeholders. The result is the raw BulletinDraft JSON object (no prose preamble, no markdown code fences, no sign-off — the JSON object and nothing else). ' +
          'If the originKind is "plugin:clarity-pack:operation:tldr-compile": the issue DESCRIPTION is a TL;DR compile prompt. Follow it exactly and produce ONLY the requested TL;DR text (in the format the prompt specifies). Never write more than 8000 characters in a single TL;DR. ' +
          'When the operation is complete, deliver the result by calling the "submit-compile-result" tool. Pass the operation issue\'s id as operationIssueId and the result payload as result — for a bulletin-compile issue, result is the raw BulletinDraft JSON object; for a tldr-compile issue, result is the raw TL;DR text. Call "submit-compile-result" exactly once. Do NOT post the result as an issue comment and do NOT file it as an issue document — the "submit-compile-result" tool is the only delivery channel. ' +
          'The "Editorial Desk" voice and sign-off rule apply to NARRATIVE prose you write INSIDE a draft (for example a department editorialSummary) — but the value you pass to the tool\'s result parameter is the raw JSON object (bulletin-compile) or the raw TL;DR text (tldr-compile) only. ' +
          'If you cannot produce a useful result, call "submit-compile-result" with result set to the literal string "Insufficient context" — the host treats that as a graceful skip.',
      },
    },
  ],
  // Plan 03-07 — the result-delivery tool. The worker registers the handler in
  // src/worker/agents/compile-result-tool.ts; this manifest entry is what the
  // host exposes to the Editor-Agent's tool surface. Keep in sync with
  // SUBMIT_COMPILE_RESULT_TOOL in compile-result-tool.ts (a contract test in
  // test/worker/agents/compile-result-tool.test.mjs locks them together).
  tools: [
    {
      name: 'submit-compile-result',
      displayName: 'Submit Clarity Pack compile result',
      description:
        'Deliver the completed BulletinDraft JSON or TL;DR text ' +
        'for the current clarity-pack operation issue. Call this exactly once ' +
        'when the operation is complete, passing the operation issue id and ' +
        'the raw result payload.',
      parametersSchema: {
        type: 'object',
        required: ['operationIssueId', 'result'],
        properties: {
          operationIssueId: {
            type: 'string',
            description:
              'The id of the plugin:clarity-pack:operation:* issue you are completing.',
          },
          result: {
            type: 'string',
            description:
              'Raw BulletinDraft JSON object, or raw TL;DR text — no prose, no markdown fences.',
          },
        },
      },
    },
  ],
};

export default manifest;
