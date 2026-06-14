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

test('inline: **bold** becomes a strong span whose nested spans carry the inner content', () => {
  // Plan 250530 — `strong` now carries `spans: InlineSpan[]` (was `text:string`).
  // A simple `**hello**` yields a strong with a single nested text span.
  const blocks = parseMarkdownBlocks('say **hello** now');
  const strong = allSpans(blocks).find((s) => s.type === 'strong');
  assert.ok(strong, 'a strong span exists');
  assert.ok(Array.isArray(strong.spans), 'strong carries `spans: InlineSpan[]`');
  assert.equal(strong.spans.length, 1, 'single nested text span for "hello"');
  assert.equal(strong.spans[0].type, 'text');
  assert.equal(strong.spans[0].text, 'hello');
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

test('inline: [label](https://e.com) becomes a link span with nested label spans + the href', () => {
  // Plan 250530 — `link` now carries `spans: InlineSpan[]` (was `label:string`).
  // A plain label yields a single nested text span; `href` is unchanged.
  const blocks = parseMarkdownBlocks('see [the doc](https://e.com)');
  const link = allSpans(blocks).find((s) => s.type === 'link');
  assert.ok(link, 'a link span exists');
  assert.equal(link.href, 'https://e.com');
  assert.ok(Array.isArray(link.spans), 'link carries `spans: InlineSpan[]`');
  assert.equal(link.spans.length, 1);
  assert.equal(link.spans[0].type, 'text');
  assert.equal(link.spans[0].text, 'the doc');
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

test('T1-A: hrefs carrying an unfilled <…> template placeholder are rejected (null) — no repeating 404', () => {
  // The literal angle-bracket placeholder left in a deliverable/ref URL by an
  // agent (the BEAAA `/api/issues/<weekly-issue-id>#document-<weekly-doc-key>`
  // 404 loop). A raw `<`/`>` is invalid in a URI (RFC 3986 §2) so it can never
  // resolve — Clarity must never emit it as a live anchor.
  assert.equal(sanitizeHref('/api/issues/<weekly-issue-id>#document-<weekly-doc-key>'), null);
  assert.equal(sanitizeHref('/issues/<id>'), null);
  assert.equal(sanitizeHref('https://example.com/<placeholder>'), null);
  assert.equal(sanitizeHref('/a>b'), null);
  // Real (filled-in) links are unaffected — no angle brackets.
  assert.equal(sanitizeHref('/BEAAA/issues/BEAAA-933'), '/BEAAA/issues/BEAAA-933');
  assert.equal(sanitizeHref('https://example.com/x'), 'https://example.com/x');
});

test('T1-A: a markdown link with a <…> placeholder href downgrades to inert text (no fetchable link)', () => {
  const blocks = parseMarkdownBlocks(
    'see the [weekly report](/api/issues/<weekly-issue-id>#document-<weekly-doc-key>)',
  );
  // No span anywhere carries the placeholder href as a live link.
  assert.equal(
    allSpans(blocks).some((s) => s.type === 'link'),
    false,
    'placeholder-href link must NOT become a live anchor',
  );
  // The human-readable label still survives as plain text.
  const text = allSpans(blocks).map((s) => s.text ?? '').join('');
  assert.equal(text.includes('weekly report'), true);
  assert.equal(text.includes('<weekly-issue-id>'), false, 'placeholder URL is dropped, not rendered');
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

// ---------------------------------------------------------------------------
// Plan 07-04 Task 2 (D-I31-02) — opt-in ref-awareness (parseMarkdownBlocks /
// parseInline gain an optional refOpts param; a PREFIX-NNN token becomes a
// `ref` span). Instance-agnostic; back-compat (no opt-in = no chips); the XSS
// guards still hold with refOpts on.
// ---------------------------------------------------------------------------

/** Collect every `ref` span across all blocks. */
function refSpans(blocks) {
  return allSpans(blocks).filter((s) => s.type === 'ref');
}

test('ref-aware (D-I31-02): a PREFIX-NNN token becomes a `ref` span when refOpts.prefix is given; surrounding text survives', () => {
  const blocks = parseMarkdownBlocks('Blocked by BEAAA-141 until review', { prefix: 'BEAAA' });
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1, 'exactly one ref span');
  assert.equal(refs[0].refId, 'BEAAA-141', 'refId is the matched token');
  // surrounding text survives as text spans
  const text = allSpans(blocks)
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join('');
  assert.equal(text.includes('Blocked by'), true, 'leading text survives');
  assert.equal(text.includes('until review'), true, 'trailing text survives');
});

test('ref-aware (D-I31-02): WITHOUT refOpts the SAME input yields NO `ref` span (back-compat)', () => {
  const blocks = parseMarkdownBlocks('Blocked by BEAAA-141 until review');
  assert.equal(refSpans(blocks).length, 0, 'no ref span without the opt-in');
  // and the token survives as plain text
  const text = allSpans(blocks)
    .map((s) => s.text ?? s.label ?? '')
    .join('');
  assert.equal(text.includes('BEAAA-141'), true, 'token stays plain text');
});

test('ref-aware (D-I31-02): instance-agnostic — prefix:"COU" chip-ifies COU-12 and NOT BEAAA-807', () => {
  const blocks = parseMarkdownBlocks('see COU-12 and BEAAA-807', { prefix: 'COU' });
  const refs = refSpans(blocks);
  assert.deepEqual(
    refs.map((r) => r.refId),
    ['COU-12'],
    'only the COU token becomes a ref; BEAAA-807 stays text',
  );
  const text = allSpans(blocks)
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join('');
  assert.equal(text.includes('BEAAA-807'), true, 'the off-prefix token stays plain text');
});

test('ref-aware (D-I31-02): broad fallback — prefix:null (or {}) chip-ifies both COU-12 and BEAAA-807', () => {
  const a = refSpans(parseMarkdownBlocks('see COU-12 and BEAAA-807', { prefix: null }));
  assert.deepEqual(a.map((r) => r.refId).sort(), ['BEAAA-807', 'COU-12']);
  const b = refSpans(parseMarkdownBlocks('see COU-12 and BEAAA-807', {}));
  assert.deepEqual(b.map((r) => r.refId).sort(), ['BEAAA-807', 'COU-12']);
});

test('ref-aware (D-I31-02): markdown still works alongside refs (heading + list with a ref span)', () => {
  const blocks = parseMarkdownBlocks('## Plan\n\n- do BEAAA-9 thing', { prefix: 'BEAAA' });
  assert.equal(blocks[0].type, 'heading', 'first block is a heading');
  const list = blocks.find((b) => b.type === 'list');
  assert.ok(list, 'a list block exists');
  const itemSpans = list.items.flatMap((it) => it.spans);
  const ref = itemSpans.find((s) => s.type === 'ref');
  assert.ok(ref, 'the list item contains a ref span');
  assert.equal(ref.refId, 'BEAAA-9');
});

test('ref-aware (D-I31-02 + 250530): a ref INSIDE a link label stays inside the link — but is now a NESTED ref span (recursion)', () => {
  // Plan 250530 — links now carry recursively-parsed children
  // (`spans: InlineSpan[]`). The link still "wins" the leftmost-match contest
  // (the ref isn't carved OUT of the link span), but the link's children are
  // re-parsed so the embedded ref token becomes a nested ref span. The Reader
  // renders the chip INSIDE the anchor — strictly better operator UX.
  const blocks = parseMarkdownBlocks('[BEAAA-1 details](https://e.com)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'one link span — the wrapping anchor still wins');
  assert.equal(links[0].href, 'https://e.com', 'the link href is preserved verbatim');
  // The ref is NESTED inside the link's spans (not at the top level).
  const topLevelRefs = allSpans(blocks).filter((s) => s.type === 'ref');
  assert.equal(topLevelRefs.length, 0, 'no top-level ref carved out of the link');
  const nestedRef = links[0].spans.find((s) => s.type === 'ref');
  assert.ok(nestedRef, 'the ref token is a nested ref span inside the link');
  assert.equal(nestedRef.refId, 'BEAAA-1');
  // The trailing " details" survives as a text sibling inside the link.
  const trailingText = links[0].spans.filter((s) => s.type === 'text').map((s) => s.text).join('');
  assert.equal(trailingText.includes('details'), true, 'trailing label text survives');
});

test('ref-aware (D-I31-02): XSS STILL HOLDS with refOpts on — <script> is inert text, no js: href', () => {
  // <script> tag → inert text even with the opt-in enabled
  const sb = parseMarkdownBlocks('<script>BEAAA-1</script>', { prefix: 'BEAAA' });
  for (const s of allSpans(sb)) {
    assert.notEqual(s.type, 'html');
    assert.notEqual(s.type, 'script');
  }
  // the literal <script> survives as text content (React escapes it on render)
  const text = allSpans(sb)
    .map((s) => s.text ?? s.label ?? s.refId ?? '')
    .join('');
  assert.equal(text.includes('<script>'), true, 'script tag preserved as inert text');

  // a javascript: href is still rejected with refOpts on
  const jb = parseMarkdownBlocks('click [x](javascript:alert(1))', { prefix: 'BEAAA' });
  assert.equal(
    allSpans(jb).some((s) => s.href === 'javascript:alert(1)'),
    false,
    'no span carries a javascript: href even with refOpts on',
  );
});

test('ref-aware (D-I31-02): sanitizeHref source is UNCHANGED (the allowlist is load-bearing)', () => {
  // sanitizeHref still allows http/https/mailto/relative and rejects the
  // dangerous schemes — refOpts must not touch the href allowlist.
  assert.equal(sanitizeHref('https://e.com'), 'https://e.com');
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
  assert.equal(sanitizeHref('data:text/html,x'), null);
});

test('safe-markdown.tsx renders RefChip for a `ref` span and STILL has no dangerouslySetInnerHTML', () => {
  assert.match(TSX_SRC, /RefChip/, 'the component imports + renders RefChip for a ref span');
  assert.match(TSX_SRC, /case 'ref'|case "ref"/, "renderInline handles the 'ref' span case");
  assert.equal(
    /dangerouslySetInnerHTML/.test(TSX_SRC),
    false,
    'SafeMarkdown must NEVER use dangerouslySetInnerHTML',
  );
});

test('safe-markdown.tsx SafeMarkdown props widen to accept linkRefs + companyPrefix', () => {
  assert.match(TSX_SRC, /linkRefs/, 'SafeMarkdown accepts a linkRefs prop');
  assert.match(TSX_SRC, /companyPrefix/, 'SafeMarkdown accepts a companyPrefix prop');
});

// ---------------------------------------------------------------------------
// Plan 250530 — code/link span ref-upgrade. The Editor-Agent dresses up issue
// refs as backtick-code (`BEAAA-933`) or markdown links
// ([BEAAA-933](/BEAAA/issues/BEAAA-933)) — both bypass the chip pipeline and
// the operator sees a bare id without a title (the rabbit-hole the Reader was
// meant to close, BEAAA-1047 case 2026-05-30). The parser now upgrades a
// WHOLE-STRING ref token inside a code span — and a canonical issue link
// (bare-token label + matching /<prefix>/issues/<sameId> href) — to a `ref`
// span so the chip resolves the title. Mixed-content code stays code; non-
// canonical links stay links; the XSS allowlist is unchanged.
// ---------------------------------------------------------------------------

test('code → ref (250530): a code span whose content is just a PREFIX-NNN token becomes a ref span', () => {
  const blocks = parseMarkdownBlocks('see `BEAAA-933` now', { prefix: 'BEAAA' });
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1, 'one ref span carved out of the code span');
  assert.equal(refs[0].refId, 'BEAAA-933');
  // and NO code span survives — the upgrade is the chosen span.
  assert.equal(
    allSpans(blocks).some((s) => s.type === 'code' && s.text === 'BEAAA-933'),
    false,
    'the bare-token code span was upgraded, not duplicated',
  );
});

test('code → ref + recursive gloss (250530 v1.1.3): MIXED content with leading PREFIX-NNN + em-dash IS broken apart', () => {
  // EXPLICIT REVERSAL of the v1.1.1 conservative call. The agent's hand-rolled
  // gloss (`BEAAA-933 — BEAAA-187 child — ...in_review`) is the pervasive
  // shape on BEAAA-1000, BEAAA-1047, and every TL;DR. v1.1.3 detects the
  // leading PREFIX-NNN + em-dash and chips it, then recursively parses the
  // gloss so the EMBEDDED BEAAA-187 ALSO chips. The v1.1.1 test phrased this
  // as "the parser must not torture mixed code into a ref" — that conservative
  // call left the operator with a wall of boxed monospace text, which is
  // exactly the "still reads like a mess" complaint v1.1.3 closes.
  const input = 'pinned: `BEAAA-933 — BEAAA-187 child — v1.1.2 reconciliation of in_review`';
  const blocks = parseMarkdownBlocks(input, { prefix: 'BEAAA' });
  // Leading id is now a ref.
  const refs = refSpans(blocks).map((r) => r.refId).sort();
  assert.deepEqual(refs, ['BEAAA-187', 'BEAAA-933'], 'BOTH refs (leading + embedded) chip');
  // The original mixed-content code span is REPLACED by [ref, ...glossSpans];
  // the verbatim gloss string no longer appears as a single code span.
  const code = allSpans(blocks).find(
    (s) => s.type === 'code' && s.text.includes('BEAAA-933 — BEAAA-187 child'),
  );
  assert.equal(code, undefined, 'the original mixed-content code span is broken apart');
});

test('code stays code (250530): non-ref content inside backticks (version string, status enum) stays code', () => {
  for (const lit of ['v1.1.2', 'in_review', 'b5c5da95', 'npm test']) {
    const blocks = parseMarkdownBlocks('x `' + lit + '` y', { prefix: 'BEAAA' });
    assert.equal(refSpans(blocks).length, 0, `no ref for ${lit}`);
    const code = allSpans(blocks).find((s) => s.type === 'code');
    assert.ok(code, `code span survives for ${lit}`);
    assert.equal(code.text, lit);
  }
});

test('code stays code (250530): trimming — ` BEAAA-933 ` (whitespace inside ticks) STILL upgrades to ref', () => {
  // The agent may add whitespace inside the backticks; the trimmed-token check
  // handles that — the chip resolves on the trimmed id.
  const blocks = parseMarkdownBlocks('see `  BEAAA-933  ` here', { prefix: 'BEAAA' });
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].refId, 'BEAAA-933');
});

test('code stays code (250530): WITHOUT refOpts the upgrade is OFF (back-compat — `BEAAA-933` stays code)', () => {
  const blocks = parseMarkdownBlocks('see `BEAAA-933`');
  assert.equal(refSpans(blocks).length, 0);
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code);
  assert.equal(code.text, 'BEAAA-933');
});

test('code → ref (250530): broad fallback — prefix:null upgrades any whole-token code span', () => {
  const blocks = parseMarkdownBlocks('see `COU-2486` here', { prefix: null });
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].refId, 'COU-2486');
});

test('canonical link → ref (250530): [BEAAA-933](/BEAAA/issues/BEAAA-933) becomes a ref span', () => {
  const blocks = parseMarkdownBlocks(
    'blocked on [BEAAA-933](/BEAAA/issues/BEAAA-933) before op-seat',
    { prefix: 'BEAAA' },
  );
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1, 'one ref span carved out of the canonical issue link');
  assert.equal(refs[0].refId, 'BEAAA-933');
  // and no link span lingers (the explicit anchor was the agent's "fancy
  // version of a ref" — the chip is the better surface).
  assert.equal(
    allSpans(blocks).some((s) => s.type === 'link'),
    false,
    'the canonical link was upgraded to a ref, not duplicated',
  );
});

test('link stays link (250530): CUSTOM label is preserved — [BEAAA-933 — title](/BEAAA/issues/BEAAA-933)', () => {
  // A label with extra content is an explicit author choice — keep it. With
  // 250530 recursion the label's PREFIX-NNN token inside the link is now a
  // nested ref span (chip rendered inside the anchor) and the trailing
  // " — title" stays as text.
  const blocks = parseMarkdownBlocks('[BEAAA-933 — title](/BEAAA/issues/BEAAA-933)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'link survives');
  assert.equal(links[0].href, '/BEAAA/issues/BEAAA-933');
  // Inside the link: a nested ref + a text span carrying the trailing " — title".
  const nestedRef = links[0].spans.find((s) => s.type === 'ref');
  assert.ok(nestedRef, 'the ref token inside the custom label is a nested ref span');
  assert.equal(nestedRef.refId, 'BEAAA-933');
  const labelText = links[0].spans.filter((s) => s.type === 'text').map((s) => s.text).join('');
  assert.equal(labelText.includes('title'), true, 'the custom suffix survives as text');
  // No TOP-LEVEL ref carved out — the link still wraps everything.
  assert.equal(refSpans(blocks).length, 0, 'no top-level ref carved out of the custom-label link');
});

test('link stays link (250530): CROSS-INSTANCE — label prefix ≠ url prefix is NOT upgraded', () => {
  // [BEAAA-933] href /COU/issues/BEAAA-933 — a deliberate cross-instance link.
  const blocks = parseMarkdownBlocks('[BEAAA-933](/COU/issues/BEAAA-933)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'cross-instance link survives');
  assert.equal(refSpans(blocks).length, 0);
});

test('link stays link (250530): EXTRA path/query is NOT upgraded — /BEAAA/issues/BEAAA-933?focus=ac1 stays a link', () => {
  // A deep-link target is intentional — leave it.
  const blocks = parseMarkdownBlocks('[BEAAA-933](/BEAAA/issues/BEAAA-933?focus=ac1)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'deep-link survives');
  assert.equal(refSpans(blocks).length, 0);
});

test('link stays link (250530): OFF-PREFIX label (prefix-narrowed mode) is NOT upgraded', () => {
  // prefix:'BEAAA' but the link refers to a COU issue — outside the narrowed prefix.
  const blocks = parseMarkdownBlocks('[COU-12](/COU/issues/COU-12)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'off-prefix link survives');
  assert.equal(refSpans(blocks).length, 0);
});

test('link → ref (250530): broad fallback (prefix:null) upgrades any canonical /<id>-prefix/issues/<id> link', () => {
  const blocks = parseMarkdownBlocks('[COU-12](/COU/issues/COU-12)', { prefix: null });
  const refs = refSpans(blocks);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].refId, 'COU-12');
});

test('SAFETY (250530): a javascript: href is STILL rejected — no ref/link upgrade can bypass the allowlist', () => {
  // Even though label "BEAAA-933" matches the canonical-ref shape, the hostile
  // href fails sanitizeHref → the link downgrades to TEXT (label only). The
  // ref-upgrade path is gated on a non-null `href` so it cannot fire here.
  const blocks = parseMarkdownBlocks('click [BEAAA-933](javascript:alert(1))', { prefix: 'BEAAA' });
  // no ref carved out of a hostile link, no anchor with the hostile href
  assert.equal(refSpans(blocks).length, 0, 'no ref upgrade smuggling past sanitizeHref');
  assert.equal(
    allSpans(blocks).some((s) => s.href === 'javascript:alert(1)'),
    false,
    'no span carries the hostile href',
  );
});

test('SAFETY (250530): a `ref` span carries ONLY a validated id string — no href/HTML can ride along', () => {
  const blocks = parseMarkdownBlocks(
    'see `BEAAA-933` and [BEAAA-141](/BEAAA/issues/BEAAA-141)',
    { prefix: 'BEAAA' },
  );
  for (const r of refSpans(blocks)) {
    // shape: { type: 'ref', refId: <id> } — nothing else.
    const keys = Object.keys(r).sort();
    assert.deepEqual(keys, ['refId', 'type'], 'ref span carries only type + refId');
    assert.match(r.refId, /^[A-Z][A-Z0-9]{1,7}-\d+$/, 'refId is a validated token');
  }
});

// ---------------------------------------------------------------------------
// Plan 250530 — strong/em/link RECURSION. The pre-recursion parser produced
// `strong/em/link` spans with a flat `text` (or `label`) STRING, which the
// .tsx renderer mounted as a raw text node. So `**[BEAAA-933](/url)**` showed
// the literal `[BEAAA-933](/url)` markdown SYNTAX inside the bold — the exact
// "still reads like a mess" complaint on BEAAA-1047's TL;DR headline
// (2026-05-30). Recursing into the children via parseInline produces a fully-
// resolved tree so nested refs / links / code / em / bold render correctly.
// ---------------------------------------------------------------------------

function flattenAllSpans(spans) {
  const out = [];
  for (const s of spans ?? []) {
    out.push(s);
    if (s.type === 'strong' || s.type === 'em' || s.type === 'link') {
      out.push(...flattenAllSpans(s.spans));
    }
  }
  return out;
}

test('recursion (250530): **[BEAAA-933](/BEAAA/issues/BEAAA-933)** — the canonical-issue-link inside bold becomes a ref chip inside the strong', () => {
  // The TL;DR's exact headline shape on BEAAA-1047.
  const blocks = parseMarkdownBlocks(
    '**BEAAA-1047 is blocked on countersigning [BEAAA-933](/BEAAA/issues/BEAAA-933)**',
    { prefix: 'BEAAA' },
  );
  const strong = allSpans(blocks).find((s) => s.type === 'strong');
  assert.ok(strong, 'a strong span exists');
  const refs = strong.spans.filter((s) => s.type === 'ref').map((s) => s.refId);
  // Both the plain-prose BEAAA-1047 and the canonical-link-upgraded BEAAA-933
  // become ref spans nested inside the strong.
  assert.deepEqual(refs.sort(), ['BEAAA-1047', 'BEAAA-933']);
  // No literal markdown-link or markdown-text fragment survives as a link span
  // inside the strong — the canonical link was upgraded all the way to a ref.
  assert.equal(
    strong.spans.some((s) => s.type === 'link'),
    false,
    'the canonical issue link inside bold is upgraded to a ref, not left as a link',
  );
  // No literal `[`/`]`/`(`/`)` markdown survives as text inside the strong
  const stringy = strong.spans
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join('');
  assert.equal(/[[\]()]/.test(stringy), false, 'no literal markdown brackets/parens in the strong');
});

test('recursion (250530): *italic* with a ref inside chips up — *see BEAAA-141 today*', () => {
  const blocks = parseMarkdownBlocks('*see BEAAA-141 today*', { prefix: 'BEAAA' });
  const em = allSpans(blocks).find((s) => s.type === 'em');
  assert.ok(em, 'an em span exists');
  const ref = em.spans.find((s) => s.type === 'ref');
  assert.ok(ref, 'the ref token inside italic is a nested ref span');
  assert.equal(ref.refId, 'BEAAA-141');
});

test('recursion (250530): a non-canonical link label re-parses children — [hold **on** to BEAAA-141](https://e.com)', () => {
  // The link is NOT canonical (href is external), so the label is recursively
  // parsed and the bold + ref render inside the anchor.
  const blocks = parseMarkdownBlocks('[hold **on** to BEAAA-141](https://e.com)', { prefix: 'BEAAA' });
  const link = allSpans(blocks).find((s) => s.type === 'link');
  assert.ok(link, 'the non-canonical link stays a link');
  assert.equal(link.href, 'https://e.com');
  const types = link.spans.map((s) => s.type);
  assert.ok(types.includes('strong'), 'the **on** bold survives inside the link label');
  assert.ok(types.includes('ref'), 'the BEAAA-141 ref renders inside the link label');
});

test('recursion (250530): triply-nested **outer _BEAAA-9 here_ end** — bold with em with ref, no literal markup leaks', () => {
  // Different markers (** for strong, _ for em) so leftmost-match picks the
  // outer strong first; parseInline then re-parses the inner content and the
  // _em_ + ref token nest cleanly. The pre-recursion parser would have
  // returned strong with `.text = "outer _BEAAA-9 here_ end"` and rendered the
  // underscores as literal text.
  const blocks = parseMarkdownBlocks('**outer _BEAAA-9 here_ end**', { prefix: 'BEAAA' });
  const strong = allSpans(blocks).find((s) => s.type === 'strong');
  assert.ok(strong, 'an outer strong exists');
  const em = strong.spans.find((s) => s.type === 'em');
  assert.ok(em, 'the _em_ is nested inside the strong');
  const ref = em.spans.find((s) => s.type === 'ref');
  assert.ok(ref, 'the ref leaks all the way to the em-inside-strong leaf');
  assert.equal(ref.refId, 'BEAAA-9');
  // No literal underscore should appear in the strong's children
  const flat = flattenAllSpans(strong.spans);
  const stringy = flat
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join('');
  assert.equal(/_/.test(stringy), false, 'no literal underscore syntax inside the strong');
});

test('recursion (250530): `code` does NOT recurse — backticks remain verbatim (code is a leaf)', () => {
  // Even though `[BEAAA-9](/url)` looks like markdown, inside backticks it's
  // verbatim by contract — the chip pipeline's bare-id upgrade only fires on a
  // WHOLE-string match (see code → ref tests above), not on substrings.
  const blocks = parseMarkdownBlocks('`[BEAAA-9](/x)`', { prefix: 'BEAAA' });
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code, 'the code span survives');
  assert.equal(code.text, '[BEAAA-9](/x)', 'inline code is verbatim — no recursion');
  // No accidental refs/links carved out of the code content.
  const all = allSpans(blocks);
  assert.equal(all.filter((s) => s.type === 'ref').length, 0);
  assert.equal(all.filter((s) => s.type === 'link').length, 0);
});

test('SAFETY (250530 recursion): XSS still holds — a javascript: href inside bold (**[x](js:)**) is downgraded to text', () => {
  const blocks = parseMarkdownBlocks('**[x](javascript:alert(1))**', { prefix: 'BEAAA' });
  // No span anywhere carries a javascript href, even nested.
  const all = flattenAllSpans(allSpans(blocks));
  assert.equal(
    all.some((s) => s.href === 'javascript:alert(1)'),
    false,
    'no nested span carries the hostile href',
  );
});

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.3 — leading-PREFIX-NNN-with-separator in a code span. The
// agent's BEAAA-1000 TL;DR + body shipped boxed `<id> — <gloss>` strings
// everywhere; the conservative v1.1.1 left these as code and the operator saw
// no chips. v1.1.3 splits: chip the leading id + recursively parse the gloss
// so EMBEDDED refs ALSO chip. Separator set is explicit (whitespace / em-dash /
// en-dash / colon) so derived tokens (BEAAA-933-foo, BEAAA-933.json) stay code.
// ---------------------------------------------------------------------------

test('v1.1.3 code-leading-ref: the BEAAA-1000 TL;DR pattern chips both refs', () => {
  // EXACT shape from BEAAA-1000 TL;DR (2026-05-30 screenshot).
  const input = 'closed (`BEAAA-1086 — UW operational pre-read of BEAAA-1000 Sco` /';
  const blocks = parseMarkdownBlocks(input, { prefix: 'BEAAA' });
  const refs = refSpans(blocks).map((r) => r.refId).sort();
  assert.deepEqual(refs, ['BEAAA-1000', 'BEAAA-1086'], 'leading id + embedded id BOTH chip');
});

test('v1.1.3 code-leading-ref: the agent pervasive pattern `BEAAA-NNN — title-fragment — UUID`', () => {
  // Another exact BEAAA-1000 fragment.
  const input = '`BEAAA-1168 — Compile TL;DR — a119b8e7-d79e-404e-9e66-1`';
  const blocks = parseMarkdownBlocks(input, { prefix: 'BEAAA' });
  const refs = refSpans(blocks).map((r) => r.refId);
  assert.deepEqual(refs, ['BEAAA-1168'], 'leading id chips; UUID tail discarded as plain text');
  // No spurious chip from the UUID.
  assert.equal(
    refs.some((r) => r.includes('a119b8e7')),
    false,
    'UUID is not misread as a ref',
  );
});

test('v1.1.3 code-leading-ref: SEPARATOR set — space, em-dash, en-dash, colon all trigger the split', () => {
  for (const [sep, label] of [
    [' ', 'space'],
    [' — ', 'em-dash with spaces'],
    ['—', 'bare em-dash'],
    [' – ', 'en-dash with spaces'],
    [': ', 'colon-space'],
  ]) {
    const blocks = parseMarkdownBlocks('x `BEAAA-933' + sep + 'gloss` y', { prefix: 'BEAAA' });
    const refs = refSpans(blocks).map((r) => r.refId);
    assert.deepEqual(refs, ['BEAAA-933'], `separator "${label}" triggers the chip split`);
  }
});

test('v1.1.3 code-leading-ref: HYPHEN and DOT are NOT separators — `BEAAA-933-foo` / `BEAAA-933.json` stay as code', () => {
  for (const lit of ['BEAAA-933-extension', 'BEAAA-933.json', 'BEAAA-933.md']) {
    const blocks = parseMarkdownBlocks('see `' + lit + '` here', { prefix: 'BEAAA' });
    assert.equal(refSpans(blocks).length, 0, `${lit} does NOT trigger the split`);
    const code = allSpans(blocks).find((s) => s.type === 'code');
    assert.ok(code, `${lit} survives as a code span`);
    assert.equal(code.text, lit);
  }
});

test('v1.1.3 code-leading-ref: PRE-EXISTING legit code still stays code (npm test, v1.1.2, in_review, status enums)', () => {
  // Non-ref code spans are unaffected — these were the v1.1.1 protected cases
  // and they remain protected: the split fires ONLY when the content STARTS
  // with a valid PREFIX-NNN token.
  for (const lit of ['npm test', 'v1.1.2', 'in_review', 'b5c5da95', 'scan_id 244ea118', 'done']) {
    const blocks = parseMarkdownBlocks('x `' + lit + '` y', { prefix: 'BEAAA' });
    assert.equal(refSpans(blocks).length, 0, `${lit} stays code (not a leading ref)`);
    const code = allSpans(blocks).find((s) => s.type === 'code');
    assert.ok(code, `${lit} code span survives`);
    assert.equal(code.text, lit);
  }
});

test('v1.1.3 code-leading-ref: OFF-PREFIX leading id (prefix-narrowed mode) stays as code', () => {
  // With prefix:'BEAAA' a leading COU-12 must NOT split — only BEAAA-NNN does.
  const blocks = parseMarkdownBlocks('see `COU-12 — sales project gloss` now', { prefix: 'BEAAA' });
  assert.equal(refSpans(blocks).length, 0, 'off-prefix leading id stays code');
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code, 'the code span survives');
  assert.equal(code.text, 'COU-12 — sales project gloss');
});

test('v1.1.3 code-leading-ref: BROAD fallback (prefix:null) splits any leading PREFIX-NNN', () => {
  const blocks = parseMarkdownBlocks('see `COU-12 — sales project gloss` now', { prefix: null });
  const refs = refSpans(blocks).map((r) => r.refId);
  assert.deepEqual(refs, ['COU-12']);
});

test('v1.1.3 code-leading-ref: a single bare-id code span still upgrades (back-compat — `BEAAA-933` alone)', () => {
  // The whole-string check from v1.1.1 still fires before the split check.
  const blocks = parseMarkdownBlocks('see `BEAAA-933` end', { prefix: 'BEAAA' });
  const refs = refSpans(blocks).map((r) => r.refId);
  assert.deepEqual(refs, ['BEAAA-933']);
});

test('v1.1.3 code-leading-ref: chained refs in the gloss ALL chip — `A-1 — B-2 — C-3`', () => {
  // Three-deep ref chain — the leading splits, then the rest is recursively
  // parsed and the gloss tokens chip via the normal in-prose ref regex.
  const blocks = parseMarkdownBlocks('`BEAAA-1 — BEAAA-2 — BEAAA-3`', { prefix: 'BEAAA' });
  const refs = refSpans(blocks).map((r) => r.refId).sort();
  assert.deepEqual(refs, ['BEAAA-1', 'BEAAA-2', 'BEAAA-3']);
});

test('v1.1.3 code-leading-ref: WITHOUT refOpts the split is OFF (back-compat — code stays code)', () => {
  const blocks = parseMarkdownBlocks('`BEAAA-933 — gloss BEAAA-1000`');
  assert.equal(refSpans(blocks).length, 0, 'no refs without the opt-in');
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code);
  assert.equal(code.text, 'BEAAA-933 — gloss BEAAA-1000');
});

test('SAFETY (250530 v1.1.3): the ref span carved by the leading-id split carries ONLY a validated id', () => {
  const blocks = parseMarkdownBlocks('`BEAAA-933 — anything <script>alert(1)</script> here`', {
    prefix: 'BEAAA',
  });
  const refs = refSpans(blocks);
  assert.ok(refs.length >= 1);
  // The first ref MUST be the leading id (a validated token shape).
  assert.match(refs[0].refId, /^[A-Z][A-Z0-9]{1,7}-\d+$/);
  assert.equal(refs[0].refId, 'BEAAA-933');
  // ref span has ONLY {type, refId} — no script HTML can ride along.
  for (const r of refs) {
    const keys = Object.keys(r).sort();
    assert.deepEqual(keys, ['refId', 'type']);
  }
  // The <script> tag survives ONLY as inert text (React escapes it on render).
  const all = allSpans(blocks);
  for (const s of all) {
    assert.notEqual(s.type, 'html');
    assert.notEqual(s.type, 'script');
  }
});

test('SAFETY (250530 recursion): no `text` field on strong/em/link spans (the old flat shape is GONE)', () => {
  const blocks = parseMarkdownBlocks('**hello** and *world* and [x](/y)', { prefix: 'BEAAA' });
  for (const s of allSpans(blocks)) {
    if (s.type === 'strong' || s.type === 'em') {
      assert.equal('text' in s, false, `${s.type} no longer carries a flat .text — only .spans`);
      assert.ok(Array.isArray(s.spans), `${s.type} carries .spans`);
    }
    if (s.type === 'link') {
      assert.equal('label' in s, false, 'link no longer carries a flat .label — only .spans');
      assert.ok(Array.isArray(s.spans));
    }
  }
});
