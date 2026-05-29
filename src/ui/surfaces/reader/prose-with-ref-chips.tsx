// src/ui/surfaces/reader/prose-with-ref-chips.tsx
//
// Plan 02-03b Task 2 — fix React key warnings. The Plan 02-03 draft pushed
// raw strings into the children array (text-node siblings to <RefChip>); React
// can't assign stable keys to bare strings inside an array, so it emitted
// "Each child in a list should have a unique key" against ProseWithRefChips →
// ReaderView → ClaritySurfaceRoot. Wrap every text segment in a keyed
// <React.Fragment> so siblings are all keyed elements.
//
// Plan 02-03 Task 2 (original) — READER-03: parses an issue body and inlines a
// <RefChip refId={id} /> for every issue reference. Splits on the company-
// prefix-agnostic pattern below and interleaves text segments with chip
// elements.
//
// rc.8 hotfix 2026-05-26 — REF_PATTERN generalized from /\bBEAAA-\d+\b/g to
// match ANY uppercase company prefix (2-8 chars, starting with a letter).
// The original BEAAA-only pattern meant references on Countermoves (COU-NNN)
// and every other company stayed as plain text, directly breaking the
// project's "zero rabbit-holes" core value (PROJECT.md). The RefChip
// component itself is already company-agnostic — it sends the matched id
// string to the `resolve-refs` worker handler which queries the host's
// issue table by identifier. The only blocker was the regex; this fix
// unblocks every non-BEAAA install.
//
// 2026-05-27 BEAAA hotfix — the rc.8 broad pattern over-matches on issue
// bodies containing YAML-shaped artifact specs with `<UPPER>-<NUM>` tokens
// that aren't issue keys (DAY-3, GATE-2, PAGE-1, DRAFT-1, BY-1 etc.).
// Each over-match triggered a 404 fetch and the Reader's resolution chain
// threw → error boundary caught → "Clarity Pack: failed to render". Fix:
// when the URL exposes a company prefix (which is always the case inside
// /:companyPrefix/issues/:id), narrow the regex to that single prefix.
// Cross-company references aren't a real use case for issue body content;
// the narrow regex is more correct. Fallback to the broad pattern when
// the pathname has no prefix (root URL / standalone surfaces).

// Plan 07-04 Task 3 (D-I31-03) — REWRITTEN to delegate to the ref-aware
// SafeMarkdown (Task 2). The old manual-regex split rendered text segments as
// PLAIN text (literal `## BLUF` / `**bold**` / `-` bullets) and refs as a
// title-less chip — the operator's "rest of the reader looks half rendered"
// complaint (BEAAA-828, 2026-05-29). Now the prose body renders formatted
// markdown AND clickable titled chips, identical to the TL;DR strip.
//
// The instance-agnostic ref regex (BROAD_REF_PATTERN + escapeRegex) moved to
// safe-markdown.ts as the SINGLE source-of-truth; the prefix-narrowing happens
// there. This file keeps the { body } prop shape (so the Reader index.tsx and
// the chat message-thread.tsx call sites are unchanged), the companyPrefix
// derivation, the clarity-reader-prose wrapper, and the empty-body guard. The
// no-innerHTML posture (T-04-18 in chat) is preserved — SafeMarkdown never sets
// innerHTML.

import * as React from 'react';
import { useHostLocation } from '@paperclipai/plugin-sdk/ui/hooks';

import { SafeMarkdown } from '../../primitives/safe-markdown.tsx';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';

export function ProseWithRefChips({ body }: { body: string | null | undefined }): React.ReactElement | null {
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname);
  if (!body) return null;
  return (
    <div className="clarity-reader-prose">
      <SafeMarkdown text={body} linkRefs companyPrefix={companyPrefix} />
    </div>
  );
}
