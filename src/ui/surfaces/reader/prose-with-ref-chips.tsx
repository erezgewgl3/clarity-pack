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

import * as React from 'react';

import { RefChip } from '../../primitives/ref-chip.tsx';

// Match a 2-8 char uppercase prefix (first char A-Z, rest A-Z|0-9), a
// hyphen, and one or more digits. Word boundaries on both sides so we
// don't match inside identifiers or lowercase tokens. Examples that match:
// BEAAA-141 / COU-2486 / ACME-9 / OPS2-3. Examples that DO NOT match:
// foo-bar (lowercase), A-1 (single-char prefix), 123-456 (no leading
// letter).
const REF_PATTERN = /\b[A-Z][A-Z0-9]{1,7}-\d+\b/g;

export function ProseWithRefChips({ body }: { body: string | null | undefined }): React.ReactElement | null {
  if (!body) return null;
  const nodes: React.ReactElement[] = [];
  let lastIndex = 0;
  let segmentSeq = 0;
  // Fresh regex per render so lastIndex state is isolated.
  const re = new RegExp(REF_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      const text = body.slice(lastIndex, match.index);
      nodes.push(
        <React.Fragment key={`text-${segmentSeq++}-${match.index}`}>{text}</React.Fragment>,
      );
    }
    nodes.push(<RefChip key={`ref-${segmentSeq++}-${match.index}`} refId={match[0]} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    nodes.push(
      <React.Fragment key={`text-${segmentSeq++}-tail`}>{body.slice(lastIndex)}</React.Fragment>,
    );
  }
  return <div className="clarity-reader-prose">{nodes}</div>;
}
