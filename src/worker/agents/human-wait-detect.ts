// src/worker/agents/human-wait-detect.ts
//
// Phase 17 Plan 17-03 Task 1 (WAIT-01, WAIT-02; D-03/D-04/D-05/D-06) — the
// Editor-Agent's HIGH-PRECISION "blocked on a human decision X" detection step.
//
// This is the PRODUCER half of the structured-human-wait producer/consumer
// split. 17-01 built the table + repo + the priority-0 AWAITING_HUMAN engine
// branch; 17-02 wired the three consuming merge sites. THIS module populates (or
// self-clears) the `clarity_human_waits` row those sites consume — structurally
// a SIBLING of the TL;DR compile, run inside the SAME per-issue heartbeat loop
// (editor.ts) over the SAME comments already fetched.
//
// It is the ONLY AI in the structured-wait path (the engine stays pure, SC4).
// The trust contract is HIGH PRECISION (D-03): a false positive puts a fake item
// in the centerpiece Needs-you tier and erodes trust; a missed wait is no worse
// than today's conservative Watch floor. So detection defaults to "no wait" on
// ANY ambiguity.
//
// GOVERNANCE (Phase 16.1, no-storm) — this module adds NO new wake path, NO new
// schedule, NO new event subscription. It rides the existing heartbeat pull +
// wake-governor + opt-in scope gate + self-loop filter that already wrap the
// editor loop. The op-issue delivery (startAgentTask/pollAgentTaskResult) uses a
// NEW operationKind 'human-wait-detect' in the EXISTING
// plugin:clarity-pack:operation:* namespace, so isOwnOperationIssue auto-excludes
// it from re-compilation (no recursion).
//
// DEGRADE-SAFE: when detection can't run / parse, when the issue is not blocked,
// or when no founder owner is claimed, NO row is written (or a stale row is
// self-cleared). The issue then falls to the conservative engine floor — never a
// fabricated needs-you.

import {
  startAgentTask,
  pollAgentTaskResult,
  type AgentTaskDeliveryCtx,
} from './agent-task-delivery.ts';
import { polishTldr, tldrContentHash } from './compile-tldr.ts';
import { extractJsonObject } from '../bulletin/compile-pass-1.ts';
import {
  upsertClarityHumanWait,
  deleteClarityHumanWait,
  listClarityHumanWaitsForCompany,
  type ClarityHumanWaitRepoCtx,
} from '../db/clarity-human-wait-repo.ts';
import { resolveFounderUserId } from '../situation/founder-resolution.ts';
import type { ClarityAgentOwnersRepoCtx } from '../db/clarity-agent-owners-repo.ts';

/**
 * Minimal issue shape the detection step reads. A blocked status is the
 * precondition for a structured wait (D-04 — the wait only exists WHILE blocked).
 */
export type HumanWaitIssue = {
  id: string;
  status?: string | null;
  description?: string | null;
  identifier?: string | null;
};

/** Minimal comment shape — the same rows editor.ts already fetched. */
export type HumanWaitComment = { body: string };

/**
 * The ctx slice detectAndPersistHumanWait needs. It is a STRICT SUBSET of the
 * Editor heartbeat ctx (AgentTaskDeliveryCtx for the op-issue handoff +
 * { db } for the repo / founder resolution), so the editor loop passes its own
 * ctx through unchanged.
 */
export type HumanWaitDetectCtx = AgentTaskDeliveryCtx &
  ClarityHumanWaitRepoCtx &
  ClarityAgentOwnersRepoCtx;

export type DetectAndPersistHumanWaitArgs = {
  agentId: string;
  companyId: string;
  issueId: string;
  issue: HumanWaitIssue;
  comments: HumanWaitComment[];
};

/** The structured shape the detection prompt is contracted to return. */
type HumanWaitDetectionResult = {
  isHumanWait: boolean;
  decisionOneLiner: string | null;
};

const MAX_ONE_LINER_CHARS = 80;

/**
 * Build the HIGH-PRECISION detection prompt (D-03). The prompt is tuned so the
 * agent returns isHumanWait=true ONLY when the prose CLEARLY names a decision or
 * question that is awaiting a SPECIFIC person (the operator/founder) — not merely
 * that the issue is blocked, not an agent waiting on another agent, not a vague
 * "stuck". On ANY ambiguity it must return false. The result is a STRICT JSON
 * object { isHumanWait, decisionOneLiner } so it parses out of prose via
 * extractJsonObject. (Exact wording is this module's discretion within D-03.)
 */
export function buildHumanWaitDetectionPrompt(
  body: string,
  comments: string[],
): string {
  const commentBlock =
    comments.length > 0
      ? comments.map((c, i) => `[comment ${i + 1}] ${c}`).join('\n')
      : '(no comments)';
  return [
    'You are the Editorial Desk. Read the issue below and decide, with HIGH',
    'PRECISION, whether it is BLOCKED ON A HUMAN DECISION — that is, whether the',
    'prose CLEARLY shows the work is waiting on a SPECIFIC PERSON (the founder /',
    'operator) to make a decision or answer a question before it can proceed.',
    '',
    'Set "isHumanWait": true ONLY when ALL of these hold:',
    '  - A concrete decision or question is named (e.g. "which vendor", "approve',
    '    the budget", "should we ship X or Y").',
    '  - It is clearly addressed to a PERSON to resolve — not another agent, not',
    '    an external system, not "waiting on a build".',
    '  - The wait is OPEN — the human has not already answered and the agent has',
    '    not already moved past it.',
    '',
    'If there is ANY ambiguity, if it is an agent-to-agent handoff, if it is a',
    'vague "blocked"/"stuck" with no named human decision, or if the decision',
    'already looks resolved: set "isHumanWait": false. A missed wait is SAFE; a',
    'false positive is NOT. Precision over recall.',
    '',
    'When isHumanWait is true, set "decisionOneLiner" to a short plain-English',
    'phrase naming the decision the person must make (e.g. "approve the Q3 budget"',
    'or "pick the launch date"). Keep it under 80 characters, no issue codes, no',
    'names. When isHumanWait is false, set "decisionOneLiner" to null.',
    '',
    'Respond with ONLY a JSON object on a single line, no prose, no code fence:',
    '{"isHumanWait": <boolean>, "decisionOneLiner": <string|null>}',
    '',
    '--- ISSUE BODY ---',
    body || '(no description)',
    '',
    '--- COMMENTS ---',
    commentBlock,
  ].join('\n');
}

/**
 * Parse the agent's detection result DEFENSIVELY. Any parse failure, missing
 * isHumanWait, or non-boolean isHumanWait collapses to a NEGATIVE detection
 * (isHumanWait=false) — the high-precision, degrade-safe default (D-03). Never
 * throws.
 */
export function parseHumanWaitDetection(raw: string): HumanWaitDetectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { isHumanWait: false, decisionOneLiner: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { isHumanWait: false, decisionOneLiner: null };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.isHumanWait !== true) {
    return { isHumanWait: false, decisionOneLiner: null };
  }
  const oneLiner =
    typeof obj.decisionOneLiner === 'string' && obj.decisionOneLiner.trim().length > 0
      ? obj.decisionOneLiner
      : null;
  return { isHumanWait: true, decisionOneLiner: oneLiner };
}

/**
 * Voice-parity the one-liner: pass through polishTldr (the SAME helper the
 * Reader/SR voice uses, D-05) then truncate to <=80 chars with an ellipsis (the
 * build-employees-rollup.ts:384-389 usage model). Returns '' for an empty/absent
 * one-liner so the caller can fall back.
 */
export function voiceOneLiner(oneLiner: string | null): string {
  const polished = polishTldr(oneLiner ?? '');
  if (polished.length === 0) return '';
  return polished.length > MAX_ONE_LINER_CHARS
    ? `${polished.slice(0, MAX_ONE_LINER_CHARS - 3)}…`
    : polished;
}

/**
 * Detect a structured human-wait on one blocked issue and persist (or
 * self-clear) the row. Called once per issue from the Editor heartbeat loop,
 * over the comments already fetched.
 *
 * Flow:
 *   1. Self-clear precondition (D-04): if the issue is NOT blocked, delete any
 *      stale wait row and return (the wait only exists while blocked).
 *   2. Idempotency short-circuit: if a persisted row already exists with the
 *      SAME content_hash over the same comment-input set, the inputs are
 *      unchanged — skip the LLM call (mirror the prepareTldrCompile cache-hit).
 *   3. Deliver the HIGH-PRECISION detection prompt through the existing op-issue
 *      layer (operationKind 'human-wait-detect'); on a not-ready poll, return
 *      without writing (the drainer / next heartbeat re-evaluates).
 *   4. Parse defensively. On a negative / ambiguous result, self-clear and
 *      return.
 *   5. On a positive result, resolve the founder owner (D-06); SKIP the write
 *      when null (degrade-safe). Else voice the one-liner and upsert the row.
 *
 * Never throws on a detection-internal failure path that the caller relies on
 * being isolated — but the editor loop ALSO wraps this in its per-issue
 * try/catch, so a thrown host error here is caught there and never aborts the
 * TL;DR compile or the loop.
 */
export async function detectAndPersistHumanWait(
  ctx: HumanWaitDetectCtx,
  args: DetectAndPersistHumanWaitArgs,
): Promise<void> {
  const { agentId, companyId, issueId, issue, comments } = args;

  // 1. Self-clear precondition (D-04) — the wait only exists while blocked.
  if (issue.status !== 'blocked') {
    await deleteClarityHumanWait(ctx, companyId, issueId);
    return;
  }

  const body = issue.description ?? '';
  const commentBodies = comments.map((c) => c.body);

  // content_hash over the SAME comment-input set the TL;DR uses (the 'human-wait'
  // surface keeps the hash namespace distinct from the issue TL;DR hash).
  const contentHash = tldrContentHash({
    surface: 'issue',
    scopeId: `human-wait-${issueId}`,
    inputs: { body, comments: commentBodies, refs: [] },
  });

  // 2. Idempotency short-circuit — unchanged inputs since the last persisted row
  //    → no-op (skip the LLM call). The list query is one bounded company-scoped
  //    read the prefetch already issues elsewhere; here we read it per-issue.
  const existing = await listClarityHumanWaitsForCompany(ctx, companyId);
  const priorRow = existing.find((w) => w.issue_id === issueId);
  if (priorRow && priorRow.content_hash === contentHash) {
    return;
  }

  // 3. Deliver the detection prompt through the EXISTING op-issue layer. NEW
  //    operationKind in the EXISTING plugin:clarity-pack:operation:* namespace →
  //    isOwnOperationIssue auto-excludes it; NO new wake path.
  const prompt = buildHumanWaitDetectionPrompt(body, commentBodies);
  const started = await startAgentTask(ctx, {
    agentId,
    companyId,
    operationKind: 'human-wait-detect',
    operationId: `human-wait-${issueId}`,
    title: `Detect human-wait — ${issueId}`,
    prompt,
  });
  const poll = await pollAgentTaskResult(ctx, {
    operationIssueId: started.operationIssueId,
    companyId,
    operationKind: 'human-wait-detect',
    agentId,
  });
  // Not ready in this invocation — leave it; the drainer / next heartbeat
  // re-evaluates. Do NOT write anything (degrade-safe).
  if (poll.status !== 'ready') {
    return;
  }

  const detection = parseHumanWaitDetection(poll.body);

  // 4. Negative / ambiguous → self-clear (D-04) and return.
  if (!detection.isHumanWait) {
    await deleteClarityHumanWait(ctx, companyId, issueId);
    return;
  }

  // 5. Positive → resolve the founder owner (D-06). null → SKIP the write
  //    (degrade-safe; the issue falls to the conservative floor, NOT a
  //    fabricated needs-you).
  const ownerUserId = await resolveFounderUserId(ctx, companyId);
  if (ownerUserId == null) {
    return;
  }

  // Voice-parity the one-liner (D-05) before persistence; fall back to a plain
  // phrase when the agent gave no usable one-liner (still high-precision: we only
  // reach here on a positive detection).
  const polishedOneLiner = voiceOneLiner(detection.decisionOneLiner) || 'a decision';

  await upsertClarityHumanWait(ctx, {
    company_id: companyId,
    issue_id: issueId,
    owner_user_id: ownerUserId,
    decision_one_liner: polishedOneLiner,
    content_hash: contentHash,
    generated_at: new Date().toISOString(),
    compiled_by_agent_id: agentId,
    source_revisions: [],
  });
}
