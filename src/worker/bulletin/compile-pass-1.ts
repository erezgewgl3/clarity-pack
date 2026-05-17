// src/worker/bulletin/compile-pass-1.ts
//
// Plan 03-02 — Pass-1 LLM call producing a structured BulletinDraft.
//
// Shape mirrors src/worker/agents/compile-tldr.ts:153-226 exactly:
// cap-then-call, schema-validate, recordFailure on every error path,
// recordSuccess on a clean parse+validate.
//
// KEY DIFFERENCE vs compile-tldr: output is a structured BulletinDraft (D-14),
// not a plain string. validateDraftSchema asserts every required key; any
// `{{NUMBER:X}}` placeholder in department prose is resolved through
// replaceSlots, which throws a tagged UNKNOWN_SLOT error if a placeholder
// references a key not in the factsTable.
//
// T-03-11 (LLM token spend DoS): MAX_BULLETIN_TOKENS caps input tokens; the
// cap is enforced BEFORE the LLM call so an over-budget prompt costs nothing.

import {
  recordFailure,
  BULLETIN_COMPILE_AGENT_KEY,
  type CircuitBreakerCtx,
} from '../agents/circuit-breaker.ts';
import { replaceSlots } from './facts-table.ts';
import type {
  BulletinDraft,
  FactsTable,
  StandingNumberRow,
} from '../../shared/types.ts';

export { BULLETIN_COMPILE_AGENT_KEY };

/**
 * Input-token cap for a bulletin compile. Higher than compile-tldr's 4000
 * because the bulletin prompt carries the full factsTable + per-department
 * data. Cap is enforced BEFORE the LLM call (T-03-11).
 */
export const MAX_BULLETIN_TOKENS = 6000;

/** ~4 chars per token — the published English rule-of-thumb (matches compile-tldr). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** LLM adapter — same interface compile-tldr.ts uses; tests inject a stub. */
export type LlmAdapter = {
  complete(args: { maxTokens: number; prompt: string }): Promise<string>;
};

export type CompilePass1Ctx = CircuitBreakerCtx & {
  logger?: {
    info?(...a: unknown[]): void;
    warn?(...a: unknown[]): void;
    error?(...a: unknown[]): void;
  };
};

export type CompilePass1Args = {
  companyId: string;
  cycleNumber: number;
  factsTable: FactsTable;
  standingNumbers: StandingNumberRow[];
  departments: string[];
  /**
   * The RESOLVED Editor-Agent UUID for this company (from
   * `ctx.agents.managed.reconcile`). Used as the `agentId` on every
   * `recordFailure` call so that, when the D-06 circuit breaker trips, it
   * pauses the real agent. Passing the non-UUID `EDITOR_AGENT_ID_TAG` name tag
   * here is rejected host-side as `invalid input syntax for type uuid` and
   * masks the real failure — the 2026-05-16 Countermoves drill defect.
   */
  editorAgentId: string;
  /**
   * The LLM adapter. Plan 03-05: this is the REAL `sessionLlmAdapter`
   * (agent-chat-session backed) built per-company by the compile-bulletin job;
   * tests pass a stub. There is no `ctx.llm` fallback — `ctx.llm` never existed
   * on the SDK `PluginContext` (03-LLM-INVOCATION-RESEARCH.md). Keeping a
   * `?? ctx.llm` fallback was a type-level fiction; the adapter is always
   * supplied by the caller, so `llm` is required here.
   */
  llm: LlmAdapter;
};

/**
 * Throws if `body` is not a structurally well-formed BulletinDraft — asserts
 * the object shape, masthead, and the four required arrays. Does NOT resolve
 * `{{NUMBER:key}}` slots: slot resolution is a downstream `compilePass1`
 * concern (it needs the real facts table). The Option-B result readback
 * (`agent-task-delivery.ts`) calls THIS, never the slot-resolving
 * `validateDraftSchema` — an agent draft legitimately carries unresolved
 * `{{NUMBER:key}}` placeholders that `verifyDraft` pass-2 resolves later.
 */
export function validateDraftStructure(
  body: unknown,
): asserts body is BulletinDraft {
  if (!body || typeof body !== 'object') {
    throw new Error('BulletinDraft failed schema validation (not an object)');
  }
  const d = body as Record<string, unknown>;
  if (!d.masthead || typeof d.masthead !== 'object') {
    throw new Error('BulletinDraft.masthead missing or not an object');
  }
  if (!Array.isArray(d.actionInbox)) {
    throw new Error('BulletinDraft.actionInbox must be an array');
  }
  if (!Array.isArray(d.departments)) {
    throw new Error('BulletinDraft.departments must be an array');
  }
  if (!Array.isArray(d.standingNumbers)) {
    throw new Error('BulletinDraft.standingNumbers must be an array');
  }
  if (!Array.isArray(d.lineageThreads)) {
    throw new Error('BulletinDraft.lineageThreads must be an array');
  }
}

/**
 * Throws if `body` is not a well-formed BulletinDraft. Asserts every required
 * top-level key (via `validateDraftStructure`), then resolves every department
 * `editorialSummary` through replaceSlots so an unknown `{{NUMBER:X}}`
 * placeholder surfaces as a tagged UNKNOWN_SLOT error.
 *
 * This is the production validator used by `compilePass1` — it MUST be called
 * with the real facts table. The Option-B result readback does NOT use this;
 * it calls `validateDraftStructure` (structure-only) because an agent draft
 * legitimately carries unresolved `{{NUMBER:key}}` placeholders.
 */
export function validateDraftSchema(
  body: unknown,
  facts: FactsTable,
): asserts body is BulletinDraft {
  validateDraftStructure(body);

  // Resolve every department prose summary — replaceSlots throws (with a
  // tagged `.slot`) if a placeholder references an unknown factsTable key.
  for (const dept of (body as BulletinDraft).departments as Array<{
    editorialSummary?: unknown;
  }>) {
    if (typeof dept.editorialSummary === 'string') {
      replaceSlots(dept.editorialSummary, facts);
    }
  }
}

/**
 * Peel a JSON object out of raw LLM output (Defect B — 2026-05-16 Countermoves
 * re-drill).
 *
 * The Editor-Agent session does respond, but it may wrap the BulletinDraft
 * JSON in a ```json fence or a prose preamble ("Here is the bulletin: {...}").
 * `JSON.parse` on that wrapped string throws — so `compilePass1` used to reject
 * a perfectly good draft as 'LLM output was not valid JSON'.
 *
 * Extraction order:
 *   1. If a ```json (or bare ```) fence is present, take the content between
 *      the FIRST fence pair — a fenced block wins over any surrounding prose.
 *   2. Otherwise (or if the fenced content still carries prose), scan for the
 *      first `{`, walk forward counting brace depth — respecting `"`-delimited
 *      strings and `\"` escapes so braces inside string values do not miscount
 *      — and return the substring through the matching `}`.
 *   3. If no `{` exists at all, THROW — genuinely non-JSON output must still
 *      hit compilePass1's recordFailure path and the 'LLM output was not valid
 *      JSON' rejection.
 *
 * This is a pure function: same input → same output, no side effects.
 */
export function extractJsonObject(raw: string): string {
  // Step 1 — a fenced block, if any. ```json\n...\n``` or ```\n...\n```.
  // The capture is the content between the first fence pair.
  const fence = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(raw);
  const candidate = fence ? fence[1] : raw;

  // Step 2 — brace-balanced, quote-aware scan for the first complete object.
  const start = candidate.indexOf('{');
  if (start === -1) {
    throw new Error('no JSON object found in LLM output');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }

  // An unbalanced `{` with no matching `}` — not a usable object. Throw so the
  // caller's recordFailure path treats it as non-JSON output.
  throw new Error('no balanced JSON object found in LLM output');
}

/** Build the pass-1 prompt — factsTable as DATA, never as instruction. */
function buildPrompt(args: CompilePass1Args): string {
  return [
    'You are the Editorial Desk for Paperclip. Compose a Daily Bulletin in structured JSON form.',
    'Use the provided facts table as the ONLY source of numeric claims. NEVER type a number into prose; use `{{NUMBER:key}}` placeholders that reference factsTable keys.',
    '',
    `Cycle: ${args.cycleNumber}`,
    `Departments: ${args.departments.join(', ')}`,
    '',
    'Facts table (NEVER invent values; reference these keys via `{{NUMBER:key}}`):',
    JSON.stringify(args.factsTable, null, 2),
    '',
    'Standing numbers (already verified — emit as-is in the standingNumbers field):',
    JSON.stringify(args.standingNumbers, null, 2),
    '',
    'Output a JSON BulletinDraft with keys: masthead, actionInbox, departments, standingNumbers, lineageThreads.',
    'Department `editorialSummary` prose may use `{{NUMBER:key}}` placeholders; a post-pass interpolates them.',
  ].join('\n');
}

/**
 * Pass-1 compile. Enforces the token cap, invokes the injected LLM adapter,
 * parses + schema-validates the output. Every failure path
 * (cap breach, LLM throw, bad JSON, schema invalid) calls recordFailure with
 * agentKey='bulletin-compile' and re-throws.
 *
 * NOTE: pass-1 does NOT call recordSuccess. The bulletin-compile circuit
 * breaker counter tracks the WHOLE two-pass pipeline — recordSuccess is the
 * compile-bulletin job's responsibility, called only after a verified publish.
 * Resetting the counter here would let a draft that pass-1 accepts but the
 * pass-2 verifier rejects escape the "3 consecutive rejections" trip wire.
 */
export async function compilePass1(
  ctx: CompilePass1Ctx,
  args: CompilePass1Args,
): Promise<BulletinDraft> {
  const prompt = buildPrompt(args);
  const inputTokens = estimateTokens(prompt);
  if (inputTokens > MAX_BULLETIN_TOKENS) {
    await recordFailure(ctx, {
      agentKey: BULLETIN_COMPILE_AGENT_KEY,
      agentId: args.editorAgentId,
      companyId: args.companyId,
      reason: `input_tokens=${inputTokens} exceeds MAX_BULLETIN_TOKENS=${MAX_BULLETIN_TOKENS}`,
    });
    throw new Error(
      `Bulletin compile input exceeds max_tokens cap (${inputTokens} > ${MAX_BULLETIN_TOKENS})`,
    );
  }

  // Plan 03-05: the LLM adapter is always supplied by the caller (the
  // compile-bulletin job builds a real session-backed adapter per company).
  // There is no `ctx.llm` — it never existed on the SDK PluginContext.
  const { llm } = args;
  if (!llm) {
    throw new Error('compilePass1 called without an LLM adapter (args.llm is required)');
  }

  let raw: string;
  try {
    raw = await llm.complete({ maxTokens: MAX_BULLETIN_TOKENS, prompt });
  } catch (err) {
    await recordFailure(ctx, {
      agentKey: BULLETIN_COMPILE_AGENT_KEY,
      agentId: args.editorAgentId,
      companyId: args.companyId,
      reason: `llm_error: ${(err as Error).message}`,
    });
    throw err;
  }

  let parsed: unknown;
  try {
    // Defect B: the agent may wrap the draft in a ```json fence or a prose
    // preamble. extractJsonObject peels it down to the bare object; an
    // extraction throw (no JSON object at all) and a JSON.parse throw both land
    // in this catch → recordFailure → the 'LLM output was not valid JSON'
    // rejection, byte-identical for genuinely non-JSON output.
    const extracted = extractJsonObject(raw);
    parsed = JSON.parse(extracted);
  } catch (err) {
    await recordFailure(ctx, {
      agentKey: BULLETIN_COMPILE_AGENT_KEY,
      agentId: args.editorAgentId,
      companyId: args.companyId,
      reason: `llm_output_not_json: ${(err as Error).message}`,
    });
    throw new Error('compilePass1: LLM output was not valid JSON');
  }

  try {
    validateDraftSchema(parsed, args.factsTable);
  } catch (err) {
    await recordFailure(ctx, {
      agentKey: BULLETIN_COMPILE_AGENT_KEY,
      agentId: args.editorAgentId,
      companyId: args.companyId,
      reason: `draft_schema_invalid: ${(err as Error).message}`,
    });
    throw err;
  }

  return parsed as BulletinDraft;
}
