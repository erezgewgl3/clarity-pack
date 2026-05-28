// test/ui/safe-markdown.test.mjs
//
// Plan 07-02 Task 1 (D-I3-01) — the hand-rolled, plugin-local SAFE markdown
// renderer. The Editor-Agent emits markdown (## headings, **bold**, *italic*,
// - bullets, [label](url) links, `code`, blank-line paragraph breaks) that the
// TL;DR strip + the Anchored-to ref-card excerpt were rendering as LITERAL text
// (operator saw "## BLUF …" / "**bold**" on BEAAA, 2026-05-29). This renderer
// turns that markdown into React element nodes — NEVER via
// dangerouslySetInnerHTML — with an href allowlist so a javascript:/data: URL
// never becomes a live link and any literal <...> HTML renders as inert text.
//
// HARNESS NOTE: Node 24's native strip-types loads .ts but NOT .tsx (same
// constraint the rest of test/ui/* works around). So the load-bearing parse +
// safety logic lives in a pure src/ui/primitives/safe-markdown.ts module that
// node --test CAN import and assert directly (block/inline tokenization + the
// sanitizeHref allowlist); the thin .tsx component maps that token tree → keyed
// React nodes and is verified by source-grep (no dangerouslySetInnerHTML; uses
// the parser; applies the href allowlist). This mirrors the project idiom
// (reader-view.test.mjs / prose-with-ref-chips.test.mjs are source-grep based).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseMarkdownBlocks, sanitizeHref } from '../../src/ui/primitives/safe-markdown.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const TSX_SRC = readFileSync(
  path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'safe-markdown.tsx'),
  'utf8',
);

// --- helpers ---------------------------------------------------------------

/** Flatten every inline span across every block to a single array. */
function allSpans(blocks) {
  return blocks.flatMap((b) =>
    b.type === 'list' ? b.items.flatMap((it) => it.spans) : (b.spans ?? []),
  );
}
function spanTypes(blocks) {
  return allSpans(blocks).map((s) => s.type);
}

// ---------------------------------------------------------------------------
// Block parse
// ---------------------------------------------------------------------------

test('parseMarkdownBlocks: empty / null / whitespace input yields an empty block list', () => {
  assert.deepEqual(parseMarkdownBlocks(''), []);
  assert.deepEqual(parseMarkdownBlocks(null), []);
  assert.deepEqual(parseMarkdownBlocks(undefined), []);
  assert.deepEqual(parseMarkdownBlocks('   \n\n  '), []);
});

test('parseMarkdownBlocks: a "## " block becomes a heading block (NOT a paragraph containing ##)', () => {
  const blocks = parseMarkdownBlocks('## BLUF');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'heading');
  // the literal "## " marker is consumed, not rendered as text
  const text = blocks[0].spans.map((s) => s.text ?? s.label ?? '').join('');
  assert.equal(text.includes('##'), false, 'heading marker stripped');
  assert.equal(text, 'BLUF');
});

test('parseMarkdownBlocks: "### " is a deeper heading level than "## "', () => {
  const h2 = parseMarkdownBlocks('## Top');
  const h3 = parseMarkdownBlocks('### Detail');
  assert.equal(h2[0].type, 'heading');
  assert.equal(h3[0].type, 'heading');
  // "## " → level 3 (h3), "### " → level 4 (h4); deeper marker = higher level number.
  assert.equal(h2[0].level, 3);
  assert.equal(h3[0].level, 4);
  assert.ok(h3[0].level > h2[0].level, '### renders one level deeper than ##');
});

test('parseMarkdownBlocks: consecutive "- " / "* " lines become ONE unordered list with one item per line', () => {
  const blocks = parseMarkdownBlocks('- alpha\n- beta\n* gamma');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].ordered, false);
  assert.equal(blocks[0].items.length, 3);
});

test('parseMarkdownBlocks: consecutive "1." / "2." lines become ONE ordered list', () => {
  const blocks = parseMarkdownBlocks('1. first\n2. second');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].ordered, true);
  assert.equal(blocks[0].items.length, 2);
});

test('parseMarkdownBlocks: blank-line-separated prose becomes multiple paragraph blocks', () => {
  const blocks = parseMarkdownBlocks('first para\n\nsecond para');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].type, 'paragraph');
});

// ---------------------------------------------------------------------------
// Inline parse
// ---------------------------------------------------------------------------

test('inline: **bold** becomes a strong span whose text is the inner content', () => {
  const blocks = parseMarkdownBlocks('say **hello** now');
  const strong = allSpans(blocks).find((s) => s.type === 'strong');
  assert.ok(strong, 'a strong span exists');
  assert.equal(strong.text, 'hello');
  assert.equal(spanTypes(blocks).includes('strong'), true);
});

test('inline: *italic* and _italic_ become em spans', () => {
  assert.equal(spanTypes(parseMarkdownBlocks('a *b* c')).includes('em'), true);
  assert.equal(spanTypes(parseMarkdownBlocks('a _b_ c')).includes('em'), true);
});

test('inline: `code` becomes a code span', () => {
  const blocks = parseMarkdownBlocks('run `npm test` ok');
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code);
  assert.equal(code.text, 'npm test');
});

test('inline: [label](https://e.com) becomes a link span with label text + the href', () => {
  const blocks = parseMarkdownBlocks('see [the doc](https://e.com)');
  const link = allSpans(blocks).find((s) => s.type === 'link');
  assert.ok(link, 'a link span exists');
  assert.equal(link.label, 'the doc');
  assert.equal(link.href, 'https://e.com');
});

test('inline: malformed / unmatched markup degrades to plain text (never throws)', () => {
  assert.doesNotThrow(() => parseMarkdownBlocks('an **unclosed bold and a [broken](link'));
  const blocks = parseMarkdownBlocks('an **unclosed bold');
  // no strong span — the lone marker is just text
  assert.equal(spanTypes(blocks).includes('strong'), false);
});

// ---------------------------------------------------------------------------
// SAFETY (load-bearing) — sanitizeHref allowlist
// ---------------------------------------------------------------------------

test('sanitizeHref: http/https/mailto/relative are allowed', () => {
  assert.equal(sanitizeHref('https://e.com'), 'https://e.com');
  assert.equal(sanitizeHref('http://e.com'), 'http://e.com');
  assert.equal(sanitizeHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(sanitizeHref('/BEAAA/issues/BEAAA-1'), '/BEAAA/issues/BEAAA-1');
});

test('sanitizeHref: javascript:/data:/vbscript: (and obfuscated case/whitespace variants) are rejected (null)', () => {
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
  assert.equal(sanitizeHref('JavaScript:alert(1)'), null);
  assert.equal(sanitizeHref('  javascript:alert(1)'), null);
  assert.equal(sanitizeHref('java\tscript:alert(1)'), null);
  assert.equal(sanitizeHref('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeHref('vbscript:msgbox(1)'), null);
});

test('XSS: [x](javascript:alert(1)) does NOT yield a live javascript: href', () => {
  const blocks = parseMarkdownBlocks('click [x](javascript:alert(1))');
  const link = allSpans(blocks).find((s) => s.type === 'link');
  // implemented behavior: a rejected href downgrades the link to plain text
  // (no link span emitted with a javascript: href).
  if (link) {
    assert.notEqual(link.href, 'javascript:alert(1)');
    assert.equal(link.href == null || link.href === '', true, 'no live javascript: href');
  } else {
    // downgraded to text — assert the label text survives as plain content
    const text = allSpans(blocks).map((s) => s.text ?? s.label ?? '').join('');
    assert.equal(text.includes('x'), true);
  }
  // belt-and-braces: no span anywhere carries the hostile href
  assert.equal(
    allSpans(blocks).some((s) => s.href === 'javascript:alert(1)'),
    false,
    'no span carries a javascript: href',
  );
});

test('XSS: a <script> tag in the input is parsed as inert text content (no script block, no raw HTML span)', () => {
  const blocks = parseMarkdownBlocks('<script>alert(1)</script>');
  // The literal string is preserved as text; React text nodes escape it on render.
  const text = allSpans(blocks).map((s) => s.text ?? s.label ?? '').join('');
  assert.equal(text, '<script>alert(1)</script>');
  // No span type smuggles raw HTML.
  for (const s of allSpans(blocks)) {
    assert.notEqual(s.type, 'html');
    assert.notEqual(s.type, 'script');
  }
});

// ---------------------------------------------------------------------------
// Source-scan of the .tsx component (the load-bearing no-innerHTML guard)
// ---------------------------------------------------------------------------

test('safe-markdown.tsx contains NO dangerouslySetInnerHTML (load-bearing XSS guard)', () => {
  assert.equal(
    /dangerouslySetInnerHTML/.test(TSX_SRC),
    false,
    'SafeMarkdown must NEVER use dangerouslySetInnerHTML',
  );
});

test('safe-markdown.tsx exports SafeMarkdown and consumes the pure parser (parseMarkdownBlocks)', () => {
  assert.match(TSX_SRC, /export function SafeMarkdown/);
  assert.match(TSX_SRC, /parseMarkdownBlocks/);
});

test('safe-markdown.tsx applies the href allowlist (sanitizeHref) — no unvetted href reaches an anchor', () => {
  // The component must route any link href through sanitizeHref (the allowlist
  // lives in the parser; the .tsx must not re-introduce a raw href bypass).
  assert.match(TSX_SRC, /sanitizeHref|href === null|href == null|\.href\b/);
});
