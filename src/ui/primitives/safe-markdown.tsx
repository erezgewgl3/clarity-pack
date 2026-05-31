// src/ui/primitives/safe-markdown.tsx
//
// Plan 07-02 Task 1 (D-I3-01) — the hand-rolled, plugin-local SAFE markdown
// renderer. Renders the markdown the Editor-Agent emits (## headings, **bold**,
// *italic*, - / * / numbered bullets, [label](url), `code`, blank-line paragraph
// breaks) as React element nodes. NO new runtime dependency — the parse + safety
// core lives in the sibling pure ./safe-markdown.ts module (so node --test can
// assert it directly; Node strip-types loads .ts but not .tsx).
//
// SAFETY (load-bearing — same-origin trusted UI):
//   - NEVER uses React's raw-innerHTML escape hatch (the no-raw-HTML invariant is
//     pinned by a source-scan in test/ui/safe-markdown.test.mjs). Every span is
//     rendered as a React text node (or a wrapping element whose children are
//     text nodes), so literal <...> HTML in the input is escaped by React to
//     inert text — there is no HTML-injection path.
//   - Link hrefs are allowlisted by the parser's sanitizeHref (http/https/mailto/
//     relative only); a rejected href is downgraded to a plain-text span upstream
//     so a javascript:/data:/vbscript: URL never becomes a live anchor. Anchors
//     additionally carry rel="noopener noreferrer" and target="_blank" for
//     absolute links.
//   - Every list of sibling nodes is keyed (mirrors prose-with-ref-chips.tsx) so
//     React emits no "unique key" warnings.

import * as React from 'react';

import {
  parseMarkdownBlocks,
  type InlineSpan,
  type MarkdownBlock,
} from './safe-markdown.ts';
// Plan 07-04 Task 2 (D-I31-02) — a `ref` span renders as a clickable titled
// chip (RefChip), so an in-prose PREFIX-NNN token resolves to `ID — title`
// instead of plain text. RefChip carries no href/HTML of its own beyond the
// nav.linkProps anchor it already used (no new XSS surface).
import { RefChip } from './ref-chip.tsx';

// Quick 260531-b8w (004-B) — refVariant is threaded through renderBlock →
// renderInline so a `ref` span renders the matching RefChip form. Defaults to
// 'full' everywhere; ProseWithRefChips passes 'inline' for the Reader body so
// mid-sentence refs render the light inline chip. All other callers (TL;DR
// strip, chat message-thread) stay byte-unchanged (default 'full').
function renderInline(
  spans: InlineSpan[],
  keyPrefix: string,
  refVariant: 'full' | 'inline' = 'full',
): React.ReactNode[] {
  return spans.map((span, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (span.type) {
      case 'strong':
        // Plan 250530 — strong/em/link children are recursively parsed by the
        // parser into `spans: InlineSpan[]`; render them via the same
        // renderInline so nested refs / links / code / em / bold all render.
        // The TL;DR's `**[BEAAA-933](/BEAAA/issues/BEAAA-933)**` headline now
        // resolves the link to a titled chip INSIDE the bold (was: literal
        // markdown text inside <strong>).
        return <strong key={key}>{renderInline(span.spans, `${key}-s`, refVariant)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(span.spans, `${key}-e`, refVariant)}</em>;
      case 'code':
        return (
          <code key={key} className="clarity-md-code">
            {span.text}
          </code>
        );
      case 'link': {
        // The href was already vetted by sanitizeHref in the parser; a rejected
        // href is delivered as a 'text' span, never as a 'link', so this href is
        // always allowlisted. Relative links open in place; absolute ones in a
        // new tab with noopener.
        const isRelative = span.href.startsWith('/');
        return (
          <a
            key={key}
            className="clarity-md-link"
            href={span.href}
            {...(isRelative ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            {renderInline(span.spans, `${key}-l`, refVariant)}
          </a>
        );
      }
      case 'ref':
        // Plan 07-04 (D-I31-02) — render the validated PREFIX-NNN token as a
        // clickable titled chip. RefChip resolves {id,title,status} via the
        // 'resolve-refs' handler and renders `ID — title` (Task 1).
        // Quick 260531-b8w (004-B) — thread the variant so the Reader body's
        // mid-sentence refs render the light inline chip.
        return <RefChip key={key} refId={span.refId} variant={refVariant} />;
      case 'text':
      default:
        return <React.Fragment key={key}>{span.text}</React.Fragment>;
    }
  });
}

function renderBlock(
  block: MarkdownBlock,
  idx: number,
  refVariant: 'full' | 'inline' = 'full',
): React.ReactElement {
  const key = `b-${idx}`;
  switch (block.type) {
    case 'heading': {
      const Tag = (block.level === 3 ? 'h3' : 'h4') as 'h3' | 'h4';
      return (
        <Tag key={key} className="clarity-md-heading">
          {renderInline(block.spans, `${key}-h`, refVariant)}
        </Tag>
      );
    }
    case 'list': {
      const ListTag = (block.ordered ? 'ol' : 'ul') as 'ol' | 'ul';
      return (
        <ListTag key={key} className="clarity-md-list">
          {block.items.map((item, j) => (
            <li key={`${key}-li-${j}`}>{renderInline(item.spans, `${key}-li-${j}`, refVariant)}</li>
          ))}
        </ListTag>
      );
    }
    case 'paragraph':
    default:
      return (
        <p key={key} className="clarity-md-paragraph">
          {renderInline(block.spans, `${key}-p`, refVariant)}
        </p>
      );
  }
}

/**
 * Render `text` (markdown) as safe React nodes. Returns null for empty / nullish
 * input. NEVER uses React's raw-innerHTML escape hatch (no-raw-HTML invariant).
 *
 * Plan 07-04 Task 2 (D-I31-02) — opt-in ref-awareness: when `linkRefs` is true,
 * `PREFIX-NNN` tokens render as clickable titled <RefChip> nodes (the prefix is
 * derived by the caller via extractCompanyPrefixFromPathname; a null/empty
 * `companyPrefix` falls back to the broad pattern). When `linkRefs` is
 * falsy/absent → no `ref` spans are produced, so existing callers that do not
 * pass it are byte-unchanged (back-compat).
 */
export function SafeMarkdown({
  text,
  linkRefs,
  companyPrefix,
  refVariant = 'full',
}: {
  text: string | null | undefined;
  linkRefs?: boolean;
  companyPrefix?: string | null;
  // Quick 260531-b8w (004-B) — which RefChip form a `ref` span renders. Defaults
  // to 'full' so existing callers (TL;DR strip, chat message-thread) are
  // byte-unchanged; ProseWithRefChips passes 'inline' for the Reader body.
  refVariant?: 'full' | 'inline';
}): React.ReactElement | null {
  const blocks = parseMarkdownBlocks(text, linkRefs ? { prefix: companyPrefix ?? null } : undefined);
  if (blocks.length === 0) return null;
  return <div className="clarity-md">{blocks.map((b, i) => renderBlock(b, i, refVariant))}</div>;
}
