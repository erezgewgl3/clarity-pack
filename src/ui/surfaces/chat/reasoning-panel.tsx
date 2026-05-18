// src/ui/surfaces/chat/reasoning-panel.tsx
//
// Plan 04-05 Task 2 — CHAT-10 — the collapsed "Show reasoning" panel.
//
// An agent reply may carry a D-14 reasoning block delimited inside the
// comment body. The pure split logic lives in reasoning-block-parser.mjs (a
// dependency-free module so the Node test runner can exercise it directly —
// Node cannot load .tsx). This component renders the parser's output: the
// visible text as a normal bubble body, the reasoning as a collapsed
// <details> "Show reasoning" panel.
//
// If a reply has no block, the parser returns the body unchanged and no
// reasoning panel renders — there is no hard dependency on the block.
//
// SECURITY (T-04-18): the block is parsed as TEXT — never eval, never
// dangerouslySetInnerHTML. Inline references render via the resolver-backed
// RefChip. The visible body and the reasoning body both render through
// ProseWithRefChips, which only ever produces text nodes + RefChip elements.
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 213-230.

import * as React from 'react';

import { ProseWithRefChips } from '../reader/prose-with-ref-chips.tsx';
// @ts-expect-error — .mjs sibling, dependency-free, no .d.ts; shape is stable.
import { parseReasoning as parseReasoningImpl } from './reasoning-block-parser.mjs';

export type ParsedReasoning = {
  /** The visible message text (the block removed). */
  visible: string;
  /** The reasoning block text, or null if the body carried no block. */
  reasoning: string | null;
};

/**
 * Split a comment body into its visible text and its optional reasoning
 * block. Thin typed wrapper over the pure reasoning-block-parser.mjs.
 */
export function parseReasoning(body: string | null | undefined): ParsedReasoning {
  return parseReasoningImpl(body) as ParsedReasoning;
}

/**
 * The collapsed reasoning panel. Renders nothing when there is no block.
 */
export function ReasoningPanel({
  reasoning,
}: {
  reasoning: string | null;
}): React.ReactElement | null {
  if (!reasoning) return null;
  return (
    <details className="reasoning">
      <summary>Show reasoning</summary>
      <div className="body">
        <ProseWithRefChips body={reasoning} />
      </div>
    </details>
  );
}
