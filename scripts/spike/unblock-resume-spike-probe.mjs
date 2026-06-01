#!/usr/bin/env node
// scripts/spike/unblock-resume-spike-probe.mjs
//
// THROWAWAY Phase 10 (Unblock-Resume) falsify-first spike probe.
//
// This file ships NOTHING. It is not bundled, not under src/, never imported
// by plugin code, adds no npm dependency, and uses only Node's built-in fetch.
// It exists only to be run by Eric against the LIVE BEAAA Paperclip instance
// (the AriClaw DigitalOcean droplet — D-01: the real host/version the v1.4.0
// milestone is about, NOT a Countermoves proxy), bookended by a verified
// DO-droplet backup. After the findings doc (10-…-SPIKE-FINDINGS.md) is written
// it may be deleted.
//
// PURPOSE: Phase 10's make-or-break question (DO-03) must be falsified on the
// live host BEFORE any reply-in-place / decision-chip action UI (Phase 14) is
// written: against live BEAAA, does posting a COMMENT to a blocked agent's
// thread actually unblock AND resume that agent, or must a status / blocker
// transition accompany it? The answer is captured per the three "blocked
// shapes", each judged by the three-signal PASS:
//   Shape A — awaiting reply  (agent asked a question, parked at in_progress)
//   Shape B — status='blocked' (terminal status per topic-watchdog.ts)
//   Shape C — blockedByIssueIds relation (dependency edge)
// Three-signal PASS (D-07): behavioral (agent emits a NEW action/comment) +
// consumption (a fresh run picked the issue up) + state (issue transitions off
// blocked/awaiting). Signal 3 alone is necessary-but-not-sufficient.
//
// THIS PLAN (10-01) lands the harness + named stubs and resolves the two cheap
// Wave-0 open questions plus the read-only fidelity check:
//   A1  — is status:'blocked' settable via PATCH /api/issues/{id} within the
//         declared issues.update capability, or does blocked require a non-empty
//         blockedByIssueIds (which would merge Shape B into Shape C)?
//   A3  — can the probe mint AND delete a dedicated sacrificial agent via REST,
//         or must the operator mint one manually (then pin SPIKE_PROBE_AGENT_ID)?
//   D-02 — observe at least one REAL BEAAA blocked item per shape READ-ONLY and
//         confirm the probe-shape construction matches what BEAAA produces.
// The three-shape probe functions are STUBS filled by Plan 10-02.
//
// USAGE — RUN AFTER A DO-DROPLET BACKUP OF THE ARICLAW DROPLET (D-03). BEAAA has
// NO safety-CLI (scripts/safety/cli.mjs is a Countermoves-only inheritance; the
// box has no ~/clarity-pack and no /etc/paperclip/db.env). The bookend on BEAAA
// is a DO-droplet backup + the plugin-reinstall rollback path, performed by the
// operator on a LOCAL tunnel+SSH window:
//
//   # 1) Bookend (CLAUDE.md bookended-by-snapshots rule) — operator, LOCAL window:
//   #    a) Take a DO-droplet backup/snapshot of the AriClaw droplet via the
//   #       DigitalOcean console; record its id + timestamp.
//   #    b) Confirm the plugin-reinstall rollback path ONCE (prior clarity-pack
//   #       tarball reachable; `sudo -u beai-agent bash -lc 'cd ~ && npx
//   #       paperclipai plugin list'` shows the current install — do NOT actually
//   #       roll back now, just confirm the path is real).
//
//   # 2) Open the tunnel + mint a bearer token (operator, LOCAL window):
//   #    ssh -L 3100:localhost:3100 ariclaw          # key beaaa_ariclaw_ed25519
//   #    auth login --instance-admin                 # token at ~/.paperclip/auth.json
//   #    (minimize repeat SSH — fail2ban bans on banner-exchange bursts; wait
//   #     15-30 min or use the DO Web Console if banned. Do NOT paste the token
//   #     into the GSD session — the probe redacts it from all output.)
//
//   # 3) Run the probe through the tunnel:
//   PAPERCLIP_API_URL=http://localhost:3100 \
//   PAPERCLIP_API_KEY=<bearer token from ~/.paperclip/auth.json> \
//   PAPERCLIP_COMPANY_ID=59f8876e-e729-4dda-98f9-1317c2b50492 \
//     node scripts/spike/unblock-resume-spike-probe.mjs > 10-01-dryconfirm-output.txt 2>&1
//
//   # 4) Teardown: the probe deletes its [SPIKE 10]-tagged throwaway issues +
//   #    any sacrificial agent it minted. Anything left over is greppable by the
//   #    [SPIKE 10] title tag; worst case the DO-backup rollback removes it.
//
// Optional env:
//   SPIKE_PROBE_AGENT_ID   pin the sacrificial probe agent if A3 says the probe
//                          cannot mint one via REST and the operator minted it
//                          manually (NOT the Editor-Agent, NOT a real hire).
//
// This runs OUTSIDE the plugin worker, so it has no plugin SDK `ctx`. It uses
// REST-direct bearer auth (the only mutation surface reachable from outside the
// worker), redacts the token from all output, and mirrors the REST-client +
// try/catch-per-step + structured-JSON-summary pattern from
// scripts/spike/chat-true-task-spike-probe.mjs (the proven Phase 4.1 analog).
// Route shapes VERIFIED LIVE (04-01): issue/agent COLLECTION routes are
// companyId-scoped (`/api/companies/{id}/issues`, `/api/companies/{id}/agents`)
// while per-issue SUB-routes are FLAT (`/api/issues/{id}`,
// `/api/issues/{id}/comments`, `/api/issues/{id}/wakeup`). Every probe step is
// wrapped so one failure cannot abort the others — partial findings are still
// findings. It prints a single structured JSON summary at the end on stdout.
//
// CAPABILITY BOUNDARY (D-09 — confirmed against src/manifest.ts):
//   DECLARED:     issue.comments.create, issues.wakeup, issues.update,
//                 agents.pause, agents.resume, agents.managed, agents.read,
//                 issue.relations.read
//   NOT DECLARED: issue.relations.write   ← D-10: do NOT use; the edge-clear path
//                 for Shape C is documented as spec'd-not-proven, never exercised.

import process from 'node:process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = (process.env.PAPERCLIP_API_URL || '').replace(/\/$/, '');
const API_KEY = process.env.PAPERCLIP_API_KEY || '';
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';
// NEW — pins the sacrificial probe agent if A3 says the operator must mint it
// manually (the probe could not create+delete an agent via the REST surface).
const SPIKE_PROBE_AGENT_ID = process.env.SPIKE_PROBE_AGENT_ID || '';

// Poll cadence and windows. Heartbeat min interval is ~30s; real LLM replies
// take minutes (RESEARCH.md Pattern 4). Windows are bounded so the probe never
// hammers the host and finishes in a predictable time.
const POLL_INTERVAL_MS = 30_000;
const FIRST_REPLY_WINDOW_MS = 8 * 60_000; // 8 min for the first agent reply
const RE_WAKE_WINDOW_MS = 4 * 60_000; // 4 min per D-08 ladder rung
const STATUS_OBS_WINDOW_MS = 6 * 60_000; // 6 min observing status changes

const SPIKE_TAG = '[SPIKE 10]'; // every spike-created issue title carries this
// — a botched run is greppable + deletable (threat T-10-03).

// Reply-channel instruction proven necessary in Plan 04-01's spike (the agent
// will file documents instead of commenting otherwise — A5/D-14 fold).
const REPLY_CHANNEL_INSTRUCTION =
  'Reply to comments on this issue by posting a COMMENT on this issue (not a document).';

// ---------------------------------------------------------------------------
// Tiny REST client — copied VERBATIM from
// scripts/spike/chat-true-task-spike-probe.mjs (lines 124-256). Proven live,
// token-safe, route-shapes verified. Do NOT re-derive (RESEARCH "Don't
// Hand-Roll").
// ---------------------------------------------------------------------------

/** Redact the bearer token from any error message before it is logged. */
function redactedError(err, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return err;
  const original =
    err && typeof err.message === 'string' ? err.message : String(err);
  let scrubbed = original.split(apiKey).join('<REDACTED>');
  scrubbed = scrubbed.split(`Bearer ${apiKey}`).join('Bearer <REDACTED>');
  const wrapped = new Error(scrubbed);
  if (err && err.name) wrapped.name = err.name;
  if (err && err.cause !== undefined) wrapped.cause = err.cause;
  return wrapped;
}

/**
 * Single REST call. Returns { status, body } for any HTTP status (the caller
 * decides PASS vs FAIL); only network failures throw. The token is never
 * echoed — errors are scrubbed via redactedError.
 */
async function call(method, pathname, body) {
  if (!API_URL)
    throw new Error(
      'unblock-resume-spike-probe: PAPERCLIP_API_URL is required',
    );
  const url = `${API_URL}${pathname}`;
  const init = {
    method,
    headers: API_KEY ? { authorization: `Bearer ${API_KEY}` } : {},
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let raw;
  try {
    raw = await fetch(url, init);
  } catch (err) {
    throw redactedError(err, API_KEY);
  }
  const ct = raw.headers.get('content-type') || '';
  let parsed;
  try {
    parsed = ct.includes('application/json') ? await raw.json() : await raw.text();
  } catch (err) {
    throw redactedError(err, API_KEY);
  }
  return { status: raw.status, body: parsed };
}

/** True when an HTTP status is in the 2xx range. */
function ok(status) {
  return status >= 200 && status < 300;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** ISO timestamp for log lines. */
function now() {
  return new Date().toISOString();
}

/** Structured stderr log line — never carries the token. */
function log(msg, extra) {
  const tail = extra ? ' ' + JSON.stringify(extra) : '';
  process.stderr.write(`[${now()}] ${msg}${tail}\n`);
}

// ---------------------------------------------------------------------------
// Endpoint helpers — route shapes VERIFIED LIVE against the host in Plan 04-01's
// probe and copied VERBATIM from chat-true-task-spike-probe.mjs (lines 198-244).
// Issue/agent COLLECTION routes are companyId-scoped
// (`/api/companies/{id}/issues`, `/api/companies/{id}/agents`), but per-issue
// SUB-routes are FLAT (`/api/issues/{id}`, `/api/issues/{id}/comments`,
// `/api/issues/{id}/wakeup`).
// ---------------------------------------------------------------------------

const C = () => encodeURIComponent(COMPANY_ID);
const I = (issueId) => encodeURIComponent(issueId);

function listAgents() {
  return call('GET', `/api/companies/${C()}/agents`);
}

function createIssue(payload) {
  // Collection route — companyId-scoped.
  return call('POST', `/api/companies/${C()}/issues`, payload);
}

function getIssue(issueId) {
  return call('GET', `/api/issues/${I(issueId)}`);
}

function updateIssue(issueId, patch) {
  // PATCH /api/issues/{id} — mirrors ctx.issues.update; the A1 status lever.
  return call('PATCH', `/api/issues/${I(issueId)}`, patch);
}

function listComments(issueId) {
  return call('GET', `/api/issues/${I(issueId)}/comments`);
}

function createComment(issueId, bodyText) {
  // POST /api/issues/{id}/comments — mirrors ctx.issues.createComment, the path
  // Phase 14 Send takes and the resume trigger under test.
  return call('POST', `/api/issues/${I(issueId)}/comments`, { body: bodyText });
}

function requestWakeup(issueId, opts) {
  // Capability `issues.wakeup` is declared in the manifest. Body shape mirrors
  // the SDK PluginIssuesClient.requestWakeup signature ({ reason, contextSource }).
  // D-08 rung 2 — EXPECTED HTTP 404 on this host from the REST-direct scope
  // (RESEARCH Pitfall 3); kept fire-and-forget, never blocked on.
  return call('POST', `/api/issues/${I(issueId)}/wakeup`, opts);
}

function listIssues(query) {
  // Build query string from { originKind, originId, status, ... } for the D-02
  // read-only scan.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null) qs.set(k, String(v));
  }
  const s = qs.toString();
  return call(
    'GET',
    `/api/companies/${C()}/issues${s ? `?${s}` : ''}`,
  );
}

/** Normalize an array-or-wrapped-array REST body into a plain array. */
function asArray(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.comments)) return body.comments;
  if (body && Array.isArray(body.documents)) return body.documents;
  if (body && Array.isArray(body.agents)) return body.agents;
  if (body && Array.isArray(body.issues)) return body.issues;
  return [];
}

/** Sanitize a free-text body for the findings doc — cap length, strip nulls. */
function truncBody(body, max = 200) {
  if (typeof body !== 'string') return body;
  return body.length > max ? body.slice(0, max) + '...[truncated]' : body;
}

/**
 * Poll listComments on `issueId` until a comment NOT already in `seenIds`
 * appears, or the time budget runs out. Returns { fresh, allComments }, or null.
 * Copied VERBATIM from chat-true-task-spike-probe.mjs (lines 268-292).
 */
async function pollForNewComment(issueId, seenIds, windowMs) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let res;
    try {
      res = await listComments(issueId);
    } catch (err) {
      log('pollForNewComment: listComments threw', { err: err.message });
      continue;
    }
    if (!ok(res.status)) {
      log('pollForNewComment: listComments non-2xx', { status: res.status });
      continue;
    }
    const comments = asArray(res.body);
    const fresh = comments.find((c) => c && c.id && !seenIds.has(c.id));
    if (fresh) return { fresh, allComments: comments };
    log('pollForNewComment: no new comment yet', {
      count: comments.length,
      remainingMs: deadline - Date.now(),
    });
  }
  return null;
}

// ===========================================================================
// dryConfirmA1A3 — Wave-0 cheap open questions (FILLED BY PLAN 10-02)
// ===========================================================================
//
// A1: create one [SPIKE 10]-tagged throwaway issue at status:'in_progress',
//     re-GET it (CAS guard — Pitfall 4), PATCH status:'blocked' via updateIssue
//     and re-GET to confirm whether the host accepts the bare status flip. If
//     rejected because blocked requires a non-empty blockedByIssueIds, record
//     that the host rule merges Shape B into Shape C (Assumption A1 mitigation).
// A3: attempt to mint a sacrificial agent via the REST agent-create route and
//     then delete it; record whether create+delete succeed via bearer-token
//     REST, or whether the operator must mint one manually (then pin
//     SPIKE_PROBE_AGENT_ID).
// Tears down the A1 throwaway issue + any A3 test agent at the end of the dry run.

async function dryConfirmA1A3(state) {
  const finding = {
    probe: 'DRY-CONFIRM-A1-A3',
    question:
      'A1: is status:\'blocked\' settable via PATCH /api/issues/{id}? A3: can the probe mint+delete a sacrificial agent via REST?',
    steps: [],
    a1: null, // { createHttpStatus, preFlipStatus, patchHttpStatus, reReadStatus, accepted, hostRule, shapeBMergesIntoC }
    a3: null, // { createHttpStatus, agentId, deleteHttpStatus, restCapable, fallback, pinnedAgentId }
    teardown: { issueDeleteHttpStatus: null, agentDeleteHttpStatus: null, residue: [] },
    verdictHint: null,
  };

  // -------------------------------------------------------------------------
  // A1 — is status:'blocked' settable via the declared issues.update cap?
  //
  // 1. Create one [SPIKE 10]-tagged throwaway issue at status:'in_progress'.
  // 2. Re-GET it (CAS guard — Pitfall 4 — read the freshly-observed status,
  //    never trust the PATCH/POST response body alone).
  // 3. PATCH status:'blocked' via updateIssue, then re-GET to confirm whether
  //    the host accepted the BARE status flip (read-back, not the PATCH echo).
  // 4. If rejected because blocked requires a non-empty blockedByIssueIds,
  //    record that the host rule merges Shape B into Shape C (A1 mitigation).
  // -------------------------------------------------------------------------
  const a1 = {
    createHttpStatus: null,
    preFlipStatus: null,
    patchHttpStatus: null,
    patchBodyError: null,
    reReadStatus: null,
    accepted: null,
    hostRule: null,
    shapeBMergesIntoC: null,
  };
  try {
    // BEAAA's POST /api/companies/{C}/issues validator REQUIRES assigneeAgentId
    // (the proven chat-true-task analog always assigns at create; omitting it
    // returns HTTP 422). Per A3 (agent-create is NOT reachable via bearer REST)
    // AND the D-02 / T-10-04 boundary (NEVER assign a throwaway to a real
    // in-flight production agent — sacrificial agent only), we assign ONLY to the
    // operator-minted sacrificial agent pinned via SPIKE_PROBE_AGENT_ID. We do
    // NOT auto-pick a real agent. With no pin, A1 stays inconclusive until the
    // operator mints ONE sacrificial agent and re-runs with the pin set.
    const a1Assignee = SPIKE_PROBE_AGENT_ID || null;
    finding.steps.push(
      `A1: assignee = ${a1Assignee ? `${a1Assignee} [SPIKE_PROBE_AGENT_ID]` : '(none — set SPIKE_PROBE_AGENT_ID to the manually-minted sacrificial agent)'}`,
    );

    let createRes;
    if (!a1Assignee) {
      createRes = {
        status: 0,
        body: {
          message:
            'skipped — no SPIKE_PROBE_AGENT_ID. BEAAA create requires assigneeAgentId; per D-02 the probe will NOT assign a throwaway to a real agent, and per A3 agents cannot be minted via REST. Operator mints ONE sacrificial agent and re-runs with SPIKE_PROBE_AGENT_ID set.',
        },
      };
    } else {
      createRes = await createIssue({
        title: `A1 blocked-status dry-confirm ${SPIKE_TAG}`,
        description: `Spike 10 Wave-0 A1 dry-confirm — is status:'blocked' settable via PATCH? ${REPLY_CHANNEL_INSTRUCTION} Safe to delete after the spike.`,
        status: 'in_progress',
        assigneeAgentId: a1Assignee,
      });
    }
    a1.createHttpStatus = createRes.status;
    finding.steps.push(`A1: create throwaway issue: HTTP ${createRes.status}`);
    if (!ok(createRes.status) || !createRes.body?.id) {
      const createErr =
        createRes.body && typeof createRes.body === 'object'
          ? createRes.body.error ?? createRes.body.message ?? truncBody(JSON.stringify(createRes.body), 300)
          : truncBody(createRes.body, 300);
      a1.hostRule = `issue create failed: HTTP ${createRes.status}${createErr ? ` (${createErr})` : ''}`;
      finding.steps.push(
        `A1: could not create the throwaway issue — A1 inconclusive${createErr ? `: ${createErr}` : ''}`,
      );
    } else {
      const issueId = createRes.body.id;
      state.a1ProbeIssueId = issueId;
      finding.steps.push(`A1: created throwaway issue ${issueId}`);

      // CAS guard (Pitfall 4) — re-read the issue and capture the fresh status
      // BEFORE the flip; never compute the flip from a stale read.
      const pre = await getIssue(issueId);
      a1.preFlipStatus = ok(pre.status) ? pre.body?.status ?? null : null;
      finding.steps.push(
        `A1: pre-flip re-GET: HTTP ${pre.status}, status=${a1.preFlipStatus ?? '(unknown)'}`,
      );

      // Attempt the BARE status flip to 'blocked' (declared issues.update).
      const patch = await updateIssue(issueId, { status: 'blocked' });
      a1.patchHttpStatus = patch.status;
      if (!ok(patch.status)) {
        // Capture the host's rejection verbatim — it may state the exact rule
        // (e.g. "blocked requires non-empty blockedByIssueIds").
        a1.patchBodyError =
          patch.body && typeof patch.body === 'object'
            ? patch.body.error ?? patch.body.message ?? truncBody(JSON.stringify(patch.body), 300)
            : truncBody(patch.body, 300);
      }
      finding.steps.push(
        `A1: PATCH {status:'blocked'}: HTTP ${patch.status}${a1.patchBodyError ? ` (${a1.patchBodyError})` : ''}`,
      );

      // Re-read to confirm what actually stuck (read-back — Pitfall 4: a PATCH
      // may return 200 yet the CAS guard silently no-op the flip).
      const post = await getIssue(issueId);
      a1.reReadStatus = ok(post.status) ? post.body?.status ?? null : null;
      finding.steps.push(
        `A1: post-flip re-GET: HTTP ${post.status}, status=${a1.reReadStatus ?? '(unknown)'}`,
      );

      a1.accepted = a1.reReadStatus === 'blocked';

      if (a1.accepted) {
        a1.hostRule = 'bare status flip to blocked accepted (no blocker edge required)';
        a1.shapeBMergesIntoC = false;
      } else {
        // The bare flip did not stick. Record the host rule from the rejection
        // body if present; otherwise note that blocked likely requires a
        // non-empty blockedByIssueIds (Shape B merges into Shape C — A1 mitigation).
        a1.hostRule =
          a1.patchBodyError ||
          `bare flip did not stick (read back '${a1.reReadStatus ?? 'unknown'}'); blocked likely requires a non-empty blockedByIssueIds`;
        a1.shapeBMergesIntoC = true;
        finding.steps.push(
          'A1: bare status:blocked flip NOT accepted — Shape B may merge into Shape C (set blockedByIssueIds at create instead)',
        );
      }

      // Teardown the A1 throwaway issue (delete by id, or note for the bookend
      // rollback if no REST delete route exists).
      const del = await call('DELETE', `/api/issues/${I(issueId)}`);
      finding.teardown.issueDeleteHttpStatus = del.status;
      finding.steps.push(`A1: teardown DELETE /api/issues/{id}: HTTP ${del.status}`);
      if (ok(del.status)) {
        state.a1ProbeIssueId = null;
      } else {
        finding.teardown.residue.push(
          `issue ${issueId} (${SPIKE_TAG}) — DELETE returned HTTP ${del.status}; remove via DO-backup rollback or manual delete`,
        );
      }
    }
  } catch (err) {
    a1.hostRule = `A1 probe threw: ${err.message}`;
    finding.steps.push(`A1: threw: ${err.message}`);
  }
  finding.a1 = a1;

  // -------------------------------------------------------------------------
  // A3 — can the probe mint AND delete a sacrificial agent via bearer REST?
  //
  // Attempt to create an agent via the company-scoped agent-create route, then
  // delete it. If create OR delete is unreachable via REST, record the
  // manual-mint fallback: the operator mints one agent manually before the run
  // and pins it via SPIKE_PROBE_AGENT_ID (NOT the Editor-Agent, NOT a real hire).
  // -------------------------------------------------------------------------
  const a3 = {
    createHttpStatus: null,
    createBodyError: null,
    agentId: null,
    deleteHttpStatus: null,
    restCapable: null,
    fallback: null,
    pinnedAgentId: SPIKE_PROBE_AGENT_ID || null,
  };
  try {
    const agentCreate = await call('POST', `/api/companies/${C()}/agents`, {
      name: `Spike10 Sacrificial Probe Agent ${SPIKE_TAG}`,
      role: 'individual_contributor',
      description: `Spike 10 sacrificial probe agent — created to test REST mint/delete (A3). Standard hire, no special privileges. Safe to terminate/delete after the spike.`,
    });
    a3.createHttpStatus = agentCreate.status;
    if (!ok(agentCreate.status)) {
      a3.createBodyError =
        agentCreate.body && typeof agentCreate.body === 'object'
          ? agentCreate.body.error ?? agentCreate.body.message ?? truncBody(JSON.stringify(agentCreate.body), 300)
          : truncBody(agentCreate.body, 300);
    }
    finding.steps.push(
      `A3: POST /api/companies/{C}/agents: HTTP ${agentCreate.status}${a3.createBodyError ? ` (${a3.createBodyError})` : ''}`,
    );

    if (ok(agentCreate.status) && agentCreate.body?.id) {
      a3.agentId = agentCreate.body.id;
      state.a3ProbeAgentId = a3.agentId;
      finding.steps.push(`A3: minted sacrificial agent ${a3.agentId}`);

      // Attempt to delete it again (the teardown half of A3).
      const agentDel = await call('DELETE', `/api/companies/${C()}/agents/${encodeURIComponent(a3.agentId)}`);
      a3.deleteHttpStatus = agentDel.status;
      finding.steps.push(
        `A3: DELETE /api/companies/{C}/agents/{id}: HTTP ${agentDel.status}`,
      );
      finding.teardown.agentDeleteHttpStatus = agentDel.status;

      if (ok(agentDel.status)) {
        a3.restCapable = true;
        a3.fallback = null;
        state.a3ProbeAgentId = null;
        finding.steps.push('A3: REST create+delete BOTH succeeded — probe can mint a sacrificial agent in Plan 10-02');
      } else {
        a3.restCapable = false;
        a3.fallback =
          'REST create succeeded but DELETE did not — operator must terminate/delete the minted agent manually (or DO-backup rollback). For Plan 10-02, prefer the manual-mint + SPIKE_PROBE_AGENT_ID pin path to avoid undeletable residue.';
        finding.teardown.residue.push(
          `agent ${a3.agentId} (${SPIKE_TAG}) — DELETE returned HTTP ${agentDel.status}; terminate/delete manually or via DO-backup rollback`,
        );
        finding.steps.push('A3: create OK but delete FAILED — see fallback');
      }
    } else {
      // Create is not reachable via the bearer REST surface.
      a3.restCapable = false;
      a3.fallback =
        'Agent create is NOT reachable via bearer REST. The operator must mint ONE sacrificial agent manually before the Plan 10-02 run (NOT the Editor-Agent, NOT a real hire) and pin it via SPIKE_PROBE_AGENT_ID; teardown is operator-side (pause then terminate/delete), with the DO-backup rollback as the safety net.';
      finding.steps.push('A3: agent create NOT reachable via REST — manual-mint fallback documented');
    }
  } catch (err) {
    a3.restCapable = false;
    a3.fallback = `A3 probe threw (${err.message}); treat as REST-incapable — operator mints manually and pins SPIKE_PROBE_AGENT_ID.`;
    finding.steps.push(`A3: threw: ${err.message}`);
  }
  finding.a3 = a3;

  // Verdict hint — summarize both answers for the findings doc.
  const a1Verdict =
    a1.accepted === true
      ? "A1=SETTABLE (bare PATCH {status:'blocked'} sticks — Shape B is independent of Shape C)"
      : a1.accepted === false
        ? 'A1=NOT-SETTABLE (Shape B merges into Shape C — set blockedByIssueIds at create)'
        : 'A1=INCONCLUSIVE';
  const a3Verdict =
    a3.restCapable === true
      ? 'A3=REST-CAPABLE (probe mints+deletes its own sacrificial agent)'
      : a3.restCapable === false
        ? 'A3=MANUAL-MINT (operator mints + pins SPIKE_PROBE_AGENT_ID)'
        : 'A3=INCONCLUSIVE';
  finding.verdictHint = `${a1Verdict}; ${a3Verdict}`;

  return finding;
}

// ===========================================================================
// observeRealBlockedItems — D-02 read-only fidelity scan (FILLED BY PLAN 10-02)
// ===========================================================================
//
// Via listIssues, scan for REAL BEAAA blocked items READ-ONLY (D-02 — never
// write to them) and record, per shape, one real example's status string +
// relation shape so Plan 10-02's construction is confirmed to match what BEAAA
// actually produces (Pitfall 6 / Open Question 2). If BEAAA produces no real
// item of a given shape, record that explicitly (e.g. real blocks are all
// in_progress-awaiting, making Shape B academic).

async function observeRealBlockedItems(state) {
  const finding = {
    probe: 'OBSERVE-REAL-BLOCKED-ITEMS',
    question:
      'D-02: does the probe construction per shape match what real BEAAA blocked items look like (status string + relation shape)?',
    steps: [],
    scanned: 0,
    statusHistogram: {}, // status string -> count, across the scanned sample
    shapeA: null, // awaiting-answer real example, or { present: false }
    shapeB: null, // status='blocked' real example, or { present: false }
    shapeC: null, // blockedByIssueIds relation real example, or { present: false }
    verdictHint: null,
  };

  // READ-ONLY (D-02 absolute): scan the live board via listIssues and classify
  // real items by shape. NEVER write to any real item here — only listIssues +
  // getIssue reads. Bound the scan so the probe never hammers the host.
  //
  //   Shape A — awaiting-answer: status='in_progress' (04.1-01 OQ1: agents leave
  //             topics at in_progress; "awaiting" is semantic, not a status).
  //   Shape B — status='blocked' (the terminal status in TERMINAL_OR_BLOCKED_STATUSES).
  //   Shape C — a non-empty blockedByIssueIds relation (dependency edge).
  const SCAN_CAP = 200; // bound the read-only scan

  /** Summarize one real item READ-ONLY into a shape-evidence record. */
  function realItemEvidence(it) {
    const blockedBy =
      (Array.isArray(it?.blockedByIssueIds) && it.blockedByIssueIds) ||
      (Array.isArray(it?.blocked_by_issue_ids) && it.blocked_by_issue_ids) ||
      [];
    return {
      present: true,
      issueId: it?.id ?? null,
      identifier: it?.identifier ?? null,
      status: it?.status ?? null,
      assigneeAgentId: it?.assigneeAgentId ?? it?.assignee_agent_id ?? null,
      blockedByIssueIds: blockedBy,
      titleExcerpt: truncBody(it?.title ?? '', 120),
    };
  }

  try {
    // Pull a bounded sample of the company's issues. The REST origin filters are
    // known-broken (04.1-01 OQ2 WEAK-REST-LIMIT), so we scan unfiltered and
    // classify client-side — read-only, no mutation.
    let sample = [];
    try {
      const res = await listIssues({ limit: SCAN_CAP });
      if (ok(res.status)) {
        sample = asArray(res.body).slice(0, SCAN_CAP);
        finding.steps.push(
          `listIssues (read-only) returned ${asArray(res.body).length} rows; scanning up to ${SCAN_CAP}`,
        );
      } else {
        finding.steps.push(`listIssues non-2xx: ${res.status}; D-02 scan limited`);
      }
    } catch (err) {
      finding.steps.push(`listIssues threw: ${err.message}`);
    }
    finding.scanned = sample.length;

    // Build a status histogram (answers Open Question 2: does BEAAA produce
    // status='blocked' at all, or are real blocks all in_progress-awaiting?).
    for (const it of sample) {
      const s = it?.status ?? '(none)';
      finding.statusHistogram[s] = (finding.statusHistogram[s] || 0) + 1;
    }

    // Shape B — first real item with status === 'blocked'.
    const realBlocked = sample.find((it) => it?.status === 'blocked');
    if (realBlocked) {
      finding.shapeB = realItemEvidence(realBlocked);
      finding.steps.push(
        `Shape B: found real status='blocked' item ${finding.shapeB.identifier ?? finding.shapeB.issueId}`,
      );
    } else {
      finding.shapeB = {
        present: false,
        note:
          "no real status='blocked' item in the scanned sample — on BEAAA real blocks may all be in_progress-awaiting (Shape B academic; Shape A carries DO-03 — Open Question 2)",
      };
      finding.steps.push("Shape B: NO real status='blocked' item observed in the sample");
    }

    // Shape C — first real item with a non-empty blockedByIssueIds relation.
    const realRelation = sample.find((it) => {
      const b =
        (Array.isArray(it?.blockedByIssueIds) && it.blockedByIssueIds) ||
        (Array.isArray(it?.blocked_by_issue_ids) && it.blocked_by_issue_ids) ||
        [];
      return b.length > 0;
    });
    if (realRelation) {
      finding.shapeC = realItemEvidence(realRelation);
      finding.steps.push(
        `Shape C: found real blockedByIssueIds relation on ${finding.shapeC.identifier ?? finding.shapeC.issueId} (${finding.shapeC.blockedByIssueIds.length} blocker(s))`,
      );
    } else {
      // The list payload may not include the relation; do one read-only getIssue
      // on a candidate to confirm the relation field is simply absent from list,
      // not absent from the data model.
      let confirmed = false;
      const candidate = sample.find((it) => it?.id);
      if (candidate?.id) {
        try {
          const full = await getIssue(candidate.id);
          if (ok(full.status)) {
            const b =
              (Array.isArray(full.body?.blockedByIssueIds) && full.body.blockedByIssueIds) ||
              (Array.isArray(full.body?.blocked_by_issue_ids) && full.body.blocked_by_issue_ids) ||
              [];
            confirmed = true;
            finding.steps.push(
              `Shape C: read-only getIssue on ${candidate.id} — blockedByIssueIds present in detail body: ${b.length > 0 ? 'yes' : 'empty'}`,
            );
            if (b.length > 0) {
              finding.shapeC = realItemEvidence(full.body);
            }
          }
        } catch (err) {
          finding.steps.push(`Shape C: getIssue probe threw: ${err.message}`);
        }
      }
      if (!finding.shapeC) {
        finding.shapeC = {
          present: false,
          note: confirmed
            ? 'no real blockedByIssueIds relation in the scanned sample (detail body confirms the field exists but is empty on the candidate) — construct Shape C synthetically at create time (Open Question 3)'
            : 'no real blockedByIssueIds relation observed in the scanned sample; the list payload may omit the relation field — Plan 10-02 should re-confirm via getIssue on a known dependency edge if one exists',
        };
        finding.steps.push('Shape C: NO real blockedByIssueIds relation observed in the sample');
      }
    }

    // Shape A — first real in_progress item (awaiting-answer is semantic, so an
    // in_progress assigned item is the closest real-shape match). Prefer one
    // assigned to an agent (the awaiting-an-answer condition needs an assignee).
    const realInProgress =
      sample.find(
        (it) =>
          it?.status === 'in_progress' &&
          (it?.assigneeAgentId || it?.assignee_agent_id),
      ) || sample.find((it) => it?.status === 'in_progress');
    if (realInProgress) {
      finding.shapeA = realItemEvidence(realInProgress);
      finding.shapeA.note =
        '"awaiting reply" is semantic (agent asked a question, parked at in_progress); status stays in_progress (04.1-01 OQ1). This real in_progress item is the closest shape match.';
      finding.steps.push(
        `Shape A: found real in_progress item ${finding.shapeA.identifier ?? finding.shapeA.issueId}`,
      );
    } else {
      finding.shapeA = {
        present: false,
        note: 'no real in_progress item in the scanned sample — unexpected; widen the scan or re-confirm at run time',
      };
      finding.steps.push('Shape A: NO real in_progress item observed in the sample');
    }

    // Verdict hint — does the probe construction per shape match real BEAAA?
    const aMatch = finding.shapeA?.present ? 'A=matches(in_progress-awaiting)' : 'A=absent';
    const bMatch = finding.shapeB?.present
      ? 'B=matches(real status=blocked exists)'
      : 'B=academic(no real status=blocked on BEAAA)';
    const cMatch = finding.shapeC?.present
      ? 'C=matches(real blockedByIssueIds relation exists)'
      : 'C=construct-synthetically(no real relation in sample)';
    finding.verdictHint = `D-02 read-only fidelity: ${aMatch}; ${bMatch}; ${cMatch}. READ-ONLY — zero writes to real items.`;
  } catch (err) {
    finding.steps.push(`observeRealBlockedItems threw: ${err.message}`);
    finding.verdictHint = 'INCONCLUSIVE — D-02 scan error';
  }

  void state;
  return finding;
}

// ===========================================================================
// probeShapeA — awaiting-reply resume (FILLED BY PLAN 10-02)
// ===========================================================================
//
// Construct: create issue status:'in_progress', assign to the sacrificial probe
// agent, post a question comment + REPLY_CHANNEL_INSTRUCTION, let the agent run
// and park. Then COMMENT-ALONE (the resume trigger) and observe the three
// signals (behavioral / consumption / state) within the bounded window. Extends
// the proven 04.1-01 PASS-NATIVE result to the awaiting-answer condition.

// ---------------------------------------------------------------------------
// Shared three-signal helpers (used by probeShapeA / B / C). Each shape judges
// resume by the D-07 triad: behavioral (a NEW agent comment), consumption (a
// FRESH createdByRunId on that comment, distinct from the run(s) that produced
// the question), and state (issue status off blocked/awaiting). Signal 3 alone
// is necessary-but-not-sufficient (Pitfall 2 — disposition-recovery false-pass).
// ---------------------------------------------------------------------------

/** True when a comment row was authored by the probe agent (not system/human). */
function isAgentComment(c, probeAgentId) {
  if (!c) return false;
  if (c.authorType === 'agent') return true;
  const a = c.authorAgentId ?? c.author_agent_id ?? null;
  return !!(probeAgentId && a && a === probeAgentId);
}

/** True when a comment row is a host system_notice (disposition-recovery). */
function isSystemNotice(c) {
  if (!c) return false;
  if (c.authorType === 'system') return true;
  const kind = c.presentation?.kind ?? c.presentation_kind ?? null;
  return kind === 'system_notice';
}

/** Pull createdByRunId off a comment row across the snake/camel variants. */
function runIdOf(c) {
  return (c && (c.createdByRunId ?? c.created_by_run_id)) || null;
}

/** Read the agent's status via the company-scoped roster (Pitfall 6 / A6). */
async function getAgentStatus(probeAgentId) {
  if (!probeAgentId) return null;
  try {
    const res = await listAgents();
    if (!ok(res.status)) return null;
    const a = asArray(res.body).find((x) => x && x.id === probeAgentId);
    return a ? a.status ?? null : null;
  } catch (err) {
    log('getAgentStatus threw', { err: err.message });
    return null;
  }
}

/**
 * Poll issue status across a window, recording the full transition list (04.1
 * OQ1 pattern). Returns { transitions:[{at,status}], finalStatus }. READ-ONLY.
 */
async function pollIssueStatus(issueId, baselineStatus, windowMs) {
  const transitions = [];
  let last = baselineStatus ?? null;
  if (last != null) transitions.push({ at: now(), status: last });
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let res;
    try {
      res = await getIssue(issueId);
    } catch (err) {
      log('pollIssueStatus: getIssue threw', { err: err.message });
      continue;
    }
    if (!ok(res.status)) continue;
    const s = res.body?.status ?? null;
    if (s !== last) {
      transitions.push({ at: now(), status: s });
      last = s;
    }
  }
  return { transitions, finalStatus: last };
}

/**
 * The core three-signal observation. Posts no comment itself — the caller has
 * already taken the resume action (comment / transition). Concurrently polls
 * for a NEW non-system agent comment (behavioral + consumption) and the issue
 * status transition (state) within `windowMs`. `knownRunIds` are the run ids
 * already seen BEFORE the resume action — a reply whose createdByRunId is in
 * that set is NOT fresh consumption.
 *
 * Returns { behavioral, consumption, state, evidence } where evidence carries
 * the commentId, createdByRunId, status transition list, and any system_notice
 * seen (the disposition-recovery false-pass marker, Pitfall 2).
 */
async function observeThreeSignals(issueId, {
  seenIds,
  knownRunIds,
  probeAgentId,
  baselineStatus,
  blockedStatuses,
  windowMs,
}) {
  const evidence = {
    behavioralCommentId: null,
    behavioralAuthorType: null,
    consumptionRunId: null,
    statusTransitions: [],
    finalStatus: null,
    systemNoticeSeen: null,
  };

  // Run both observations concurrently so neither starves the window.
  const [commentResult, statusResult] = await Promise.all([
    pollForNewComment(issueId, seenIds, windowMs),
    pollIssueStatus(issueId, baselineStatus, windowMs),
  ]);

  evidence.statusTransitions = statusResult.transitions;
  evidence.finalStatus = statusResult.finalStatus;

  let behavioral = false;
  let consumption = false;
  if (commentResult && commentResult.fresh) {
    const fresh = commentResult.fresh;
    if (isSystemNotice(fresh)) {
      // Host disposition-recovery — NOT an agent resume (Pitfall 2 marker).
      evidence.systemNoticeSeen = {
        commentId: fresh.id ?? null,
        body: truncBody(fresh.body ?? '', 160),
        runId: runIdOf(fresh),
      };
    }
    if (isAgentComment(fresh, probeAgentId)) {
      behavioral = true;
      evidence.behavioralCommentId = fresh.id ?? null;
      evidence.behavioralAuthorType = fresh.authorType ?? null;
      const rid = runIdOf(fresh);
      evidence.consumptionRunId = rid;
      // Consumption = the reply rode a FRESH run id (A2 — distinct from the
      // run(s) that produced the question / any pre-existing run).
      consumption = !!rid && !(knownRunIds && knownRunIds.has(rid));
    } else if (!evidence.systemNoticeSeen) {
      // A fresh non-agent, non-system comment — still record it for audit.
      evidence.behavioralCommentId = fresh.id ?? null;
      evidence.behavioralAuthorType = fresh.authorType ?? null;
    }
  }

  // State = the issue moved off the blocked/awaiting set across the window.
  const blocked = blockedStatuses || new Set(['blocked']);
  const finalOffBlocked =
    evidence.finalStatus != null && !blocked.has(evidence.finalStatus);
  const everOffBlocked = evidence.statusTransitions.some(
    (t) => t.status != null && !blocked.has(t.status),
  );
  // Shape A starts at in_progress (not in blocked set); "state" there means the
  // status stayed non-blocked through a fresh agent run. For B/C it means the
  // terminal status was actually shed.
  const state = finalOffBlocked || everOffBlocked;

  return { behavioral, consumption, state, evidence };
}

/** Combine the three signals into PASS / PARTIAL / FAIL (D-07). */
function verdictFromSignals(behavioral, consumption, state) {
  if (behavioral && consumption && state) return 'PASS';
  // State flipped but no fresh agent run = host disposition-recovery, not a
  // resume (Pitfall 2). Any partial corroboration short of all-three is PARTIAL.
  if (state || behavioral || consumption) return 'PARTIAL';
  return 'FAIL';
}

/**
 * Seed the set of run ids already present on an issue's comments BEFORE the
 * resume action, so a later reply's createdByRunId can be judged "fresh".
 * Also seeds `seenIds` with the existing comment ids. READ-ONLY.
 */
async function seedSeenAndRuns(issueId, seenIds, knownRunIds) {
  try {
    const res = await listComments(issueId);
    if (ok(res.status)) {
      for (const c of asArray(res.body)) {
        if (c && c.id) seenIds.add(c.id);
        const rid = runIdOf(c);
        if (rid) knownRunIds.add(rid);
      }
    }
  } catch (err) {
    log('seedSeenAndRuns threw', { err: err.message });
  }
}

async function probeShapeA(state) {
  const finding = {
    probe: 'PROBE-SHAPE-A',
    question:
      'Shape A (awaiting reply): does a comment alone resume an agent that asked a question and parked?',
    steps: [],
    construction: [],
    probeIssueId: null,
    signals: { behavioral: null, consumption: null, state: null },
    evidence: null,
    ladderRungsTried: [],
    minimalRecipe: null,
    verdictHint: 'STUB — filled by Plan 10-02',
  };

  if (!SPIKE_PROBE_AGENT_ID) {
    finding.verdictHint =
      'SKIPPED — SPIKE_PROBE_AGENT_ID not set; the three-shape run is gated behind the pinned sacrificial agent (D-02).';
    finding.steps.push('Shape A skipped — no SPIKE_PROBE_AGENT_ID');
    return finding;
  }

  try {
    // ----------------------------------------------------------------------
    // CONSTRUCT — create an in_progress issue assigned to the probe agent and
    // post a question + the reply-channel instruction. Let the agent run, ask,
    // and park (awaiting an answer — the primary DO-03 case).
    // ----------------------------------------------------------------------
    const create = await createIssue({
      title: `Shape A awaiting-reply probe ${SPIKE_TAG}`,
      description: `Spike 10 Shape A — agent asks a question then parks awaiting a human answer. ${REPLY_CHANNEL_INSTRUCTION} Safe to delete after the spike.`,
      status: 'in_progress',
      assigneeAgentId: SPIKE_PROBE_AGENT_ID,
      originKind: 'plugin:clarity-pack',
      originId: `spike-shapeA:${Date.now()}`,
    });
    finding.construction.push(`createIssue (in_progress, assigned to probe): HTTP ${create.status}`);
    if (!ok(create.status) || !create.body?.id) {
      finding.verdictHint = 'FAIL — could not create the Shape A probe issue';
      finding.steps.push(`Shape A: create failed HTTP ${create.status}`);
      return finding;
    }
    const issueId = create.body.id;
    finding.probeIssueId = issueId;
    state.shapeAProbeIssueId = issueId;
    finding.steps.push(`created Shape A probe issue ${issueId}`);

    // Post the question comment that asks the agent to pose a decision and park.
    const seen = new Set();
    const knownRuns = new Set();
    const q = await createComment(
      issueId,
      `Spike 10 Shape A: in one sentence, ask me the single question you most need answered to proceed, then stop and wait. ${REPLY_CHANNEL_INSTRUCTION}`,
    );
    finding.construction.push(`createComment (question): HTTP ${q.status}`);
    if (q.body?.id) seen.add(q.body.id);

    // Let the agent run + ask its question (behavioral turn 1). Bounded wait so
    // the agent genuinely parks awaiting-answer before we post the resume reply.
    finding.steps.push('awaiting the agent question turn (parks awaiting-answer)');
    const askedQuestion = await pollForNewComment(issueId, seen, FIRST_REPLY_WINDOW_MS);
    if (askedQuestion && askedQuestion.fresh) {
      const qc = askedQuestion.fresh;
      if (qc.id) seen.add(qc.id);
      const qRun = runIdOf(qc);
      if (qRun) knownRuns.add(qRun); // the question run is NOT fresh consumption
      finding.steps.push(
        `agent question turn observed (comment ${qc.id}, runId ${qRun ?? '(none)'})`,
      );
    } else {
      // Pitfall 5 — if the agent never ran, check for a budget/invocation block
      // before treating this as a resume FAIL.
      const agentStatus = await getAgentStatus(SPIKE_PROBE_AGENT_ID);
      finding.steps.push(
        `agent never produced a question turn in ${FIRST_REPLY_WINDOW_MS / 60000}min — agent status=${agentStatus ?? '(unknown)'}; check for a budget/invocation-block incident before declaring FAIL`,
      );
    }
    // Seed any other pre-existing runs so the resume reply's run id is judged fresh.
    await seedSeenAndRuns(issueId, seen, knownRuns);

    // ----------------------------------------------------------------------
    // RESUME — Rung 0: comment alone (the proven Shape-A baseline). Post the
    // answer, then run the three-signal observation.
    // ----------------------------------------------------------------------
    finding.ladderRungsTried.push('rung0:comment-alone');
    const baseline = await getIssue(issueId);
    const baselineStatus = ok(baseline.status) ? baseline.body?.status ?? null : null;
    const answer = await createComment(
      issueId,
      'Spike 10 Shape A: here is your answer — proceed. Reply with your next concrete step as a COMMENT on this issue.',
    );
    finding.steps.push(`posted answer comment (rung 0): HTTP ${answer.status}`);
    if (answer.body?.id) seen.add(answer.body.id);

    const obs = await observeThreeSignals(issueId, {
      seenIds: seen,
      knownRunIds: knownRuns,
      probeAgentId: SPIKE_PROBE_AGENT_ID,
      baselineStatus,
      blockedStatuses: new Set(['blocked']), // Shape A: in_progress is "off-blocked"
      windowMs: FIRST_REPLY_WINDOW_MS,
    });
    finding.signals = {
      behavioral: obs.behavioral,
      consumption: obs.consumption,
      state: obs.state,
    };
    finding.evidence = obs.evidence;

    let verdict = verdictFromSignals(obs.behavioral, obs.consumption, obs.state);
    if (verdict === 'PASS') {
      finding.minimalRecipe = 'comment-alone (rung 0) — native wake resumes an awaiting-answer agent';
    } else if (obs.evidence.systemNoticeSeen && !obs.behavioral) {
      finding.steps.push(
        'state moved via host disposition-recovery (system_notice), no fresh agent run — PARTIAL not PASS (Pitfall 2)',
      );
    }
    finding.verdictHint = `${verdict} — behavioral=${obs.behavioral} consumption=${obs.consumption} state=${obs.state}`;
  } catch (err) {
    finding.steps.push(`Shape A threw: ${err.message}`);
    finding.verdictHint = `FAIL — Shape A threw: ${err.message}`;
  }
  return finding;
}

// ===========================================================================
// probeShapeB — status='blocked' resume (FILLED BY PLAN 10-02)
// ===========================================================================
//
// Construct: create + assign, then drive INTO status:'blocked' via updateIssue
// (the genuine unknown — the host may refuse to dispatch a heartbeat to a
// terminal-status issue). Test comment-alone; if it fails, escalate the D-08
// ladder one rung at a time (rung 1: updateIssue {status:'in_progress'} to
// un-terminal, then re-test). Record the exact required ordering.

async function probeShapeB(state) {
  const finding = {
    probe: 'PROBE-SHAPE-B',
    question:
      'Shape B (status=blocked): does a comment alone resume a terminal-blocked issue, or is an un-terminal status flip required (and in which order)?',
    steps: [],
    construction: [],
    probeIssueId: null,
    blockedVia: null, // 'bare-status-flip' | 'blockedByIssueIds-edge' (runtime-determined)
    shapeBMergesIntoC: null,
    signals: { behavioral: null, consumption: null, state: null },
    ladderRungsTried: [],
    ladderResults: [], // { rung, ordering, signals, verdict }
    minimalRecipe: null,
    requestWakeupHttpStatus: null,
    agentStatusAtBlock: null,
    verdictHint: 'STUB — filled by Plan 10-02',
  };

  if (!SPIKE_PROBE_AGENT_ID) {
    finding.verdictHint =
      'SKIPPED — SPIKE_PROBE_AGENT_ID not set; the three-shape run is gated behind the pinned sacrificial agent (D-02).';
    finding.steps.push('Shape B skipped — no SPIKE_PROBE_AGENT_ID');
    return finding;
  }

  // The blocked-status set for the "state" signal: B must shed BOTH the
  // terminal 'blocked' AND stay off it for a real resume.
  const BLOCKED = new Set(['blocked']);

  try {
    // ----------------------------------------------------------------------
    // CONSTRUCT — create + assign, then drive into status:'blocked'. The A1
    // result (whether the BARE flip sticks) is UNKNOWN at code time (Plan 10-01
    // not closed), so probeShapeB is SELF-DETERMINING at runtime: attempt the
    // bare flip, re-GET to see if it stuck, and branch.
    // ----------------------------------------------------------------------
    const create = await createIssue({
      title: `Shape B blocked-status probe ${SPIKE_TAG}`,
      description: `Spike 10 Shape B — terminal status='blocked'. ${REPLY_CHANNEL_INSTRUCTION} Safe to delete after the spike.`,
      status: 'in_progress',
      assigneeAgentId: SPIKE_PROBE_AGENT_ID,
      originKind: 'plugin:clarity-pack',
      originId: `spike-shapeB:${Date.now()}`,
    });
    finding.construction.push(`createIssue (in_progress, assigned): HTTP ${create.status}`);
    if (!ok(create.status) || !create.body?.id) {
      finding.verdictHint = 'FAIL — could not create the Shape B probe issue';
      finding.steps.push(`Shape B: create failed HTTP ${create.status}`);
      return finding;
    }
    const issueId = create.body.id;
    finding.probeIssueId = issueId;
    state.shapeBProbeIssueId = issueId;
    finding.steps.push(`created Shape B probe issue ${issueId}`);

    // CAS guard (Pitfall 4) — re-GET before the flip; never compute from a stale read.
    const pre = await getIssue(issueId);
    const preStatus = ok(pre.status) ? pre.body?.status ?? null : null;
    finding.construction.push(`pre-flip re-GET: HTTP ${pre.status}, status=${preStatus ?? '(unknown)'}`);

    // Attempt the BARE flip to 'blocked' (declared issues.update).
    const flip = await updateIssue(issueId, { status: 'blocked' });
    finding.construction.push(`PATCH {status:'blocked'} (bare): HTTP ${flip.status}`);
    // Read-back (Pitfall 4) — a PATCH may 200 yet CAS-lose the flip.
    const postFlip = await getIssue(issueId);
    const postFlipStatus = ok(postFlip.status) ? postFlip.body?.status ?? null : null;
    finding.construction.push(`post-flip re-GET: HTTP ${postFlip.status}, status=${postFlipStatus ?? '(unknown)'}`);

    if (postFlipStatus === 'blocked') {
      finding.blockedVia = 'bare-status-flip';
      finding.shapeBMergesIntoC = false;
      finding.steps.push("bare status:'blocked' flip STUCK — Shape B is independent of Shape C");
    } else {
      // The bare flip did NOT stick — blocked likely requires a non-empty
      // blockedByIssueIds. Establish a blocker edge at create on a fresh issue
      // (legal via issues.create, NO relations.write) and record the merge.
      finding.shapeBMergesIntoC = true;
      finding.steps.push(
        `bare flip did not stick (read back '${postFlipStatus ?? 'unknown'}') — establishing a blocker edge at create (Shape B merges into Shape C)`,
      );
      // Create a throwaway blocker, then a fresh blocked issue with the edge set.
      const blocker = await createIssue({
        title: `Shape B blocker (edge) ${SPIKE_TAG}`,
        status: 'in_progress',
        assigneeAgentId: SPIKE_PROBE_AGENT_ID,
        originKind: 'plugin:clarity-pack',
        originId: `spike-shapeB-blocker:${Date.now()}`,
      });
      finding.construction.push(`createIssue blocker (for edge): HTTP ${blocker.status}`);
      if (ok(blocker.status) && blocker.body?.id) {
        state.shapeBBlockerIssueId = blocker.body.id;
        const blockedEdge = await createIssue({
          title: `Shape B blocked-via-edge probe ${SPIKE_TAG}`,
          description: `Spike 10 Shape B (merged into C). ${REPLY_CHANNEL_INSTRUCTION} Safe to delete.`,
          status: 'in_progress',
          assigneeAgentId: SPIKE_PROBE_AGENT_ID,
          blockedByIssueIds: [blocker.body.id],
          originKind: 'plugin:clarity-pack',
          originId: `spike-shapeB-edge:${Date.now()}`,
        });
        finding.construction.push(
          `createIssue blocked-via-edge (blockedByIssueIds set at create): HTTP ${blockedEdge.status}`,
        );
        if (ok(blockedEdge.status) && blockedEdge.body?.id) {
          // Re-point the probe at the edge-blocked issue and try to flip status too.
          finding.probeIssueId = blockedEdge.body.id;
          state.shapeBProbeIssueId = blockedEdge.body.id;
          finding.blockedVia = 'blockedByIssueIds-edge';
          const edgeFlip = await updateIssue(blockedEdge.body.id, { status: 'blocked' });
          finding.construction.push(`PATCH {status:'blocked'} on edge issue: HTTP ${edgeFlip.status}`);
          const edgePost = await getIssue(blockedEdge.body.id);
          finding.construction.push(
            `edge issue re-GET: HTTP ${edgePost.status}, status=${ok(edgePost.status) ? edgePost.body?.status ?? '(unknown)' : '(unknown)'}`,
          );
        }
      }
    }

    const probeIssueId = finding.probeIssueId;

    // Distinguish "issue blocked" from "agent paused" (Pitfall 6 / A6) — record
    // the agent status while the issue is blocked; rung 3 is only relevant if paused.
    finding.agentStatusAtBlock = await getAgentStatus(SPIKE_PROBE_AGENT_ID);
    finding.steps.push(`agent status while issue blocked: ${finding.agentStatusAtBlock ?? '(unknown)'}`);

    // ----------------------------------------------------------------------
    // D-08 LADDER — climb minimal-first; lock the FIRST rung where all three
    // signals fire. Re-observe after each rung. FAIL only after the full window.
    // ----------------------------------------------------------------------
    let locked = null;

    // Run one ladder attempt: set up seen/run baselines, take the rung action,
    // observe three signals, record the result.
    async function attemptRung(label, ordering, action) {
      finding.ladderRungsTried.push(label);
      const seen = new Set();
      const knownRuns = new Set();
      await seedSeenAndRuns(probeIssueId, seen, knownRuns);
      const baseRead = await getIssue(probeIssueId);
      const baseStatus = ok(baseRead.status) ? baseRead.body?.status ?? null : null;
      await action(seen, knownRuns, baseStatus);
      const obs = await observeThreeSignals(probeIssueId, {
        seenIds: seen,
        knownRunIds: knownRuns,
        probeAgentId: SPIKE_PROBE_AGENT_ID,
        baselineStatus: baseStatus,
        blockedStatuses: BLOCKED,
        windowMs: RE_WAKE_WINDOW_MS,
      });
      const verdict = verdictFromSignals(obs.behavioral, obs.consumption, obs.state);
      finding.ladderResults.push({
        rung: label,
        ordering,
        signals: {
          behavioral: obs.behavioral,
          consumption: obs.consumption,
          state: obs.state,
        },
        evidence: obs.evidence,
        verdict,
      });
      finding.steps.push(`${label} [${ordering}]: ${verdict} (b=${obs.behavioral} c=${obs.consumption} s=${obs.state})`);
      if (obs.evidence.systemNoticeSeen && !obs.behavioral) {
        finding.steps.push(`${label}: state moved via host disposition-recovery only — PARTIAL not PASS (Pitfall 2)`);
      }
      return { obs, verdict };
    }

    // Rung 0 — comment alone on the blocked issue (the resume trigger under test).
    {
      const { obs, verdict } = await attemptRung(
        'rung0:comment-alone',
        'comment-only',
        async (seen) => {
          const c = await createComment(
            probeIssueId,
            'Spike 10 Shape B (rung 0): here is your answer — proceed. Reply with your next step as a COMMENT.',
          );
          if (c.body?.id) seen.add(c.body.id);
        },
      );
      if (verdict === 'PASS') {
        locked = { rung: 'rung0:comment-alone', ordering: 'comment-only', signals: obs };
      }
    }

    // Rung 1 — + issues.update({status:'in_progress'}) to un-terminal. Test BOTH
    // orderings (flip-before-comment AND flip-after) and record which works.
    if (!locked) {
      // Ordering A: flip-BEFORE-comment.
      const a = await attemptRung(
        'rung1:flip-before-comment',
        'flip-before-comment',
        async (seen) => {
          // CAS guard — re-GET immediately before the flip.
          const fresh = await getIssue(probeIssueId);
          finding.steps.push(
            `rung1A pre-flip re-GET: status=${ok(fresh.status) ? fresh.body?.status ?? '(unknown)' : '(unknown)'}`,
          );
          const up = await updateIssue(probeIssueId, { status: 'in_progress' });
          finding.steps.push(`rung1A PATCH {status:'in_progress'}: HTTP ${up.status}`);
          const c = await createComment(
            probeIssueId,
            'Spike 10 Shape B (rung 1, flip-before): un-terminalled then answering — proceed. Reply as a COMMENT.',
          );
          if (c.body?.id) seen.add(c.body.id);
        },
      );
      if (a.verdict === 'PASS') {
        locked = { rung: 'rung1:flip-before-comment', ordering: 'flip-before-comment', signals: a.obs };
      } else {
        // Re-block before testing the other ordering, if it can be re-blocked.
        if (finding.blockedVia === 'bare-status-flip') {
          const reblockFresh = await getIssue(probeIssueId);
          void reblockFresh;
          const reblock = await updateIssue(probeIssueId, { status: 'blocked' });
          finding.steps.push(`re-block before rung1B: PATCH {status:'blocked'} HTTP ${reblock.status}`);
        }
        // Ordering B: flip-AFTER-comment.
        const b = await attemptRung(
          'rung1:flip-after-comment',
          'flip-after-comment',
          async (seen) => {
            const c = await createComment(
              probeIssueId,
              'Spike 10 Shape B (rung 1, flip-after): answering, then un-terminalling — proceed. Reply as a COMMENT.',
            );
            if (c.body?.id) seen.add(c.body.id);
            const fresh = await getIssue(probeIssueId);
            finding.steps.push(
              `rung1B pre-flip re-GET: status=${ok(fresh.status) ? fresh.body?.status ?? '(unknown)' : '(unknown)'}`,
            );
            const up = await updateIssue(probeIssueId, { status: 'in_progress' });
            finding.steps.push(`rung1B PATCH {status:'in_progress'}: HTTP ${up.status}`);
          },
        );
        if (b.verdict === 'PASS') {
          locked = { rung: 'rung1:flip-after-comment', ordering: 'flip-after-comment', signals: b.obs };
        }
      }
    }

    // Rung 2 — + requestWakeup. EXPECTED 404 from REST (Pitfall 3); fire-and-forget,
    // NOT a FAIL. Record the HTTP status verbatim.
    if (!locked) {
      const b2 = await attemptRung(
        'rung2:requestWakeup',
        'comment+requestWakeup',
        async (seen) => {
          // Un-terminal first (best-effort) so the host can dispatch.
          if (finding.blockedVia === 'bare-status-flip') {
            await updateIssue(probeIssueId, { status: 'in_progress' });
          }
          const c = await createComment(
            probeIssueId,
            'Spike 10 Shape B (rung 2): answering + nudging via requestWakeup — proceed. Reply as a COMMENT.',
          );
          if (c.body?.id) seen.add(c.body.id);
          const wake = await requestWakeup(probeIssueId, {
            reason: 'issue_commented',
            idempotencyKey: `spike10-shapeB-${Date.now()}`,
          });
          finding.requestWakeupHttpStatus = wake.status;
          finding.steps.push(
            `rung2 requestWakeup: HTTP ${wake.status}${wake.status === 404 ? ' (EXPECTED 404 — REST surface unavailable, fire-and-forget, NOT a FAIL — Pitfall 3)' : ''}`,
          );
        },
      );
      if (b2.verdict === 'PASS') {
        locked = { rung: 'rung2:requestWakeup', ordering: 'comment+requestWakeup', signals: b2.obs };
      }
    }

    // Rung 3 — agents.resume / resumeHeartbeat — ONLY if the AGENT itself is
    // paused (Pitfall 6 / A6). Check first; an issue being blocked != agent paused.
    if (!locked) {
      const agentStatus = await getAgentStatus(SPIKE_PROBE_AGENT_ID);
      if (agentStatus === 'paused') {
        const b3 = await attemptRung(
          'rung3:agents.resume',
          'comment+agent-resume',
          async (seen) => {
            const resume = await call(
              'POST',
              `/api/companies/${C()}/agents/${encodeURIComponent(SPIKE_PROBE_AGENT_ID)}/resume`,
            );
            finding.steps.push(`rung3 agents.resume: HTTP ${resume.status}`);
            const c = await createComment(
              probeIssueId,
              'Spike 10 Shape B (rung 3): agent resumed + answering — proceed. Reply as a COMMENT.',
            );
            if (c.body?.id) seen.add(c.body.id);
          },
        );
        if (b3.verdict === 'PASS') {
          locked = { rung: 'rung3:agents.resume', ordering: 'comment+agent-resume', signals: b3.obs };
        }
      } else {
        finding.ladderRungsTried.push('rung3:agents.resume(N/A)');
        finding.steps.push(
          `rung3 NOT-APPLICABLE — agent status='${agentStatus ?? 'unknown'}' (not 'paused'); an issue being blocked != agent paused (Pitfall 6/A6)`,
        );
      }
    }

    // Lock the minimal recipe and surface the signals from the locked rung.
    if (locked) {
      finding.minimalRecipe = `${locked.rung} (${locked.ordering})`;
      finding.signals = {
        behavioral: locked.signals.behavioral,
        consumption: locked.signals.consumption,
        state: locked.signals.state,
      };
      finding.verdictHint = `PASS — minimal recipe locked: ${finding.minimalRecipe}; ladder=${finding.ladderRungsTried.join(' → ')}`;
    } else {
      // No rung passed. If the agent never ran at all, flag the budget/invocation
      // block check (Pitfall 5) before treating this as a hard FAIL.
      const anyBehavioral = finding.ladderResults.some((r) => r.signals.behavioral);
      const lastVerdict = finding.ladderResults.length
        ? finding.ladderResults[finding.ladderResults.length - 1].verdict
        : 'FAIL';
      finding.signals = finding.ladderResults.length
        ? finding.ladderResults[finding.ladderResults.length - 1].signals
        : { behavioral: false, consumption: false, state: false };
      if (!anyBehavioral) {
        const agentStatus = await getAgentStatus(SPIKE_PROBE_AGENT_ID);
        finding.steps.push(
          `no rung produced an agent run — agent status=${agentStatus ?? '(unknown)'}; inspect for a budget/invocation-block incident before final FAIL (Pitfall 5)`,
        );
      }
      finding.verdictHint = `${lastVerdict} — no rung locked through the full window; ladder=${finding.ladderRungsTried.join(' → ')}`;
    }
  } catch (err) {
    finding.steps.push(`Shape B threw: ${err.message}`);
    finding.verdictHint = `FAIL — Shape B threw: ${err.message}`;
  }
  return finding;
}

// ===========================================================================
// probeShapeC — blockedByIssueIds relation resume (FILLED BY PLAN 10-02)
// ===========================================================================
//
// Construct: create blocker X and blocked Y with Y.blockedByIssueIds:[X] AT
// CREATE time (legal via issues.create — NO issue.relations.write). Test the
// CASCADE hypothesis (answer/resolve X, observe Y resumes WITHOUT touching Y's
// relation). If Y only resumes after the edge is cleared (needs
// issue.relations.write — NOT declared, D-10), record the clear-the-edge path
// as spec'd-not-proven; never exercise it.

async function probeShapeC(state) {
  const finding = {
    probe: 'PROBE-SHAPE-C',
    question:
      'Shape C (blockedByIssueIds): does answering the blocker cascade-resume the blocked issue within the declared capability boundary?',
    steps: [],
    blockerIssueId: null,
    blockedIssueId: null,
    signals: { behavioral: null, consumption: null, state: null },
    cascadeObserved: null,
    edgeClearPathSpecdNotProven: null, // D-10 — relations.write path, documented not exercised
    verdictHint: 'STUB — filled by Plan 10-02',
  };
  finding.steps.push('STUB — probeShapeC not yet implemented (Plan 10-02)');
  void state;
  void createIssue;
  void createComment;
  void updateIssue;
  void pollForNewComment;
  return finding;
}

// ===========================================================================
// Main
// ===========================================================================
//
// Plan 10-01 wires ONLY dryConfirmA1A3 + observeRealBlockedItems (the Wave-0
// dry-confirm). The three-shape probes (probeShapeA/B/C) are landed as stubs
// for Plan 10-02 to fill and are NOT yet invoked here.

async function main() {
  const configErrors = [];
  if (!API_URL) configErrors.push('PAPERCLIP_API_URL is required');
  if (!API_KEY) configErrors.push('PAPERCLIP_API_KEY is required');
  if (!COMPANY_ID) configErrors.push('PAPERCLIP_COMPANY_ID is required');

  const summary = {
    probe: 'unblock-resume-spike-probe',
    phase: '10-unblock-resume-spike',
    plan: '10-01',
    startedAt: now(),
    apiUrl: API_URL || '(unset)',
    companyId: COMPANY_ID || '(unset)',
    probeAgentIdPinned: SPIKE_PROBE_AGENT_ID || '(none — A3 may mint via REST)',
    configErrors,
    findings: {},
    spikeIssues: {},
    finishedAt: null,
  };

  if (configErrors.length > 0) {
    summary.finishedAt = now();
    log('config incomplete — aborting before any host calls', {
      configErrors,
    });
    process.stdout.write('\n=== UNBLOCK-RESUME SPIKE PROBE SUMMARY ===\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return 1;
  }

  // Shared mutable state threaded across probes (probe issues / agents created
  // by earlier steps are referenced by later ones and torn down at the end).
  const state = {
    a1ProbeIssueId: null,
    a3ProbeAgentId: null,
    shapeAProbeIssueId: null,
    shapeBProbeIssueId: null,
    shapeCBlockerIssueId: null,
    shapeCBlockedIssueId: null,
  };

  log('DRY-CONFIRM-A1-A3 — can we set status:blocked + mint/delete a probe agent?');
  summary.findings.dryConfirmA1A3 = await dryConfirmA1A3(state);

  log('OBSERVE-REAL-BLOCKED-ITEMS — D-02 read-only per-shape fidelity scan');
  summary.findings.observeRealBlockedItems = await observeRealBlockedItems(state);

  // NOTE: probeShapeA / probeShapeB / probeShapeC are STUBS in this plan; Plan
  // 10-02 wires them into main() for the full three-shape run. Referenced here
  // so the linter sees them as used and the harness lands intact.
  void probeShapeA;
  void probeShapeB;
  void probeShapeC;

  summary.spikeIssues = {
    a1ProbeIssueId: state.a1ProbeIssueId,
    a3ProbeAgentId: state.a3ProbeAgentId,
    shapeAProbeIssueId: state.shapeAProbeIssueId,
    shapeBProbeIssueId: state.shapeBProbeIssueId,
    shapeCBlockerIssueId: state.shapeCBlockerIssueId,
    shapeCBlockedIssueId: state.shapeCBlockedIssueId,
    note: `Spike issues are tagged ${SPIKE_TAG} in their titles — greppable + deletable, or rollback to the DO-droplet backup bookend.`,
  };
  summary.finishedAt = now();

  process.stdout.write('\n=== UNBLOCK-RESUME SPIKE PROBE SUMMARY ===\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(
    '\nPaste the JSON block above back into the GSD session so the 10-01 dry-confirm result can be recorded.\n',
  );
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    // Top-level guard — the per-probe try/catch should have caught everything,
    // but never crash without a redacted message.
    process.stderr.write(redactedError(err, API_KEY).message + '\n');
    process.exit(1);
  });
