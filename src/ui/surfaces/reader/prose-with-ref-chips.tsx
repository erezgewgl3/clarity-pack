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
// <RefChip refId={id} /> for every BEAAA-NNN reference. Splits on the
// /\bBEAAA-\d+\b/g pattern and interleaves text segments with chip elements.

import * as React from 'react';

import { RefChip } from '../../primitives/ref-chip.tsx';

const REF_PATTERN = /\bBEAAA-\d+\b/g;

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
