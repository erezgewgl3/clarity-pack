// test/helpers/host-faithful-ctx.mjs
//
// Quick task 260516-gx4 Task 2 — the ASSEMBLED host-faithful `ctx` for the
// bulletin compile path.
//
// `registerCompileBulletinJob` touches a wide ctx surface. Three reusable
// fakes already model the hardest host contracts in isolation:
//
//   - host-faithful-db.mjs       — `ctx.db.query` SELECT-only / one statement;
//                                  `ctx.db.execute` DML-in-namespace, returns
//                                  only `{rowCount}` (catalogue item 1).
//   - host-faithful-sessions.mjs — `ctx.agents.sessions.*` taskKey namespace
//                                  contract (item 2) + the heartbeat-policy
//                                  rejection (item 4).
//   - host-faithful-agents.mjs   — `ctx.agents.get/resume/pause` UUID
//                                  enforcement (item 3) + the editor-agent
//                                  key/tag distinction (item 8).
//
// `makeHostFaithfulCompileCtx` COMPOSES all three and adds thin host-faithful
// `companies`/`issues`/`jobs`/`logger` fakes, encoding the remaining items:
//
//   - Item 5 — the logger fake DROPS any 2nd-arg metadata object. Only the
//     message STRING survives into `loggedMessages`. The live host forwards a
//     fixed set of plugin-log fields and discards arbitrary metadata keys, so
//     any evidence the job needs must be in the message string itself.
//   - Item 6 — the migration-SQL validator (apostrophe-in-comment, CREATE
//     INDEX rejection) is a MIGRATION-time concern, already covered by
//     test/migrations/ddl-prefix-validator.test.mjs. The compile-bulletin job
//     never runs DDL at runtime, so this ctx models NO fake surface for it —
//     deliberately out of scope here.
//   - Item 7 — the in-memory bulletins table treats `cycle_number 0` as the
//     bootstrap sentinel. `MAX(cycle_number)` over PUBLISHED rows ignores the
//     sentinel, so the first real publish is cycle 1.
//   - Item 9 — `ctx.issues.list` returns Issue rows with `assigneeUserId` and
//     NO `lastActorId`/`lastActorName` field — the lineage path must key on
//     `assigneeUserId` (the SDK `Issue` type has no last-actor field).
//
// The in-memory bulletins/issues SQL model is lifted from the proven
// `makeFakeCtx` in compile-bulletin-end-to-end.test.mjs (which already models
// the bulletins/issues SQL faithfully) so there is ONE shared model.
//
// Plan 03-06 — the `issues` fake additionally models the OPERATION-ISSUE
// HANDOFF host CONSTRAINT: `requestWakeup` (record + resolve) and
// `listComments` (return a scripted agent result comment), and `list` honours
// `includePluginOperations` (a `plugin_operation`-visibility issue is returned
// only when the flag is set, mirroring the host — the B-1 contract).
//
// IMPORTANT — this fake models the HOST CONSTRAINT (the issues-API shape), NOT
// the agent's real BEHAVIOUR. The "agent" is simulated by the helper
// pre-seeding the result comment. The research's explicit lesson: a fake
// cannot model "the agent ignores the prompt" — only the live Countermoves
// drill (Plan 03-06 Task 5) can prove the agent actually processes the
// assigned operation issue.
//
// Plan 03-07 — the `tools` + `issues.documents` fakes model the HOST CONSTRAINT
// (the ctx API shape), NOT the agent's real behaviour. A fake cannot prove the
// real Editor-Agent calls submit-compile-result rather than filing a document —
// only the Task-5 live Countermoves drill can. (Research lesson:
// 03-RESULT-READBACK-RESEARCH.md / the 2026-05-16 re-drill.) The helper
// SIMULATES the agent by exposing `callTool(name, params, runCtx)`, which
// invokes a registered tool handler in-process.

import { wrapHostFaithfulDb } from './host-faithful-db.mjs';
import { makeHostFaithfulAgents as makeHostFaithfulSessions } from './host-faithful-sessions.mjs';
import { makeHostFaithfulAgents as makeHostFaithfulAgentLifecycle } from './host-faithful-agents.mjs';

/** A canned, well-formed BulletinDraft whose `mrr` standing number the
 *  verifier re-checks against the SQL result. */
function cannedDraft({ mrr = 2475 } = {}) {
  return {
    masthead: {
      volume: 'I',
      number: 1,
      weekday: 'Thursday',
      dateText: '2026-05-07',
      prepareForName: 'Eric G.',
      cycleNumber: 1,
    },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: mrr, format: 'currency' }],
    lineageThreads: [],
  };
}

/**
 * Assemble a host-faithful `ctx` that runs `registerCompileBulletinJob`
 * end-to-end and fails LOCALLY on any host-contract violation.
 *
 * @param {object} opts
 * @param {Array}  opts.companies   — companies `ctx.companies.list` returns.
 * @param {object} opts.nextDue     — companyId → ISO next_due_at for the
 *                                    initial getNextDueAtForCompany lookup.
 *                                    A company absent here takes the bootstrap
 *                                    path (catalogue item 7).
 * @param {number} opts.sqlMrr      — the value every standing-number / verifier
 *                                    SQL returns. Matching the canned draft's
 *                                    2475 passes the verifier; a mismatch
 *                                    (e.g. 9999) makes it reject.
 * @param {string} opts.draftJson   — override the JSON string the scripted
 *                                    session streams (Defect-B style inputs).
 * @param {string} opts.agentStatus — status `ctx.agents.get` reports.
 * @param {object} opts.sessionOpts — opts forwarded to the host-faithful
 *                                    sessions fake (e.g. heartbeatPolicySkip,
 *                                    notFoundForFirstNSends).
 * @param {Array}  opts.issues      — Issue rows `ctx.issues.list` returns
 *                                    (item 9: carry `assigneeUserId`, never
 *                                    `lastActorId`).
 * @param {Array}  opts.operationIssues — pre-seeded operation issues (Plan
 *                                    03-06). Returned by `list` ONLY when the
 *                                    caller passes `includePluginOperations:
 *                                    true` (the B-1 host contract).
 * @param {boolean} opts.noResultComment — when true, `listComments` returns
 *                                    NO agent result comment (the
 *                                    delivery-timeout path).
 */
export function makeHostFaithfulCompileCtx({
  companies = [],
  nextDue = {},
  sqlMrr = 2475,
  draftJson,
  agentStatus = 'idle',
  sessionOpts = {},
  issues = [],
  operationIssues = [],
  noResultComment = false,
} = {}) {
  // {cycle_number, company_id, next_due_at, compiled_at, content_hash,
  //  compile_status, published_issue_id}
  const bulletins = [];
  const issuesCreated = [];
  const wakeups = []; // Plan 03-06 — ctx.issues.requestWakeup calls
  const failures = []; // editor_agent_failures audit rows (circuit breaker)
  const compileFailures = []; // bulletin_compile_failures rows
  const loggedMessages = []; // item 5 — message STRINGS only, never metadata
  const jobs = new Map();
  const registeredTools = new Map(); // Plan 03-07 — ctx.tools.register captures

  // ---- In-memory bulletins/issues SQL model (lifted from the e2e test) -----
  const fakeDb = {
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query(sql, params) {
      // getNextDueAtForCompany
      if (/SELECT next_due_at/i.test(sql)) {
        // Prefer a live in-memory row (bootstrap writes one) over the seed map.
        const cid = params?.[0];
        const liveRows = bulletins
          .filter((b) => b.company_id === cid)
          .sort((a, b) => b.cycle_number - a.cycle_number);
        if (liveRows.length > 0) return [{ next_due_at: liveRows[0].next_due_at }];
        const iso = nextDue[cid];
        return iso ? [{ next_due_at: iso }] : [];
      }
      // MAX(cycle_number) — item 7: over PUBLISHED rows only, sentinel 0 ignored.
      if (/MAX\(cycle_number\)/i.test(sql)) {
        const cid = params?.[0];
        // The job's cycle-derivation SQL filters compile_status='published';
        // upsertBulletin's bootstrap SQL has no status filter. Detect which.
        const publishedOnly = /compile_status/i.test(sql);
        const max = bulletins
          .filter((b) => b.company_id === cid && (!publishedOnly || b.compile_status === 'published'))
          .reduce((m, b) => Math.max(m, b.cycle_number), 0);
        return [{ max_cycle: max, max }];
      }
      // publish.ts post-INSERT ownership check
      if (/SELECT compile_status/i.test(sql)) {
        const row = bulletins.find(
          (b) => b.next_due_at === params?.[0] && b.content_hash === params?.[1],
        );
        return row ? [{ compile_status: row.compile_status }] : [];
      }
      // Plan 03-06 — isCircuitOpenDurable reads the last N editor_agent_failures
      // rows for an agent_key, ORDER BY id DESC. Replay the in-memory `failures`
      // array (recordFailure appends to it) newest-first, capped at LIMIT $2.
      if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) {
        const agentKey = params?.[0];
        const limit = Number(params?.[1] ?? 3);
        return failures
          .filter((f) => f.agentKey === agentKey)
          .slice(-limit)
          .reverse()
          .map((f) => ({ consecutive: f.consecutive }));
      }
      // standing-numbers + verifier SQL — every slot returns sqlMrr.
      return [{ value: sqlMrr }];
    },
    async execute(sql, params) {
      if (/editor_agent_failures/i.test(sql)) {
        // params: agent_key, reason, consecutive
        failures.push({ agentKey: params?.[0], reason: params?.[1], consecutive: params?.[2] });
        return { rowCount: 1 };
      }
      if (/bulletin_compile_failures/i.test(sql)) {
        // params: cycle_number, reason, attempt_n, next_retry_at
        compileFailures.push({
          cycle_number: params?.[0],
          reason: params?.[1],
          attempt_n: params?.[2],
          next_retry_at: params?.[3],
        });
        return { rowCount: 1 };
      }
      if (/INSERT INTO .*bulletins/i.test(sql)) {
        // upsertBulletin (bootstrap) params:
        //   0 cycle_number, 1 company_id, 2 next_due_at, 3 compiled_at,
        //   4 verified_at, 5 published_at, 6 published_issue_id,
        //   7 compile_status, 8 content_hash, 9 lineage_json, 10 draft_json
        // publish.ts params:
        //   0 cycle_number, 1 company_id, 2 next_due_at, 3 compiled_at,
        //   4 content_hash, 5 lineage_json, 6 draft_json
        //   (compile_status is the SQL literal 'attempting').
        const isBootstrap = /verified_at/i.test(sql);
        const nextDueAt = params[2];
        const contentHash = isBootstrap ? params[8] : params[4];
        const compileStatus = isBootstrap ? params[7] : 'attempting';
        const dup = bulletins.find(
          (b) => b.next_due_at === nextDueAt && b.content_hash === contentHash,
        );
        if (dup) return { rowCount: 0 }; // ON CONFLICT DO NOTHING
        bulletins.push({
          cycle_number: params[0],
          company_id: params[1],
          next_due_at: nextDueAt,
          compiled_at: params[3],
          compile_status: compileStatus,
          content_hash: contentHash,
          published_issue_id: null,
        });
        return { rowCount: 1 };
      }
      // [\s\S] so the matcher crosses the multi-line SQL publish.ts emits.
      if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
        // params: issue_id, published_at, next_due_at, content_hash
        const row = bulletins.find(
          (b) => b.next_due_at === params[2] && b.content_hash === params[3],
        );
        if (row) {
          row.published_issue_id = params[0];
          row.compile_status = 'published';
        }
        return { rowCount: row ? 1 : 0 };
      }
      if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
        // params: new_next_due_at, cycle_number, company_id
        const row = bulletins.find(
          (b) => b.cycle_number === params[1] && b.company_id === params[2],
        );
        if (row) row.next_due_at = params[0];
        return { rowCount: row ? 1 : 0 };
      }
      // clarity_department_membership UPSERT — accepted, not modelled in detail.
      return { rowCount: 1 };
    },
  };

  // ---- Item 5 — the logger fake drops 2nd-arg metadata ---------------------
  // Only the message string is retained. A test that needs to assert evidence
  // survived the host's metadata drop checks `loggedMessages` and finds the
  // string only — never the dropped metadata object.
  const record = (msg) => {
    if (typeof msg === 'string') loggedMessages.push(msg);
  };
  const logger = {
    info(msg /* , metadata — DROPPED */) {
      record(msg);
    },
    warn(msg /* , metadata — DROPPED */) {
      record(msg);
    },
    error(msg /* , metadata — DROPPED */) {
      record(msg);
    },
    debug(msg /* , metadata — DROPPED */) {
      record(msg);
    },
  };

  // ---- ctx.agents — ONE coherent object: agent-lifecycle + sessions --------
  // host-faithful-sessions builds the sessions slice (taskKey contract item 2,
  // heartbeat-policy item 4). It needs the scripted draft as a streamed chunk.
  const draftText = draftJson ?? JSON.stringify(cannedDraft());
  const sessionsFake = makeHostFaithfulSessions({
    ...sessionOpts,
    events: sessionOpts.events ?? [
      { eventType: 'chunk', stream: 'stdout', message: draftText, payload: null },
      { eventType: 'done', stream: 'system', message: null, payload: null },
    ],
  });
  // host-faithful-agents composes that sessions slice with the agent-lifecycle
  // slice (UUID enforcement item 3, key/tag item 8). reconcile resolves a UUID.
  const agentsFake = makeHostFaithfulAgentLifecycle({
    agentStatus,
    sessions: sessionsFake,
  });

  // reconcileDepartments calls ctx.agents.list — not on the lifecycle fake's
  // surface; add a thin host-faithful list (empty roster is host-faithful).
  agentsFake.agents.list = async () => [];

  const ctx = {
    logger,
    db: wrapHostFaithfulDb(fakeDb),
    jobs: {
      register(key, fn) {
        jobs.set(key, fn);
      },
    },
    // Plan 03-07 — ctx.tools.register. Captures (name, declaration, fn) so a
    // test can SIMULATE the agent by invoking the captured handler via the
    // returned `callTool` helper. Models the host CONSTRAINT (the API shape),
    // not the agent's behaviour.
    tools: {
      register(name, declaration, fn) {
        registeredTools.set(name, { declaration, fn });
      },
    },
    companies: {
      async list() {
        return companies;
      },
    },
    agents: agentsFake.agents,
    issues: {
      async create(args) {
        issuesCreated.push(args);
        const created = {
          id: `issue-${issuesCreated.length}`,
          identifier: `COU-${issuesCreated.length}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args,
        };
        // Plan 03-06 — a freshly-created operation issue becomes visible to a
        // subsequent idempotency `list` (mirroring the host).
        if (
          typeof args.originKind === 'string' &&
          args.originKind.startsWith('plugin:clarity-pack:operation:')
        ) {
          operationIssues.push(created);
        }
        return created;
      },
      // Item 9 — Issue rows carry `assigneeUserId`, never `lastActorId` /
      // `lastActorName`. The lineage path keys on assigneeUserId.
      //
      // Plan 03-06 (B-1) — an operation-issue idempotency search
      // (`originKindPrefix` + `includePluginOperations`) returns seeded
      // operation issues ONLY when the flag is set; the lineage `list`
      // (companyId only) returns the regular issue rows.
      async list(input = {}) {
        if (input.originKindPrefix) {
          if (!input.includePluginOperations) return [];
          return operationIssues.filter(
            (oi) =>
              oi.originKind &&
              oi.originKind.startsWith(input.originKindPrefix) &&
              (input.originId === undefined || oi.originId === input.originId),
          );
        }
        return issues;
      },
      async get() {
        return null;
      },
      async requestWakeup(issueId, companyId, options) {
        wakeups.push({ issueId, companyId, options });
        return { queued: true, runId: 'run-op' };
      },
      // The simulated agent's result comment. By default a single comment whose
      // body is the canned BulletinDraft JSON, authored by the resolved Editor-
      // Agent id, with real Date objects to match the SDK IssueComment shape.
      async listComments(issueId, companyId) {
        if (noResultComment) return [];
        return [
          {
            id: `op-comment-${issueId}`,
            companyId,
            issueId,
            authorType: 'agent',
            authorAgentId: agentsFake.resolvedAgentId,
            authorUserId: null,
            body: draftText,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
      },
      async createComment() {
        return { id: 'comment-x' };
      },
      // Plan 03-07 — the issues.documents fake (Option-B fallback scan). Both
      // default to empty so the tool channel — not the fallback — is the path
      // exercised by default. A test that wants to drill the document fallback
      // overrides these.
      documents: {
        async list() {
          return [];
        },
        async get() {
          return null;
        },
      },
    },
  };

  return {
    ctx,
    bulletins,
    issuesCreated,
    operationIssues,
    wakeups,
    failures,
    compileFailures,
    loggedMessages,
    jobs,
    registeredTools,
    agentCalls: agentsFake.calls,
    resolvedAgentId: agentsFake.resolvedAgentId,
    sessions: sessionsFake,
    /**
     * Plan 03-07 — SIMULATE the agent calling a registered plugin tool. Invokes
     * the captured handler for `name` with `(params, runCtx)`. Throws if no
     * tool of that name was registered.
     */
    async callTool(name, params, runCtx = {}) {
      const entry = registeredTools.get(name);
      if (!entry) throw new Error(`callTool: no tool registered with name "${name}"`);
      return entry.fn(params, runCtx);
    },
  };
}
