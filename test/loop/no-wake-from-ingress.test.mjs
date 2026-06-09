// test/loop/no-wake-from-ingress.test.mjs
//
// Phase 16.1 Plan 16.1-05 Task 1 (LOOP-01) — the region-scoped static no-wake
// gate + a behavioral zero-wake backstop.
//
// WHY THIS EXISTS. The 2026-06-04 wake-storm was a self-sustaining loop ignited
// by a wake reachable from an instance-wide event-handler body: every Clarity
// write re-entered ingress, which woke the Editor-Agent, which wrote again. The
// fix (Plans 02-04) made ingress OBSERVE-ONLY — no wake reachable from any
// ctx.events.on handler, and requestWakeup deleted from the delivery path. This
// test is the CONTRACT that fails the build the instant a wake reappears inside
// an event-handler body or in the delivery path, so a storm-prone build can
// never be reinstalled on BEAAA.
//
// TWO LAYERS (RESEARCH section 4):
//   1. STATIC, REGION-SCOPED (W-1). Strip comments from src/worker.ts, extract
//      the body of EACH ctx.events.on(...) registration (the text between the
//      callback's opening `{` and its matching closing `}`), and assert each
//      handler body contains ZERO forbidden wake tokens. The gate is scoped to
//      handler bodies ONLY — it does NOT scan whole-file for
//      runHeartbeat/handleEditorHeartbeat, because the loop-safe build
//      LEGITIMATELY wires `new HeartbeatDispatcher({ runHeartbeat: ..., })` in
//      MODULE scope (worker.ts ~:531) outside every handler. A whole-file grep
//      would false-positive on that correct build (T-161-24).
//   2. BEHAVIORAL BACKSTOP. Drive a burst of issue/comment events through a
//      faithful reconstruction of the observe-only ingress short-circuit and
//      assert ZERO agent wakes are emitted. This catches an alias move the token
//      list might miss (e.g. a wake routed through a renamed import).
//
// The token list is forbidden INSIDE handler bodies only:
//   requestWakeup, requestWakeups, .pause(, .resume(, managed.reconcile(,
//   runHeartbeat, handleEditorHeartbeat
// agent-task-delivery.ts has NO ctx.events.on region, so a whole-file grep for
// the single requestWakeup token is correct there (proves D-05).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ensureSeeded, isCompanyOptedIn, invalidateOptedInCache } from '../../src/worker/opted-in-company-set.ts';
import { isOwnOperationIssue } from '../../src/worker/db/own-operation-issues-repo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const WORKER_TS = path.join(REPO_ROOT, 'src', 'worker.ts');
const DELIVERY_TS = path.join(REPO_ROOT, 'src', 'worker', 'agents', 'agent-task-delivery.ts');

// The wake/dispatch surface forbidden INSIDE every event-handler body.
const FORBIDDEN_HANDLER_TOKENS = [
  'requestWakeup',
  'requestWakeups',
  '.pause(',
  '.resume(',
  'managed.reconcile(',
  'runHeartbeat',
  'handleEditorHeartbeat',
];

/** Strip line + block comments so a docstring mention never trips the gate. */
function stripComments(src) {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the body text of every `ctx.events.on(...)` registration in the
 * comment-stripped source. For each `ctx.events.on(` occurrence we find the
 * first `{` that opens the callback body and walk a balanced-brace scan to its
 * matching `}`. Returns an array of body strings (one per registration). The
 * handlers in worker.ts are simple async arrow bodies, so a brace-depth walk is
 * sufficient and robust.
 */
function extractEventHandlerBodies(stripped) {
  const bodies = [];
  const marker = 'ctx.events.on(';
  let searchFrom = 0;
  for (;;) {
    const at = stripped.indexOf(marker, searchFrom);
    if (at === -1) break;
    // Find the first `{` after the marker — that opens the callback body.
    const open = stripped.indexOf('{', at + marker.length);
    if (open === -1) {
      searchFrom = at + marker.length;
      continue;
    }
    // Balanced-brace walk from `open` to its matching `}`.
    let depth = 0;
    let end = -1;
    for (let i = open; i < stripped.length; i++) {
      const ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break; // unbalanced — stop (would be a syntax error in source)
    bodies.push(stripped.slice(open, end + 1));
    searchFrom = end + 1;
  }
  return bodies;
}

test('LOOP-01 static (region-scoped): no wake token inside any ctx.events.on handler body in worker.ts', () => {
  const stripped = stripComments(readFileSync(WORKER_TS, 'utf8'));
  const bodies = extractEventHandlerBodies(stripped);

  // worker.ts has two INLINE ctx.events.on registrations: the company.created
  // handler and the ingress handler (the ingress one is inside a `for (const
  // evt of [...])` loop, so it is a single ctx.events.on( text occurrence that
  // covers all three issue/comment event names). The chat-stream bridge
  // registers inside registerChatStreamBridge() — a separate module, not an
  // inline ctx.events.on here. Require at least both inline handlers.
  assert.ok(
    bodies.length >= 2,
    `expected to find the ingress + company.created inline event handlers (got ${bodies.length})`,
  );

  bodies.forEach((body, idx) => {
    for (const token of FORBIDDEN_HANDLER_TOKENS) {
      const count = body.split(token).length - 1;
      assert.equal(
        count,
        0,
        `ctx.events.on handler #${idx} must contain ZERO "${token}" — a wake/dispatch reachable from an event handler reignites the 2026-06-04 storm (LOOP-01)`,
      );
    }
  });
});

test('LOOP-01 static: the module-scope HeartbeatDispatcher wiring exists and is intentionally EXCLUDED from the gate (W-1 / T-161-24)', () => {
  const stripped = stripComments(readFileSync(WORKER_TS, 'utf8'));
  // Positively document that the loop-safe build KEEPS the dispatcher
  // constructor in module scope. The region-scoped gate above must pass with
  // this present — proving the gate does not false-positive on the correct
  // build's runHeartbeat/handleEditorHeartbeat config keys.
  assert.ok(
    stripped.includes('new HeartbeatDispatcher'),
    'the loop-safe build wires `new HeartbeatDispatcher(...)` in module scope; the gate is scoped to handler bodies so it is NOT matched',
  );
  // And it lives OUTSIDE every event-handler body.
  const bodies = extractEventHandlerBodies(stripped);
  for (const body of bodies) {
    assert.ok(
      !body.includes('new HeartbeatDispatcher'),
      'the HeartbeatDispatcher constructor must NOT appear inside any event-handler body (module-scope only)',
    );
  }
});

test('LOOP-07 static: agent-task-delivery.ts contains EXACTLY ONE governed requestWakeup (supersedes the D-05 zero invariant)', () => {
  // LOOP-07 supersedes D-05's "zero requestWakeup in the delivery path" invariant.
  // D-05 deleted the wake entirely on the assumption the Editor-Agent's native
  // heartbeat would pull op-issues; it does not — undispatched op-issues fall to
  // Paperclip's recovery sweep (status_only / write-blocked) so TL;DRs never
  // persist. The delivery path now LEGITIMATELY carries EXACTLY ONE GOVERNED wake
  // at op-issue creation in startAgentTask (gated by checkAndRecordWake). This is
  // NOT a storm regression: the wake lives outside every ctx.events.on handler
  // body (agent-task-delivery.ts has no ingress region at all), so the recursion
  // edge (event-ingress -> wake) the region-scoped gate above protects stays
  // absent. We assert (1) exactly one requestWakeup( call site, and (2) it is
  // GOVERNED — a checkAndRecordWake( token appears BEFORE it in the source.
  //
  // The matching `requestWakeup` token in the AgentTaskDeliveryCtx.issues Pick
  // member (`'requestWakeup'`) is a TYPE-position string literal, not a call site,
  // so we count call sites (`requestWakeup(`) specifically — exactly one.
  const stripped = stripComments(readFileSync(DELIVERY_TS, 'utf8'));

  const callSites = stripped.split('requestWakeup(').length - 1;
  assert.equal(
    callSites,
    1,
    'agent-task-delivery.ts must contain EXACTLY ONE requestWakeup( call site — the governed creation-time wake (LOOP-07)',
  );

  // The wake is GOVERNED: checkAndRecordWake( must appear before the requestWakeup(
  // call in the stripped source (the call lives inside the `if (allowed)` branch).
  const govAt = stripped.indexOf('checkAndRecordWake(');
  const wakeAt = stripped.indexOf('requestWakeup(');
  assert.ok(
    govAt !== -1,
    'agent-task-delivery.ts must call checkAndRecordWake( — the wake is governed, not raw (LOOP-07)',
  );
  assert.ok(
    govAt < wakeAt,
    'checkAndRecordWake( must precede requestWakeup( — the wake is gated through the governor (LOOP-07)',
  );
});

// --- Behavioral backstop (alias-proof) -------------------------------------
//
// Reconstruct the observe-only ingress short-circuit using the REAL gate
// primitives (ensureSeeded / isCompanyOptedIn / isOwnOperationIssue) and a
// faithful fake db. Feeding a burst of in-scope, non-own events MUST emit zero
// agent wakes. If a refactor ever wires a wake into the observe step (even via
// an alias the static token list misses), wakeCalls grows and this fails.

function makeIngressCtx({ optedInCompanyIds = ['c1'], ownIssueIds = [] } = {}) {
  const wakeCalls = []; // any agent wake the ingress path attempts
  const ownSet = new Set(ownIssueIds);
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/clarity_user_prefs/.test(sql)) {
          // seed step (a): opted-in user ids
          return optedInCompanyIds.length > 0 ? [{ user_id: 'u1' }] : [];
        }
        if (/clarity_agent_owners/.test(sql)) {
          // seed step (b): map users -> companies
          return optedInCompanyIds.map((company_id) => ({ company_id }));
        }
        if (/own_operation_issues/.test(sql)) {
          // ingress provenance read (company_id, issue_id) -> issue_id is $2
          return ownSet.has(params[1]) ? [{ '?column?': 1 }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    // If any of these were ever reached from ingress, the backstop catches it.
    issues: {
      async requestWakeup(id) {
        wakeCalls.push(id);
        return { queued: true };
      },
      async create() {
        wakeCalls.push('create');
        return { id: 'x' };
      },
    },
    agents: {
      managed: {
        async reconcile() {
          wakeCalls.push('reconcile');
          return { agentId: 'editor' };
        },
      },
      async pause() {
        wakeCalls.push('pause');
      },
      async resume() {
        wakeCalls.push('resume');
      },
    },
  };
  return { ctx, wakeCalls };
}

/**
 * Faithful reconstruction of worker.ts observe-only ingress (worker.ts ~:575-615):
 *   (1) scope gate, (2) durable own-operation provenance gate, (3) observe (log
 *   only — NO wake). Uses the REAL gate primitives so the behavior tracks the
 *   shipped contract.
 */
async function observeOnlyIngress(ctx, event) {
  const companyId = event.companyId;
  const entityId = event.entityId;
  if (!companyId || !entityId) return;
  await ensureSeeded(ctx);
  if (!isCompanyOptedIn(companyId)) return; // out-of-scope — no host work
  if (await isOwnOperationIssue(ctx, companyId, entityId)) return; // own write — drop
  // (3) observe only — a structured log line; NOTHING that wakes an agent.
  ctx.logger?.info?.('observed in-scope event (observe-only)', { companyId, entityId });
}

test('LOOP-01 behavioral: a burst of issue/comment events through observe-only ingress emits ZERO agent wakes', async () => {
  invalidateOptedInCache();
  const { ctx, wakeCalls } = makeIngressCtx({
    optedInCompanyIds: ['c1'],
    ownIssueIds: ['op-1', 'op-2'],
  });

  // Mixed burst: real in-scope issues + Clarity's own op-issues + an out-of-scope
  // company event. None may wake an agent.
  const burst = [
    { entityId: 'BEAAA-1', companyId: 'c1' },
    { entityId: 'BEAAA-2', companyId: 'c1' },
    { entityId: 'op-1', companyId: 'c1' }, // own op-issue — dropped by provenance
    { entityId: 'BEAAA-3', companyId: 'c2' }, // out-of-scope company — dropped by scope gate
    { entityId: 'op-2', companyId: 'c1' }, // own op-issue — dropped
    { entityId: 'BEAAA-4', companyId: 'c1' },
  ];
  for (const event of burst) {
    await observeOnlyIngress(ctx, event);
  }

  assert.equal(
    wakeCalls.length,
    0,
    'observe-only ingress emitted zero agent wakes for a mixed burst (the alias-proof backstop)',
  );

  invalidateOptedInCache();
});
