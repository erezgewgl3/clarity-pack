// src/ui/primitives/safe-markdown.ts
//
// Plan 07-02 Task 1 (D-I3-01) — the PURE parsing + safety core of the
// hand-rolled, plugin-local safe markdown renderer. Split out of the .tsx
// component so it can be unit-tested directly: Node 24's strip-types loads .ts
// but NOT .tsx, so the load-bearing parse + href-allowlist logic lives here
// (node --test imports it directly) and the thin .tsx maps the token tree to
// keyed React nodes.
//
// SAFETY MODEL (load-bearing — same-origin trusted UI):
//   - This module emits a structured token tree of PLAIN STRINGS only. It never
//     produces HTML. The .tsx renders strings into React text nodes (which React
//     escapes), so any literal <...> in the input appears as inert text — there
//     is NO HTML-injection path because nothing ever sets innerHTML.
//   - A link href is allowed ONLY for http: / https: / mailto: / a site-relative
//     path. A javascript:/data:/vbscript: URL (incl. case + embedded-whitespace
//     obfuscations) is rejected (sanitizeHref → null), and the .tsx then renders
//     the link's label as plain text rather than a live anchor.
//
// Covers exactly what the Editor-Agent emits (07-01 drill: "## BLUF …",
// **bold**, *italic*, - / * / numbered bullets, [label](url), `code`, blank-line
// paragraph breaks). Linear passes only — no nested backtracking quantifiers
// (T-07-02-DoS accepted: the body is length-capped upstream by the prompt + the
// MAX_TOKENS input cap).

export type InlineSpan =
  | { type: 'text'; text: string }
  // Plan 250530 — strong/em/link now carry `spans: InlineSpan[]` (was a flat
  // `text`/`label` string). This makes the parser produce a fully-resolved tree
  // so `**[BEAAA-933](/BEAAA/issues/BEAAA-933)**` renders the chip INSIDE the
  // bold (was: the markdown link rendered as literal text inside the strong).
  // BEAAA-1047 (2026-05-30) — the TL;DR's bold headline was the most visible
  // source of "reads like a mess" because nested inline markdown wasn't
  // re-parsed. `code` stays a leaf (code is verbatim by contract); `ref` stays
  // a leaf (carries only a validated id). Backwards-incompat for any consumer
  // destructuring `strong.text` / `link.label` — both occurrences in
  // tests/safe-markdown.test.mjs updated in the same commit.
  | { type: 'strong'; spans: InlineSpan[] }
  | { type: 'em'; spans: InlineSpan[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; spans: InlineSpan[] }
  // Plan 07-04 Task 2 (D-I31-02) — an opt-in `PREFIX-NNN` reference token. The
  // .tsx maps it to <RefChip refId={refId} /> (a clickable titled chip). Carries
  // ONLY the validated token — no href, no HTML (XSS guards unaffected).
  | { type: 'ref'; refId: string };

/**
 * Plan 07-04 Task 2 (D-I31-02) — the SINGLE source-of-truth ref token regex
 * (moved out of prose-with-ref-chips.tsx). Matches a 2-8 char uppercase prefix
 * (first char A-Z, rest A-Z|0-9), a hyphen, and one or more digits, with word
 * boundaries both sides: BEAAA-141 / COU-2486 / ACME-9 / OPS2-3 match;
 * foo-bar (lowercase) / A-1 (single-char prefix) / 123-456 (no leading letter)
 * do NOT. Used as the broad fallback when no company prefix is known.
 */
export const BROAD_REF_PATTERN = /\b[A-Z][A-Z0-9]{1,7}-\d+\b/g;

/** Escape regex metacharacters in a (validated) company prefix. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Opt-in ref-awareness options threaded through the parser. When present, a
 *  ref token competes in the inline scan; when absent the parse is byte-identical
 *  to the pre-07-04 behaviour (back-compat). */
export type RefOpts = { prefix?: string | null };

/** Build the ref regex for a given prefix: prefix-narrowed when a non-empty
 *  string, else the broad fallback. Always a fresh `g`-flagged RegExp so
 *  lastIndex state is isolated per call. */
function refRegexFor(opts: RefOpts): RegExp {
  const prefix = typeof opts.prefix === 'string' ? opts.prefix.trim() : '';
  return prefix.length > 0
    ? new RegExp(`\\b${escapeRegex(prefix)}-\\d+\\b`, 'g')
    : new RegExp(BROAD_REF_PATTERN.source, 'g');
}

/** Plan 250530 — WHOLE-STRING ref-token test, prefix-narrowed when opts.prefix
 *  is set, else the broad pattern. Used to detect a `code` span or a `link`
 *  label that is JUST a PREFIX-NNN token (so the parser can upgrade it to a
 *  `ref` span and render as a titled chip). No `g` flag — plain `test()`. */
function isWholeRefToken(s: string, opts: RefOpts): boolean {
  const prefix = typeof opts.prefix === 'string' ? opts.prefix.trim() : '';
  if (prefix.length > 0) {
    return new RegExp(`^${escapeRegex(prefix)}-\\d+$`).test(s);
  }
  return /^[A-Z][A-Z0-9]{1,7}-\d+$/.test(s);
}

/** Plan 250530 v1.1.3 — leading-PREFIX-NNN-with-separator split. The Editor-
 *  Agent's pervasive pattern in BOTH TL;DRs and issue bodies is a code span
 *  shaped like `<id> <separator> <gloss>` (e.g.
 *  `` `BEAAA-933 — UW operational pre-read of BEAAA-1000` ``). The whole-
 *  string check above leaves these as code; this split extracts the leading
 *  id so the chip renders the authoritative title, AND returns the remainder
 *  for the caller to recursively parse (so embedded refs in the gloss also
 *  chip). The separator MUST be one of: whitespace / em-dash (—) / en-dash
 *  (–) / colon. Hyphen (-) and dot (.) are deliberately NOT separators so a
 *  derived token like `BEAAA-933-foo` or a file ref `BEAAA-933.json` stays as
 *  code. Returns null when there is no leading id-then-separator. Pure;
 *  never throws. */
function leadingRefTokenSplit(
  s: string,
  opts: RefOpts,
): { refId: string; rest: string } | null {
  const prefix = typeof opts.prefix === 'string' ? opts.prefix.trim() : '';
  const idPattern = prefix.length > 0 ? `${escapeRegex(prefix)}-\\d+` : '[A-Z][A-Z0-9]{1,7}-\\d+';
  // Separator class: \s (whitespace), — (—), – (–), `:` (colon).
  const re = new RegExp(`^(${idPattern})([\\s\\u2014\\u2013:].*)$`);
  const m = re.exec(s);
  if (!m) return null;
  // Strip leading separator chars from `rest` so a stray "— " (em-dash + space)
  // doesn't render between the chip and the recursively-parsed gloss.
  const rest = m[2].replace(/^[\s—–:]+/, '');
  return { refId: m[1], rest };
}

export type HeadingBlock = { type: 'heading'; level: 3 | 4; spans: InlineSpan[] };
export type ParagraphBlock = { type: 'paragraph'; spans: InlineSpan[] };
export type ListItem = { spans: InlineSpan[] };
export type ListBlock = { type: 'list'; ordered: boolean; items: ListItem[] };
export type MarkdownBlock = HeadingBlock | ParagraphBlock | ListBlock;

/**
 * Allowlist a link href. Returns the trimmed href when it is http(s)/mailto or a
 * site-relative path (`/...`), else null. Rejects javascript:/data:/vbscript:
 * including case variants and control-char obfuscations (e.g. `java\tscript:`).
 * Pure; never throws.
 */
export function sanitizeHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;
  const raw = href.trim();
  if (raw.length === 0) return null;
  // T1-A (no-rabbit-holes, 2026-06-15) — reject any href carrying an UNFILLED
  // angle-bracket template placeholder (e.g. `/api/issues/<weekly-issue-id>#document-<weekly-doc-key>`
  // — an agent left a literal `<…>` token in a deliverable/ref URL). A raw
  // `<`/`>` is invalid in a URI per RFC 3986 §2 (it MUST be percent-encoded),
  // so such an href can never resolve — emitting it as a live anchor is exactly
  // the repeating 404 rabbit-hole the operator saw in the Reader/issue console.
  // Returning null downgrades the markdown link to inert plain text upstream
  // (firstInlineMatch's `if (!href) return [{ type: 'text', … }]`). This is the
  // check BEFORE the relative-path allow, because the placeholder href above
  // starts with `/` and would otherwise pass the site-relative fast-path.
  if (raw.includes('<') || raw.includes('>')) return null;
  // Site-relative path — always safe (no scheme, no protocol-relative //).
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  // Strip ASCII control chars + whitespace before the scheme check so
  // `java\tscript:` / `java\nscript:` cannot smuggle a dangerous scheme past us.
  const collapsed = raw.replace(/[ - ]+/g, '').toLowerCase();
  if (
    collapsed.startsWith('javascript:') ||
    collapsed.startsWith('data:') ||
    collapsed.startsWith('vbscript:') ||
    collapsed.startsWith('file:')
  ) {
    return null;
  }
  if (collapsed.startsWith('http://') || collapsed.startsWith('https://') || collapsed.startsWith('mailto:')) {
    return raw;
  }
  // Anything with an unknown scheme (`foo:bar`) is rejected; a bare word
  // (no scheme, no leading slash) is treated as a relative reference and allowed.
  if (/^[a-z][a-z0-9+.-]*:/.test(collapsed)) return null;
  return raw;
}

// Inline tokenizer. Single left-to-right scan; each marker is matched against a
// closing marker on the same text run. An unmatched marker degrades to literal
// text (the loop advances one char and keeps scanning). No nested backtracking.
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/;
const STRONG_RE = /\*\*([^*]+?)\*\*/;
const CODE_RE = /`([^`]+?)`/;
const EM_STAR_RE = /\*([^*]+?)\*/;
const EM_US_RE = /_([^_]+?)_/;

// Plan 250530 v1.1.3 — Match carries `spans: InlineSpan[]` (was a single
// `span: InlineSpan`) so a code span like `BEAAA-933 — gloss BEAAA-1000` can
// emit a [ref, ...parseInline(gloss)] sequence in one match step (chip BOTH
// refs, not just the leading one). Every other match type wraps its span in
// a single-element array.
type Match = { index: number; length: number; spans: InlineSpan[] };

function firstInlineMatch(s: string, refOpts?: RefOpts): Match | null {
  let best: Match | null = null;
  const consider = (m: RegExpExecArray | null, make: (m: RegExpExecArray) => InlineSpan[]) => {
    if (!m) return;
    const cand: Match = { index: m.index, length: m[0].length, spans: make(m) };
    if (best === null || cand.index < best.index) best = cand;
  };
  // Plan 250530 — strong/em/link children are RECURSIVELY parsed via
  // parseInline so a ref / link / code nested inside renders correctly. Each
  // recursive call walks a strict substring of the input so the parent's
  // guard-bounded loop still terminates; an adversarial deeply-nested input is
  // bounded by parseInline's `guard < 10000` cap at every level.
  consider(CODE_RE.exec(s), (m) => {
    // Plan 250530 — a code span that is JUST a PREFIX-NNN token is the agent's
    // "highlight this id" intent dressing up an issue ref as monospace; upgrade
    // to a `ref` span so the Reader's chip resolves the title (otherwise the
    // operator sees a bare id without context — exactly the rabbit-hole the
    // chip pipeline exists to close).
    if (refOpts) {
      const trimmed = m[1].trim();
      if (isWholeRefToken(trimmed, refOpts)) {
        return [{ type: 'ref', refId: trimmed }];
      }
      // v1.1.3 — leading PREFIX-NNN followed by a separator (whitespace, em-
      // dash, en-dash, colon). The agent's pervasive `<id> — <gloss>` pattern
      // (seen on every TL;DR + issue body) was previously left as one big code
      // span — invisible to the chip pipeline. Now we chip the leading id AND
      // recursively parse the trailing gloss so embedded refs in the gloss
      // ALSO chip. Hyphen / dot are NOT separators so `BEAAA-933-foo` and
      // `BEAAA-933.json` stay as code (the id flows into a derived identifier).
      const split = leadingRefTokenSplit(trimmed, refOpts);
      if (split) {
        return [
          { type: 'ref', refId: split.refId },
          ...parseInline(split.rest, refOpts),
        ];
      }
    }
    return [{ type: 'code', text: m[1] }];
  });
  consider(LINK_RE.exec(s), (m) => {
    const href = sanitizeHref(m[2]);
    // A rejected href downgrades the link to plain text (label only).
    if (!href) return [{ type: 'text', text: m[1] }];
    // Plan 250530 — a markdown link whose label is a bare PREFIX-NNN token AND
    // whose href is the canonical `/<samePrefix>/issues/<sameId>` path is an
    // issue ref the agent dressed up as a manual link. Upgrade to a `ref` span
    // so the chip resolves the title; otherwise keep the explicit author-chosen
    // anchor. Cross-instance hrefs (label prefix ≠ url prefix) and links with
    // any extra path/query/fragment are deliberately NOT upgraded — those are
    // intentional custom targets.
    if (refOpts) {
      const trimmedLabel = m[1].trim();
      if (isWholeRefToken(trimmedLabel, refOpts)) {
        const dashIdx = trimmedLabel.lastIndexOf('-');
        const labelPrefix = trimmedLabel.slice(0, dashIdx);
        if (href === `/${labelPrefix}/issues/${trimmedLabel}`) {
          return [{ type: 'ref', refId: trimmedLabel }];
        }
      }
    }
    return [{ type: 'link', href, spans: parseInline(m[1], refOpts) }];
  });
  consider(STRONG_RE.exec(s), (m) => [{ type: 'strong', spans: parseInline(m[1], refOpts) }]);
  consider(EM_STAR_RE.exec(s), (m) => [{ type: 'em', spans: parseInline(m[1], refOpts) }]);
  consider(EM_US_RE.exec(s), (m) => [{ type: 'em', spans: parseInline(m[1], refOpts) }]);
  // Plan 07-04 Task 2 (D-I31-02) — a ref token competes by LEFTMOST index with
  // the other markers (NOT a second regex-replace pass). A ref that sits inside
  // a [label](url) link starts AFTER the link's `[` so the link wins by index
  // (its index is smaller) and the ref token stays inside the link label —
  // exactly the "the link wins" contract. A fresh g-regex isolates lastIndex.
  if (refOpts) {
    consider(refRegexFor(refOpts).exec(s), (m) => [{ type: 'ref', refId: m[0] }]);
  }
  return best;
}

/** Parse one block's text into inline spans. Never throws. When `refOpts` is
 *  present, `PREFIX-NNN` tokens become `ref` spans; absent → byte-identical to
 *  the pre-07-04 parse (back-compat). */
export function parseInline(input: string, refOpts?: RefOpts): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let rest = input;
  // Bound the loop defensively; each iteration consumes >=1 char of progress.
  let guard = 0;
  while (rest.length > 0 && guard++ < 10000) {
    const m = firstInlineMatch(rest, refOpts);
    if (!m) {
      spans.push({ type: 'text', text: rest });
      break;
    }
    if (m.index > 0) spans.push({ type: 'text', text: rest.slice(0, m.index) });
    // v1.1.3 — Match.spans (was Match.span). Most match types return a single-
    // element array; the code-span leading-ref split returns [ref, ...glossSpans].
    spans.push(...m.spans);
    rest = rest.slice(m.index + m.length);
  }
  return mergeText(spans);
}

/** Collapse adjacent text spans (cleaner node output, fewer React keys). */
function mergeText(spans: InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (s.type === 'text' && prev && prev.type === 'text') {
      prev.text += s.text;
    } else {
      out.push(s);
    }
  }
  return out;
}

const HEADING_RE = /^(#{2,3})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

/**
 * Block parse: split on blank lines, classify each block as a heading, a list
 * (consecutive bullet / numbered lines), or a paragraph; inline-parse each.
 * Empty / null / whitespace-only input → []. Never throws.
 */
export function parseMarkdownBlocks(
  input: string | null | undefined,
  refOpts?: RefOpts,
): MarkdownBlock[] {
  if (typeof input !== 'string') return [];
  const normalized = input.replace(/\r\n?/g, '\n');
  if (normalized.trim().length === 0) return [];

  const blocks: MarkdownBlock[] = [];
  const rawBlocks = normalized.split(/\n[ \t]*\n/);

  for (const raw of rawBlocks) {
    const block = raw.replace(/\n+$/g, '');
    if (block.trim().length === 0) continue;
    const lines = block.split('\n');

    // A whole block that is one heading line.
    if (lines.length === 1) {
      const h = HEADING_RE.exec(lines[0]);
      if (h) {
        blocks.push({
          type: 'heading',
          level: h[1].length === 2 ? 3 : 4,
          spans: parseInline(h[2], refOpts),
        });
        continue;
      }
    }

    // A block whose lines are ALL bullet (or all numbered) items → a list.
    const ulItems = lines.map((l) => UL_RE.exec(l.trim()));
    const olItems = lines.map((l) => OL_RE.exec(l.trim()));
    if (lines.length > 0 && ulItems.every((m) => m !== null)) {
      blocks.push({
        type: 'list',
        ordered: false,
        items: ulItems.map((m) => ({ spans: parseInline((m as RegExpExecArray)[1], refOpts) })),
      });
      continue;
    }
    if (lines.length > 0 && olItems.every((m) => m !== null)) {
      blocks.push({
        type: 'list',
        ordered: true,
        items: olItems.map((m) => ({ spans: parseInline((m as RegExpExecArray)[1], refOpts) })),
      });
      continue;
    }

    // Otherwise a paragraph — join soft line breaks with a space.
    blocks.push({ type: 'paragraph', spans: parseInline(lines.join(' '), refOpts) });
  }

  return blocks;
}
