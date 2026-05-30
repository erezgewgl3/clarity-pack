// src/worker/agents/compile-tldr.ts
//
// Plan 02-03 Task 1 — the core TL;DR compile loop. Implements four locked
// hardening properties:
//
//   - EDITOR-03 idempotency: content_hash over (surface, scope_id, inputs)
//     dedupes; same inputs twice = ONE LLM call.
//   - EDITOR-04 self-loop input: writes carry EDITOR_WRITE_TAG so the next
//     heartbeat's filterSelfLoopEvents() excludes them.
//   - EDITOR-05 max-tokens cap: estimated input tokens are checked BEFORE
//     invoking the LLM adapter. Cap breach → recordFailure + throw, no LLM
//     spend.
//   - D-06 circuit breaker: any throw (LLM error, schema-validation failure,
//     cap breach) is recorded; after MAX_CONSECUTIVE_FAILURES the agent is
//     paused.
//
// Architecture note — SDK 2026.512.0 does NOT expose ctx.llm.complete() OR
// ctx.agents.onHeartbeat(). The plan's pseudocode assumed those APIs; the
// real surfaces are:
//   - LLM calls go through the agent's adapter (claude_local / process) when
//     the agent is woken via ctx.agents.invoke(agentId, companyId, {prompt}).
//   - The agent calls back into our worker via MCP tools (Phase 3 deepens
//     this) and uses our tools to write the resulting TL;DR.
//
// For v1 dogfood we expose compileTldr() as the kernel both paths converge
// on: the agent's adapter may call it via an MCP tool, or our event-handler
// may invoke it directly with a stub adapter while the MCP wiring beds in.
// The injectable `ctx.llm` shape is the seam — production wires it to
// ctx.agents.invoke(); tests inject a stub.

import crypto from 'node:crypto';

import { upsertTldr, getTldrByScope, type TldrRow, type TldrCacheCtx } from '../db/tldr-cache.ts';
import {
  recordFailure,
  recordSuccess,
  type CircuitBreakerCtx,
} from './circuit-breaker.ts';
import { EDITOR_WRITE_TAG } from './self-loop-filter.ts';

/**
 * Input-token cap for a TL;DR compile.
 *
 * View-driven rework (2026-05-28) — RAISED 4000 → 16000. The old 4000 cap caused
 * long tasks (e.g. a multi-paragraph strategy memo) to be SKIPPED entirely on
 * BEAAA — "No TL;DR yet" forever on exactly the tasks most worth summarizing
 * (live evidence: `input exceeds max_tokens cap (4758 > 4000)` skips). The modern
 * agent summarizes 16k tokens comfortably, so the cap is raised to let it read
 * the whole task. For pathological inputs BEYOND 16k, `truncateTldrInputs`
 * head/tail-truncates as a backstop and flags it so the Reader can surface a
 * "summarized from a long task" notice (operator decision 2026-05-28).
 */
export const MAX_TOKENS = 16000;

/** Tag stamped on a TL;DR whose input was truncated to fit the cap. Surfaced in the Reader. */
export const TLDR_TRUNCATED_TAG = 'clarity:truncated';

/** Marker inserted at the head/tail cut so the agent (and a reader) sees the gap. */
const TLDR_TRUNCATION_MARKER =
  '\n\n…[task content truncated for length — summarize the opening and the latest sections below]…\n\n';

/**
 * Fit the TL;DR inputs under `maxTokens`. A no-op when the full prompt already
 * fits (the common case now that the cap is 16k). Over the cap, head/tail-cuts
 * the body (keeps the opening + the latest section) and caps the comments,
 * preserving refs, and returns `truncated:true` so the caller can flag it.
 */
export function truncateTldrInputs(
  inputs: { body: string; comments: string[]; refs: string[] },
  maxTokens: number = MAX_TOKENS,
): { inputs: { body: string; comments: string[]; refs: string[] }; truncated: boolean } {
  const fullPrompt = buildPrompt({
    surface: 'issue',
    scopeId: '',
    inputs,
    agentKey: '',
    agentId: '',
    companyId: '',
  });
  if (estimateTokens(fullPrompt) <= maxTokens) {
    return { inputs, truncated: false };
  }

  // estimateTokens ≈ chars / 4. Reserve headroom for the prompt scaffolding +
  // the truncation marker; split the remainder body-heavy (comments ≤ 25%).
  //
  // Plan 250530 — DYNAMIC reserve. The original 1200-char reserve was sized
  // for the Plan 07-02 prompt; the 1.1.1 prompt-contract addition pushed the
  // scaffolding past it and the truncated body overshot the cap by ~56 tokens.
  // Compute the scaffolding length empirically: build the prompt with EMPTY
  // body+comments (refs preserved — they appear in the footer) so any future
  // prompt edit auto-adjusts the reserve. The TLDR_TRUNCATION_MARKER is added
  // back inside the body during truncation, so we subtract its length too.
  const charBudget = maxTokens * 4;
  const scaffolding = buildPrompt({
    surface: 'issue',
    scopeId: '',
    inputs: { body: '', comments: [], refs: inputs.refs },
    agentKey: '',
    agentId: '',
    companyId: '',
  });
  const reserve = scaffolding.length + TLDR_TRUNCATION_MARKER.length;
  const avail = Math.max(2000, charBudget - reserve);
  const commentsJoined = inputs.comments.join('\n');
  const commentBudget = Math.min(commentsJoined.length, Math.floor(avail * 0.25));
  const bodyBudget = avail - commentBudget;

  let truncated = false;
  let body = inputs.body;
  if (body.length > bodyBudget) {
    const headLen = Math.floor(bodyBudget * 0.66);
    const tailLen = Math.max(0, bodyBudget - headLen - TLDR_TRUNCATION_MARKER.length);
    body =
      body.slice(0, headLen) +
      TLDR_TRUNCATION_MARKER +
      (tailLen > 0 ? body.slice(body.length - tailLen) : '');
    truncated = true;
  }

  const comments: string[] = [];
  let used = 0;
  for (const c of inputs.comments) {
    if (used + c.length > commentBudget) {
      truncated = true;
      break;
    }
    comments.push(c);
    used += c.length + 1;
  }

  return { inputs: { body, comments, refs: inputs.refs }, truncated };
}

/**
 * Stable agent id for compiled-by attribution. Survives reconciliation cycles;
 * the resolved agentId UUID changes per-company while this tag stays constant
 * so cross-company queries can identify our writes uniformly.
 */
export const EDITOR_AGENT_ID_TAG = 'clarity-pack-editor-agent';

/**
 * Rough token estimator. ~4 chars per token is the OpenAI/Anthropic published
 * rule-of-thumb for English. Replace with tiktoken (or the model-specific
 * tokenizer) in v2 once we know which adapter the operator picked.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Output schema validation. EDITOR-05 lists this as a "failure" mode that
 * counts toward the circuit breaker. Empty string, non-string, or absurdly
 * long output all qualify. The upper bound (8000 chars ≈ 2000 tokens) is
 * a sanity check, not a billing cap — the cap is on INPUT (MAX_TOKENS).
 */
function validateLlmOutput(body: unknown): asserts body is string {
  if (typeof body !== 'string' || body.length === 0 || body.length > 8000) {
    throw new Error(`Editor-Agent output failed schema validation (len=${typeof body === 'string' ? body.length : 'non-string'})`);
  }
}

/**
 * Plan 250530 v1.1.7 — DETERMINISTIC META-PROSE STRIPPER.
 *
 * Layered on top of v1.1.6's prompt rules because LLM prompt-rule compliance
 * is unreliable. BEAAA-1000 shipped a TL;DR that was literally a meta-narration
 * of its own output ("The TL;DR leads with… notes both… points at the …
 * kickoff path. 82 words, within the ~80-word envelope."). The prompt rules
 * forbid this; the LLM ignored them. v1.1.7 enforces the contract at the
 * worker tier with a sentence-level regex strip.
 *
 * A sentence is dropped when it matches ANY of these patterns (case-
 * insensitive):
 *   - the literal "TL;DR" used as a subject ("The TL;DR leads with…",
 *     "TL;DR notes…", "TL;DR is stored…", "TL;DR opens with…",
 *     "TL;DR summarizes…", "TL;DR describes…", "TL;DR points at…")
 *   - "compile-result document" / "compile result"
 *   - "operation issue is marked" (any tense)
 *   - "stored as the … document"
 *   - explicit word-count claims: "82 words, within the …", "~80-word envelope"
 *
 * Lines that become empty after strip are dropped. The function preserves
 * markdown structure (bullets, headings, blank-line separators).
 */
export const META_PROSE_PATTERNS: RegExp[] = [
  // Meta-narration: TL;DR used as a subject with a meta-verb. Requires the
  // verb so legitimate prose like "the TL;DR body" doesn't match.
  /\b(?:the\s+)?TL;?DR\s+(?:stored|leads|notes|points|opens|summarizes|summarises|describes|carries|reports|begins|is\s+(?:stored|about|marked))\b/i,
  // Bookkeeping references unique to the Editor-Agent's own operation flow.
  /\bcompile[-\s]?result\b/i,
  /\boperation\s+issue\s+is\s+(?:marked|now)\b/i,
  /\bstored\s+as\s+the\s+\S+\s+document\b/i,
  // Word-count self-commentary ("82 words, within the ~80-word envelope.").
  /\b\d+\s+words?\s*,?\s*within\s+the\b/i,
  /\b~?\d+[-\s]?word\s+envelope\b/i,
  /\bword\s+envelope\b/i,
];

/**
 * Minimum body length AFTER stripping. The strip removes meta-noise but the
 * remaining prose must be substantive enough to be useful. A body shorter than
 * this is treated as a compile failure (recordFailure → next view-driven
 * trigger retries). Picked at 50 chars because a useful headline + one short
 * bullet is at least that long.
 */
export const MIN_USEFUL_TLDR_LEN = 50;

/** Split a single line of prose into sentences. Naive split on `. ` (period +
 *  space) — does not handle abbreviations, but the TL;DR is short prose where
 *  edge cases are rare. The next-sentence start can be ANY non-whitespace char
 *  (capital letter, digit, paren) so a sentence like "82 words, within the
 *  ~80-word envelope." that follows substantive prose is correctly split off
 *  and matched against the meta patterns (not glued to its predecessor).
 *  Returns sentences with their trailing period reattached. */
export function splitSentences(line: string): string[] {
  if (typeof line !== 'string' || line.length === 0) return [];
  const parts = line.split(/(?<=[.!?])\s+(?=\S)/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Pure: strip meta-prose sentences from a TL;DR body. Preserves markdown
 *  structure (bullets / headings / paragraph breaks). Returns the cleaned
 *  body (may be empty if every sentence was meta). Never throws. */
export function stripMetaProse(body: string): string {
  if (typeof body !== 'string' || body.length === 0) return '';
  const lines = body.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      cleaned.push(line);
      continue;
    }
    // Preserve a leading markdown prefix (bullet / blockquote / heading) on
    // the line so the sentence-level strip below only touches the prose.
    const prefixMatch = /^(\s*(?:[-*]\s+|>\s+|#{1,6}\s+)?)(.*)$/.exec(line);
    const prefix = prefixMatch?.[1] ?? '';
    const content = prefixMatch?.[2] ?? line;
    const sentences = splitSentences(content);
    const kept = sentences.filter(
      (s) => !META_PROSE_PATTERNS.some((p) => p.test(s)),
    );
    if (kept.length === 0) {
      // The whole line was meta — drop it entirely.
      continue;
    }
    cleaned.push(prefix + kept.join(' '));
  }
  // Collapse runs of blank lines to a single blank line, trim outer blanks.
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of cleaned) {
    const isBlank = line.trim().length === 0;
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }
  return collapsed.join('\n').trim();
}

export type LlmAdapter = {
  /**
   * Run the LLM completion. Production wires this to ctx.agents.invoke() via
   * an adapter shim; tests inject a stub that returns a canned string or
   * throws to simulate failures.
   */
  complete(args: { maxTokens: number; prompt: string }): Promise<string>;
};

export type CompileTldrCtx = TldrCacheCtx &
  CircuitBreakerCtx & {
    logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void; error?(...a: unknown[]): void };
    llm?: LlmAdapter;
  };

export type CompileTldrArgs = {
  surface: TldrRow['surface'];
  scopeId: string;
  inputs: { body: string; comments: string[]; refs: string[] };
  agentKey: string;
  agentId: string;
  companyId: string;
  /**
   * Optional adapter override. When absent, ctx.llm is used (or compileTldr
   * throws with a helpful "no llm adapter wired" message). Tests pass a stub.
   */
  llm?: LlmAdapter;
};

/**
 * Delivery-layer rework (2026-05-28) — exported so the cross-tick TL;DR START
 * step (editor.ts heartbeat) and the drainer build the same prompt the
 * synchronous `compileTldr` builds. Reads only surface / scopeId / inputs.
 */
export function buildTldrPrompt(args: CompileTldrArgs): string {
  return buildPrompt(args);
}

function buildPrompt(args: CompileTldrArgs): string {
  // Plan 07-02 (D-I3-03) — tightened to a hard, founder-readable OUTPUT shape.
  // The old prompt ("Compile a plain-English TL;DR") gave the agent no shape, so
  // it emitted long, raw-markdown blobs the operator could not skim. We now
  // instruct a 1-2 sentence headline + at most 3 bullets + a length cap, in the
  // busy-founder voice (decision → current state → next action). This is an
  // OUTPUT-shape instruction only — the INPUT cap (MAX_TOKENS) is unchanged and
  // the input scaffolding (Surface / Scope id / Issue body / comments / refs)
  // below is intact. Phase 3 deepens the Bulletin/Situation Room voice.
  //
  // Plan 250530 — REF + JARGON contract added. BEAAA-1047 (2026-05-30) shipped a
  // TL;DR riddled with `[BEAAA-933](/BEAAA/issues/BEAAA-933)` markdown links and
  // backtick-wrapped ids (`BEAAA-933 — BEAAA-187 child — v1.1.2 reconciliation`)
  // AND domain jargon (AC4 / HoUW / op-seat / dual-anchor) with no expansion.
  // Both shapes BYPASS the Reader's ref-chip pipeline (which shows id + title +
  // status as a clickable hover-peek) — the operator saw bare ids without
  // titles and unexpanded acronyms, the exact rabbit-hole the Reader exists to
  // close. The PARSER fix (safe-markdown.ts same commit family) catches the
  // canonical `[ID](/<prefix>/issues/ID)` link and bare-id code span, but
  // mixed-content code spans must be solved at the source — tighten the prompt.
  const lines = [
    'You are the Clarity Pack Editorial Desk. Compile a plain-English TL;DR for the following Paperclip issue.',
    '',
    'Write for a busy founder who has 10 seconds: lead with the decision, then the current state, then the single next action.',
    'Use this hard shape and DO NOT exceed it:',
    '  - A 1-2 sentence headline (the decision or the one thing that matters now).',
    '  - Then AT MOST 3 short bullets (current state / blockers / next action).',
    '  - Keep the whole TL;DR concise — under ~80 words. Be brief; cut filler.',
    'You may use light markdown (bold, bullets, links); never pad to fill space.',
    '',
    'When you cite another issue, write its id as plain prose (e.g. "BEAAA-933"). DO NOT wrap it in backticks (`BEAAA-933`) or a markdown link ([BEAAA-933](/BEAAA/issues/BEAAA-933)). The Reader auto-renders every plain id as a clickable chip showing id + title + status + a hover-peek with the owner and a one-line excerpt — wrapping the id in code or a link strips the title and forces the reader to click out.',
    'Do NOT restate a cited issue\'s title or status next to its id (the chip already shows them). Just write the id; the chip handles the rest.',
    'Expand every internal abbreviation or jargon term on first use, e.g. "Head of Underwriting (HoUW)", "Acceptance Criterion 4 (AC4)", "operating seat (op-seat)". A reader without domain context must understand the TL;DR end-to-end.',
    '',
    'CRITICAL CONTENT RULE — the TL;DR summarizes the ISSUE itself. The reader wants to know: what is this issue about, what is the decision in flight, what is the single next action. Do NOT describe how the TL;DR is compiled, where it is stored, what document key carries it, what operation issue tracks it, what your own internal status is, or any other meta-information about your work as the Editorial Desk. The reader does not care that "the TL;DR is stored as the compile-result document on BEAAA-1168" or that "the operation issue is marked done" — those are bookkeeping details. They care what THIS issue is about.',
    'NEVER reference your own clarity-pack operation issues (the ones you create to track compile-result delivery, sign-offs, bulletin generation, etc. — titles like "Compile TL;DR — <uuid>", "Bulletin compile — <date>"). The reader has no context for them and they pollute the prose with UUIDs.',
    '',
    'BAD example (what NOT to write, all three failures at once):',
    '  "TL;DR stored as the `compile-result` document on `BEAAA-1168 — Compile TL;DR — a119b8e7-…` and the operation issue is marked done. The TL;DR leads with the Wed binding ratification, notes both operational sign-offs closed."',
    'GOOD example (what TO write — same source issue):',
    '  "**Wed 2026-06-03 binding ratification on hold pending HoUW countersign of BEAAA-933.** Both operational sign-offs are closed (BEAAA-1086, BEAAA-1103) — Underwriter pre-read and Claims Architect sign-off both complete. Next: HoUW countersign on BEAAA-933 to unblock the ratification."',
    'Notice in the GOOD example: the headline names the decision (ratification) and the blocker (countersign). The cited refs are plain BEAAA-NNN tokens with no manual gloss — the chip will resolve the title. There is no mention of compile-result documents, operation issues, or storage paths.',
    '',
    `Surface: ${args.surface}`,
    `Scope id: ${args.scopeId}`,
    '',
    'Issue body:',
    args.inputs.body,
    '',
  ];
  if (args.inputs.comments.length > 0) {
    lines.push('Recent comments:');
    for (const c of args.inputs.comments) lines.push(`- ${c}`);
    lines.push('');
  }
  if (args.inputs.refs.length > 0) {
    lines.push(`Referenced ids: ${args.inputs.refs.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Build the deterministic content hash. Inputs that produce the same canonical
 * JSON-stringified blob produce the same hash, regardless of insertion order.
 * (We sort keys at the top level for stability.)
 */
/**
 * Build the deterministic content hash for a (surface, scopeId, inputs) triple.
 *
 * Delivery-layer rework (2026-05-28) — exported as `tldrContentHash` so the
 * cross-tick drainer (which re-reads the issue inputs to key the cache) computes
 * the SAME hash the heartbeat compile used. Reads only surface / scopeId /
 * inputs, so the full `CompileTldrArgs` structurally satisfies it.
 */
export function tldrContentHash(args: {
  surface: TldrRow['surface'];
  scopeId: string;
  inputs: { body: string; comments: string[]; refs: string[] };
}): string {
  const canonical = JSON.stringify({
    surface: args.surface,
    scopeId: args.scopeId,
    body: args.inputs.body,
    comments: args.inputs.comments,
    refs: args.inputs.refs,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function contentHashFor(args: CompileTldrArgs): string {
  return tldrContentHash(args);
}

/**
 * Delivery-layer rework (2026-05-28) — the "prepare" half of compileTldr,
 * everything up to (but not including) the LLM call: the EDITOR-03 cache check
 * and the EDITOR-05 token-cap gate. Shared by the synchronous `compileTldr` AND
 * the cross-tick heartbeat START step (editor.ts) so neither duplicates the
 * cache/cap logic.
 *
 *   - `cache-hit` — a fresh cached row exists; the caller returns it (no compile).
 *   - `capped`    — the prompt exceeds MAX_TOKENS; recordFailure has ALREADY
 *                   fired (EDITOR-05). The caller skips (heartbeat) or throws
 *                   (compileTldr) — no LLM/agent call.
 *   - `compile`   — proceed: `prompt` + `contentHash` are returned for the caller
 *                   to deliver to the agent + key the resulting cache row.
 */
export type PrepareTldrResult =
  | { kind: 'cache-hit'; tldr: TldrRow }
  | { kind: 'compile'; prompt: string; contentHash: string; truncated: boolean };

export async function prepareTldrCompile(
  ctx: CompileTldrCtx,
  args: CompileTldrArgs,
): Promise<PrepareTldrResult> {
  // content_hash is over the ORIGINAL (untruncated) inputs so the cache key
  // reflects the real task — a TL;DR is recompiled when the task actually
  // changes, not when the truncation boundary shifts.
  const contentHash = contentHashFor(args);

  // EDITOR-03: check cache by (surface, scope_id). If the most-recent row's
  // hash matches, return it without an LLM call.
  const cached = await getTldrByScope(ctx, args.surface, args.scopeId);
  if (cached && cached.content_hash === contentHash) {
    return { kind: 'cache-hit', tldr: cached };
  }

  // View-driven rework (2026-05-28) — no longer a hard cap-and-skip. The cap is
  // raised (16k) so the agent reads the whole task; an input beyond the cap is
  // head/tail-truncated as a backstop and flagged so the Reader can surface it.
  const { inputs: promptInputs, truncated } = truncateTldrInputs(args.inputs, MAX_TOKENS);
  const prompt = buildPrompt({ ...args, inputs: promptInputs });
  return { kind: 'compile', prompt, contentHash, truncated };
}

/**
 * Delivery-layer rework (2026-05-28) — the "finalize" half of compileTldr: turn a
 * RAW agent result body into a validated, cached TldrRow. Shared by the
 * synchronous `compileTldr`, the cross-tick heartbeat (immediate-ready), and the
 * drainer (a later tick). Output-schema failures count toward the D-06 breaker
 * (recordFailure + throw — the caller skips). A clean body resets the breaker
 * counter and is upserted with the EDITOR-04 self-loop tag.
 */
export async function finalizeTldr(
  ctx: CompileTldrCtx,
  args: {
    surface: TldrRow['surface'];
    scopeId: string;
    contentHash: string;
    body: string;
    agentKey: string;
    agentId: string;
    companyId: string;
    /** When true, the input was truncated to fit the cap — stamp TLDR_TRUNCATED_TAG. */
    truncated?: boolean;
  },
): Promise<TldrRow> {
  try {
    validateLlmOutput(args.body);
  } catch (err) {
    await recordFailure(ctx, {
      agentKey: args.agentKey,
      agentId: args.agentId,
      companyId: args.companyId,
      reason: `output_schema_invalid: ${(err as Error).message}`,
    });
    throw err;
  }

  // Plan 250530 v1.1.7 — deterministic META-PROSE STRIP. Runs AFTER schema
  // validation so a non-string / out-of-bounds input still throws the right
  // error. Drops sentences that meta-narrate the TL;DR's own output structure
  // ("The TL;DR leads with…", "82 words, within the ~80-word envelope") or
  // describe the agent's own compile bookkeeping ("compile-result document
  // on…", "operation issue is marked done"). The gate fires ONLY when the
  // strip actually removed content AND the remainder is below the useful
  // minimum — a short body that contains no meta patterns is left untouched
  // (the schema validator already gates the absolute minimum). When the gate
  // fires the compile is treated as a failure and the cache is NOT written —
  // the next view-driven trigger will retry with the same prompt (the bias
  // is to retry, not to cache garbage).
  const stripped = stripMetaProse(args.body);
  const meaningfullyStripped = stripped.length < args.body.length;
  if (meaningfullyStripped && stripped.length < MIN_USEFUL_TLDR_LEN) {
    await recordFailure(ctx, {
      agentKey: args.agentKey,
      agentId: args.agentId,
      companyId: args.companyId,
      reason: `tldr_meta_drift: body collapsed to ${stripped.length} chars after meta-strip (was ${args.body.length})`,
    });
    throw new Error(
      `Editor-Agent TL;DR was almost entirely meta-prose after strip (kept ${stripped.length}/${args.body.length} chars). Next view-driven trigger will retry.`,
    );
  }

  recordSuccess(args.agentKey);

  const tags = [EDITOR_WRITE_TAG]; // D-04 self-loop filter tag
  if (args.truncated) tags.push(TLDR_TRUNCATED_TAG);

  const tldr: TldrRow = {
    surface: args.surface,
    scope_id: args.scopeId,
    content_hash: args.contentHash,
    body: stripped, // Plan 250530 v1.1.7 — cache the cleaned body, not the raw LLM output.
    generated_at: new Date().toISOString(),
    source_revisions: [args.contentHash],
    compiled_by_agent_id: EDITOR_AGENT_ID_TAG,
    tags,
  };
  await upsertTldr(ctx, tldr);
  return tldr;
}

/**
 * Compile a TL;DR for one (surface, scopeId, inputs) triple. Cache hit on
 * identical inputs returns the cached row without invoking the LLM (EDITOR-03).
 * Token-cap breach throws BEFORE the LLM call (EDITOR-05). LLM errors / output
 * schema failures count toward the circuit breaker (D-06).
 *
 * The synchronous form (one invocation holds the whole agent round-trip) is
 * retained for tests + any caller that wants a single-call compile; the
 * PRODUCTION heartbeat path (editor.ts) instead uses prepareTldrCompile +
 * startAgentTask + finalizeTldr across ticks so no invocation outlives its scope.
 */
export async function compileTldr(
  ctx: CompileTldrCtx,
  args: CompileTldrArgs,
): Promise<TldrRow> {
  const prep = await prepareTldrCompile(ctx, args);
  if (prep.kind === 'cache-hit') return prep.tldr;

  // Resolve adapter (arg override > ctx.llm). No fallback to a global — we
  // want the call to fail loudly during wiring if production forgot to plumb it.
  const llm = args.llm ?? ctx.llm;
  if (!llm) {
    throw new Error('Editor-Agent compileTldr called without an LLM adapter wired into ctx.llm');
  }

  let body: string;
  try {
    body = await llm.complete({ maxTokens: MAX_TOKENS, prompt: prep.prompt });
  } catch (err) {
    await recordFailure(ctx, {
      agentKey: args.agentKey,
      agentId: args.agentId,
      companyId: args.companyId,
      reason: `llm_error: ${(err as Error).message}`,
    });
    throw err;
  }

  return finalizeTldr(ctx, {
    surface: args.surface,
    scopeId: args.scopeId,
    contentHash: prep.contentHash,
    body,
    agentKey: args.agentKey,
    agentId: args.agentId,
    companyId: args.companyId,
    truncated: prep.truncated,
  });
}
