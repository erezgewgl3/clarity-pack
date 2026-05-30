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

test('ref-aware (D-I31-02): a ref INSIDE a link label stays a single link span (the link wins — no split)', () => {
  const blocks = parseMarkdownBlocks('[BEAAA-1 details](https://e.com)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'one link span');
  assert.equal(links[0].label, 'BEAAA-1 details', 'the ref token stays inside the link label');
  assert.equal(refSpans(blocks).length, 0, 'no ref span carved out of the link label');
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

test('code stays code (250530): MIXED content inside backticks is NOT broken apart — code span survives intact', () => {
  // The agent's hand-rolled gloss (BEAAA-933 — manual note — in_review) is the
  // exact shape BEAAA-1047 exhibits; the parser must not torture this into a ref
  // because the rest of the code span isn't a ref. The prompt fix (separately)
  // teaches the agent to stop emitting these.
  const input = 'pinned: `BEAAA-933 — BEAAA-187 child — v1.1.2 reconciliation of in_review`';
  const blocks = parseMarkdownBlocks(input, { prefix: 'BEAAA' });
  const code = allSpans(blocks).find((s) => s.type === 'code');
  assert.ok(code, 'a code span survives');
  assert.equal(code.text, 'BEAAA-933 — BEAAA-187 child — v1.1.2 reconciliation of in_review');
  assert.equal(refSpans(blocks).length, 0, 'no ref carved out of mixed code');
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
    allSpans(blocks).some((s) => s.type === 'link' && s.label === 'BEAAA-933'),
    false,
    'the canonical link was upgraded, not duplicated',
  );
});

test('link stays link (250530): CUSTOM label is preserved — [BEAAA-933 — title](/BEAAA/issues/BEAAA-933)', () => {
  // A label with extra content is an explicit author choice — keep it.
  const blocks = parseMarkdownBlocks('[BEAAA-933 — title](/BEAAA/issues/BEAAA-933)', { prefix: 'BEAAA' });
  const links = allSpans(blocks).filter((s) => s.type === 'link');
  assert.equal(links.length, 1, 'link survives');
  assert.equal(links[0].label, 'BEAAA-933 — title');
  assert.equal(refSpans(blocks).length, 0, 'no ref upgrade for a custom-label link');
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
