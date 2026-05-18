#!/usr/bin/env node
// scripts/spike/chat-spike-probe.mjs
//
// THROWAWAY Phase 4 (Employee Chat) falsify-first spike probe.
//
// This file ships NOTHING. It is not bundled, not under src/, never imported
// by plugin code. It exists only to be run ONCE, by Eric, against the live
// Countermoves Paperclip instance, bookended by a verified snapshot. After the
// findings doc (04-01-SPIKE-FINDINGS.md) is written it may be deleted.
//
// WHY a probe at all: Phase 4's whole reply loop rests on Paperclip's NATIVE
// `issue_commented` heartbeat wake — posting a comment on an agent-assigned
// issue is documented (CONTEXT.md D-01) to natively enqueue a heartbeat
// wakeup so the assigned employee-agent runs and replies. That behaviour is
// implementation-ahead-of-spec (RESEARCH.md MEDIUM confidence — proven only by
// code+tests at paperclipai/paperclip@242a2c2, absent from the formal spec).
// Phase 3's five gap-closure plans (03-06..03-10) were the direct cost of NOT
// running this discipline. So before any chat data layer, worker handler, or
// UI is written, this probe proves the four load-bearing assumptions live.
//
// It probes four questions (see RESEARCH.md "Open Questions"):
//   PROBE-D01 / OQ-4 : does an employee-agent natively WAKE on a comment, and
//                      in what FORM does it reply (issue_comments row vs a
//                      document)? The `issue_commented` wake is the contract.
//   PROBE-OQ2        : the shape of the new comment row (the 04-03 stream
//                      bridge derives commentId from event.entityId + a
//                      listComments re-fetch — this records the real shape).
//   PROBE-OQ3        : does flipping a `done` topic to `in_progress` ALONE
//                      re-wake the agent, or is requestWakeup also needed?
//   PROBE-OQ1        : is there ANY plugin-accessible attachment-upload path?
//
// USAGE (run from ~/clarity-pack on the Countermoves VPS, AFTER a verified
// snapshot — see runbook/operator-gotchas.md and the 04-01 plan Task 2):
//
//   PAPERCLIP_API_URL=http://127.0.0.1:3100 \
//   PAPERCLIP_API_KEY=<bearer token from ~/.paperclip/auth.json> \
//   PAPERCLIP_COMPANY_ID=<Countermoves company id> \
//     node scripts/spike/chat-spike-probe.mjs
//
// Optional env:
//   SPIKE_EMPLOYEE_AGENT_ID  pin the employee-agent to probe (else first
//                            non-Editor agent in the roster is used)
//   SPIKE_EDITOR_AGENT_ID    Editor-Agent id to EXCLUDE from auto-pick
//
// This runs OUTSIDE the plugin worker, so it cannot use the plugin SDK `ctx`.
// It mirrors the REST-client pattern from scripts/safety/lib/paperclip-api.mjs
// (native fetch, Bearer header, redacted errors). Every probe step is wrapped
// so one failure cannot abort the others — partial findings are still
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
// take minutes (RESEARCH.md D-04). Windows are bounded so the probe never
// hammers the host (T-04-03) and finishes in a predictable ~20-30 min.
const POLL_INTERVAL_MS = 30_000;
const D01_WINDOW_MS = 8 * 60_000; // 8 min for the first agent reply
const OQ3_WINDOW_MS = 4 * 60_000; // 4 min per OQ-3 sub-step (3 sub-steps)

const SPIKE_TAG = '[SPIKE]'; // every spike-created issue title carries this,
// so a botched run is greppable + deletable (threat T-04-01).

// Reply-channel instruction. RESEARCH.md OQ-4: Phase 3 found the Editor-Agent
// files DOCUMENTS instead of posting COMMENTS unless instructed via the issue
// description. This literal string is what 04-03's chat-send handler will fold
// into every new topic-issue description (D-14) if the spike comes back
// DEGRADED. The probe puts it in now so we test the instructed path.
const REPLY_CHANNEL_INSTRUCTION =
  'Reply to comments on this issue by posting a COMMENT on this issue (not a document).';

// ---------------------------------------------------------------------------
// Tiny REST client — mirrors scripts/safety/lib/paperclip-api.mjs
// ---------------------------------------------------------------------------

/** Redact the bearer token from any error message before it is logged. */
function redactedError(err, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return err;
  const original = err && typeof err.message === 'string' ? err.message : String(err);
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
  if (!API_URL) throw new Error('chat-spike-probe: PAPERCLIP_API_URL is required');
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
// Endpoint helpers — route shapes VERIFIED LIVE against Countermoves
// 2026-05-18. Issue/agent COLLECTION routes are companyId-scoped
// (`/api/companies/{id}/issues`, `/api/companies/{id}/agents`), but per-issue
// SUB-routes are FLAT (`/api/issues/{id}`, `/api/issues/{id}/comments`, ...).
// The earlier company-scoped per-issue guess returned 404 "API route not
// found" on createComment / updateIssue / documents — see the first failed
// run in 04-01-probe-output.txt. Discovery curl loop confirmed the flat shape.
// ---------------------------------------------------------------------------

const C = () => encodeURIComponent(COMPANY_ID);
const I = (issueId) => encodeURIComponent(issueId);

function listAgents() {
  return call('GET', `/api/companies/${C()}/agents`);
}

function createIssue(payload) {
  // payload: { parentId?, title, description?, status?, assigneeAgentId?,
  //            originKind?, originId? }
  // Collection route — companyId-scoped (verified: createIssue succeeded).
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

function requestWakeup(issueId) {
  // capability `issues.wakeup` is already declared in the manifest.
  return call('POST', `/api/issues/${I(issueId)}/wakeup`, {});
}

function listDocuments(issueId) {
  return call('GET', `/api/issues/${I(issueId)}/documents`);
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

// ---------------------------------------------------------------------------
// PROBE-D01 / OQ-4 — native agent wake + reply form
// ---------------------------------------------------------------------------

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
    if (fresh) return fresh;
    log('pollForNewComment: no new comment yet', {
      count: comments.length,
      remainingMs: deadline - Date.now(),
    });
  }
  return null;
}

async function probeD01(state) {
  // PROBE-D01/OQ-4: prove the native issue_commented heartbeat wake — create a
  // parent + child topic issue assigned to an employee-agent, post a comment,
  // observe whether the agent natively wakes and replies, and in what form.
  const finding = {
    probe: 'D01/OQ-4',
    question: 'Native agent wake on a comment + reply form (comment vs document)',
    steps: [],
    agentReplied: null,
    replyForm: null, // 'comment' | 'document' | 'both' | 'none'
    replyCommentShape: null, // raw new-comment JSON (also feeds OQ-2)
    replyAuthorField: null, // 'author_agent_id' | 'author_user_id' | unknown
    documentsFiledByAgent: null,
    verdictHint: null,
  };

  try {
    // Resolve a real employee-agent (NOT the Editor-Agent).
    const agentsRes = await listAgents();
    if (!ok(agentsRes.status)) {
      finding.steps.push(`listAgents non-2xx: ${agentsRes.status}`);
      finding.verdictHint = 'FAIL — could not load the agent roster';
      return finding;
    }
    const agents = asArray(agentsRes.body);
    let employee = null;
    if (PINNED_EMPLOYEE_AGENT_ID) {
      employee = agents.find((a) => a && a.id === PINNED_EMPLOYEE_AGENT_ID) || null;
    }
    if (!employee) {
      employee =
        agents.find(
          (a) => a && a.id && a.id !== EDITOR_AGENT_ID && a.id !== PINNED_EMPLOYEE_AGENT_ID,
        ) || agents.find((a) => a && a.id && a.id !== EDITOR_AGENT_ID) || null;
    }
    if (!employee) {
      finding.steps.push('no non-Editor employee-agent found in the roster');
      finding.verdictHint = 'FAIL — no employee-agent to probe';
      return finding;
    }
    finding.employeeAgentId = employee.id;
    finding.employeeAgentName = employee.name || employee.title || '(unnamed)';
    finding.steps.push(`resolved employee-agent ${employee.id}`);

    // Create the per-employee parent issue.
    const parentRes = await createIssue({
      title: `Chat — ${finding.employeeAgentName} ${SPIKE_TAG}`,
      description: 'Spike parent issue. Safe to delete after the spike.',
      status: 'todo',
      originKind: 'plugin:clarity-pack',
      originId: 'chat-spike',
    });
    if (!ok(parentRes.status) || !parentRes.body || !parentRes.body.id) {
      finding.steps.push(`parent createIssue failed: status ${parentRes.status}`);
      finding.verdictHint = 'FAIL — could not create the parent issue';
      return finding;
    }
    state.parentIssueId = parentRes.body.id;
    finding.parentIssueId = state.parentIssueId;
    finding.steps.push(`created parent issue ${state.parentIssueId}`);

    // Create the child topic issue assigned to the employee-agent.
    const childRes = await createIssue({
      parentId: state.parentIssueId,
      title: `Spike topic ${SPIKE_TAG}`,
      description: REPLY_CHANNEL_INSTRUCTION,
      status: 'todo',
      assigneeAgentId: employee.id,
      originKind: 'plugin:clarity-pack',
      originId: 'chat-spike',
    });
    if (!ok(childRes.status) || !childRes.body || !childRes.body.id) {
      finding.steps.push(`child createIssue failed: status ${childRes.status}`);
      finding.verdictHint = 'FAIL — could not create the child topic issue';
      return finding;
    }
    state.childIssueId = childRes.body.id;
    finding.childIssueId = state.childIssueId;
    finding.steps.push(`created child topic issue ${state.childIssueId}`);

    // Snapshot existing comments so we only count NEW ones.
    let seenIds = new Set();
    try {
      const before = await listComments(state.childIssueId);
      if (ok(before.status)) {
        for (const c of asArray(before.body)) if (c && c.id) seenIds.add(c.id);
      }
    } catch (err) {
      finding.steps.push(`pre-comment listComments threw: ${err.message}`);
    }

    // Post Eric's prompt comment.
    const promptRes = await createComment(
      state.childIssueId,
      'What is 2 + 2? Reply with a comment.',
    );
    if (!ok(promptRes.status)) {
      finding.steps.push(`prompt createComment non-2xx: ${promptRes.status}`);
      finding.verdictHint = 'FAIL — could not post the prompt comment';
      return finding;
    }
    // The prompt comment itself is now a "seen" id so it is not mistaken for
    // an agent reply.
    if (promptRes.body && promptRes.body.id) seenIds.add(promptRes.body.id);
    finding.steps.push('posted prompt comment; polling up to 8 min for a reply');

    // Poll for the agent reply.
    const reply = await pollForNewComment(state.childIssueId, seenIds, D01_WINDOW_MS);
    if (!reply) {
      finding.agentReplied = false;
      finding.replyForm = 'none';
      finding.verdictHint =
        'FAIL — no agent reply within 8 min; the issue_commented native wake did not fire';
    } else {
      finding.agentReplied = true;
      finding.replyForm = 'comment';
      finding.replyCommentShape = reply; // raw JSON — also the OQ-2 evidence
      // Capture the author field set on the reply row.
      if (reply.author_agent_id || reply.authorAgentId) {
        finding.replyAuthorField = 'author_agent_id';
      } else if (reply.author_user_id || reply.authorUserId) {
        finding.replyAuthorField = 'author_user_id';
      } else {
        finding.replyAuthorField = 'unknown — inspect replyCommentShape';
      }
      finding.steps.push(
        `agent replied with a comment; author field = ${finding.replyAuthorField}`,
      );
    }

    // Did the agent ALSO file a document? (Phase 3 surprise — A5.)
    try {
      const docsRes = await listDocuments(state.childIssueId);
      if (ok(docsRes.status)) {
        const docs = asArray(docsRes.body);
        finding.documentsFiledByAgent = docs.length;
        if (docs.length > 0 && finding.agentReplied) {
          finding.replyForm = 'both';
          finding.steps.push(`agent ALSO filed ${docs.length} document(s)`);
        } else if (docs.length > 0 && !finding.agentReplied) {
          finding.replyForm = 'document';
          finding.steps.push(
            `agent filed ${docs.length} document(s) but no comment — DEGRADED`,
          );
        }
      } else {
        finding.documentsFiledByAgent = `listDocuments non-2xx: ${docsRes.status}`;
      }
    } catch (err) {
      finding.documentsFiledByAgent = `listDocuments threw: ${err.message}`;
    }

    if (finding.verdictHint == null) {
      if (finding.replyForm === 'comment') {
        finding.verdictHint = 'PASS — agent woke and replied with a comment';
      } else if (finding.replyForm === 'both') {
        finding.verdictHint =
          'PASS-ish — agent woke and replied with a comment (also filed a document)';
      } else if (finding.replyForm === 'document') {
        finding.verdictHint =
          'DEGRADED — agent woke but filed a document instead of commenting';
      }
    }
  } catch (err) {
    finding.steps.push(`probeD01 threw: ${err.message}`);
    finding.verdictHint = finding.verdictHint || 'INCONCLUSIVE — probe error';
  }
  return finding;
}

// ---------------------------------------------------------------------------
// PROBE-OQ2 — issue.comment.created payload / comment row shape
// ---------------------------------------------------------------------------

function probeOQ2(d01Finding) {
  // The probe runs OUTSIDE the worker, so it cannot subscribe to ctx.events.
  // Instead it records the full JSON shape of the agent's reply comment (as
  // re-fetched by listComments in probeD01). This is exactly what the 04-03
  // stream bridge needs: if the live `issue.comment.created` event payload is
  // opaque, the bridge derives the comment from event.entityId (the issue id)
  // + a listComments re-fetch — this records that the re-fetch shape carries
  // id / body / created_at / author fields.
  const finding = {
    probe: 'OQ-2',
    question: 'issue.comment.created payload / comment row shape',
    canSubscribeFromProbe: false,
    note:
      'Probe runs outside the worker — cannot read ctx.events. Recorded the ' +
      'listComments re-fetch shape instead. 04-03 design input: the stream ' +
      'bridge derives commentId from event.entityId + a listComments re-fetch ' +
      'unless the live event payload proves to carry the comment id/body.',
    commentRowKeys: null,
    commentRowSample: null,
  };
  const shape = d01Finding && d01Finding.replyCommentShape;
  if (shape && typeof shape === 'object') {
    finding.commentRowKeys = Object.keys(shape);
    finding.commentRowSample = shape;
  } else {
    finding.note +=
      ' (No agent reply landed, so no comment-row shape was captured.)';
  }
  return finding;
}

// ---------------------------------------------------------------------------
// PROBE-OQ3 — auto-reopen re-wake of a `done` topic
// ---------------------------------------------------------------------------

async function probeOQ3(state) {
  // PROBE-OQ3: close the child topic (status `done`), post a comment, and find
  // out which step re-wakes the agent: (a) status flip to in_progress ALONE,
  // (b) status flip + requestWakeup, or (c) neither. This decides whether
  // 04-03's chat-send auto-reopen path (D-06) calls only ctx.issues.update or
  // ALSO ctx.issues.requestWakeup.
  const finding = {
    probe: 'OQ-3',
    question: 'Does a status flip alone re-wake a done topic, or is requestWakeup needed?',
    steps: [],
    wokeBy: null, // 'status-flip' | 'status-flip+requestWakeup' | 'neither'
    verdictHint: null,
  };

  if (!state.childIssueId) {
    finding.steps.push('no child issue from probeD01 — OQ-3 skipped');
    finding.verdictHint = 'INCONCLUSIVE — probeD01 did not create a child issue';
    return finding;
  }

  try {
    // Snapshot existing comments.
    const seenIds = new Set();
    try {
      const before = await listComments(state.childIssueId);
      if (ok(before.status)) {
        for (const c of asArray(before.body)) if (c && c.id) seenIds.add(c.id);
      }
    } catch (err) {
      finding.steps.push(`pre-step listComments threw: ${err.message}`);
    }

    // Close the topic.
    const closeRes = await updateIssue(state.childIssueId, { status: 'done' });
    finding.steps.push(`set status=done: HTTP ${closeRes.status}`);
    if (!ok(closeRes.status)) {
      finding.verdictHint = 'INCONCLUSIVE — could not close the topic';
      return finding;
    }

    // Post a re-wake comment while the issue is `done`.
    const wakeCommentRes = await createComment(
      state.childIssueId,
      'Re-wake test — reply with a comment.',
    );
    if (wakeCommentRes.body && wakeCommentRes.body.id) {
      seenIds.add(wakeCommentRes.body.id);
    }
    finding.steps.push(`posted re-wake comment: HTTP ${wakeCommentRes.status}`);

    // Step 0: wait 60s then poll 4 min — does the comment ALONE wake a done
    // topic? (Some hosts re-wake on a comment regardless of status.)
    await sleep(60_000);
    let reply = await pollForNewComment(state.childIssueId, seenIds, OQ3_WINDOW_MS);
    if (reply) {
      finding.wokeBy = 'comment-on-done-issue (no status flip)';
      finding.steps.push('agent replied with the issue still `done` — comment alone woke it');
      finding.verdictHint = 'STATUS-FLIP-NOT-NEEDED — a comment alone re-wakes a done topic';
      return finding;
    }
    finding.steps.push('no reply with status=done; flipping status to in_progress');

    // Step a: flip status to in_progress, do NOT call requestWakeup, poll 4 min.
    const flipRes = await updateIssue(state.childIssueId, { status: 'in_progress' });
    finding.steps.push(`set status=in_progress: HTTP ${flipRes.status}`);
    reply = await pollForNewComment(state.childIssueId, seenIds, OQ3_WINDOW_MS);
    if (reply) {
      finding.wokeBy = 'status-flip';
      finding.steps.push('agent replied after the status flip alone');
      finding.verdictHint =
        'STATUS-FLIP-SUFFICIENT — flipping to in_progress alone re-wakes the agent';
      return finding;
    }
    finding.steps.push('no reply after status flip; calling requestWakeup');

    // Step b: call requestWakeup, poll 4 more min.
    const wakeRes = await requestWakeup(state.childIssueId);
    finding.steps.push(`requestWakeup: HTTP ${wakeRes.status}`);
    reply = await pollForNewComment(state.childIssueId, seenIds, OQ3_WINDOW_MS);
    if (reply) {
      finding.wokeBy = 'status-flip+requestWakeup';
      finding.steps.push('agent replied only after requestWakeup');
      finding.verdictHint =
        'NEEDS-REQUESTWAKEUP — D-06 auto-reopen must also call ctx.issues.requestWakeup';
      return finding;
    }

    finding.wokeBy = 'neither';
    finding.verdictHint =
      'NEITHER — neither a status flip nor requestWakeup re-woke the agent within the windows';
  } catch (err) {
    finding.steps.push(`probeOQ3 threw: ${err.message}`);
    finding.verdictHint = finding.verdictHint || 'INCONCLUSIVE — probe error';
  }
  return finding;
}

// ---------------------------------------------------------------------------
// PROBE-OQ1 — attachment upload path
// ---------------------------------------------------------------------------

async function probeOQ1(state) {
  // PROBE-OQ1: RESEARCH.md already concludes SDK 2026.512.0 ships NO plugin
  // asset-upload API (PLUGIN_SPEC §8.1). This probe is a long-shot for an
  // UNDOCUMENTED path. It attempts, in order, and records the exact outcome:
  //   (a) an issue-documents upsert carrying a small base64 text body;
  //   (b) any host multipart upload route;
  //   (c) confirms there is no `assets` write route.
  // If NOTHING stores a retrievable file, CHAT-07 ships as the steady-state
  // degraded path (attach button disabled, explicit message).
  const finding = {
    probe: 'OQ-1',
    question: 'Is there ANY plugin-accessible attachment-upload path?',
    attempts: [],
    pathFound: false,
    retrievableFile: false,
    verdictHint: null,
  };

  const targetIssueId = state.childIssueId || state.parentIssueId || null;
  if (!targetIssueId) {
    finding.attempts.push({
      path: 'n/a',
      outcome: 'skipped — no spike issue id available to attach to',
    });
    finding.verdictHint = 'INCONCLUSIVE — no issue to attach to';
    return finding;
  }

  const sampleBody = Buffer.from('clarity-pack chat attachment spike test\n').toString(
    'base64',
  );

  // Attempt (a): issue-documents upsert with a base64 text body.
  try {
    const res = await call(
      'POST',
      `/api/issues/${I(targetIssueId)}/documents`,
      {
        key: 'chat-attachment-test',
        title: 'chat-attachment-test',
        contentType: 'text/plain',
        body: sampleBody,
        encoding: 'base64',
      },
    );
    const stored = ok(res.status);
    finding.attempts.push({
      path: 'POST /issues/{id}/documents (base64 body)',
      status: res.status,
      stored,
      responseSample: typeof res.body === 'object' ? res.body : String(res.body).slice(0, 200),
    });
    if (stored) {
      finding.pathFound = true;
      // Confirm retrievability.
      try {
        const back = await listDocuments(targetIssueId);
        const docs = asArray(back.body);
        const hit = docs.find(
          (d) =>
            d &&
            (d.key === 'chat-attachment-test' || d.title === 'chat-attachment-test'),
        );
        finding.retrievableFile = Boolean(hit);
        finding.attempts.push({
          path: 'GET /issues/{id}/documents (retrieval check)',
          status: back.status,
          retrieved: Boolean(hit),
        });
      } catch (err) {
        finding.attempts.push({
          path: 'GET /issues/{id}/documents (retrieval check)',
          outcome: `threw: ${err.message}`,
        });
      }
    }
  } catch (err) {
    finding.attempts.push({
      path: 'POST /issues/{id}/documents (base64 body)',
      outcome: `threw: ${err.message}`,
    });
  }

  // Attempt (b): a host multipart upload route. We probe a couple of plausible
  // routes with a HEAD/OPTIONS-style GET to see if any exist (404 vs 405/200).
  for (const route of [
    `/api/companies/${C()}/attachments`,
    `/api/issues/${I(targetIssueId)}/attachments`,
    `/api/companies/${C()}/uploads`,
    '/api/uploads',
  ]) {
    try {
      const res = await call('GET', route);
      finding.attempts.push({
        path: `GET ${route} (route-existence probe)`,
        status: res.status,
        note:
          res.status === 404
            ? 'route absent'
            : 'route responds — inspect for an upload affordance',
      });
      if (res.status !== 404 && ok(res.status)) {
        finding.attempts.push({
          path: route,
          note: 'a non-404 response here is a lead — 04-04 should inspect it',
        });
      }
    } catch (err) {
      finding.attempts.push({
        path: `GET ${route} (route-existence probe)`,
        outcome: `threw: ${err.message}`,
      });
    }
  }

  // Attempt (c): confirm there is no `assets` write route.
  try {
    const res = await call('POST', `/api/companies/${C()}/assets`, {
      key: 'chat-attachment-test',
      body: sampleBody,
    });
    finding.attempts.push({
      path: 'POST /companies/{id}/assets (assets write probe)',
      status: res.status,
      note:
        res.status === 404
          ? 'no assets write route — as RESEARCH.md predicted'
          : 'assets route responded — unexpected; inspect',
    });
    if (ok(res.status)) {
      finding.pathFound = true;
      finding.attempts.push({
        path: '/companies/{id}/assets',
        note: 'UNEXPECTED success — a real plugin asset write path may exist',
      });
    }
  } catch (err) {
    finding.attempts.push({
      path: 'POST /companies/{id}/assets (assets write probe)',
      outcome: `threw: ${err.message}`,
    });
  }

  if (finding.pathFound && finding.retrievableFile) {
    finding.verdictHint =
      'PATH-FOUND — a retrievable attachment path exists; describe it in the findings doc';
  } else if (finding.pathFound) {
    finding.verdictHint =
      'PARTIAL — a write succeeded but retrievability was not confirmed; inspect attempts';
  } else {
    finding.verdictHint =
      'NO-PATH — no plugin-accessible upload path; CHAT-07 ships as the steady-state degraded path';
  }
  return finding;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Fail fast on missing config — but DO print a structured summary so the
  // operator gets a usable result either way.
  const configErrors = [];
  if (!API_URL) configErrors.push('PAPERCLIP_API_URL is required');
  if (!API_KEY) configErrors.push('PAPERCLIP_API_KEY is required');
  if (!COMPANY_ID) configErrors.push('PAPERCLIP_COMPANY_ID is required');

  const summary = {
    probe: 'chat-spike-probe',
    phase: '04-employee-chat',
    plan: '04-01',
    startedAt: now(),
    apiUrl: API_URL || '(unset)',
    companyId: COMPANY_ID || '(unset)',
    configErrors,
    findings: {},
    finishedAt: null,
  };

  if (configErrors.length > 0) {
    summary.finishedAt = now();
    log('config incomplete — aborting before any host calls', { configErrors });
    process.stdout.write('\n=== CHAT SPIKE PROBE SUMMARY ===\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return 1;
  }

  // Shared mutable state threaded across probes (issue ids created in D01 are
  // reused by OQ-3 and OQ-1 so the spike creates exactly one topic tree).
  const state = { parentIssueId: null, childIssueId: null };

  log('PROBE-D01/OQ-4 — native agent wake + reply form');
  summary.findings.d01 = await probeD01(state);

  log('PROBE-OQ2 — comment row shape');
  summary.findings.oq2 = probeOQ2(summary.findings.d01);

  log('PROBE-OQ3 — auto-reopen re-wake');
  summary.findings.oq3 = await probeOQ3(state);

  log('PROBE-OQ1 — attachment upload path');
  summary.findings.oq1 = await probeOQ1(state);

  summary.spikeIssues = {
    parentIssueId: state.parentIssueId,
    childIssueId: state.childIssueId,
    note: `Spike issues are tagged ${SPIKE_TAG} in their titles — greppable and safe to delete.`,
  };
  summary.finishedAt = now();

  process.stdout.write('\n=== CHAT SPIKE PROBE SUMMARY ===\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(
    '\nPaste the JSON block above back into the GSD session so 04-01-SPIKE-FINDINGS.md can be written.\n',
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
