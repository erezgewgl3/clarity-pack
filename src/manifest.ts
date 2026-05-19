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
  // 0.7.2 (Plan 04-05 Task-4 drill gap-closure round 2) — four more Employee
  // Chat defects the live Countermoves re-drill surfaced: (GAP 6) chat.send
  // failed on EVERY send — composer.tsx passed snake_case `message_uuid` but
  // the chat-send.ts handler reads camelCase `messageUuid` via reqStr, so
  // params.messageUuid was undefined and reqStr threw; the composer now sends
  // `messageUuid` (a cross-file wire-contract test guards the param names).
  // (GAP 5) the CHT-NN allocator produced CHT-1, CHT-11, CHT-111 — the bigint
  // MAX returns as a STRING from node-postgres, so `"1" + 1` concatenated;
  // allocateChtNumber now coerces via Number(...). (GAP 1) a new topic opened
  // but did not focus the message input — the composer textarea is now
  // autoFocus, and since the Composer is keyed per topic-issue it focuses on
  // every topic open. (GAP 3a) the context-rail frame borders leaned on
  // --line (too faint over the rail backgrounds) — a rail-scoped --ctx-line
  // token brightens them; --line is not globally redefined. UI/CSS + one
  // worker repo coercion — no manifest shape, capability, or schema change.
  //
  // 0.7.1 (Plan 04-05 Task-4 drill gap-closure) — four Employee Chat UI gaps
  // the live Countermoves visual-fidelity drill surfaced: (1) handleNewTopic
  // ignored the chat.topic.create return value, so a new topic never opened —
  // it now inspects the { ok, topicId, issueId, parentIssueId } | { error }
  // result, setTopic()s the new topic, and surfaces a returned error visibly;
  // (2) the new topic did not appear in the strip until the employee was
  // re-selected — a refreshKey folded into the TopicStrip key now forces a
  // fresh chat.topics fetch on create; (3a) the context rail leaned on --ink-3
  // (~4.3:1, below WCAG AA) — promoted to --ink-2, scoped to .ctx; (3b) the
  // agent card rendered "STATUSIDLE"/"TOPICHELLO" — the label is now its own
  // .stat-label span over a block <b> value. UI/CSS only — no manifest shape,
  // capability, schema, or worker-contract change.
  //
  // 0.7.0 (Plan 04-02 — Employee Chat data layer) — opens Phase 4. Adds the
  // 0006_chat.sql migration (chat_topics + chat_messages + chat_employee_parents
  // in the plugin namespace, additive-only) and the typed chat-topics-repo.
  // chat_messages is the D-09 idempotency side table (message_uuid -> comment_id
  // map + supersedes link + pin flag — never message body; content lives only
  // in public.issue_comments per CHAT-02). chat_employee_parents is the D-05
  // per-employee parent-issue map (composite PK gives each employee exactly one
  // Chat parent issue; race-safe first-ever-topic create). No new capability
  // strings: the chat worker handlers call ctx.issues.createComment /
  // ctx.issues.update / ctx.events.on / ctx.agents — all covered by capabilities
  // Phase 2/3 already declared and proved live on Countermoves (ctx.issues.update
  // is exercised by bulletin-action-approve, which installed live with the
  // current set, so D-06 auto-reopen needs no new string).
  //
  // 0.6.6 (debug fix from session bulletin-compile-cadence-runaway) — two bugs
  // the v0.6.5 closure re-drill exposed: (1) RUNAWAY COMPILE CADENCE — the
  // schedule pointer was advanced only on the success path, so every failure
  // continue left a stale past `next_due_at` and the every-minute cron
  // re-compiled immediately (6 cycles in 14 min). Fixed: advanceScheduleForCompany
  // moves the pointer on every path that consumes a due tick. (2) VERIFIER RACE —
  // verifyDraft re-ran each slot's SQL at compile END with tolerance 0; the ~50s
  // agent window let the live board drift. Fixed: verifyDraft validates the draft
  // against the FROZEN pass-1 facts snapshot, no live re-query.
  //
  // 0.6.5 (debug fix from session tldr-heartbeat-recursion) — two bugs the
  // v0.6.4 cycle-2 re-drill exposed once its bug-2 fix un-crashed the editor
  // TL;DR heartbeat: (1) INFINITE TL;DR RECURSION — handleEditorHeartbeat
  // compiled EVERY observed issue, including the plugin's OWN `tldr-compile`
  // operation issues, each of which spawns the next operation issue,
  // unbounded (17+ concurrent Editor-Agent runs live). Fixed: the heartbeat
  // skips any issue whose `originKind` is in the
  // `plugin:clarity-pack:operation:` namespace — the plugin must never
  // TL;DR-compile its own plumbing. (2) MALFORMED ARRAY LITERAL — every TL;DR
  // write failed at the host db layer: a scalar content-hash string was bound
  // into the `source_revisions text[]` (and `tags text[]`) column. Fixed:
  // upsertTldr binds both `text[]` columns as Postgres array-literal strings
  // through `$N::text[]` casts (toPgTextArrayLiteral). The recursion was
  // LATENT — the heartbeat crashed on the v0.6.3 `ctx.issue` typo (an
  // accidental circuit breaker) until v0.6.4's bug-2 fix un-crashed it.
  //
  // 0.6.4 (debug fix 2b1419f) — two latent bugs the v0.6.3 cycle-2 drill
  // exposed (neither a v0.6.3 regression): (1) every cycle >= 2 silently failed
  // to publish — publishBulletin's idempotency pre-check keyed on `next_due_at`,
  // which the prior published cycle's row also carries, so the pre-check matched
  // the prior cycle and returned 'failed'; re-keyed on (company_id,
  // cycle_number). (2) the Editor-Agent TL;DR compile had never run —
  // editor.ts read comments via a fictional `ctx.issue.comments.read`
  // (undefined on the host), now `ctx.issues.listComments`. The 0.6.3 defect-C
  // "fix" had only quieted that crash's log. compile-bulletin also gained
  // post-readback instrumentation (verdict + publish-result logging).
  //
  // 0.6.3 (debug fix from session bulletin-content-defects) — four defects the
  // v0.6.2 re-drill exposed on the published bulletin: (A) {{NUMBER:key}}
  // placeholders rendered literally — resolveDraftSlots writes resolved prose
  // back into editorialSummary + actionInbox summaries; (B) blank masthead —
  // buildMasthead populates it deterministically; (C) mislabeled WARN; (D) the
  // compile-bulletin catch-all routes unexpected throws through recordFailure.
  //
  // 0.6.2 (debug fix c9c6318) — per-department items normalization for
  // BULLETIN-RENDER-DEPT-ITEMS-UNDEFINED: validateDraftStructure coerces each
  // department's missing/non-array `items` to []. PROVEN LIVE on the v0.6.2
  // re-drill (Bulletin No. 1 published end-to-end).
  //
  // 0.6.1 (debug fix a0e77d3) — operation-issue exclusion for
  // BULLETIN-VERIFIER-COUNTS-OWN-OPERATION-ISSUE: the three public.issues
  // standing-number slots exclude Clarity Pack's own Compile Daily Bulletin
  // operation issue (origin_kind NOT LIKE 'plugin:clarity-pack:operation:%'), so
  // verifyDraft pass-2 no longer re-counts +1 against the frozen pass-1 number.
  // PROVEN LIVE on the 2026-05-17 v0.6.1 re-drill.
  //
  // Plan 03-10 — 0.6.0: standing-number schema-drift fix. STANDING_NUMBER_SLOTS
  // was rewritten with 5 agent-operations metrics whose SQL uses only columns
  // verified present against the live Paperclip schema (03-10-SCHEMA-FINDINGS.md
  // §2); the old 5 slots referenced invented columns (active_subscription_cents,
  // issues.tags, issue_comments.author_role) that failed every verifyDraft
  // pass-2 ctx.db.query on the Plan 03-09 closure drill.
  version: '0.7.2',
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
    // Plan 04-02 — Employee Chat. The 04-03 chat worker handlers need no NEW
    // capability strings: posting a chat message uses issue.comments.create
    // (above); the stream bridge subscribes issue.comment.created via
    // events.subscribe (above); the roster handler reads the employee list via
    // agents.read (above); the + New topic flow creates the child topic issue
    // via issues.create (above); D-06 auto-reopen calls ctx.issues.update,
    // which Phase 3's bulletin-action-approve already exercises live with this
    // exact capability set. Adding an unverified `issues.update` string would
    // risk the host install validator — not added. Chat tables are in the
    // plugin namespace so database.namespace.* (above) covers them.
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
