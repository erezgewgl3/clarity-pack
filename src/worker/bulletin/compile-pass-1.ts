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
import { BULLETIN_TZ, formatInTimeZone } from './next-due-at.ts';
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
  /**
   * Defect B (2026-05-17 v0.6.2 re-drill). The masthead is DETERMINISTIC — the
   * pipeline owns today's ET date, the cycle number, and the recipient identity
   * (BULL-05: code owns facts, the LLM never invents them). `compilePass1`
   * OVERWRITES the agent's masthead with a pipeline-built one. `compiledAt` and
   * `companyName` are the only two inputs `buildMasthead` needs that are not
   * already on `CompilePass1Args`; both default sensibly when omitted (a test
   * that does not care about the masthead can leave them off).
   */
  compiledAt?: Date;
  companyName?: string;
};

/**
 * Throws if `body` is not a structurally well-formed BulletinDraft — asserts
 * the object shape, masthead, and the four required arrays. Does NOT resolve
 * `{{NUMBER:key}}` slots: slot resolution is a downstream `compilePass1`
 * concern (it needs the real facts table). The Option-B result readback
 * (`agent-task-delivery.ts`) calls THIS, never the slot-resolving
 * `validateDraftSchema` — an agent draft legitimately carries unresolved
 * `{{NUMBER:key}}` placeholders that `verifyDraft` pass-2 resolves later.
 *
 * NORMALIZATION (debug session render-dept-items-undefined, 2026-05-17). The
 * LLM Editor-Agent may emit a department object with nothing to report and
 * OMIT the `items` key entirely. `BulletinDraft` types `department.items` as a
 * required array, but agent JSON does not honor the type. Both consumers of
 * `dept.items` — `renderBulletinIssueBody` (markdown) and the React
 * `DepartmentSection` — would otherwise crash on `dept.items.length`. Rather
 * than scatter `?? []` guards, this validator is the SINGLE normalization
 * point: it COERCES each department's missing/non-array `items` to `[]` in
 * place, so every downstream consumer receives a draft that honors the type
 * contract. This is LENIENT by design — an empty department is a valid state
 * the renderer already handles with `*· no items ·*`, and the Plan 03-09
 * structure-only precedent is explicitly "validate STRUCTURE ONLY, never
 * reject for cosmetic issues". `validateDraftStructure` is an `asserts`
 * function, so after it returns the body genuinely conforms to BulletinDraft —
 * mutating `items` here makes that assertion honest.
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

  // Per-department LENIENT normalization. An agent may omit `items` on a
  // department with nothing to report; coerce a missing/non-array `items` to
  // `[]` so the renderer + UI never trip on `dept.items.length`. A department
  // entry that is not even an object is a genuine structural fault — throw.
  for (const dept of d.departments) {
    if (!dept || typeof dept !== 'object') {
      throw new Error('BulletinDraft.departments entry must be an object');
    }
    const dd = dept as Record<string, unknown>;
    if (!Array.isArray(dd.items)) {
      dd.items = [];
    }
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
 *
 * NOTE: this is validation-only — it deliberately DISCARDS the resolved string.
 * The write-back of resolved prose into the draft is `resolveDraftSlots`'s job,
 * a separate pass `compilePass1` runs AFTER this validator (Defect A).
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
 * Defect A (2026-05-17 v0.6.2 re-drill). Resolve every `{{NUMBER:key}}`
 * placeholder in the draft's prose fields and WRITE THE RESULT BACK into the
 * draft, so the published `draft_json` AND every renderer (the markdown body +
 * the React UI) carry resolved prose — never a literal `{{NUMBER:completed_7d}}`.
 *
 * Root cause this fixes: `validateDraftSchema` called `replaceSlots` purely to
 * VALIDATE (it throws on an unknown slot) and discarded the resolved string;
 * nowhere in the pipeline wrote the resolution back. The agent's raw
 * placeholder prose survived all the way to the rendered page.
 *
 * Prose fields scanned:
 *   - every `department.editorialSummary`
 *   - every `actionInbox[].summary` (defence-in-depth: today the inbox summary
 *     is an issue description with no placeholders, but a future inbox prose
 *     source would otherwise leak raw placeholders; `replaceSlots` is a no-op
 *     on text that contains no `{{NUMBER:...}}` pattern, so this is free).
 *
 * MUTATES `draft` in place and also returns it (convenient for chaining). An
 * unknown slot still throws the tagged UNKNOWN_SLOT error — `validateDraftSchema`
 * has already run by the time `compilePass1` calls this, so a bad key was
 * rejected upstream; the throw here is belt-and-suspenders.
 */
export function resolveDraftSlots(
  draft: BulletinDraft,
  facts: FactsTable,
): BulletinDraft {
  for (const dept of draft.departments) {
    if (typeof dept.editorialSummary === 'string') {
      dept.editorialSummary = replaceSlots(dept.editorialSummary, facts);
    }
  }
  for (const card of draft.actionInbox) {
    if (typeof card.summary === 'string') {
      card.summary = replaceSlots(card.summary, facts);
    }
  }
  return draft;
}

/**
 * Defect B (2026-05-17 v0.6.2 re-drill). Build the masthead DETERMINISTICALLY
 * from pipeline-owned facts — never from LLM output.
 *
 * Root cause this fixes: `buildPrompt` instructed the agent to "Output a JSON
 * BulletinDraft with keys: masthead, ..." so the masthead was AGENT-supplied;
 * the LLM left every field blank and the rendered page showed
 * `VOL. ⟨blank⟩ · NO. ⟨blank⟩`, blank weekday/date, blank recipient. The footer
 * was correct because it renders the (pipeline-owned) cycle number, not the
 * masthead.
 *
 * BULL-05 spirit — code owns facts:
 *   - `volume`   — v1 ships a single volume; locked to 'I' (matches the
 *                  sketches/ mockups).
 *   - `number`   — the cycle number. The footer already proves this datum is
 *                  in-pipeline ("END OF BULLETIN · NO. 1").
 *   - `weekday`  — ET weekday of `compiledAt`, via the same `formatInTimeZone`
 *                  that `publish.ts` uses for the issue title.
 *   - `dateText` — ET `yyyy-MM-dd` of `compiledAt` (matches the issue title).
 *   - `prepareForName` — the recipient identity. v1 has no per-recipient
 *                  config, so the company name is the deterministic stand-in
 *                  (the Editor-in-Chief of the org). Falls back to a fixed
 *                  label when no company name is supplied.
 *   - `cycleNumber` — the cycle number (the sub-masthead's "Operations Cycle N").
 */
export function buildMasthead(args: {
  cycleNumber: number;
  compiledAt: Date;
  companyName?: string;
}): BulletinDraft['masthead'] {
  const weekday = formatInTimeZone(args.compiledAt, BULLETIN_TZ, 'EEEE');
  const dateText = formatInTimeZone(args.compiledAt, BULLETIN_TZ, 'yyyy-MM-dd');
  return {
    volume: 'I',
    number: args.cycleNumber,
    weekday,
    dateText,
    prepareForName:
      args.companyName && args.companyName.trim().length > 0
        ? args.companyName.trim()
        : 'Operations',
    cycleNumber: args.cycleNumber,
  };
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

/** The subset of CompilePass1Args the prompt builder reads. */
export type BuildBulletinPromptArgs = Pick<
  CompilePass1Args,
  'cycleNumber' | 'departments' | 'factsTable' | 'standingNumbers'
>;

/**
 * Build the pass-1 prompt — factsTable as DATA, never as instruction.
 *
 * Delivery-layer rework (2026-05-28) — exported so the cross-tick compile
 * START step (compile-bulletin.ts) can build the prompt for `startAgentTask`
 * without invoking the whole synchronous `compilePass1`. `compilePass1` still
 * calls this for the in-one-call path.
 */
export function buildBulletinPrompt(args: BuildBulletinPromptArgs): string {
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
    'The `masthead` object is REBUILT deterministically by the pipeline after you respond — you may emit an empty masthead `{}`; any values you put there are overwritten.',
    'Each department object MUST carry an `items` array (use `[]` if the department has nothing to report).',
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
 *
 * Post-validation passes (Defect A + B, 2026-05-17 v0.6.2 re-drill):
 *   - `resolveDraftSlots` writes resolved `{{NUMBER:key}}` prose back into the
 *     draft so the published draft_json + every renderer carry resolved text.
 *   - `buildMasthead` OVERWRITES the agent's masthead with a deterministic,
 *     pipeline-built one (the LLM masthead is never trusted — BULL-05).
 */
/**
 * Delivery-layer rework (2026-05-28) — turn a RAW agent result body into a
 * validated, slot-resolved, deterministic-masthead BulletinDraft, using the
 * FROZEN compile inputs (factsTable / cycleNumber / compiledAt / companyName)
 * captured when the compile was STARTED. This is the "finish" half of
 * `compilePass1` (everything after `llm.complete`), callable on a LATER job
 * tick once `pollAgentTaskResult` returns the body. THROWS on bad JSON /
 * invalid schema / unknown slot (the caller records the failure) — it does NOT
 * call recordFailure itself, so the resume tick owns the breaker accounting.
 *
 * Reusing the frozen factsTable (not a fresh re-query) is what keeps the
 * verifier honest across ticks — the agent compiled against these exact numbers
 * (v0.6.6 Bug-2: no live re-query).
 */
export function finalizeBulletinDraft(
  rawBody: string,
  frozen: {
    factsTable: FactsTable;
    cycleNumber: number;
    compiledAt?: Date;
    companyName?: string;
  },
): BulletinDraft {
  const parsed: unknown = JSON.parse(extractJsonObject(rawBody));
  validateDraftSchema(parsed, frozen.factsTable);
  const draft = parsed as BulletinDraft;
  resolveDraftSlots(draft, frozen.factsTable);
  draft.masthead = buildMasthead({
    cycleNumber: frozen.cycleNumber,
    compiledAt: frozen.compiledAt ?? new Date(),
    companyName: frozen.companyName,
  });
  return draft;
}

export async function compilePass1(
  ctx: CompilePass1Ctx,
  args: CompilePass1Args,
): Promise<BulletinDraft> {
  const prompt = buildBulletinPrompt(args);
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

  const draft = parsed as BulletinDraft;

  // Defect A — write resolved `{{NUMBER:key}}` prose back into the draft so the
  // published draft_json and every renderer carry resolved text. validateDraft-
  // Schema has already rejected an unknown slot, so this never throws here.
  resolveDraftSlots(draft, args.factsTable);

  // Defect B — overwrite the agent-supplied (blank) masthead with a
  // deterministic, pipeline-built one. The LLM masthead is never trusted.
  draft.masthead = buildMasthead({
    cycleNumber: args.cycleNumber,
    compiledAt: args.compiledAt ?? new Date(),
    companyName: args.companyName,
  });

  return draft;
}
