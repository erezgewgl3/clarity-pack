// src/ui/surfaces/reader/prose-with-ref-chips.tsx
//
// Plan 02-03 Task 2 — READER-03: parses an issue body and inlines a
// <RefChip refId={id} /> for every BEAAA-NNN reference. Splits on the
// /\bBEAAA-\d+\b/g pattern and interleaves text segments with chip elements.
// Each chip independently calls usePluginData('resolve-refs', { ids: [...] })
// (per 02-02 ref-chip primitive); the Reader view's TOP-LEVEL fetch is
// already PRIM-01 (issue.reader handler resolves all refs in one round-trip),
// so this component does NOT trigger N+1.

import * as React from 'react';

import { RefChip } from '../../primitives/ref-chip.tsx';

const REF_PATTERN = /\bBEAAA-\d+\b/g;

export function ProseWithRefChips({ body }: { body: string | null | undefined }): React.ReactElement | null {
  if (!body) return null;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  // Fresh regex per render so lastIndex state is isolated.
  const re = new RegExp(REF_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(body.slice(lastIndex, match.index));
    }
    nodes.push(<RefChip key={`ref-${match.index}`} refId={match[0]} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    nodes.push(body.slice(lastIndex));
  }
  return <div className="clarity-reader-prose">{nodes}</div>;
}
