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

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.9 — DETERMINISTIC POLISH PIPELINE.
//
// Honest read after v1.1.8: prompt-engineering plateaued. The agent stopped
// writing meta-prose but its surviving output still reads like AI slop — ISO
// dates ("Wed 2026-06-03"), titles restated in parens right after a chip
// ("(Underwriter pre-read)"), generic agent jargon ("operational sign-off",
// "binding ratification", "pre-read"). These are LLM-training-distribution
// signatures that prompts move ~30% on the dial. The remaining 70% lands
// with deterministic transforms.
//
// Three narrow passes, each pure, regex-bounded, testable:
//   1. isoDateToHuman — `\d{4}-\d{2}-\d{2}` → "Wed 6/3" (weekday computed;
//      preserved if the agent already wrote one). Skips identifier-like
//      contexts (`BEAAA-2026-06-03` stays put — boundary class excludes
//      word-or-hyphen on either side).
//   2. stripRestatedParenAfterRef — `BEAAA-NNN (Title-like content)` → drop
//      the parenthetical. Conservative: only strips when the parens content
//      starts with a capital AND doesn't contain another PREFIX-NNN
//      (cross-refs survive: "BEAAA-1086 (or BEAAA-1103 as backup)" stays put).
//   3. applyJargonGlossary — 6 entries covering the worst agent-generic
//      terms ("operational sign-off" → "approval", "pre-read" → "review",
//      "binding ratification" → "final approval"). Case-insensitive. Plural
//      handled via a captured `(s?)` group. Issue-specific codenames
//      (Scope-β, Path B, G7, Tier-2) are deliberately NOT translated —
//      those are unique to the source issue and the agent should keep them.
//
// polishTldr() runs all three in order. It's cosmetic only: no semantic
// stripping (that's stripMetaProse's job from v1.1.7). Runs in finalizeTldr
// AFTER stripMetaProse and AFTER the min-length gate, BEFORE upsertTldr.

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Pure: replace ISO dates (YYYY-MM-DD) with human format ("Wed M/D"). When
 *  the agent already wrote a weekday word immediately before the date, that
 *  weekday is preserved (no duplication). Identifier contexts like
 *  `BEAAA-2026-06-03` are skipped via boundary class. Invalid dates pass
 *  through unchanged. */
export function isoDateToHuman(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  return input.replace(
    /(?<![\w-])(?:(Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nes(?:day)?)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?)[\s.,]+)?(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\w-])/gi,
    (match, weekday: string | undefined, year: string, month: string, day: string) => {
      const y = Number(year);
      const mo = Number(month);
      const d = Number(day);
      const date = new Date(y, mo - 1, d);
      // Validate by round-trip: if any field doesn't survive, the input was
      // technically formatted but not a real date — leave alone.
      if (
        date.getFullYear() !== y ||
        date.getMonth() !== mo - 1 ||
        date.getDate() !== d
      ) {
        return match;
      }
      const computedWeekday = WEEKDAY_SHORT[date.getDay()];
      // Use the agent's weekday spelling if they wrote one; else use computed.
      const useWeekday = weekday ?? computedWeekday;
      return `${useWeekday} ${mo}/${d}`;
    },
  );
}

/** Pure: when a `PREFIX-NNN` plain id is immediately followed by a
 *  parenthetical that starts with a capital letter, the parenthetical is the
 *  agent restating the chip's title (the chip auto-shows the title; the
 *  parenthetical is redundant noise). Strip just the parenthetical, keep the
 *  id. Conservative — never strips parens that contain ANOTHER PREFIX-NNN
 *  (that's a cross-ref, not a restatement) and never strips lowercase-led
 *  parens like "(for context)" / "(now closed)" (those are footnotes, not
 *  title restatements). */
export function stripRestatedParenAfterRef(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  return input.replace(
    /\b([A-Z][A-Z0-9]{1,7}-\d+)\s*\(([A-Z][^)]{0,80})\)/g,
    (match, id: string, content: string) => {
      // If the parens content references ANOTHER PREFIX-NNN, leave it alone —
      // it's a cross-ref the operator may want.
      if (/\b[A-Z][A-Z0-9]{1,7}-\d+\b/.test(content)) return match;
      return id;
    },
  );
}

/** A small, conservative glossary of generic agent-language → plain English
 *  substitutions. ONLY entries that translate cleanly out of context —
 *  domain-specific codenames (Scope-β, G7, Tier-2, ARE Scanner) are NOT
 *  touched because they are part of the source-issue's identity and the
 *  reader is meant to learn them. Plural is handled via a captured `(s?)`
 *  group so "sign-off" → "approval" AND "sign-offs" → "approvals". */
export const JARGON_GLOSSARY: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Order matters: more specific phrases must match before their generic forms.
  // "operational sign-off" → "approval" is more specific than bare "sign-off",
  // so it goes first; the bare form catches any remaining "sign-off" usages.
  { pattern: /\boperational\s+sign-?off(s?)\b/gi, replacement: 'approval$1' },
  { pattern: /\bsign-?off(s?)\b/gi, replacement: 'approval$1' },
  { pattern: /\bpre-?read(s?)\b/gi, replacement: 'review$1' },
  { pattern: /\bbinding\s+ratification(s?)\b/gi, replacement: 'final approval$1' },
  { pattern: /\bratification(s?)\b/gi, replacement: 'approval$1' },
  { pattern: /\bcountersign\b/gi, replacement: 'sign off' },
  { pattern: /\bcountersigns\b/gi, replacement: 'signs off' },
  { pattern: /\bcountersigned\b/gi, replacement: 'signed off' },
  { pattern: /\bcountersigning\b/gi, replacement: 'signing off' },
];

/** Pure: apply the glossary in order. Case-insensitive matches via the regex
 *  `i` flag; plural handled by `(s?)` capture in the replacement template. */
export function applyJargonGlossary(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;
  for (const entry of JARGON_GLOSSARY) {
    out = out.replace(entry.pattern, entry.replacement);
  }
  return out;
}

/** Pure: run all three polish passes in order. Cosmetic only — no sentence
 *  drops, no semantic changes. Caller (finalizeTldr) runs this AFTER
 *  stripMetaProse and AFTER the min-length gate, BEFORE upsertTldr. */
export function polishTldr(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = input;
  out = isoDateToHuman(out);
  out = stripRestatedParenAfterRef(out);
  out = applyJargonGlossary(out);
  return out;
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
    'You are the Clarity Pack Editorial Desk. YOUR JOB IS TRANSLATION, NOT SUMMARY.',
    '',
    'The agents below write in their own internal vocabulary — project codenames (Scope-β / Path B / G7), status enums (in_review, done, blocked), operation kinds (compile-result, sign-off, op-seat), agent shorthand (HoUW, AC4, BLUF, pre-read), and ISO dates (2026-06-03). Eric — the busy founder reading this — does not speak agent-language. Your job is to translate the issue into plain English he can act on in 10 seconds.',
    '',
    'WRITE LIKE A CHIEF-OF-STAFF BRIEFING A CEO. Five voice rules:',
    '  1. DIRECT ADDRESS — when there is something Eric does, write "you". "You ratify on Wed 6/3" — not "the operator ratifies" or "ratification is queued".',
    '  2. ACTIVE VERBS, present tense — "X blocks Y" not "Y is being blocked by X". "Ship Z" not "Z needs to be shipped".',
    '  3. CONCRETE > NOMINAL — name the decision in plain words, not by codename. "Upgrade the rescans API from doc-only to actual measurement" — NOT "the binding ratification of Scope-β".',
    '  4. HUMAN DATES — "Wed 6/3" or "tomorrow morning". NOT "2026-06-03" (ISO format).',
    '  5. TRANSLATE EVERY AGENT TERM — if you find yourself writing "operational sign-off" / "Scope-β" / "compile-result" / "op-seat" / "pre-read" / "G7 escalation", translate it. Eric does NOT know these. "Sign-off" → "approval". "Pre-read" → "review". "Scope-β" → whatever the scope actually IS in plain words.',
    '',
    'HARD SHAPE (do not exceed):',
    '  - One bold sentence (the headline) that names the decision in flight, the call, or the one thing Eric needs to know — in HIS vocabulary, not the agent\'s. Lead with the decision.',
    '  - Up to 3 short bullets: current state / blocker (if any) / what Eric does next.',
    '  - Under 80 words total. Cut filler. Three commas in one sentence = split it.',
    'You may use light markdown (bold, bullets, links); never pad to fill space.',
    '',
    'THE TL;DR IS *NOT*:',
    '  - A description of itself. Never write "The TL;DR leads with…" / "notes…" / "points at…". Never report your word count.',
    '  - A description of how you compiled it. Never mention compile-result documents, operation issues you created, document keys, storage paths, sign-off operation issues, or any of your own bookkeeping. Eric does not care where this text is filed.',
    '  - A list of every reference in the body. Cite only the issues that move the decision forward.',
    '',
    'REF CONVENTIONS:',
    '  - When you cite another issue, write its id as plain prose (e.g. "BEAAA-933"). DO NOT wrap it in backticks (`BEAAA-933`) or a markdown link ([BEAAA-933](/BEAAA/issues/BEAAA-933)). The Reader auto-renders every plain id as a clickable chip showing id + title + status — wrapping strips the title and forces a click-out.',
    '  - Do NOT restate a cited issue\'s title or status next to its id (the chip already shows them).',
    '  - NEVER cite your own internal operation issues (titles like "Compile TL;DR — <uuid>", "Bulletin compile — <date>"). Eric has no context for them.',
    '  - Expand abbreviations on first use, e.g. "Head of Underwriting (HoUW)", "Acceptance Criterion 4 (AC4)", "operating seat (op-seat)". A reader without domain context must understand the TL;DR end-to-end.',
    '',
    'BAD example (the EXACT failure mode the Editor-Agent shipped on BEAAA-1000, every wrong thing at once):',
    '  "TL;DR stored as the `compile-result` document on `BEAAA-1168 — Compile TL;DR — a119b8e7-…` and the operation issue is marked done. The TL;DR leads with the Wed 2026-06-03 binding ratification, notes both operational sign-offs closed (BEAAA-1086, BEAAA-1103) with the variance resolved, and points at the post-ratification kickoff path. 82 words, within the ~80-word envelope."',
    '  Why it fails: (1) describes itself ("the TL;DR leads with…", "82 words within…"); (2) cites an internal operation issue (BEAAA-1168 + UUID); (3) ISO date format; (4) agent jargon untranslated ("operational sign-offs", "Scope-β", "binding ratification"); (5) passive nominal voice ("variance resolved"); (6) leaves Eric with no concrete next action ("points at the post-ratification kickoff path" — what does he DO?).',
    '',
    'GOOD example (same source issue, top-tier translation):',
    '  "**Wed 6/3 you ratify upgrading the rescans API from doc-only to actual measurement.**',
    '   - Underwriter pre-read and Claims Architect sign-off are both in (BEAAA-1086, BEAAA-1103). Pricing variance is settled — nothing\'s blocking.',
    '   - Next: show up to the 6/3 CTO ↔ Underwriting review ready to sign, then the agents kick off post-ratification work."',
    '  Why it works: (1) addresses Eric directly ("you ratify"); (2) names the actual decision in plain words ("upgrading the rescans API from doc-only to actual measurement" — not "binding ratification of Scope-β"); (3) human date ("Wed 6/3" not "2026-06-03"); (4) cites only the two chips that matter (no operation-issue noise); (5) active voice ("nothing\'s blocking" not "variance is resolved"); (6) explicit next action Eric can act on; (7) ~55 words; (8) zero self-narration.',
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

  // Plan 250530 v1.1.9 — DETERMINISTIC POLISH. Cosmetic only — no sentence
  // drops or semantic changes. Three passes: ISO→human dates, strip restated
  // parenthetical after a ref id, generic-jargon glossary. Reliably moves the
  // dial on the LLM-training-distribution slop that prompt rules don't reach.
  const polished = polishTldr(stripped);

  recordSuccess(args.agentKey);

  const tags = [EDITOR_WRITE_TAG]; // D-04 self-loop filter tag
  if (args.truncated) tags.push(TLDR_TRUNCATED_TAG);

  const tldr: TldrRow = {
    surface: args.surface,
    scope_id: args.scopeId,
    content_hash: args.contentHash,
    body: polished, // Plan 250530 v1.1.9 — cache the polished body (strip + polish).
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
