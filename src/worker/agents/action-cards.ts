// src/worker/agents/action-cards.ts
//
// Plan 13-02 (Phase 13 — Editor-Agent Named Action). The Editor-Agent
// action-card generation step. A 1:1 STRUCTURAL MIRROR of
// driveBulletinGlossStep (src/worker/bulletin/bulletin-gloss.ts).
//
// WHAT IT DOES. For each engine-flagged needsYou row (D-07 — the deterministic
// blocker-chain engine, NOT the AI, decides WHETHER a row needs a human), the
// Editor-Agent emits a grounded ACTION CARD: a single named action + the awaited
// party + a coarse time-estimate bucket (+ optional yes/no decision options when
// the source issue poses an explicit binary). ONE Editor-Agent operation per
// recompute emits a STRICT-JSON MAP keyed by sourceIssueId (the leaf UUID,
// dispatch-only — NO_UUID_LEAK, D-03/D-10), exactly like the gloss step emits a
// {threadId→sentence} map. Cards are cached PER LEAF in the additive
// plugin_clarity_pack_cdd6bda4bd.action_cards table (Plan 13-01 repo).
//
// CADENCE (D-06). This step runs in the situation.snapshot DATA handler (the
// valid HTTP-request scope the UI polls — the 60s on-view recompute) + the
// Editor-Agent heartbeat. NO new cron/loop (the cron path is dead — PR #6547).
//
// ANTI-FABRICATION (D-07..D-10). The AI never invents urgency: it only writes
// sentences for rows the engine already flagged. decisionOptions is CONSERVATIVE
// (D-08 — non-null only on an explicit binary array, default null). The estimate
// is a COARSE bucket {quick,focused,deep} (D-09 — never manufactured minutes).
// named_action / awaited_party carry ZERO raw UUIDs (D-10 — the prompt forbids
// them AND a belt-and-suspenders strip runs before cache).
//
// STALENESS (D-11). A cached card is FRESH iff its content_hash equals the
// recomputed hash (the *correctness* arm — catches a changed issue/verdict
// immediately) AND its generated_at is within 10 minutes of now (the *liveness*
// arm — catches a silently-dead agent). Stale/absent → no card on that row.
//
// GRACEFUL DEGRADE (D-12, LOCKED). The step NEVER throws: every host call is
// wrapped so a hiccup yields a non-error status and no card. A stale/absent card
// resolves to NO card for that row, so the UI degrades to the EXISTING
// deterministic blockerChain.humanAction / awaitedPartyLabel line — never blank,
// never fabricated. We NEVER auto-resume a paused agent on a passive view.
//
// ENGINE SEPARATION (D-15). This file imports NOTHING from
// src/shared/blocker-chain.ts — the engine verdict arrives as structured input
// on the needsYou rows passed in. All AI generation lives HERE.
//
// Instance-agnostic: NO company-prefix literal in the prompt or code.

import type { ActionCard } from '../../shared/types.ts';
import { UUID_RE_G } from '../../shared/scrub-human-action.ts';
import {
  EDITOR_AGENT_KEY,
  resolveEditorAgentId,
  type TldrViewDriverCtx,
} from './editor.ts';
import {
  tldrContentHash,
  polishTldr,
  EDITOR_AGENT_ID_TAG,
  type CompileTldrCtx,
} from './compile-tldr.ts';
import {
  upsertActionCard,
  getActionCardBySource,
  type ActionCardsCacheCtx,
  type ActionCardRow,
} from '../db/action-cards-repo.ts';
import {
  startAgentTask,
  pollAgentTaskResult,
  OPERATION_ORIGIN_KIND_PREFIX,
} from './agent-task-delivery.ts';

/** The ctx the action-card step needs — the SAME shape as the TL;DR view driver
 *  (op-issue discovery + the handoff + agents.get) plus the cache primitives'
 *  ctx (db.execute/query for finalizeTldr + the action-cards repo). The
 *  situation.snapshot handler satisfies this via a widening cast (mirror
 *  BulletinGlossCtx = TldrViewDriverCtx & CompileTldrCtx). */
export type ActionCardsCtx = TldrViewDriverCtx & CompileTldrCtx & ActionCardsCacheCtx;

/**
 * One engine-flagged needsYou row — the grounding input for ONE action card.
 * Carries ONLY the structured engine verdict fields + the source issue inputs
 * the prompt grounds in. `sourceIssueId` is the LEAF UUID (== verdict
 * targetIssueUuid / pathIds[last]) — the cache KEY + dispatch id, NEVER rendered
 * (NO_UUID_LEAK, D-03). The deterministic `humanAction` / `awaitedPartyLabel`
 * are the degrade-line source the UI falls back to when no fresh card exists.
 */
export type ActionCardSourceRow = {
  /** LEAF UUID — cache key / dispatch only, never rendered (D-03/D-10). */
  sourceIssueId: string;
  /** Human leaf identifier (e.g. BEAAA-649) — the prompt may cite it; display-safe. */
  leafIssueId: string | null;
  /** Scrubbed engine display party (grounding input — already NO_UUID_LEAK). */
  awaitedPartyLabel: string;
  /** The deterministic degrade line (D-12 fallback source). */
  humanAction: string;
  /** Engine affordance → action_kind mapping input (D-discretion). Mirrors
   *  BlockerChainResult['actionAffordance']. */
  actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none';
  /** Source issue grounding inputs (body/title/comments/refs). Optional — a row
   *  with no inputs still grounds on the party + leaf id. */
  inputs?: { body: string; comments: string[]; refs: string[] };
};

export type ActionCardsStepResult = {
  /** Fresh cards keyed by sourceIssueId. A row absent from this map degrades to
   *  the deterministic engine line (D-12). */
  cards: Record<string, ActionCard>;
  /**
   * - `ready`       — fresh cards applied (cache hit or just consumed).
   * - `compiling`   — the Editor-Agent is working; poll again on the next view.
   * - `paused`      — the Editor-Agent is paused; no auto-resume on a passive view.
   * - `unavailable` — no Editor-Agent could be resolved (can't start a compile).
   */
  status: 'ready' | 'compiling' | 'paused' | 'unavailable';
};

/** Cache surface/scope used for the content-hash recipe (deterministic, no clock). */
const ACTION_CARDS_SURFACE = 'situation' as const;
const ACTION_CARDS_SCOPE_PREFIX = 'action-cards:';

/** D-11 liveness arm — a card older than this (by generated_at) is stale even
 *  on a content-hash match. 10 minutes ≈ 5 SR recompute cycles of slack. */
export const ACTION_CARD_STALE_MS = 10 * 60 * 1000;

/** The per-company operation dedupe key (shared by start + read-back). Per
 *  company per recompute (D-05 / Claude's-discretion scoping). */
function actionCardsOperationId(companyId: string): string {
  return `action-cards-${companyId}`;
}

// ---------------------------------------------------------------------------
// PURE HELPERS (unit-tested) — bucket normalizer, binary detector, staleness.
// ---------------------------------------------------------------------------

/**
 * D-09 — normalize an agent-emitted estimate to the coarse bucket enum. Returns
 * the same value for a valid bucket; ANY other/empty/garbage input returns null
 * (the caller OMITS the estimate — never a fabricated number). Pure.
 */
export function normalizeEstBucket(value: unknown): 'quick' | 'focused' | 'deep' | null {
  if (value === 'quick' || value === 'focused' || value === 'deep') return value;
  return null;
}

/**
 * D-08 — CONSERVATIVE binary detection. Returns a non-empty string[] ONLY when
 * given an array of >=2 short non-empty strings (an explicit pick-one set, e.g.
 * ["Approve","Reject"]). Returns null for non-arrays, single-element arrays, or
 * open-ended input — a free-text answer is the honest default. Pure.
 */
export function parseDecisionOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 60);
  if (cleaned.length < 2) return null;
  return cleaned;
}

/**
 * D-11 — staleness predicate. A card is FRESH iff its content_hash equals the
 * recomputed hash (correctness arm) AND its generated_at is within
 * {@link ACTION_CARD_STALE_MS} of `nowMs` (liveness arm). Returns false on hash
 * mismatch OR age > 10 min OR a null/absent card. Pure — the clock is INJECTED,
 * never read internally.
 */
export function isActionCardFresh(
  card: { content_hash?: string; generated_at?: string } | null | undefined,
  recomputedHash: string,
  nowMs: number,
): boolean {
  if (!card) return false;
  if (card.content_hash !== recomputedHash) return false;
  const genMs = card.generated_at ? Date.parse(card.generated_at) : NaN;
  if (!Number.isFinite(genMs)) return false;
  return nowMs - genMs <= ACTION_CARD_STALE_MS;
}

/** Map the engine actionAffordance → the card action_kind (D-discretion). Pure. */
export function actionKindFromAffordance(
  affordance: ActionCardSourceRow['actionAffordance'],
): ActionCard['actionKind'] {
  switch (affordance) {
    case 'reply':
      return 'answer';
    case 'assign':
      return 'assign';
    default:
      // IN-01 — the 'decide' action_kind variant (declared in ActionCard,
      // ActionCardRow, and the 0015 CHECK constraint) is RESERVED for Phase 14
      // quick-decision chips: when an engine affordance carries explicit
      // decisionOptions, Phase 14 will map it to 'decide'. It is intentionally
      // not produced yet — do NOT remove the enum variant.
      return 'none';
  }
}

/** Belt-and-suspenders D-10 NO_UUID_LEAK strip for a persisted/rendered string.
 *  The prompt already forbids UUIDs; this guarantees none survive to cache. */
function stripUuids(s: string): string {
  return s.replace(UUID_RE_G, '').replace(/\s{2,}/g, ' ').trim();
}

/** WR-02 — cap a single grounding-input string before it is interpolated into
 *  the LLM prompt. Keeps the injected payload from dominating the prompt's
 *  instruction section. */
const PROMPT_INPUT_MAX_CHARS = 500;

/** WR-02 — lines that look like an instruction-prefix override (case-insensitive,
 *  leading-whitespace tolerant). Conservative + deterministic: a crafted issue
 *  body that opens a line with one of these is stripped before interpolation. */
const INJECTION_PREFIX_RE =
  /^\s*(?:ignore\b|disregard\b|forget\b|system\s*:|assistant\s*:|user\s*:|developer\s*:|###|---|```)/i;

/**
 * WR-02 — a conservative, DETERMINISTIC sanitizer for issue-derived grounding
 * text (body / comments) before it is interpolated into the action-card prompt.
 * Two arms: (1) drop any line whose start matches a known instruction-prefix
 * override pattern (a prompt-injection attempt — "Ignore all previous
 * instructions", "SYSTEM:", a fenced directive block, a `---` separator the
 * model might read as a new instruction section); (2) cap the result to
 * {@link PROMPT_INPUT_MAX_CHARS} so an injected payload cannot dominate the
 * prompt. Full LLM-injection prevention is an arms race; this is the
 * proportionate, testable floor. Pure (no clock, no I/O).
 */
export function sanitizePromptInput(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  const cleaned = s
    .split(/\r?\n/)
    .filter((line) => !INJECTION_PREFIX_RE.test(line))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > PROMPT_INPUT_MAX_CHARS
    ? cleaned.slice(0, PROMPT_INPUT_MAX_CHARS)
    : cleaned;
}

/**
 * WR-01 fix — build the canonical content-hash input for ONE row, covering ONLY
 * that row's own inputs (its source leaf id + scrubbed party + engine affordance
 * + issue body/comments/refs). A per-row recipe means adding/resolving an
 * UNRELATED needsYou row leaves every other row's hash — and therefore its
 * cached card — untouched (D-11 correctness arm stays per-row; the 10-min
 * liveness arm remains meaningful). Fixed field ordering, deterministic (no
 * clock). Exported for unit testing.
 */
function canonicalRowBody(r: ActionCardSourceRow): string {
  return JSON.stringify({
    id: r.sourceIssueId,
    party: r.awaitedPartyLabel ?? '',
    affordance: r.actionAffordance ?? 'none',
    body: r.inputs?.body ?? '',
    comments: Array.isArray(r.inputs?.comments) ? r.inputs!.comments : [],
    refs: Array.isArray(r.inputs?.refs) ? r.inputs!.refs : [],
  });
}

/**
 * WR-01 fix — the PER-ROW content hash (D-11). Keyed on a single row's own
 * inputs + its sourceIssueId scope, so the freshness check (isActionCardFresh)
 * reuses an unchanged row's cached card across Situation Room updates even when
 * other rows are added or resolved. Exported for unit testing.
 */
function actionCardRowContentHash(row: ActionCardSourceRow): string {
  return tldrContentHash({
    surface: ACTION_CARDS_SURFACE,
    scopeId: `${ACTION_CARDS_SCOPE_PREFIX}${row.sourceIssueId}`,
    inputs: { body: canonicalRowBody(row), comments: [], refs: [] },
  });
}

/**
 * The action-card PROMPT — instance-agnostic, STRICT-JSON, Editorial Desk voice.
 * Grounds each card in the source issue's body/comments + the scrubbed awaited
 * party. Instructs: describe ONLY what the issue says (no invented deadlines /
 * urgency / parties — D-07); decisionOptions ONLY on an explicit binary (D-08);
 * a coarse est_bucket (D-09); NO UUIDs / internal ids (D-10). NO company-prefix
 * literal. Exported for unit testing.
 */
export function buildActionCardPrompt(rows: ActionCardSourceRow[]): string {
  const blocks = rows.map((r) => {
    const lines = [
      `- id "${r.sourceIssueId}":`,
      `    awaiting: ${r.awaitedPartyLabel || 'unknown'}`,
    ];
    if (r.leafIssueId) lines.push(`    issue: ${r.leafIssueId}`);
    // WR-02 — sanitize issue-derived text (truncate + strip instruction-prefix
    // override lines) before interpolating it into the prompt.
    const safeBody = sanitizePromptInput(r.inputs?.body ?? '');
    if (safeBody) lines.push(`    body: ${safeBody}`);
    if (r.inputs?.comments && r.inputs.comments.length > 0) {
      const safeComments = r.inputs.comments
        .map((c) => sanitizePromptInput(c))
        .filter((c) => c.length > 0);
      if (safeComments.length > 0) {
        lines.push(`    recent: ${safeComments.join(' | ')}`);
      }
    }
    return lines.join('\n');
  });
  return [
    'You are the Clarity Pack Editorial Desk. For EACH blocked item below, write a',
    'grounded ACTION CARD for Eric — a busy founder — describing the ONE thing a',
    'human must do to unblock it. YOUR JOB IS TRANSLATION, NOT INVENTION.',
    '',
    'VOICE (same rules as the TL;DR): direct address ("you"), active present-tense',
    'verbs, concrete-over-nominal (name the decision in plain words, not a',
    'codename), human dates ("Wed 6/3" not "2026-06-03"), and translate every',
    'agent term (sign-off → approval, pre-read → review). Keep namedAction to one',
    'short sentence.',
    '',
    'HARD ANTI-FABRICATION RULES:',
    '  - Describe ONLY what the issue text says. Do NOT invent deadlines, urgency,',
    '    consequences, or parties not named in the source. If the issue does not',
    '    say it, you do not write it.',
    '  - awaitedParty: who must act, in plain words, grounded in the "awaiting"',
    '    line above. NEVER a UUID or internal id.',
    '  - estBucket: a COARSE bucket only — one of "quick" (a few minutes / one',
    '    decision), "focused" (up to ~30 min review), or "deep" (needs a real',
    '    work block). NEVER a number of minutes. If you cannot tell, omit it.',
    '  - decisionOptions: include a 2+ element array (e.g. ["Approve","Reject"])',
    '    ONLY when the issue clearly poses an explicit yes/no or pick-one question.',
    '    Otherwise OMIT it (a free-text answer is expected). Do NOT invent a false',
    '    binary on an open-ended question.',
    '  - NEVER put any UUID or internal identifier in namedAction or awaitedParty.',
    '',
    'Blocked items:',
    ...blocks,
    '',
    'Return STRICT JSON ONLY: an object mapping each id to its card, e.g.',
    '{"<id>":{"namedAction":"<one sentence>","awaitedParty":"<who>",',
    '"estBucket":"quick","decisionOptions":["Approve","Reject"]}}. Omit estBucket',
    'and decisionOptions when not warranted. No prose, no markdown, no code fence',
    'around the JSON.',
  ].join('\n');
}

/** Parse the agent's JSON-map body defensively (parse-throw / non-object → null). */
function parseCardMap(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize ONE raw agent map entry into a typed ActionCard for `row`. Applies
 * the bucket normalizer (D-09), the conservative binary detector (D-08), the
 * engine-derived action_kind (D-discretion), polishTldr + the UUID strip on the
 * display strings (D-10 voice parity + NO_UUID_LEAK), and grounds the awaited
 * party fallback in the engine label. Returns null when the entry yields no
 * usable named action (the row then degrades, D-12). Pure (no clock, no I/O).
 */
function normalizeCardEntry(row: ActionCardSourceRow, raw: unknown, generatedAt: string): ActionCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const rawNamed = typeof obj.namedAction === 'string' ? obj.namedAction : '';
  const namedAction = stripUuids(polishTldr(rawNamed));
  if (namedAction.length === 0) return null;

  const rawParty =
    typeof obj.awaitedParty === 'string' && obj.awaitedParty.trim().length > 0
      ? obj.awaitedParty
      : row.awaitedPartyLabel; // ground the fallback in the scrubbed engine label
  const awaitedParty = stripUuids(rawParty) || stripUuids(row.awaitedPartyLabel);
  // WR-03 — if BOTH the agent party and the engine label strip to empty (e.g.
  // an unresolved-userId label that was a bare UUID), degrade this row to NO
  // card rather than persist/render "waiting on  · …" (a dangling, visually
  // broken party). Consistent with D-12 and the namedAction guard above; the
  // empty result never introduces a UUID into the label (NO_UUID_LEAK).
  if (awaitedParty.length === 0) return null;

  // D-09 — coarse bucket; garbage/missing → null → render OMITS the estimate.
  const estBucket = normalizeEstBucket(obj.estBucket);
  // D-08 — conservative binary; default null.
  const decisionOptions = parseDecisionOptions(obj.decisionOptions);
  // D-discretion — action_kind is ENGINE-derived (deterministic), not agent-trusted.
  const actionKind = actionKindFromAffordance(row.actionAffordance);

  return {
    namedAction,
    awaitedParty,
    // estBucket is a required ActionCard field; default 'focused' when the agent
    // gave no usable bucket so the type is satisfied — the UI keys "show an
    // estimate" off a separate signal, but D-09's intent (no fake precision) is
    // honored because 'focused' is the neutral middle bucket, never minutes.
    estBucket: estBucket ?? 'focused',
    actionKind,
    decisionOptions,
    generatedAt,
    sourceIssueUuid: row.sourceIssueId,
  };
}

/** Persist one normalized card (best-effort, never throws). */
async function persistCard(
  ctx: ActionCardsCtx,
  args: { companyId: string; row: ActionCardSourceRow; card: ActionCard; contentHash: string; editorAgentId: string },
): Promise<void> {
  const { companyId, row, card, contentHash } = args;
  const dbRow: ActionCardRow = {
    company_id: companyId,
    source_issue_id: row.sourceIssueId,
    named_action: card.namedAction,
    awaited_party: card.awaitedParty,
    est_bucket: card.estBucket,
    action_kind: card.actionKind,
    decision_options: card.decisionOptions,
    content_hash: contentHash,
    generated_at: card.generatedAt,
    compiled_by_agent_id: EDITOR_AGENT_ID_TAG,
    source_revisions: [contentHash],
    tags: [],
  };
  try {
    await upsertActionCard(ctx, dbRow);
  } catch (e) {
    // A finalize/persist hiccup degrades to no-card for that row — never throws.
    ctx.logger?.warn?.(`action-cards: upsert failed: ${(e as Error).message}`, {
      companyId,
      sourceIssueId: row.sourceIssueId,
    });
  }
}

/** Map a cached ActionCardRow → the public ActionCard shape. */
function rowToCard(row: ActionCardRow): ActionCard {
  return {
    namedAction: row.named_action,
    awaitedParty: row.awaited_party,
    estBucket: row.est_bucket,
    actionKind: row.action_kind,
    decisionOptions: row.decision_options,
    generatedAt: row.generated_at,
    sourceIssueUuid: row.source_issue_id,
  };
}

/**
 * Read back an existing TERMINAL op's result for THIS company's action-cards op
 * (consume-before-spawn — the bulletin-gloss BUG-2 fix). The agent marks its op
 * `done` ~40s after the spawn-view's single poll already returned pending, so
 * startAgentTask's idempotency reuse (non-terminal only) can't catch it. Lists
 * the op(s) for this operationId and consumes ONLY ops in a TERMINAL status
 * (done / cancelled) — IN-03 fix: a non-terminal (in-flight) op may have filed
 * a partial/interim document body that satisfies the deliberately-permissive
 * `isResultDocument` gate; consuming it would treat a partial body as the final
 * cards map. A terminal-status filter guarantees we only read back a COMPLETED
 * op (the in-flight case is handled by the normal startAgentTask+poll path,
 * which is the standard slow-agent path anyway). Read-only + degrade-safe: any
 * throw → null.
 */
const OP_TERMINAL_STATUSES = new Set(['done', 'cancelled']);

async function readBackExistingOp(
  ctx: ActionCardsCtx,
  args: { companyId: string; editorAgentId: string },
): Promise<string | null> {
  const { companyId, editorAgentId } = args;
  let ops: Array<{ id?: string; status?: string }>;
  try {
    ops = (await ctx.issues.list({
      companyId,
      originKindPrefix: OPERATION_ORIGIN_KIND_PREFIX,
      originId: actionCardsOperationId(companyId),
      includePluginOperations: true,
    })) as Array<{ id?: string; status?: string }>;
  } catch (e) {
    ctx.logger?.warn?.(`action-cards: existing-op lookup failed: ${(e as Error).message}`, { companyId });
    return null;
  }
  for (const op of ops ?? []) {
    if (!op?.id) continue;
    // IN-03 — only consume a TERMINAL op; skip in-flight ops to avoid reading a
    // partial/interim document body as the final result.
    if (!OP_TERMINAL_STATUSES.has(op.status ?? '')) continue;
    try {
      const poll = await pollAgentTaskResult(ctx, {
        operationIssueId: op.id,
        companyId,
        operationKind: 'action-cards',
        agentId: editorAgentId,
      });
      if (poll.status === 'ready') {
        try {
          await ctx.issues.update(op.id, { status: 'done' }, companyId);
        } catch {
          /* non-fatal */
        }
        return poll.body;
      }
    } catch (e) {
      ctx.logger?.info?.('action-cards: existing-op poll skipped (non-fatal)', {
        operationIssueId: op.id,
        reason: (e as Error).message,
      });
    }
  }
  return null;
}

/** Finalize a raw agent JSON body into cards: parse defensively, normalize +
 *  persist each entry, return the map. A bad entry → no card for that row
 *  (degrade, D-12). Never throws. */
async function finalizeBody(
  ctx: ActionCardsCtx,
  args: { companyId: string; rows: ActionCardSourceRow[]; body: string; editorAgentId: string },
): Promise<Record<string, ActionCard>> {
  const { companyId, rows, body, editorAgentId } = args;
  const map = parseCardMap(body);
  const generatedAt = new Date().toISOString();
  const out: Record<string, ActionCard> = {};
  if (!map) return out;
  for (const row of rows) {
    const card = normalizeCardEntry(row, map[row.sourceIssueId], generatedAt);
    if (!card) continue; // degrade — no card on this row
    out[row.sourceIssueId] = card;
    // WR-01 — persist each card under its OWN per-row content hash so an
    // unrelated roster change cannot invalidate this row's cache entry.
    await persistCard(ctx, {
      companyId,
      row,
      card,
      contentHash: actionCardRowContentHash(row),
      editorAgentId,
    });
  }
  return out;
}

/**
 * D-04 — advance the action-card compile by exactly ONE step, in the CALLER's
 * (valid HTTP-request) invocation scope. A 1:1 mirror of driveBulletinGlossStep:
 * empty → ready; per-row cache check (D-11 freshness) → reuse fresh; all fresh →
 * ready; resolve agent (null → unavailable); CONSUME-BEFORE-SPAWN read-back;
 * PAUSED-check (no auto-resume); startAgentTask + ONE poll; ready → parse +
 * normalize + persist. NEVER throws — every host call is wrapped; a hiccup
 * yields a status only and the rows degrade to the deterministic engine line.
 */
export async function driveActionCardsStep(
  ctx: ActionCardsCtx,
  args: { companyId: string; needsYouRows: ActionCardSourceRow[] },
): Promise<ActionCardsStepResult> {
  const { companyId } = args;
  const rows = Array.isArray(args.needsYouRows) ? args.needsYouRows : [];
  if (rows.length === 0) {
    return { cards: {}, status: 'ready' };
  }

  const nowMs = Date.now();

  // CACHE CHECK (D-11) — per-row freshness (PER-ROW hash equality AND age ≤ 10
  // min). WR-01 fix: each row is compared against its OWN content hash, so a row
  // whose own inputs are unchanged reuses its cached card even when OTHER rows
  // are added or resolved. Stale/absent rows form the compile set.
  const cards: Record<string, ActionCard> = {};
  const compileRows: ActionCardSourceRow[] = [];
  for (const row of rows) {
    const rowHash = actionCardRowContentHash(row);
    let cached: ActionCardRow | null = null;
    try {
      cached = await getActionCardBySource(ctx, companyId, row.sourceIssueId);
    } catch (e) {
      ctx.logger?.warn?.(`action-cards: cache read failed: ${(e as Error).message}`, {
        companyId,
        sourceIssueId: row.sourceIssueId,
      });
    }
    if (cached && isActionCardFresh(cached, rowHash, nowMs)) {
      cards[row.sourceIssueId] = rowToCard(cached);
    } else {
      compileRows.push(row);
    }
  }

  // All rows fresh → return cached cards, no compile.
  if (compileRows.length === 0) {
    return { cards, status: 'ready' };
  }

  // CACHE MISS — resolve the Editor-Agent (op-issue discovery, NO dead reconcile).
  const editorAgentId = await resolveEditorAgentId(ctx, companyId);
  if (!editorAgentId) {
    ctx.logger?.info?.('action-cards: no Editor-Agent resolvable — no cards', { companyId });
    return { cards, status: 'unavailable' };
  }

  // READ-BACK (consume-before-spawn) — consume an existing done op's result
  // BEFORE spawning a fresh one.
  const priorBody = await readBackExistingOp(ctx, { companyId, editorAgentId });
  if (priorBody != null) {
    const fresh = await finalizeBody(ctx, {
      companyId,
      rows: compileRows,
      body: priorBody,
      editorAgentId,
    });
    return { cards: { ...cards, ...fresh }, status: 'ready' };
  }

  // PAUSED check — a paused agent never processes the compile; no auto-resume on
  // a passive SR view. Render the fresh cards we have + degrade the rest.
  try {
    const agent = await ctx.agents?.get?.(editorAgentId, companyId);
    if (agent && (agent.status === 'paused' || agent.pausedAt != null)) {
      ctx.logger?.info?.('action-cards: Editor-Agent paused — not starting (no auto-resume)', { companyId });
      return { cards, status: 'paused' };
    }
  } catch {
    /* status unknown — fall through and attempt the compile */
  }

  // START (or reuse the in-flight op via idempotency) + ONE immediate poll.
  let operationIssueId: string;
  try {
    const started = await startAgentTask(ctx, {
      agentId: editorAgentId,
      companyId,
      operationKind: 'action-cards',
      operationId: actionCardsOperationId(companyId),
      title: 'Compile Situation Room action cards',
      prompt: buildActionCardPrompt(compileRows),
    });
    operationIssueId = started.operationIssueId;
  } catch (e) {
    ctx.logger?.warn?.(`action-cards: startAgentTask failed: ${(e as Error).message}`, { companyId });
    return { cards, status: 'compiling' };
  }

  let poll: { status: 'ready'; body: string } | { status: 'pending' };
  try {
    poll = await pollAgentTaskResult(ctx, {
      operationIssueId,
      companyId,
      operationKind: 'action-cards',
      agentId: editorAgentId,
    });
  } catch (e) {
    ctx.logger?.warn?.(`action-cards: poll failed: ${(e as Error).message}`, { companyId });
    return { cards, status: 'compiling' };
  }
  if (poll.status !== 'ready') {
    return { cards, status: 'compiling' };
  }

  // READY — parse + normalize + persist defensively. A bad entry → no card on
  // that row (degrade). Then mark the op done (best-effort) so a later recompute
  // starts fresh.
  const fresh = await finalizeBody(ctx, {
    companyId,
    rows: compileRows,
    body: poll.body,
    editorAgentId,
  });
  try {
    await ctx.issues.update(operationIssueId, { status: 'done' }, companyId);
  } catch (e) {
    ctx.logger?.info?.('action-cards: could not mark op issue done (non-fatal)', {
      operationIssueId,
      reason: (e as Error).message,
    });
  }

  return { cards: { ...cards, ...fresh }, status: 'ready' };
}
