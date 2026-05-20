#!/usr/bin/env node
// scripts/spike/chat-true-task-spike-probe.mjs
//
// THROWAWAY Phase 4.1 (Chat -> True Task) falsify-first spike probe.
//
// This file ships NOTHING. It is not bundled, not under src/, never imported
// by plugin code. It exists only to be run ONCE, by Eric, against the live
// Countermoves Paperclip instance, bookended by a verified snapshot. After the
// findings doc (04.1-01-SPIKE-FINDINGS.md) is written it may be deleted.
//
// PURPOSE: Phase 4.1's two genuine unknowns must be falsified on the live host
// BEFORE any chat-true-task handler, helper, UI, or migration is written.
// Phase 3's five gap-closure plans (03-06..03-10) were the direct cost of NOT
// running this discipline; Plans 02-01 and 04-01 ran it and saved their phases.
//
// THE TWO UNKNOWNS:
//   1. D-12 -- The exact `ctx.issues.requestWakeup(reason, contextSource)`
//      argument set the host's `isVerifiedIssueTreeControlInteractionWake()`
//      gate accepts for a plugin-originated wake. (RESEARCH.md Pitfall 2 /
//      Open Question 3.) Without this, Plan 04.1-03's multi-turn re-wake
//      backstop has no working argument set.
//   2. D-14 -- The actual `authorType` / `presentation.kind` values stamped on
//      a real Paperclip disposition / recovery-owner / `finish_successful_run_handoff`
//      comment. RESEARCH.md asserts HIGH confidence that `authorType === 'system'`,
//      but the value the production filter keys on must be VERIFIED on the live
//      host version installed on Countermoves before Plan 04.1-04 ships the
//      `classifyComment` filter.
//
// PLUS THREE LOWER-RISK LIVE CONFIRMATIONS:
//   3. PROBE-OQ1-STATUS -- Does an `in_progress` chat-topic issue with a fresh
//      comment natively re-wake the assignee on multi-turn, or is the explicit
//      `requestWakeup` nudge required? (Open Question 1 + Pitfall 3.)
//   4. PROBE-OQ2-FILTER -- Does `ctx.issues.list({companyId, originKind})`
//      return `originId` precisely enough to filter the D-08 active-tasks
//      query by prefix, or do we need a `0007_chat_topic_tasks.sql` side table?
//      (Open Question 2.)
//   5. FLAG-2 grep -- pure read; confirmed during probe authoring, recorded
//      in the findings doc for completeness.
//
// USAGE -- RUN AFTER `clarity-safety snapshot` ON THE TARGET BOX. The probe
// creates 3-5 real issues + several comments on the named company. Clean them
// up manually after, or restore from the bookend snapshot. From ~/clarity-pack
// on the Countermoves VPS:
//
//   # 1) Bookend snapshot (CLAUDE.md bookended-by-snapshots rule):
//   cd ~/clarity-pack
//   node scripts/safety/cli.mjs snapshot --db-url $(grep DB_URL /etc/paperclip/db.env | cut -d= -f2-)
//   node scripts/safety/cli.mjs gate
//
//   # 2) Run the probe:
//   PAPERCLIP_API_URL=https://countermoves.gl3group.com \
//   PAPERCLIP_API_KEY=<bearer token from ~/.paperclip/auth.json> \
//   PAPERCLIP_COMPANY_ID=<the live COU company id> \
//     node scripts/spike/chat-true-task-spike-probe.mjs > 04.1-01-probe-output.txt 2>&1
//
//   # 3) Bookend gate after:
//   node scripts/safety/cli.mjs gate
//
// Optional env:
//   SPIKE_EMPLOYEE_AGENT_ID   pin the employee-agent to probe (else first
//                             non-Editor agent in the roster is used)
//   SPIKE_EDITOR_AGENT_ID     Editor-Agent id to EXCLUDE from auto-pick
//
// This runs OUTSIDE the plugin worker, so it cannot use the plugin SDK `ctx`.
// It mirrors the REST-client + try/catch-per-step + structured JSON output
// pattern from scripts/spike/chat-spike-probe.mjs (Plan 04-01's analog).
// Native fetch, Bearer header, redacted errors. Every probe step is wrapped
// so one failure cannot abort the others -- partial findings are still
// findings. It prints a single structured JSON summary at the end on stdout.

import process from 'node:process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = (process.env.PAPERCLIP_API_URL || '').replace(/\/$/, '');
const API_KEY = process.env.PAPERCLIP_API_KEY || '';
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';
const PINNED_EMPLOYEE_AGENT_ID = process.env.SPIKE_EMPLOYEE_AGENT_ID || '';
const EDITOR_AGENT_ID = process.env.SPIKE_EDITOR_AGENT_ID || '';

// Poll cadence and windows. Heartbeat min interval is 30s; real LLM replies
// take minutes (RESEARCH.md). Windows are bounded so the probe never hammers
// the host and finishes in a predictable ~25-35 min.
const POLL_INTERVAL_MS = 30_000;
const FIRST_REPLY_WINDOW_MS = 8 * 60_000; // 8 min for the first agent reply
const RE_WAKE_WINDOW_MS = 4 * 60_000; // 4 min per OQ3 sub-step (4 sub-steps)
const STATUS_OBS_WINDOW_MS = 6 * 60_000; // 6 min observing OQ1 status changes

const SPIKE_TAG = '[SPIKE 04.1]'; // every spike-created issue title carries
// this -- a botched run is greppable + deletable (threat T-04.1-01-01).

// The three legal wake `reason` values per the host's gate
// `ISSUE_TREE_CONTROL_INTERACTION_WAKE_REASONS` (RESEARCH.md Pitfall 2).
const LEGAL_WAKE_REASONS = [
  'issue_commented',
  'issue_reopened_via_comment',
  'issue_comment_mentioned',
];

// Reply-channel instruction proven necessary in Plan 04-01's spike (the agent
// will file documents instead of commenting otherwise -- A5/D-14 fold).
const REPLY_CHANNEL_INSTRUCTION =
  'Reply to comments on this issue by posting a COMMENT on this issue (not a document).';

// Known runtime-comment phrases for the D-14 cheap-path search. Body-pattern
// blocklist that Plan 04.1-04's `classifyComment` falls back to if the host
// field discriminator turns out unreliable. Kept narrow.
const RUNTIME_NOTICE_PHRASES = [
  'needs a disposition',
  'blocked on a recovery owner',
  'finish_successful_run_handoff',
  'exhausted the bounded corrective handoff',
  'successful run handoff',
  'recovery owner',
];

// ---------------------------------------------------------------------------
// Tiny REST client -- mirrors scripts/safety/lib/paperclip-api.mjs
// (and scripts/spike/chat-spike-probe.mjs from Plan 04-01).
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
 * echoed -- errors are scrubbed via redactedError.
 */
async function call(method, pathname, body) {
  if (!API_URL)
    throw new Error(
      'chat-true-task-spike-probe: PAPERCLIP_API_URL is required',
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

/** Structured stderr log line -- never carries the token. */
function log(msg, extra) {
  const tail = extra ? ' ' + JSON.stringify(extra) : '';
  process.stderr.write(`[${now()}] ${msg}${tail}\n`);
}

// ---------------------------------------------------------------------------
// Endpoint helpers -- route shapes VERIFIED LIVE against Countermoves
// 2026-05-18 in Plan 04-01's probe. Issue/agent COLLECTION routes are
// companyId-scoped (`/api/companies/{id}/issues`, `/api/companies/{id}/agents`),
// but per-issue SUB-routes are FLAT (`/api/issues/{id}`,
// `/api/issues/{id}/comments`, `/api/issues/{id}/wakeup`).
// ---------------------------------------------------------------------------

const C = () => encodeURIComponent(COMPANY_ID);
const I = (issueId) => encodeURIComponent(issueId);

function listAgents() {
  return call('GET', `/api/companies/${C()}/agents`);
}

function createIssue(payload) {
  // Collection route -- companyId-scoped.
  return call('POST', `/api/companies/${C()}/issues`, payload);
}

function getIssue(issueId) {
  return call('GET', `/api/issues/${I(issueId)}`);
}

function updateIssue(issueId, patch) {
  return call('PATCH', `/api/issues/${I(issueId)}`, patch);
}

function listComments(issueId) {
  return call('GET', `/api/issues/${I(issueId)}/comments`);
}

function createComment(issueId, bodyText) {
  return call('POST', `/api/issues/${I(issueId)}/comments`, { body: bodyText });
}

function requestWakeup(issueId, opts) {
  // Capability `issues.wakeup` is already declared in the manifest (line 297).
  // Body shape mirrors the SDK PluginIssuesClient.requestWakeup signature
  // (types.d.ts:1065-1069): { reason, contextSource }.
  return call('POST', `/api/issues/${I(issueId)}/wakeup`, opts);
}

function listIssues(query) {
  // Build query string from { originKind, originId, originKindPrefix, ... }
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

/** Sanitize a free-text body for the findings doc -- cap length, strip nulls. */
function truncBody(body, max = 200) {
  if (typeof body !== 'string') return body;
  return body.length > max ? body.slice(0, max) + '...[truncated]' : body;
}

/**
 * Poll listComments on `issueId` until a comment NOT already in `seenIds`
 * appears, or the time budget runs out. Returns the new comment, or null.
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

/** Pick an employee-agent (NOT the Editor-Agent) for the probe. */
async function resolveEmployeeAgent() {
  const agentsRes = await listAgents();
  if (!ok(agentsRes.status)) {
    return {
      employee: null,
      error: `listAgents non-2xx: ${agentsRes.status}`,
    };
  }
  const agents = asArray(agentsRes.body);
  let employee = null;
  if (PINNED_EMPLOYEE_AGENT_ID) {
    employee =
      agents.find((a) => a && a.id === PINNED_EMPLOYEE_AGENT_ID) || null;
  }
  if (!employee) {
    employee =
      agents.find(
        (a) =>
          a &&
          a.id &&
          a.id !== EDITOR_AGENT_ID &&
          a.id !== PINNED_EMPLOYEE_AGENT_ID,
      ) ||
      agents.find((a) => a && a.id && a.id !== EDITOR_AGENT_ID) ||
      null;
  }
  return { employee, agents };
}

// ===========================================================================
// PROBE-D14-DISCRIM (D-14 -- runtime-comment discriminator)
// ===========================================================================
//
// Inspect at least one REAL disposition / recovery-owner /
// `finish_successful_run_handoff` comment on Countermoves and record its
// actual `authorType` + `presentation.kind` fields. Two paths:
//   (a) Cheap path -- scan recent plugin:clarity-pack issues for comments
//       matching one of RUNTIME_NOTICE_PHRASES.
//   (b) Provoke path -- create a probe chat-topic issue, ask the agent to do
//       a real action, wait for the host's recovery service to post a notice.
// Records: the raw JSON of one notice comment row including id, authorType,
// authorUserId, authorAgentId, presentation, and body (first 200 chars).
//
// Verify against RESEARCH.md "D-14 discriminator EXISTS" -- the expected
// value is authorType === 'system'. If the live host carries a DIFFERENT
// discriminator, the findings doc records the actual value the production
// filter must key on.

async function probeD14Discrim(state) {
  const finding = {
    probe: 'PROBE-D14-DISCRIM',
    question:
      'D-14: what is the actual authorType / presentation.kind on a real Paperclip runtime notice?',
    path: null, // 'cheap' | 'provoke' | 'none'
    steps: [],
    noticeRow: null, // raw JSON of one notice comment (full)
    distinguishingFields: null, // summarized record
    verdictHint: null,
  };

  try {
    // (a) Cheap path: scan existing plugin:clarity-pack issues for runtime
    // notices. The "Hire a CMO" / CHT-1116 drill left at least one such
    // comment on the box at the time of writing (04-FOLLOWUP-chat-true-task.md).
    finding.steps.push(
      'cheap path: scanning existing plugin:clarity-pack issues for runtime-notice comments',
    );
    let candidates = [];
    try {
      const res = await listIssues({ originKind: 'plugin:clarity-pack' });
      if (ok(res.status)) {
        candidates = asArray(res.body).slice(0, 20); // bound the scan
        finding.steps.push(
          `found ${candidates.length} plugin:clarity-pack issues to scan`,
        );
      } else {
        finding.steps.push(
          `listIssues(originKind) non-2xx: ${res.status}; cheap path skipped`,
        );
      }
    } catch (err) {
      finding.steps.push(`listIssues threw: ${err.message}`);
    }

    for (const cand of candidates) {
      if (!cand?.id) continue;
      let res;
      try {
        res = await listComments(cand.id);
      } catch {
        continue;
      }
      if (!ok(res.status)) continue;
      const comments = asArray(res.body);
      const match = comments.find((c) => {
        const body = String(c?.body ?? '').toLowerCase();
        return RUNTIME_NOTICE_PHRASES.some((p) => body.includes(p.toLowerCase()));
      });
      if (match) {
        finding.path = 'cheap';
        finding.noticeRow = match;
        finding.steps.push(
          `cheap-path hit on issue ${cand.id}, comment ${match.id}`,
        );
        break;
      }
    }

    // (b) Provoke path -- only if cheap path found nothing AND we have an
    // employee-agent + a probe issue. The runtime-notice provocation depends
    // on the agent successfully running and the host running its recovery
    // service. We piggyback on PROBE-OQ3's probe issue if it exists.
    if (!finding.noticeRow && state.oq3ProbeIssueId) {
      finding.steps.push(
        'cheap path empty; trying provoke path on the OQ3 probe issue',
      );
      // The recovery service typically posts its notice after a successful
      // run completes with no disposition. PROBE-OQ3 already exercises this.
      // Re-fetch its comments and look for a runtime phrase.
      try {
        const res = await listComments(state.oq3ProbeIssueId);
        if (ok(res.status)) {
          const comments = asArray(res.body);
          const match = comments.find((c) => {
            const body = String(c?.body ?? '').toLowerCase();
            return RUNTIME_NOTICE_PHRASES.some((p) =>
              body.includes(p.toLowerCase()),
            );
          });
          if (match) {
            finding.path = 'provoke';
            finding.noticeRow = match;
            finding.steps.push(
              `provoke-path hit on OQ3 probe issue, comment ${match.id}`,
            );
          } else {
            finding.steps.push(
              'provoke-path empty: OQ3 probe issue carries no runtime notice yet',
            );
          }
        }
      } catch (err) {
        finding.steps.push(`provoke-path listComments threw: ${err.message}`);
      }
    }

    if (finding.noticeRow) {
      const r = finding.noticeRow;
      finding.distinguishingFields = {
        id: r.id ?? null,
        authorType: r.authorType ?? r.author_type ?? null,
        authorUserId: r.authorUserId ?? r.author_user_id ?? null,
        authorAgentId: r.authorAgentId ?? r.author_agent_id ?? null,
        presentationKind:
          r.presentation && typeof r.presentation === 'object'
            ? r.presentation.kind ?? null
            : null,
        bodyExcerpt: truncBody(r.body, 200),
      };
      const at = finding.distinguishingFields.authorType;
      if (at === 'system') {
        finding.verdictHint =
          "PASS -- runtime notice carries authorType === 'system' as RESEARCH HIGH-confidence predicted";
      } else if (at) {
        finding.verdictHint = `DEVIATION -- live host stamps authorType === '${at}' (NOT 'system'); Plan 04.1-04 must key the filter on this value`;
      } else {
        finding.verdictHint =
          'UNDETERMINED -- notice row found but authorType field is absent; inspect raw JSON in noticeRow';
      }
    } else {
      finding.path = 'none';
      finding.verdictHint =
        'NO-NOTICE-CAPTURED -- neither cheap nor provoke path found a runtime notice; re-run after PROBE-OQ1-STATUS exercises an agent run, or use Paperclip classic UI to find one manually';
    }
  } catch (err) {
    finding.steps.push(`probeD14Discrim threw: ${err.message}`);
    finding.verdictHint =
      finding.verdictHint || 'INCONCLUSIVE -- probe error';
  }
  return finding;
}

// ===========================================================================
// PROBE-OQ3 (D-12 -- requestWakeup gate strings)
// ===========================================================================
//
// Create a probe chat-topic issue assigned to a real employee-agent (NOT the
// Editor-Agent), post one comment to wake it, wait for the reply (Phase 4
// D-01 native wake), then exercise requestWakeup with the three legal `reason`
// values one by one:
//   1. Post comment #2 WITHOUT calling requestWakeup; wait up to 4 minutes;
//      record whether the agent re-wakes (the multi-turn case 04-01 spike
//      did NOT cover -- Pitfall 3 in RESEARCH).
//   2. If no re-wake, call requestWakeup(reason: 'issue_commented',
//      contextSource: 'clarity-pack:chat'). Capture {queued, runId}. Wait 4 min.
//   3. If still no re-wake, retry with reason: 'issue_reopened_via_comment'
//      (paired with a no-op in_progress -> in_progress status flip to exercise
//      the resume mode codepath). Capture + wait.
//   4. If still no re-wake, retry with reason: 'issue_comment_mentioned'.
//      Capture + wait.
//   5. If still no re-wake, capture and report -- D-12 is host-blocked and
//      FLAG-1 / CHAT-04 reconciliation applies.
//
// Findings: the FIRST reason value that produced {queued: true, runId: <non-null>}
// AND a subsequent observable agent reply -- that is the locked argument set
// Plan 04.1-03 implements.

async function probeOQ3(state) {
  const finding = {
    probe: 'PROBE-OQ3',
    question:
      'D-12: which requestWakeup(reason, contextSource) argument set does the host gate accept for a plugin-originated wake?',
    steps: [],
    probeIssueId: null,
    employeeAgentId: null,
    firstReplyObserved: false,
    multiTurnNativeWake: null, // boolean -- did comment #2 alone re-wake?
    attempts: [], // per legal reason: {reason, contextSource, result, observedReply}
    lockedArgumentSet: null, // the winning {reason, contextSource}, or null
    verdictHint: null,
  };

  try {
    // Resolve an employee-agent.
    const { employee, error } = await resolveEmployeeAgent();
    if (!employee) {
      finding.steps.push(`could not resolve an employee-agent: ${error ?? 'no candidate'}`);
      finding.verdictHint = 'FAIL -- no employee-agent to probe';
      return finding;
    }
    finding.employeeAgentId = employee.id;
    finding.steps.push(`resolved employee-agent ${employee.id}`);

    // Create the probe chat-topic issue (top-level for probe simplicity).
    const createRes = await createIssue({
      title: `OQ3 wake-gate probe ${SPIKE_TAG}`,
      description: `Spike probe for D-12 requestWakeup gate strings. ${REPLY_CHANNEL_INSTRUCTION} Safe to delete after the spike.`,
      status: 'in_progress', // OQ-1 recommendation -- hold non-terminal from the start
      assigneeAgentId: employee.id,
      originKind: 'plugin:clarity-pack',
      originId: `spike-oq3:${Date.now()}`,
    });
    if (!ok(createRes.status) || !createRes.body?.id) {
      finding.steps.push(
        `probe issue create failed: HTTP ${createRes.status}`,
      );
      finding.verdictHint = 'FAIL -- could not create probe issue';
      return finding;
    }
    finding.probeIssueId = createRes.body.id;
    state.oq3ProbeIssueId = finding.probeIssueId;
    finding.steps.push(`created OQ3 probe issue ${finding.probeIssueId}`);

    // Track seen comment ids so we can detect agent replies.
    const seenIds = new Set();

    // Post comment #1 to wake the agent (native wake path -- already proven
    // by Plan 04-01 spike, but we need an established baseline).
    const c1 = await createComment(
      finding.probeIssueId,
      'OQ3 probe message #1: Reply with a brief one-paragraph plan for hiring a Chief Operating Officer.',
    );
    finding.steps.push(`posted comment #1: HTTP ${c1.status}`);
    if (c1.body?.id) seenIds.add(c1.body.id);

    const reply1 = await pollForNewComment(
      finding.probeIssueId,
      seenIds,
      FIRST_REPLY_WINDOW_MS,
    );
    if (!reply1) {
      finding.firstReplyObserved = false;
      finding.verdictHint =
        'BLOCKED -- no first reply within 8 min; cannot exercise multi-turn wake. Re-run or check agent budget.';
      return finding;
    }
    finding.firstReplyObserved = true;
    seenIds.add(reply1.fresh.id);
    // Also seed seenIds with any other intermediate comments so we measure
    // strictly new comments after each wake attempt.
    for (const c of reply1.allComments ?? []) if (c?.id) seenIds.add(c.id);
    finding.steps.push(
      `first agent reply observed (comment ${reply1.fresh.id})`,
    );

    // Step 1 -- post comment #2 WITHOUT requestWakeup; observe native re-wake.
    const c2 = await createComment(
      finding.probeIssueId,
      'OQ3 probe message #2 (multi-turn): What is the first hire I should focus on?',
    );
    finding.steps.push(`posted comment #2 (no requestWakeup): HTTP ${c2.status}`);
    if (c2.body?.id) seenIds.add(c2.body.id);

    const reply2 = await pollForNewComment(
      finding.probeIssueId,
      seenIds,
      RE_WAKE_WINDOW_MS,
    );
    if (reply2) {
      finding.multiTurnNativeWake = true;
      seenIds.add(reply2.fresh.id);
      finding.steps.push(
        `multi-turn native re-wake CONFIRMED (comment ${reply2.fresh.id}) -- comment #2 alone re-woke the agent`,
      );
      // This is a HUGE finding: if native wake works for multi-turn, Plan
      // 04.1-03 may not need the requestWakeup nudge at all. But we still
      // exercise the wake-gate strings below so D-12's argument set is
      // recorded in case the watchdog needs it.
    } else {
      finding.multiTurnNativeWake = false;
      finding.steps.push(
        'multi-turn native re-wake DID NOT FIRE within 4 min; proceeding to requestWakeup attempts',
      );
    }

    // Step 2-4 -- exercise the three legal wake reasons in order. We always
    // run all three so the findings doc has the full {queued, runId} matrix
    // even if the first works. After each call, briefly poll for a reply --
    // but only block on the first reason that produces a non-null runId.
    let lockedFound = false;
    for (let i = 0; i < LEGAL_WAKE_REASONS.length; i++) {
      const reason = LEGAL_WAKE_REASONS[i];
      const contextSource = 'clarity-pack:chat';
      const attempt = {
        reason,
        contextSource,
        result: null,
        observedReply: null,
        steps: [],
      };

      // The middle reason (issue_reopened_via_comment) traditionally pairs
      // with a status flip to exercise the resume mode codepath. We do a
      // no-op in_progress -> in_progress flip per the plan.
      if (reason === 'issue_reopened_via_comment') {
        try {
          const flip = await updateIssue(finding.probeIssueId, {
            status: 'in_progress',
          });
          attempt.steps.push(
            `no-op in_progress->in_progress status flip: HTTP ${flip.status}`,
          );
        } catch (err) {
          attempt.steps.push(`status flip threw: ${err.message}`);
        }
      }

      // Post a fresh comment so the wake has something to wake ON (the gate
      // checks for a verified wakeup record tied to a comment).
      try {
        const c = await createComment(
          finding.probeIssueId,
          `OQ3 wake-gate probe -- reason '${reason}'. Reply if you wake.`,
        );
        attempt.steps.push(`posted wake-bait comment: HTTP ${c.status}`);
        if (c.body?.id) seenIds.add(c.body.id);
      } catch (err) {
        attempt.steps.push(`wake-bait comment threw: ${err.message}`);
      }

      // Call requestWakeup with this reason.
      try {
        const res = await requestWakeup(finding.probeIssueId, {
          reason,
          contextSource,
        });
        attempt.result = {
          httpStatus: res.status,
          body: res.body,
          queued: res.body?.queued ?? null,
          runId: res.body?.runId ?? null,
        };
        attempt.steps.push(
          `requestWakeup(${reason}, ${contextSource}): HTTP ${res.status}, queued=${attempt.result.queued}, runId=${attempt.result.runId ?? 'null'}`,
        );
      } catch (err) {
        attempt.steps.push(`requestWakeup threw: ${err.message}`);
        attempt.result = { error: err.message };
      }

      // Observe whether a reply lands within the window.
      const reply = await pollForNewComment(
        finding.probeIssueId,
        seenIds,
        RE_WAKE_WINDOW_MS,
      );
      if (reply) {
        attempt.observedReply = {
          commentId: reply.fresh.id,
          authorType: reply.fresh.authorType ?? reply.fresh.author_type ?? null,
          createdAt: reply.fresh.createdAt ?? reply.fresh.created_at ?? null,
          bodyExcerpt: truncBody(reply.fresh.body, 200),
        };
        seenIds.add(reply.fresh.id);
        attempt.steps.push(
          `agent reply observed after requestWakeup(${reason})`,
        );

        // Lock the winning argument set on the FIRST reason that produced
        // queued===true AND a runId AND an observable reply.
        if (
          !lockedFound &&
          attempt.result?.queued === true &&
          attempt.result?.runId
        ) {
          finding.lockedArgumentSet = { reason, contextSource };
          lockedFound = true;
        }
      } else {
        attempt.steps.push(
          `no reply within 4 min after requestWakeup(${reason})`,
        );
      }

      finding.attempts.push(attempt);
    }

    // Verdict.
    if (finding.lockedArgumentSet) {
      finding.verdictHint = `PASS -- D-12 wake gate accepts {reason: '${finding.lockedArgumentSet.reason}', contextSource: '${finding.lockedArgumentSet.contextSource}'}; Plan 04.1-03 implements against this argument set`;
    } else if (finding.multiTurnNativeWake === true) {
      finding.verdictHint =
        "PASS-NATIVE -- multi-turn native wake works without requestWakeup; Plan 04.1-03 may skip the nudge (or keep it as defense-in-depth)";
    } else {
      finding.verdictHint =
        'HOST-BLOCKED -- no legal reason produced queued===true with an observed reply; D-12 is host-blocked. FLAG-1 / CHAT-04 reconciliation applies; Plan 04.1-03 must lean on D-09 + D-11 + D-13 banner instead of an explicit wake nudge.';
    }
  } catch (err) {
    finding.steps.push(`probeOQ3 threw: ${err.message}`);
    finding.verdictHint =
      finding.verdictHint || 'INCONCLUSIVE -- probe error';
  }
  return finding;
}

// ===========================================================================
// PROBE-OQ1-STATUS (D-09 + D-11 -- non-terminal holding status)
// ===========================================================================
//
// Create a SECOND probe chat-topic issue at status: 'in_progress' from the
// start (RESEARCH OQ-1 recommendation). Post a comment. Observe whether the
// agent natively re-wakes WITHOUT a requestWakeup call (is in_progress + plain
// comment sufficient for multi-turn?). Record: the status value the agent
// itself sets after the run completes -- that is the value the D-11 watchdog
// must override.

async function probeOQ1Status(state) {
  const finding = {
    probe: 'PROBE-OQ1-STATUS',
    question:
      'D-09/D-11: does in_progress + bare comment natively re-wake the assignee? What status does the agent flip the topic to after a successful run?',
    steps: [],
    probeIssueId: null,
    employeeAgentId: null,
    initialStatus: 'in_progress',
    statusTransitions: [], // chronological list of observed statuses
    agentReplied: false,
    statusAfterReply: null,
    watchdogTarget: null, // the status the D-11 watchdog must override
    verdictHint: null,
  };

  try {
    const { employee } = await resolveEmployeeAgent();
    if (!employee) {
      finding.steps.push('no employee-agent available');
      finding.verdictHint = 'FAIL -- no employee-agent';
      return finding;
    }
    finding.employeeAgentId = employee.id;

    const createRes = await createIssue({
      title: `OQ1 status probe ${SPIKE_TAG}`,
      description: `Spike probe for D-09 non-terminal holding status. ${REPLY_CHANNEL_INSTRUCTION} Safe to delete after the spike.`,
      status: 'in_progress',
      assigneeAgentId: employee.id,
      originKind: 'plugin:clarity-pack',
      originId: `spike-oq1:${Date.now()}`,
    });
    if (!ok(createRes.status) || !createRes.body?.id) {
      finding.steps.push(`create failed: HTTP ${createRes.status}`);
      finding.verdictHint = 'FAIL -- could not create probe issue';
      return finding;
    }
    finding.probeIssueId = createRes.body.id;
    state.oq1ProbeIssueId = finding.probeIssueId;
    finding.statusTransitions.push({
      at: now(),
      status: createRes.body.status ?? 'in_progress (set by probe)',
    });
    finding.steps.push(`created OQ1 probe issue ${finding.probeIssueId}`);

    const seenIds = new Set();

    const c1 = await createComment(
      finding.probeIssueId,
      'OQ1 status probe: Reply with a single-sentence acknowledgement.',
    );
    finding.steps.push(`posted prompt comment: HTTP ${c1.status}`);
    if (c1.body?.id) seenIds.add(c1.body.id);

    // Snapshot status at intervals while polling for a reply.
    const deadline = Date.now() + STATUS_OBS_WINDOW_MS;
    let reply = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      // Snapshot status.
      try {
        const iss = await getIssue(finding.probeIssueId);
        if (ok(iss.status) && iss.body?.status) {
          const last =
            finding.statusTransitions[finding.statusTransitions.length - 1];
          if (!last || last.status !== iss.body.status) {
            finding.statusTransitions.push({
              at: now(),
              status: iss.body.status,
            });
            finding.steps.push(
              `status transition observed: ${last?.status ?? '(none)'} -> ${iss.body.status}`,
            );
          }
        }
      } catch (err) {
        finding.steps.push(`getIssue threw: ${err.message}`);
      }
      // Poll for new comment.
      try {
        const lcRes = await listComments(finding.probeIssueId);
        if (ok(lcRes.status)) {
          const comments = asArray(lcRes.body);
          const fresh = comments.find((c) => c?.id && !seenIds.has(c.id));
          if (fresh) {
            reply = fresh;
            seenIds.add(fresh.id);
            break;
          }
        }
      } catch (err) {
        finding.steps.push(`listComments threw: ${err.message}`);
      }
    }

    if (reply) {
      finding.agentReplied = true;
      finding.steps.push(`agent replied (comment ${reply.id})`);
      // Capture the status post-reply -- the D-11 watchdog target.
      try {
        const post = await getIssue(finding.probeIssueId);
        if (ok(post.status) && post.body?.status) {
          finding.statusAfterReply = post.body.status;
          const last =
            finding.statusTransitions[finding.statusTransitions.length - 1];
          if (!last || last.status !== post.body.status) {
            finding.statusTransitions.push({
              at: now(),
              status: post.body.status,
            });
          }
        }
      } catch (err) {
        finding.steps.push(`post-reply getIssue threw: ${err.message}`);
      }
      finding.watchdogTarget =
        finding.statusAfterReply &&
        finding.statusAfterReply !== 'in_progress'
          ? finding.statusAfterReply
          : '(none -- agent left in_progress; watchdog has nothing to override)';
      if (finding.statusAfterReply === 'done') {
        finding.verdictHint =
          "AGENT-FLIPS-DONE -- D-11 watchdog is mandatory; the agent moves the topic to 'done' after a successful run";
      } else if (
        finding.statusAfterReply &&
        finding.statusAfterReply !== 'in_progress'
      ) {
        finding.verdictHint = `AGENT-FLIPS-${finding.statusAfterReply.toUpperCase()} -- D-11 watchdog must override '${finding.statusAfterReply}' back to in_progress`;
      } else {
        finding.verdictHint =
          "AGENT-LEAVES-IN-PROGRESS -- the watchdog's job is simpler; D-11 needs only the defensive flip-off-done path";
      }
    } else {
      finding.agentReplied = false;
      finding.verdictHint =
        'NO-REPLY -- agent did not reply within 6 min; cannot determine status post-completion. Native wake on in_progress + bare comment is UNRELIABLE for this run.';
    }
  } catch (err) {
    finding.steps.push(`probeOQ1Status threw: ${err.message}`);
    finding.verdictHint =
      finding.verdictHint || 'INCONCLUSIVE -- probe error';
  }
  return finding;
}

// ===========================================================================
// PROBE-OQ2-FILTER (D-08 active-tasks query path)
// ===========================================================================
//
// Create TWO probe true-task issues (top-level, no parentId, assigneeAgentId
// set, originKind: 'plugin:clarity-pack', distinct originIds). Call
// ctx.issues.list({companyId, originKind: 'plugin:clarity-pack'}) and inspect
// the returned rows -- does each row carry an originId field, and is it
// returned as a queryable value? Try the exact-match filter and any
// originIdPrefix filter the SDK exposes. Record: whether the precise filter
// works, an exact-match-only filter works, or only the coarse originKind
// filter works (in which case the active-tasks handler client-side-filters by
// originId.startsWith(...) per PATTERNS.md chat-active-tasks.ts recommendation).

async function probeOQ2Filter(state) {
  const finding = {
    probe: 'PROBE-OQ2-FILTER',
    question:
      'D-08: does ctx.issues.list({originKind, originId}) filter precisely? Or do we need 0007_chat_topic_tasks.sql?',
    steps: [],
    probeTaskAId: null,
    probeTaskBId: null,
    originIdsOnRows: null,
    filters: {
      originKindOnly: null,
      originKindPlusExactOriginId: null,
      originKindPlusPrefix: null,
    },
    recommendedQueryPath: null, // 'exact' | 'prefix' | 'client-side-filter-on-originKind'
    migrationNeeded: null, // boolean -- true if no usable filter and a side table would help
    verdictHint: null,
  };

  try {
    const { employee } = await resolveEmployeeAgent();
    if (!employee) {
      finding.steps.push('no employee-agent available for assigneeAgentId');
      finding.verdictHint = 'FAIL -- no employee-agent';
      return finding;
    }

    const topicA = `spike-topic-A:${Date.now()}`;
    const topicB = `spike-topic-B:${Date.now()}`;
    const commentA = `cmtA:${Date.now()}`;
    const commentB = `cmtB:${Date.now()}`;
    const originIdA = `chat-task:${topicA}:${commentA}`;
    const originIdB = `chat-task:${topicB}:${commentB}`;

    const taskA = await createIssue({
      title: `OQ2 true-task probe A ${SPIKE_TAG}`,
      description:
        'OQ2 probe true-task A. NO parentId (top-level per D-05). Safe to delete.',
      status: 'todo',
      assigneeAgentId: employee.id,
      originKind: 'plugin:clarity-pack',
      originId: originIdA,
    });
    finding.steps.push(`probe true-task A create: HTTP ${taskA.status}`);
    if (ok(taskA.status) && taskA.body?.id) {
      finding.probeTaskAId = taskA.body.id;
      state.oq2TaskAId = taskA.body.id;
    }

    const taskB = await createIssue({
      title: `OQ2 true-task probe B ${SPIKE_TAG}`,
      description:
        'OQ2 probe true-task B. NO parentId (top-level per D-05). Safe to delete.',
      status: 'todo',
      assigneeAgentId: employee.id,
      originKind: 'plugin:clarity-pack',
      originId: originIdB,
    });
    finding.steps.push(`probe true-task B create: HTTP ${taskB.status}`);
    if (ok(taskB.status) && taskB.body?.id) {
      finding.probeTaskBId = taskB.body.id;
      state.oq2TaskBId = taskB.body.id;
    }

    if (!finding.probeTaskAId || !finding.probeTaskBId) {
      finding.verdictHint =
        'FAIL -- could not create both probe true-tasks; cannot exercise the filter matrix';
      return finding;
    }

    // Coarse filter: originKind only.
    {
      const res = await listIssues({ originKind: 'plugin:clarity-pack' });
      const rows = ok(res.status) ? asArray(res.body) : [];
      const seenA = rows.some((r) => r.id === finding.probeTaskAId);
      const seenB = rows.some((r) => r.id === finding.probeTaskBId);
      // Record originId presence on the returned rows.
      const idsField = rows
        .filter((r) => r.id === finding.probeTaskAId || r.id === finding.probeTaskBId)
        .map((r) => ({
          id: r.id,
          originId: r.originId ?? r.origin_id ?? null,
          originKind: r.originKind ?? r.origin_kind ?? null,
        }));
      finding.originIdsOnRows = idsField;
      finding.filters.originKindOnly = {
        httpStatus: res.status,
        rowCount: rows.length,
        bothProbeTasksReturned: seenA && seenB,
      };
      finding.steps.push(
        `originKind-only filter: HTTP ${res.status}, rows=${rows.length}, A=${seenA}, B=${seenB}`,
      );
    }

    // Exact-match filter: originKind + originId.
    {
      const res = await listIssues({
        originKind: 'plugin:clarity-pack',
        originId: originIdA,
      });
      const rows = ok(res.status) ? asArray(res.body) : [];
      const onlyA =
        rows.length >= 1 &&
        rows.every((r) => r.id === finding.probeTaskAId);
      finding.filters.originKindPlusExactOriginId = {
        httpStatus: res.status,
        rowCount: rows.length,
        onlyProbeTaskAReturned: onlyA,
      };
      finding.steps.push(
        `originKind + originId(exact) filter: HTTP ${res.status}, rows=${rows.length}, onlyA=${onlyA}`,
      );
    }

    // Prefix filter: any of the documented SDK shapes -- try
    // `originIdPrefix` first (per types.d.ts:1010-1021 -- the SDK exposes
    // `originKindPrefix`; an `originIdPrefix` is speculative but worth trying).
    {
      const prefix = `chat-task:${topicA}:`;
      const res = await listIssues({
        originKind: 'plugin:clarity-pack',
        originIdPrefix: prefix,
      });
      const rows = ok(res.status) ? asArray(res.body) : [];
      const onlyA =
        rows.length >= 1 &&
        rows.every((r) => r.id === finding.probeTaskAId);
      finding.filters.originKindPlusPrefix = {
        httpStatus: res.status,
        rowCount: rows.length,
        onlyProbeTaskAReturned: onlyA,
        prefix,
      };
      finding.steps.push(
        `originKind + originIdPrefix filter: HTTP ${res.status}, rows=${rows.length}, onlyA=${onlyA}`,
      );
    }

    // Recommendation.
    if (
      finding.filters.originKindPlusPrefix?.onlyProbeTaskAReturned &&
      finding.filters.originKindPlusPrefix.httpStatus >= 200 &&
      finding.filters.originKindPlusPrefix.httpStatus < 300
    ) {
      finding.recommendedQueryPath = 'prefix';
      finding.migrationNeeded = false;
      finding.verdictHint =
        'PASS-PREFIX -- originIdPrefix filter works precisely; no 0007 migration needed; Plan 04.1-03 chat-active-tasks.ts uses the prefix query path';
    } else if (
      finding.filters.originKindPlusExactOriginId?.onlyProbeTaskAReturned
    ) {
      finding.recommendedQueryPath = 'exact';
      finding.migrationNeeded = false;
      finding.verdictHint =
        'PASS-EXACT-ONLY -- exact originId filter works but no prefix filter; Plan 04.1-03 client-side-filters by originId.startsWith(...) after the originKind query';
    } else if (finding.filters.originKindOnly?.bothProbeTasksReturned) {
      finding.recommendedQueryPath = 'client-side-filter-on-originKind';
      finding.migrationNeeded = false;
      finding.verdictHint =
        'PASS-COARSE -- only originKind filter works; rows DO carry originId field; Plan 04.1-03 chat-active-tasks.ts uses originKind query + client-side originId.startsWith(...) filter (PATTERNS.md recommendation)';
    } else {
      finding.recommendedQueryPath = null;
      finding.migrationNeeded = true;
      finding.verdictHint =
        'WEAK -- coarse originKind filter unreliable; consider migrations/0007_chat_topic_tasks.sql side table for O(1) topic->tasks lookup';
    }
  } catch (err) {
    finding.steps.push(`probeOQ2Filter threw: ${err.message}`);
    finding.verdictHint =
      finding.verdictHint || 'INCONCLUSIVE -- probe error';
  }
  return finding;
}

// ===========================================================================
// FLAG-2 grep result (pure read; no probe call)
// ===========================================================================
//
// Confirmed during probe authoring -- the planner verified
// src/worker/jobs/situation-snapshot.ts reads current_task_summary (~line 190)
// and does NOT do an issues.list({assigneeAgentId}) walk. Recorded here for
// completeness so the findings doc consolidates all four sub-probe outputs.
// If any other Situation Room surface DOES, the findings doc records it as a
// 04.1-03 follow-up task.

function flag2GrepResult() {
  return {
    probe: 'FLAG-2',
    question:
      'Does any Situation Room surface do issues.list({assigneeAgentId}) that would now include chat-topic issues?',
    grepTargets: [
      'src/worker/jobs/situation-snapshot.ts',
      'src/worker/jobs/*.ts',
      'src/worker/handlers/situation-room.ts',
    ],
    plannerConfirmedFinding:
      'situation-snapshot.ts reads current_task_summary (~line 190); does NOT do issues.list({assigneeAgentId}). No FLAG-2 exposure as of 2026-05-20.',
    note:
      'Pure read confirmed by the Phase 4.1 planner (CONTEXT.md FLAG-2). Operator should re-grep before commit if the Situation Room surface has been modified since the CONTEXT was gathered. If a new issues.list({assigneeAgentId}) call lands in the situation-room path, Plan 04.1-03 must add an originKind exclusion filter for chat-topic issues.',
    verdictHint:
      'PASS -- no Situation Room work-status aggregation includes chat-topic issues',
  };
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  const configErrors = [];
  if (!API_URL) configErrors.push('PAPERCLIP_API_URL is required');
  if (!API_KEY) configErrors.push('PAPERCLIP_API_KEY is required');
  if (!COMPANY_ID) configErrors.push('PAPERCLIP_COMPANY_ID is required');

  const summary = {
    probe: 'chat-true-task-spike-probe',
    phase: '04.1-chat-true-task',
    plan: '04.1-01',
    startedAt: now(),
    apiUrl: API_URL || '(unset)',
    companyId: COMPANY_ID || '(unset)',
    configErrors,
    findings: {},
    spikeIssues: {},
    finishedAt: null,
  };

  if (configErrors.length > 0) {
    summary.finishedAt = now();
    log('config incomplete -- aborting before any host calls', {
      configErrors,
    });
    process.stdout.write('\n=== CHAT TRUE-TASK SPIKE PROBE SUMMARY ===\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return 1;
  }

  // Shared mutable state threaded across probes (probe issues created by
  // earlier probes are referenced by later ones so D-14's provoke path can
  // search the OQ3 probe issue for a runtime notice).
  const state = {
    oq3ProbeIssueId: null,
    oq1ProbeIssueId: null,
    oq2TaskAId: null,
    oq2TaskBId: null,
  };

  // Order: OQ-3 first (creates the probe issue D-14 can search), then D-14
  // (gets to use OQ-3's issue for the provoke path), then OQ-1, then OQ-2.
  log('PROBE-OQ3 -- D-12 requestWakeup gate strings');
  summary.findings.oq3 = await probeOQ3(state);

  log('PROBE-D14-DISCRIM -- runtime-comment discriminator');
  summary.findings.d14Discrim = await probeD14Discrim(state);

  log('PROBE-OQ1-STATUS -- non-terminal holding status + agent flip target');
  summary.findings.oq1Status = await probeOQ1Status(state);

  log('PROBE-OQ2-FILTER -- D-08 active-tasks query path');
  summary.findings.oq2Filter = await probeOQ2Filter(state);

  log('FLAG-2 -- Situation Room cross-effect check (planner-confirmed)');
  summary.findings.flag2 = flag2GrepResult();

  summary.spikeIssues = {
    oq3ProbeIssueId: state.oq3ProbeIssueId,
    oq1ProbeIssueId: state.oq1ProbeIssueId,
    oq2TaskAId: state.oq2TaskAId,
    oq2TaskBId: state.oq2TaskBId,
    note: `Spike issues are tagged ${SPIKE_TAG} in their titles -- greppable and safe to delete via 'paperclipai issue delete <id>' or rollback to the bookend snapshot.`,
  };
  summary.finishedAt = now();

  process.stdout.write('\n=== CHAT TRUE-TASK SPIKE PROBE SUMMARY ===\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(
    '\nPaste the JSON block above back into the GSD session so 04.1-01-SPIKE-FINDINGS.md can be written.\n',
  );
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    // Top-level guard -- the per-probe try/catch should have caught everything,
    // but never crash without a redacted message.
    process.stderr.write(redactedError(err, API_KEY).message + '\n');
    process.exit(1);
  });
