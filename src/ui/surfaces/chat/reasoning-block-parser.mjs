// src/ui/surfaces/chat/reasoning-block-parser.mjs
//
// Plan 04-05 Task 2 — the pure D-14 reasoning-block parser, extracted as a
// dependency-free .mjs module so it is BOTH:
//   - imported by reasoning-panel.tsx (the React panel component), and
//   - directly testable in the Node test runner (test/ui/chat-message-thread
//     .test.mjs) — Node cannot load .tsx, but it loads plain .mjs fine.
//
// SECURITY (T-04-18): this parser operates on TEXT only. It never evals, never
// touches the DOM, never produces HTML — it just splits a string into a
// visible part and an optional reasoning part. The caller renders both as
// untrusted React text.

// D-14 reasoning block delimiters. The employee-agent is instructed (via the
// topic issue description, 04-03) to fence its reasoning between these
// markers. The parser is forgiving: case-insensitive, whitespace-tolerant,
// and treats a missing closing fence as "everything after the open fence is
// reasoning".
const OPEN_FENCE = /<!--\s*clarity:reasoning\s*-->/i;
const CLOSE_FENCE = /<!--\s*\/clarity:reasoning\s*-->/i;

/**
 * Split a comment body into its visible text and its optional reasoning
 * block. Pure — no side effects, no DOM, no eval.
 *
 * @param {string|null|undefined} body
 * @returns {{ visible: string, reasoning: string|null }}
 */
export function parseReasoning(body) {
  const text = body ?? '';
  const open = text.match(OPEN_FENCE);
  if (!open || open.index === undefined) {
    return { visible: text, reasoning: null };
  }
  const afterOpen = text.slice(open.index + open[0].length);
  const close = afterOpen.match(CLOSE_FENCE);
  let reasoning;
  let visibleTail;
  if (close && close.index !== undefined) {
    reasoning = afterOpen.slice(0, close.index);
    visibleTail = afterOpen.slice(close.index + close[0].length);
  } else {
    reasoning = afterOpen;
    visibleTail = '';
  }
  const visible = (text.slice(0, open.index) + visibleTail).trim();
  return { visible, reasoning: reasoning.trim() || null };
}
