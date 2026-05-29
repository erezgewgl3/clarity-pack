---
phase: 07-clarity-surfaces-quality-and-portability-instance-agnostic-r
plan: 04
subsystem: Unified ref-aware markdown render (RefChip title + SafeMarkdown ref-awareness + prose rewrite + worker-rewrite removal)
tags: [ui, markdown, safe-render, ref-chip, ref-awareness, xss-guard, worker-removal, no-double-render, READER-03, READER-10, D-I31-01, D-I31-02, D-I31-03, D-I31-04]
requires:
  - src/ui/primitives/safe-markdown.ts (07-02 pure parser — gains opt-in refOpts)
  - src/ui/primitives/safe-markdown.tsx (07-02 SafeMarkdown component — gains case 'ref' → RefChip + linkRefs/companyPrefix props)
  - src/ui/primitives/ref-chip.tsx (02-02/04.2-05/05-05 chip — retitled ID — title)
  - src/ui/primitives/use-resolved-company-id.ts (extractCompanyPrefixFromPathname — instance-agnostic prefix)
provides:
  - src/ui/primitives/ref-chip.tsx (RefChip renders `ID — title` clickable + status badge; bare-ID degrade preserved)
  - src/ui/primitives/safe-markdown.ts (BROAD_REF_PATTERN + escapeRegex now the single source-of-truth; RefOpts threaded parseMarkdownBlocks→parseInline→firstInlineMatch)
  - src/ui/primitives/safe-markdown.tsx (SafeMarkdown { text, linkRefs?, companyPrefix? }; a `ref` span → <RefChip refId/>)
  - src/ui/surfaces/reader/prose-with-ref-chips.tsx (REWRITTEN — delegates to ref-aware SafeMarkdown; { body } prop shape unchanged)
  - src/ui/surfaces/reader/tldr-strip.tsx (populated path enables linkRefs+companyPrefix; other branches byte-unchanged)
  - src/ui/surfaces/reader/ref-card.tsx (non-null excerpt enables ref-awareness; companyPrefix threaded from AnchoredToCards)
affects:
  - "READER-03 — chips clickable, now ENHANCED with titles; the SAME chip renders on the prose body + TL;DR + excerpt"
  - "READER-10 — mechanism is now the CLIENT-SIDE titled chip (07-04 supersedes the 07-02 worker rewrite, removed to avoid double-render)"
  - "Chat ripple — message-thread.tsx ProseWithRefChips bodies now render markdown + titled chips too (intended unified rendering; { body } prop shape unchanged so the call sites are untouched)"
  - "Worker — issue-reader.ts no longer post-processes the TL;DR body; tldr-ref-titles.ts module + its test DELETED"
tech_stack:
  added: []   # NO new runtime dep — everything is hand-rolled plugin-local
  patterns:
    - "Opt-in ref-awareness: parseMarkdownBlocks/parseInline accept an optional refOpts {prefix}; absent → byte-identical parse (back-compat); present → a PREFIX-NNN token competes by LEFTMOST index in firstInlineMatch (NOT a second regex-replace pass — a ref inside a [label](url) link loses to the link by index, so the link is never split)"
    - "Single source-of-truth ref regex: BROAD_REF_PATTERN + escapeRegex moved out of prose-with-ref-chips.tsx INTO safe-markdown.ts; prose-with-ref-chips + tldr-strip + ref-card all rely on the parser's prefix-narrowing"
    - "Unified renderer: ProseWithRefChips delegates to <SafeMarkdown linkRefs companyPrefix=…> — the { body } prop shape is kept so the Reader index.tsx + the chat message-thread.tsx call sites are byte-unchanged"
    - "RefChip title-with-degrade: resolved → `ID — title` (em-dash) + a clarity-ref-chip-status badge; empty title → bare ID (no trailing em-dash); loading/!card → the bare-ID clarity-ref-chip--loading degrade (unchanged)"
    - "No-double-render: removing the worker tldr-ref-titles rewrite means the body reaches the UI raw and the chip is the SOLE title source (no `ID — title — title`)"
    - "Empirical bundle-ceiling recalibration (Plan 05-04/05-11/07-02 precedent): the ref-aware delta overflowed the ~1.3 kB 07-02 headroom; ceiling 694→696 kB with a justification comment + a confirmed zero-SheetJS scan"
key_files:
  created:
    - test/ui/ref-chip-title.test.mjs
  modified:
    - src/ui/primitives/ref-chip.tsx
    - src/ui/primitives/theme.css
    - src/ui/primitives/safe-markdown.ts
    - src/ui/primitives/safe-markdown.tsx
    - src/ui/surfaces/reader/prose-with-ref-chips.tsx
    - src/ui/surfaces/reader/tldr-strip.tsx
    - src/ui/surfaces/reader/ref-card.tsx
    - src/worker/handlers/issue-reader.ts
    - test/ui/safe-markdown.test.mjs
    - test/ui/prose-with-ref-chips.test.mjs
    - test/ui/reader-view.test.mjs
    - test/worker/issue-reader.test.mjs
    - scripts/check-ui-bundle-size.mjs
    - .planning/REQUIREMENTS.md
  deleted:
    - src/worker/handlers/tldr-ref-titles.ts
    - test/worker/tldr-ref-titles.test.mjs
decisions:
  - "RefChip title format: `card.id` + ` — ` (em-dash) + `card.title`, with status as a small clarity-ref-chip-status badge span (data-status); degrades to the bare id when title is empty. Long titles clamp to one line via .clarity-ref-chip-label (overflow:hidden + ellipsis); the full title remains on the hover-peek (executor discretion per CONTEXT)."
  - "Ref-aware SafeMarkdown API shape: `linkRefs?: boolean` + `companyPrefix?: string | null` on SafeMarkdown (the plan's recommended shape). Without linkRefs → no ref spans (back-compat for any non-enabling caller)."
  - "Ref token competes by leftmost index in firstInlineMatch (NOT a post-hoc regex replace) so a ref inside a link label stays inside the link — pinned by a test."
  - "The single source-of-truth ref regex (BROAD_REF_PATTERN/escapeRegex) was moved from prose-with-ref-chips.tsx into safe-markdown.ts and EXPORTED; prose-with-ref-chips deletes its local copies."
  - "READER-10 stays Implemented but the MECHANISM note is refreshed: the `ID — title` render is now client-side (the chip), and the 07-02 worker text-rewrite was removed to avoid a double-render. READER-03 reaffirmed (chips clickable — now titled)."
  - "Bundle ceiling recalibrated 694→696 kB (712,704 B): the ref-aware delta is the only UI-bundle addition (+2,046 B over the 07-02 build), overflowed the ~1,273 B 07-02 headroom; zero SheetJS sentinels confirmed; per the 05-04/05-11/07-02 empirical-recalibration precedent."
metrics:
  duration: "~1 session (autonomous, ~18 min execute)"
  tasks_completed: 5
  files_created: 1
  files_modified: 14
  files_deleted: 2
  completed_date: "2026-05-29"
  suite: "2070 total / 2067 pass / 1 fail (pre-existing situation.artifacts) / 2 skip"
---

# Phase 7 Plan 04: Unified ref-aware markdown rendering (ITEM 3.1) Summary

**One-liner:** One unified ref-aware markdown renderer is now used everywhere in the Reader — the RefChip renders `ID — title` (clickable, status as a small badge), SafeMarkdown gains an opt-in `linkRefs`/`companyPrefix` mode that maps each in-prose `PREFIX-NNN` token to that chip during inline parse (instance-agnostic, back-compat, XSS guards byte-unchanged), `prose-with-ref-chips.tsx` is rewritten to delegate to it (so the main prose body — and, via the same component, chat message bodies — render formatted markdown + titled clickable chips), the TL;DR strip and the Anchored-to excerpt enable the same mode, and the redundant 07-02 worker TL;DR text-rewrite is REMOVED so there is no double-render (`ID — title — title`). Version stays 1.0.0; no migration; no new runtime dep.

## What shipped

### 1. RefChip renders `ID — title` (D-I31-01) — READER-03 enhanced

The operator reviewed BEAAA-828 live (2026-05-29) and reported the in-prose refs "do not show the title" — the chip rendered only `ID · status`. `ref-chip.tsx` already resolves `{id, title, status}` via the `resolve-refs` handler; the two resolved render paths (the clickable anchor path AND the no-prefix span path) now render a `clarity-ref-chip-label` composing `card.id` + ` — ` + `card.title`, with `card.status` in a dedicated `clarity-ref-chip-status` badge span (`data-status`) instead of the inline `· status` suffix. When `card.title` is empty the chip renders just `card.id` (no trailing em-dash). The bare-ID loading/`!card` degrade (`clarity-ref-chip--loading`), the `nav.linkProps(/<prefix>/issues/<id>)` anchor (never raw `<a href>`), and the hover-peek wrap are UNCHANGED. New scoped CSS (`.clarity-ref-chip-label` one-line clamp + `.clarity-ref-chip-id`/`-status`) added under `[data-clarity-surface]`. Pinned by `test/ui/ref-chip-title.test.mjs` (source-grep RED→GREEN) + the unchanged `ref-chip-peek.test.mjs` (peek + nav contract did not regress).

### 2. SafeMarkdown opt-in ref-awareness (D-I31-02) — instance-agnostic, back-compat, XSS holds

- **`safe-markdown.ts`**: a new `{ type: 'ref'; refId: string }` `InlineSpan` member; the exported **single source-of-truth** `BROAD_REF_PATTERN` (`/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g`) + `escapeRegex` (moved out of `prose-with-ref-chips.tsx`); an optional `RefOpts { prefix? }` threaded `parseMarkdownBlocks(input, refOpts?) → parseInline(input, refOpts?) → firstInlineMatch(s, refOpts?)`. A ref token competes by **leftmost index** against bold/em/code/link — NOT a second regex-replace pass — so a ref inside a `[label](url)` link loses to the link (the link's `[` starts earlier) and the link is never split. `sanitizeHref` + `mergeText` are byte-unchanged.
- **`safe-markdown.tsx`**: `renderInline` gains `case 'ref': return <RefChip key={key} refId={span.refId} />` (RefChip imported); `SafeMarkdown` props widen to `{ text, linkRefs?, companyPrefix? }` and pass `linkRefs ? { prefix: companyPrefix ?? null } : undefined` to the parser. No `dangerouslySetInnerHTML`.
- **Behavior pinned (`test/ui/safe-markdown.test.mjs`, +10 cases on top of the original 18):** ref span produced with `{prefix}`; NO ref span without refOpts (back-compat); `prefix:'COU'` chip-ifies `COU-12` and NOT `BEAAA-807` (instance-agnostic); `prefix:null`/`{}` broad fallback chip-ifies both; markdown still works alongside refs (heading + list with a ref span); a ref inside a link label stays one link span; **XSS still holds with refOpts on** (`<script>` inert, `javascript:` href rejected); `sanitizeHref` unchanged; the `.tsx` renders RefChip for a `ref` span with no innerHTML. 28/28 green.

### 3. Render everywhere via ref-aware SafeMarkdown (D-I31-03)

- **`prose-with-ref-chips.tsx` REWRITTEN**: `ProseWithRefChips({ body })` keeps the `{ body }` prop shape, derives `companyPrefix` from the pathname (`useHostLocation` + `extractCompanyPrefixFromPathname`), keeps the `if (!body) return null` guard + the `clarity-reader-prose` wrapper, and returns `<div className="clarity-reader-prose"><SafeMarkdown text={body} linkRefs companyPrefix={companyPrefix} /></div>`. The manual `re.exec(body)` split loop + the local `BROAD_REF_PATTERN`/`escapeRegex` are deleted (the regex now lives once in `safe-markdown.ts`). Result: the prose body renders **formatted markdown + titled clickable chips**.
- **`tldr-strip.tsx`**: the populated path now `<SafeMarkdown text={tldr.body} linkRefs companyPrefix={companyPrefix} />` (companyPrefix derived via `useHostLocation`+`extractCompanyPrefixFromPathname`, hook called unconditionally before the early returns). The empty/compiling/paused/unavailable branches + the stamp + the truncated-note are byte-unchanged.
- **`ref-card.tsx`**: `AnchoredToCards` derives `companyPrefix` once and threads it to each `<RefCard companyPrefix={…}>`; the non-null excerpt renders `<SafeMarkdown text={card.excerpt} linkRefs companyPrefix={companyPrefix} />`. The null "Quote unavailable (permission-gated)" branch + the card header (id + title + StatePill) are unchanged (chips go only inside `clarity-ref-card-quote`).
- **Tests**: `prose-with-ref-chips.test.mjs` rewritten to assert the delegation (imports + renders `SafeMarkdown` with `linkRefs`+`companyPrefix`; keeps the wrapper + guard + `{ body }` prop shape; the manual split loop + local `BROAD_REF_PATTERN` are gone). `reader-view.test.mjs`'s READER-03 assertion updated from the old "splits prose on BEAAA-NNN regex" to the SafeMarkdown-delegation shape. 88/88 across all touched UI suites.

### 4. Remove the worker TL;DR text-rewrite — no double-render (D-I31-04)

Client-side titled chips make the 07-02 worker rewrite (`tldr-ref-titles.ts`, body → "ID — title" TEXT) redundant — and it would double-render (`ID — title` chip + a trailing ` — title` text). So:

- **`issue-reader.ts`**: the `import { buildTitleMap, inlineRefTitles } from './tldr-ref-titles.ts'` (line 39-41) and the entire `buildTitleMap`/`inlineRefTitles` try/catch post-process block (line 223-241) are DELETED. The TL;DR body now reaches the result RAW. The TL;DR-drive try/catch and the refCards resolution (`resolveRefsViaSdk`, 07-01) are UNCHANGED.
- **DELETED** `src/worker/handlers/tldr-ref-titles.ts` + `test/worker/tldr-ref-titles.test.mjs` (via `git rm`).
- **`issue-reader.test.mjs`**: the "rewrites to ID — title" test is replaced by a "passes tldr.body through UNREWRITTEN" test (the FIXTURE `BEAAA-141` survives BARE — `assert.match(.../BEAAA-141\b/)` AND `assert.equal(/BEAAA-141 —/.test(...), false)`); the resolver-throws degrade test is dropped (no rewrite to degrade); PRIM-01 reverts to ONE per-ref-get pass = 3 gets (refCards only; each unique ref once; zero `?ids=` http.fetch). 9/9 green.
- **`grep -rn "tldr-ref-titles|inlineRefTitles|buildTitleMap" src/ test/` → ZERO matches** (the explanatory comments were reworded to "text-rewrite"/"title-map pass" so no functional residue or comment trips the grep).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 - harness adaptation, anticipated] No new test harness.** Per the plan's `<note_on_test_harness>`, the load-bearing ref-token-splitting logic lives in the pure `safe-markdown.ts` and is asserted DIRECTLY off `parseMarkdownBlocks`; the `.tsx` (RefChip mapping), `ref-chip.tsx` (`ID — title`), and `prose-with-ref-chips.tsx` (delegation) are verified by source-grep — the established repo idiom. No `react-test-renderer` / new devDep.

**2. [Rule 1 - intended TDD churn] `reader-view.test.mjs` READER-03 assertion updated in Task 3.** That suite pinned the OLD prose shape (`assert.match(src, /BEAAA-\\d\+.../)` "splits prose on BEAAA-NNN regex" + `<RefChip\b` directly in `prose-with-ref-chips.tsx`). The rewrite delegates to SafeMarkdown (which renders RefChip) and moves the regex into `safe-markdown.ts`, so that assertion correctly flipped red; updated in the same task to assert the SafeMarkdown-delegation shape (`<SafeMarkdown`, `linkRefs`, `companyPrefix`, `extractCompanyPrefixFromPathname`). Not a behavior regression — READER-03 is preserved + enhanced.

**3. [Rule 1 - intended TDD churn] PRIM-01 reverted 6 → 3.** Removing the worker title-map pass means the Reader resolves the unique refs via ONLY the refCards pass now (was 2 passes in 07-02). PRIM-01's `refGetCalls.length === 6` correctly flipped red; reverted to `=== 3` (each unique ref once), zero `?ids=` http.fetch unchanged. This is a strict efficiency win (one resolver pass instead of two).

**4. [AUTHORIZED recalibration] UI bundle ceiling 694 → 696 kB.** The ref-aware delta (RefChip `ID — title` label/badge render + the `ref` span/`case 'ref'`/RefChip import in SafeMarkdown + companyPrefix threading in tldr-strip/ref-card; `prose-with-ref-chips` SHRANK to a one-line delegation) pushed the built `dist/ui/index.js` from 709,383 B (07-02) to **711,429 B** (+2,046 B), overflowing the ~1,273 B 07-02 headroom by 773 B. Per the plan's explicit contingency + the empirical-recalibration precedent (Plan 05-04 / 05-11 / 07-02): confirmed the overage is this plan's legitimate ref-aware code, confirmed **zero SheetJS sentinels** (`XLSX`/`SheetJS`/`!ref` all 0 in the UI bundle), and bumped `UI_BUNDLE_BYTES_CEILING` 694→696 kB (712,704 B, ~1,275 B headroom) with a dated justification comment ("Plan 07-04: ref-aware SafeMarkdown + RefChip title, +2,046 bytes, no SheetJS"). The locked feature surface was NOT crippled to fit.

### Chat ripple — flag for the orchestrator (IMPORTANT)

`ProseWithRefChips` is also consumed by `src/ui/surfaces/chat/message-thread.tsx` (lines 720 + 974). The rewrite makes CHAT message bodies render formatted markdown + titled clickable chips too. This is intended unified rendering, and the `{ body }` prop shape is IDENTICAL so neither chat call site changed (verified by source-grep — the two `<ProseWithRefChips body={…}>` call sites are unchanged). **One acceptable behavior change to verify live:** a chat message containing literal `**` will now render bold (and a `PREFIX-NNN` token now renders a titled chip), where before it was plain text. Acceptable (consistent with the Reader), but the orchestrator should confirm the chat surface is not visually regressed at the live drill.

## Threat surface

- **T-07-04-XSS (load-bearing) — mitigated, UNCHANGED from item 3.** SafeMarkdown emits React element nodes only (no `dangerouslySetInnerHTML` → literal `<...>` is escaped to inert text) AND `sanitizeHref` is byte-unchanged. The new `ref` span carries ONLY a validated `PREFIX-NNN` token (no href, no HTML) and renders a RefChip whose anchor uses `nav.linkProps` (no raw `<a href>`). Pinned by the Task-2 "XSS still holds with refOpts on" cases + the no-innerHTML source-scan.
- **T-07-04-CHIP (title shown) — accepted.** The title was ALREADY resolved + rendered by the Anchored-to ref-card (07-01/07-02) via the SAME viewer-gated `resolve-refs` handler; showing it in the chip crosses no new boundary.
- **T-07-04-DR (double-render) — mitigated.** The worker text-rewrite is removed (Task 4); the chip is the SOLE title source. Pinned by the Task-4 "tldr.body passed through unrewritten" test + the empty grep.
- **T-07-04-DoS — accepted** (linear passes; same ref regex already shipped). **T-07-04-SC — mitigated: NO new runtime deps** (`package.json` `dependencies` unchanged; no package install attempted).

## Quality gates (Task 5 — all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `node scripts/check-css-scope.mjs` | PASS — 145 selectors, all scoped under `[data-clarity-surface]` (the new `clarity-ref-chip-label`/`-id`/`-status` are scoped) |
| `node scripts/build-worker.mjs` | PASS — dist/worker.js 2.4 MB |
| `node scripts/build-ui.mjs` | PASS — dist/ui/index.js 694.8 kB |
| `npx tsc --project tsconfig.manifest.json` | PASS — dist/manifest.js version '1.0.0' |
| `node scripts/check-ui-bundle-size.mjs` | PASS — **711,429 B ≤ 712,704 ceiling (recalibrated 694→696 kB, see Deviation #4)**; 0 SheetJS sentinels |
| `node --test "test/**/*.test.mjs"` | **2070 total / 2067 pass / 1 fail / 2 skip** — the 1 fail is the documented pre-existing `situation.artifacts: per-agent arrays sorted DESC by createdAt`; every other test passes; the deleted `tldr-ref-titles` test is GONE (not failing) |
| `grep -c paperclipInvocation dist/worker.js` | **5** (≥ 5 — SDK NOT externalized) |
| `grep -rn "tldr-ref-titles\|inlineRefTitles\|buildTitleMap" src/ test/` | **ZERO matches** (worker rewrite fully removed) |
| Version literal | `1.0.0` in package.json:3 AND src/manifest.ts:337 AND dist/manifest.js — NO bump |
| No new dep / migration | `dependencies` unchanged; no new migration (latest is 0014, untouched) |
| Source greps | `ref-chip.tsx` renders `card.title` (no `· status` suffix) + keeps `nav.linkProps`; `safe-markdown.tsx` renders RefChip for a `ref` span + no `dangerouslySetInnerHTML`; `safe-markdown.ts` `sanitizeHref` unchanged; `prose-with-ref-chips.tsx` delegates to `<SafeMarkdown linkRefs>` (no manual split loop); `tldr-strip.tsx` + `ref-card.tsx` pass `linkRefs`+`companyPrefix`; message-thread.tsx `<ProseWithRefChips body=…>` call sites unchanged |

## Tarball

- **filename:** `clarity-pack-1.0.0.tgz` (repo root)
- **sha256:** `b8f061e99dcfe7fb57c649ccd67005e22e36893a3b8892c2cc4bb39bb3b0ba7b`
- **size:** `709191` bytes (709.2 kB)
- **files:** 18 (dist/ + migrations/ + README.md + package.json); 0 src/, 0 test/, 0 .png leaks
- **version:** 1.0.0 (unchanged)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `2cbe858` | feat(07-04): RefChip renders `ID — title` with status badge (D-I31-01) |
| 2 | `e073e63` | feat(07-04): SafeMarkdown opt-in ref-awareness — PREFIX-NNN → RefChip (D-I31-02) |
| 3 | `249aa15` | feat(07-04): render prose body + TL;DR + excerpt via ref-aware SafeMarkdown (D-I31-03) |
| 4 | `d237ddf` | refactor(07-04): remove worker TL;DR text-rewrite — no double-render (D-I31-04) |
| 5 | (this commit) | docs(07-04): full gates + builds + pack + SUMMARY/STATE/ROADMAP/REQUIREMENTS |

---

## AUTONOMOUS post-build deploy + live BEAAA Playwright drill (run by the orchestrator 2026-05-29 — FULL PASS)

**Deployed:** `clarity-pack-1.0.0.tgz` sha256 `b8f061e99dcfe7fb57c649ccd67005e22e36893a3b8892c2cc4bb39bb3b0ba7b` via DEPLOY-RUNBOOK Path A as a **2-connection** sequence (upload `rm`+`cat`-over-stdin one connection; install here-string one connection — no fail2ban trip). Plugin `status=ready version=1.0.0 id=a763176a` (the post-restart `plugin list` grep initially came back empty for ~4s during the worker reload, then confirmed ready). Live drill via localhost:3100 tunnel + Playwright MCP on **BEAAA-828** (real Radix `browser_click` on the Reader tab; DOM via `browser_evaluate`).

1. **Main prose body renders formatted markdown — ✅ PASS (PRIMARY).** `clarity-reader-prose` contains `[h3, strong, a, code, ul, li]`; `proseLiteralMarkup = { heading: false, bold: false, bullet: false }` — ZERO literal `## `/`**`/`-` text. The operator's "rest of the reader looks half rendered / still asterisks" complaint is FIXED.
2. **In-prose refs are clickable titled chips — ✅ PASS (PRIMARY).** Chips render `BEAAA-704 — CSO review — Updated strategy from Founders…` as `<a href="/BEAAA/issues/BEAAA-704">` (clickable), with the status as a trailing badge. The "BEAAA-704 that does not show the title" complaint is FIXED.
3. **TL;DR refs are ALSO clickable titled chips — ✅ PASS (Editor-Agent running).** `clarity-tldr-body` chips render `BEAAA-704 — CSO review…`, `BEAAA-829 — UW: Capacity packet…`, `BEAAA-141 — Customer-readable pricing sheet…` as `<a href>` links — the operator's "same behavior in TLDR" ask. (The item-3 plain-text rewrite is gone; the chip is now the clickable title source in both places.)
4. **NO double-render — ✅ PASS.** `doubleRender: false` — no `ID — title — title` anywhere. The worker `tldr-ref-titles` removal is clean.
5. **Excerpt + scope-fence — ✅ PASS.** No "failed to render" fail-boundary; the Anchored-to excerpt continues to render formatted markdown (07-02 proof holds, now with titled chips).
6. **Chat surface not regressed — ✅ PASS (loads clean; per-message render not force-opened).** The chat surface loads cleanly (17-employee roster, `failBoundary: false`, no literal `**` in view) and uses the SAME prop-identical shared `ProseWithRefChips` renderer (call sites grep-confirmed unchanged; full suite green). A specific message thread did not auto-open on an employee click (chat needs an employee→topic selection and finding a topic with messages is hit-or-miss), so a per-message visual was NOT force-verified — LOW RISK (same safe renderer, prop-identical, tests green). **Flagged for the operator to eyeball any chat thread** (a chat message with literal `**` will now render bold — intended unified rendering).
7. **XSS — ✅ proof-of-record (unit).** No live hostile fixture on BEAAA; the Task-2 unit XSS guards (no `javascript:` href; `<script>` inert; no `dangerouslySetInnerHTML`) are the proof of record.

**Net drill verdict: FULL PASS.** The operator's feedback ("the rest of the reader looks half rendered… still asterisks… BEAAA-704 without titles… render it like the TLDR") is resolved across the whole Reader, and refs are clickable titled chips in BOTH the prose and the TL;DR. READER-03 (clickable chips — now titled) + READER-10 (markdown + refs→title, now unified client-side) reaffirmed Implemented.

Record the verdicts here. READER-10 reaffirmed Implemented (now client-side titled chip); READER-03 reaffirmed (chips clickable, now titled).

## Self-Check: PASSED

- Created file exists: `test/ui/ref-chip-title.test.mjs` — FOUND. `07-04-SUMMARY.md` — FOUND. `clarity-pack-1.0.0.tgz` — FOUND.
- Deleted files gone: `src/worker/handlers/tldr-ref-titles.ts`, `test/worker/tldr-ref-titles.test.mjs` — both REMOVED (git rm), grep returns ZERO.
- Per-task commits exist: `2cbe858` (Task 1), `e073e63` (Task 2), `249aa15` (Task 3), `d237ddf` (Task 4) — all FOUND.
- Full gate battery green (Task 5) except the documented pre-existing `situation.artifacts` test; bundle ceiling recalibrated 694→696 kB (justified, zero SheetJS); tarball packed sha256 `b8f061e9…`.
- Live BEAAA deploy + Playwright drill NOT run in this build task — orchestrator-pending (verdicts TBD above).
