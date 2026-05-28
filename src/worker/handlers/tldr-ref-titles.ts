// src/worker/handlers/tldr-ref-titles.ts
//
// Plan 07-02 Task 2 (D-I3-02) — the refs→title post-processor for a compiled
// TL;DR body. A `<PREFIX>-NNN` token in the body (e.g. `BEAAA-704`) is rewritten
// in place to `BEAAA-704 — <title>` using the title the EXISTING 07-01 SDK
// resolver returns — keeping the raw ID traceable. We POST-PROCESS the compiled
// body rather than trust the agent to avoid raw IDs (D-I3-02).
//
// REUSE, do NOT re-implement:
//   - extractRefsFromBody + prefixFromIdentifier (src/worker/agents/editor.ts) —
//     instance-agnostic extraction (prefix-narrowed when derivable; broad
//     fallback when the identifier is null). No third regex here.
//   - resolveRefsViaSdk + SdkRefIssuesClient (./sdk-ref-fetch.ts) — per-ref
//     ctx.issues.get + cached list fallback; ResolvedRef.requestedId echoes the
//     asked id, ResolvedRef.issue.title is the title.
//
// SAFETY / ROBUSTNESS (T-07-02-RW): the rewrite is idempotent (a token already
// followed by ` — ` is skipped), unresolved tokens degrade to the bare ID,
// and neither function throws — buildTitleMap degrades to an empty Map on a
// resolver error so inlineRefTitles then leaves bare IDs.

import { extractRefsFromBody } from '../agents/editor.ts';
import { resolveRefsViaSdk, type SdkRefIssuesClient } from './sdk-ref-fetch.ts';

/** Escape regex metacharacters in a (validated) ref token before building the
 *  per-token replace pattern. The token already matched `extractRefsFromBody`
 *  (`<PREFIX>-<digits>`, no metachars), so this is belt-and-braces. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite each resolvable `<PREFIX>-NNN` token in `body` to `<PREFIX>-NNN — <title>`.
 *
 * - Tokens are extracted via the shared {@link extractRefsFromBody} (prefix-derived
 *   from `identifier`; broad fallback when null) — instance-agnostic, no BEAAA
 *   hardcoding.
 * - Only tokens present in `titleById` are rewritten; an unresolved token is left
 *   as the bare ID.
 * - Idempotent: a token already immediately followed by ` — ` (em-dash) is NOT
 *   re-rewritten, so running twice yields the same string.
 * - Returns the original string unchanged when there are no resolvable tokens.
 * - Never throws.
 */
export function inlineRefTitles(
  body: string,
  identifier: string | null | undefined,
  titleById: Map<string, string>,
): string {
  if (typeof body !== 'string' || body.length === 0) return body;
  if (!titleById || titleById.size === 0) return body;

  const tokens = extractRefsFromBody(body, identifier ?? null);
  if (tokens.length === 0) return body;

  let out = body;
  for (const token of tokens) {
    const title = titleById.get(token);
    if (!title) continue;
    // Replace the token ONLY when it is not already followed by " — " (idempotent)
    // and at a word boundary so e.g. `BEAAA-7` does not match inside `BEAAA-70`.
    const re = new RegExp(`\\b${escapeRegex(token)}\\b(?!\\s+—\\s)`, 'g');
    out = out.replace(re, `${token} — ${title}`);
  }
  return out;
}

/**
 * Build the `requestedId → title` map for the tokens in `body`, reusing the
 * 07-01 SDK resolver. Empty token set → empty map (skips the SDK call entirely).
 * A thrown resolver degrades to an empty map (the caller's rewrite then leaves
 * bare IDs). Never throws.
 */
export async function buildTitleMap(
  issues: SdkRefIssuesClient,
  body: string,
  identifier: string | null | undefined,
  companyId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (typeof body !== 'string' || body.length === 0) return map;

  const tokens = extractRefsFromBody(body, identifier ?? null);
  if (tokens.length === 0) return map;

  try {
    const resolved = await resolveRefsViaSdk(issues, tokens, companyId);
    for (const { requestedId, issue } of resolved) {
      const title = (issue as { title?: string | null }).title;
      if (typeof title === 'string' && title.length > 0) {
        map.set(requestedId, title);
      }
    }
  } catch {
    // Degrade: an unresolvable map leaves bare IDs (never blanks the TL;DR).
    return new Map<string, string>();
  }
  return map;
}
