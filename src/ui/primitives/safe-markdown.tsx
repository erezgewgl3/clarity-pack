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

function renderInline(spans: InlineSpan[], keyPrefix: string): React.ReactNode[] {
  return spans.map((span, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (span.type) {
      case 'strong':
        return <strong key={key}>{span.text}</strong>;
      case 'em':
        return <em key={key}>{span.text}</em>;
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
            {span.label}
          </a>
        );
      }
      case 'text':
      default:
        return <React.Fragment key={key}>{span.text}</React.Fragment>;
    }
  });
}

function renderBlock(block: MarkdownBlock, idx: number): React.ReactElement {
  const key = `b-${idx}`;
  switch (block.type) {
    case 'heading': {
      const Tag = (block.level === 3 ? 'h3' : 'h4') as 'h3' | 'h4';
      return (
        <Tag key={key} className="clarity-md-heading">
          {renderInline(block.spans, `${key}-h`)}
        </Tag>
      );
    }
    case 'list': {
      const ListTag = (block.ordered ? 'ol' : 'ul') as 'ol' | 'ul';
      return (
        <ListTag key={key} className="clarity-md-list">
          {block.items.map((item, j) => (
            <li key={`${key}-li-${j}`}>{renderInline(item.spans, `${key}-li-${j}`)}</li>
          ))}
        </ListTag>
      );
    }
    case 'paragraph':
    default:
      return (
        <p key={key} className="clarity-md-paragraph">
          {renderInline(block.spans, `${key}-p`)}
        </p>
      );
  }
}

/**
 * Render `text` (markdown) as safe React nodes. Returns null for empty / nullish
 * input. NEVER uses React's raw-innerHTML escape hatch (no-raw-HTML invariant).
 */
export function SafeMarkdown({ text }: { text: string | null | undefined }): React.ReactElement | null {
  const blocks = parseMarkdownBlocks(text);
  if (blocks.length === 0) return null;
  return <div className="clarity-md">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
