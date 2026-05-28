---
phase: 07-clarity-surfaces-quality-and-portability-instance-agnostic-r
plan: 02
subsystem: UI markdown render + worker TL;DR refs→titles + compile-prompt tightening
tags: [ui, markdown, safe-render, xss-guard, worker, refs-to-titles, READER-02, READER-10, D-I3-01, D-I3-02, D-I3-03]
requires:
  - src/worker/handlers/sdk-ref-fetch.ts (07-01 resolveRefsViaSdk — REUSED for id→title; not re-implemented)
  - src/worker/agents/editor.ts (07-01 extractRefsFromBody + prefixFromIdentifier — REUSED for instance-agnostic extraction)
  - src/ui/surfaces/reader/prose-with-ref-chips.tsx (the keyed-React-node construction pattern mirrored)
provides:
  - src/ui/primitives/safe-markdown.ts (NEW pure parser — block/inline tokenizer + sanitizeHref allowlist; node --test-loadable)
  - src/ui/primitives/safe-markdown.tsx (NEW SafeMarkdown component — keyed React nodes, NO innerHTML escape hatch, href allowlist)
  - src/worker/handlers/tldr-ref-titles.ts (NEW pure inlineRefTitles + async buildTitleMap; reuses the 07-01 resolver)
  - issue-reader.ts wires the refs→title rewrite at the post-tldr seam behind a try/catch (degrade leaves the un-rewritten body)
  - tldr-strip.tsx + ref-card.tsx render their body/excerpt via SafeMarkdown (null permission-gated branch preserved)
  - compile-tldr.ts buildPrompt tightened to headline + <=3 bullets + ~80-word cap, busy-founder voice (MAX_TOKENS unchanged)
affects:
  - "READER-02 — the TL;DR strip now renders formatted markdown (was literal '## BLUF'/'**bold**')"
  - "READER-10 (NEW, Pending) — markdown render of TL;DR + excerpt + refs-as-titles inline"
  - "READER-03/04 scope fence — inline ref CHIP format (prose-with-ref-chips.tsx / ref-chip.tsx) UNCHANGED (empty diff)"
tech_stack:
  added: []   # NO new runtime dep — the markdown renderer is hand-rolled, plugin-local
  patterns:
    - "Hand-rolled SAFE markdown: pure parser in a .ts (node --test-loadable) emits a string-only token tree; the .tsx maps it to keyed React nodes — NEVER innerHTML, so literal <...> renders as inert escaped text"
    - "href allowlist (sanitizeHref): http/https/mailto/relative only; rejects javascript:/data:/vbscript:/file: incl. case + control-char (0x00-0x20) obfuscations; a rejected href downgrades the link to plain text"
    - "refs→title is a pure WORKER post-processor (reuses 07-01 resolveRefsViaSdk + extractRefsFromBody) wired into the reader handler; idempotent (skip a token already followed by ' — '), instance-agnostic (prefix-narrowed), degrade-safe (empty map → bare IDs), never throws"
    - "Test harness: Node 24 strip-types loads .ts but NOT .tsx — load-bearing logic lives in .ts (asserted directly); the .tsx is source-grep verified (no-innerHTML scan + SafeMarkdown/sanitizeHref greps), mirroring the repo idiom (reader-view.test.mjs)"
    - "Empirical bundle-ceiling recalibration (Plan 05-04/05-11 precedent): SafeMarkdown overflowed the ~1.3 kB 07-01 headroom; ceiling 688→694 kB with a justification comment + a confirmed zero-SheetJS scan"
key_files:
  created:
    - src/ui/primitives/safe-markdown.ts
    - src/ui/primitives/safe-markdown.tsx
    - src/worker/handlers/tldr-ref-titles.ts
    - test/ui/safe-markdown.test.mjs
    - test/worker/tldr-ref-titles.test.mjs
    - test/worker/compile-tldr.test.mjs
  modified:
    - src/worker/handlers/issue-reader.ts
    - src/ui/surfaces/reader/tldr-strip.tsx
    - src/ui/surfaces/reader/ref-card.tsx
    - src/worker/agents/compile-tldr.ts
    - scripts/check-ui-bundle-size.mjs
    - test/worker/issue-reader.test.mjs
    - .planning/REQUIREMENTS.md
decisions:
  - "Renderer split into a pure .ts parser + a thin .tsx component so the load-bearing parse + href-allowlist logic is unit-testable (Node can't load .tsx) — the .tsx is grep-verified. This is the project's established UI-test idiom, not a new harness."
  - "refs→title rewrite applies to the TL;DR body ONLY (D-I3-02 names the TL;DR); SafeMarkdown RENDERING applies to BOTH the TL;DR strip AND the Anchored-to excerpt (D-I3-01 names both). The excerpt is a verbatim upstream quote — rewriting its tokens would distort the quote."
  - "Bundle ceiling recalibrated 688→694 kB (710,656 B): SafeMarkdown is the only UI-bundle addition (+6,145 B over the 07-01 build), overflowed the ~1,274 B headroom; zero SheetJS sentinels confirmed; per the 05-04/05-11 empirical-recalibration precedent."
  - "Length cap chosen at ~80 words + <=3 bullets (the plan left the concrete number to executor discretion)."
  - "extractRefsFromBody (which internally calls prefixFromIdentifier) is imported into tldr-ref-titles.ts — satisfies the 'reuse prefixFromIdentifier/extractRefsFromBody, no third regex' contract without importing prefixFromIdentifier separately."
metrics:
  duration: "~1 session (autonomous)"
  tasks_completed: 4
  files_created: 6
  files_modified: 7
  completed_date: "2026-05-29"
  suite: "2062 total / 2059 pass / 1 fail (pre-existing situation.artifacts) / 2 skip"
---

# Phase 7 Plan 02: TL;DR cleanup (markdown render + refs→titles + tighter prompt) Summary

**One-liner:** The Editor-Agent's TL;DR and the Anchored-to ref-card excerpt now render as formatted React nodes (headings/bold/italic/bullets/links/code) via a hand-rolled, plugin-local SAFE markdown renderer (NO new dep, NO innerHTML escape hatch, href allowlist) instead of literal `## BLUF`/`**bold**` text; `<PREFIX>-NNN` tokens inside the TL;DR body are post-processed to `ID — title` by reusing the 07-01 SDK resolver (instance-agnostic, idempotent, degrade-safe); and the compile prompt is tightened to a busy-founder headline + ≤3 bullets + ~80-word cap. Version stays 1.0.0; no migration; no new runtime dep.

## What shipped

### 1. SafeMarkdown — the hand-rolled safe renderer (D-I3-01) — READER-02/READER-10

The operator saw literal `## BLUF` / `**bold**` / `- bullets` / `[label](url)` in BOTH the TL;DR strip AND the "Anchored to (resolved)" ref-card excerpt on BEAAA (07-01 drill). Item 3 closes the readability payoff of the 07-01 resolver.

- **`src/ui/primitives/safe-markdown.ts`** (NEW, pure): `parseMarkdownBlocks(text)` splits on blank lines into heading (`##`→h3 / `###`→h4), list (consecutive `- `/`* ` → `<ul>`, `1.`/`2.` → `<ol>`), and paragraph blocks; `parseInline` tokenizes `**bold**` / `*italic*` / `_italic_` / `` `code` `` / `[label](url)`. `sanitizeHref(href)` is the load-bearing allowlist: http/https/mailto/relative only — rejects `javascript:`/`data:`/`vbscript:`/`file:` including case variants and ASCII-control-char (0x00–0x20) obfuscations (`java\tscript:`). Linear passes, no nested backtracking quantifiers (T-07-02-DoS).
- **`src/ui/primitives/safe-markdown.tsx`** (NEW): `SafeMarkdown({ text })` maps the token tree to keyed React element nodes (mirrors `prose-with-ref-chips.tsx` keying — no React key warnings); returns `null` for empty/nullish. NEVER uses React's raw-innerHTML escape hatch, so literal `<script>…</script>` renders as inert escaped text. A rejected href is downgraded to a plain-text span upstream so a `javascript:` URL never becomes a live anchor; absolute links carry `target="_blank" rel="noopener noreferrer"`.
- **Tests (`test/ui/safe-markdown.test.mjs`, 18 cases):** heading/bold/italic/inline-code/ul/ol/link-with-allowed-href/multi-paragraph + the two load-bearing XSS guards (no `javascript:` href emitted; `<script>` parsed as inert text) + a source-scan asserting the `.tsx` has NO innerHTML escape hatch. Node 24 can't load `.tsx`, so the parser logic is asserted directly off the `.ts`; the `.tsx` is grep-verified (the established repo idiom).

### 2. refs→title TL;DR post-processor (D-I3-02) — instance-agnostic, degrade-safe

- **`src/worker/handlers/tldr-ref-titles.ts`** (NEW, pure): `inlineRefTitles(body, identifier, titleById)` extracts tokens via the shared 07-01 `extractRefsFromBody` (prefix-narrowed; broad fallback when identifier is null) and rewrites each resolvable `X-NNN` to `X-NNN — <title>`. Idempotent (a token already followed by ` — ` is skipped via negative lookahead), unresolved tokens stay bare, never throws. `buildTitleMap(issues, body, identifier, companyId)` calls `resolveRefsViaSdk` ONCE for the unique tokens and builds `requestedId → issue.title`; empty token set → empty map (skips the SDK call); a thrown resolver degrades to an empty map. NO new regex, NO new resolver — both are 07-01 reuse.
- **Wired into `issue-reader.ts`** at the post-`tldr`-resolution seam (after the TL;DR drive/cache try/catch, before refCards): when `tldr.body` is a non-empty string, `buildTitleMap` + `inlineRefTitles` rewrite the body inside a try/catch that logs at warn and leaves the un-rewritten body on failure (mirrors the existing TL;DR-drive degrade). The new object is built with `tldr = { ...tldr, body }` so the `satisfies IssueReaderResult` return type-checks (plan-checker warning #1).
- **Tests:** `test/worker/tldr-ref-titles.test.mjs` (10 pure cases — rewrite, unresolved-bare, idempotent, COU-vs-BEAAA instance-agnostic, empty-map degrade, buildTitleMap resolve/skip/degrade). `test/worker/issue-reader.test.mjs` gained the handler→post-processor wire-in case (FIXTURE `BEAAA-141` → `BEAAA-141 — Compliance step v2` in the returned `tldr.body`) AND a degrade-safe case (resolver throws → bare ID survives) — plan-checker warning #2. PRIM-01 updated to 3 refs × 2 per-ref-get passes (TL;DR title-map + refCards), still zero `?ids=` http.fetch.

### 3. Compile-prompt tightening (D-I3-03)

`compile-tldr.ts buildPrompt` now instructs a hard shape: a 1–2 sentence headline + AT MOST 3 short bullets + "keep the whole TL;DR concise — under ~80 words", in the busy-founder voice ("lead with the decision, then the current state, then the single next action"). The input scaffolding (Surface / Scope id / Issue body / Recent comments / Referenced ids) and `MAX_TOKENS = 16000` (the INPUT cap) are unchanged. `test/worker/compile-tldr.test.mjs` (RED→GREEN) pins the busy-founder voice, the headline/≤3-bullets/length-cap shape, the decision/state/next-action arc, the preserved scaffolding, and MAX_TOKENS=16000. The existing `tldr-truncation.test.mjs` (which asserts the truncated prompt still fits the cap) stays green — the added instruction lines fit within the truncation headroom reserve.

### 4. READER-10 + scope fence

- **READER-10** added to `.planning/REQUIREMENTS.md` (READER block after READER-09 + status table) as `Pending` (flips to Implemented after the live drill, like READER-03/04 did).
- **Scope fence honored:** the inline prose ref CHIP format (`prose-with-ref-chips.tsx` / `ref-chip.tsx`, READER-03) is UNCHANGED — `git diff HEAD` against those files is empty. 07-01 ref-resolution (`sdk-ref-fetch.ts`, the refCards path) is untouched. The excerpt's null "Quote unavailable (permission-gated)" branch is preserved.

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 - harness adaptation] Renderer split into a pure `.ts` parser + a thin `.tsx` component.** The plan's Task-1 action mentions "react-test-renderer / the project's shallow render util", but the repo has NO such util — Node 24's strip-types loads `.ts` but NOT `.tsx`, and every existing `test/ui/*` test is source-grep + extracted-logic based (e.g. `reader-view.test.mjs`, `prose-with-ref-chips.test.mjs`). To make the load-bearing parse + href-allowlist logic genuinely unit-testable (not just grep-asserted), the renderer is split: `safe-markdown.ts` (pure parser, `node --test`-loadable, asserted directly) + `safe-markdown.tsx` (the `SafeMarkdown` component, source-grep verified for no-innerHTML + SafeMarkdown/sanitizeHref). The `.tsx` named in `files_modified` is created; the `.ts` is an additive support module. No new devDep introduced. This is the correct adaptation to the repo's established harness, not a deviation from the renderer's contract.

**2. [Rule 1 - test correctness] Heading-level test premise corrected during GREEN.** A RED test asserted `### ` → `level === 3`; the implemented mapping is `## `→3 (h3), `### `→4 (h4) — deeper marker, higher level. The test assertion (not the code) was off; corrected to assert `## `→3, `### `→4, and that `###` is one level deeper than `##`.

**3. [Rule 1 - intended TDD churn] PRIM-01 "exactly 3 gets" updated to "3 refs × 2 passes".** Wiring the refs→title rewrite means the Reader now resolves the same unique refs via TWO independent per-ref-get passes per render (the TL;DR title-map AND refCards). The PRIM-01 test (which counted exactly 3 `ctx.issues.get` calls) correctly flipped red; updated to assert 6 calls = 3 unique refs × 2 passes, each pass still deduped (the per-ref-get-with-dedup boundary holds per pass), zero `?ids=` http.fetch unchanged. This is a minor efficiency cost (re-resolution), not a correctness bug — the plan explicitly accepts reusing the in-scope resolver per surface.

**4. [AUTHORIZED recalibration] UI bundle ceiling 688 → 694 kB.** SafeMarkdown (the only UI-bundle addition this plan) pushed the built `dist/ui/index.js` from 703,238 B (07-01) to **709,383 B** (+6,145 B), overflowing the ~1,274 B 07-01 headroom. Per the plan's explicit authorization + the project's empirical-recalibration precedent (Plan 05-04 / 05-11): confirmed the overage is SafeMarkdown's legitimate renderer code, confirmed **zero SheetJS sentinels** (`XLSX`/`SheetJS`/`!ref` all 0 in the UI bundle), and bumped `UI_BUNDLE_BYTES_CEILING` 688→694 kB (710,656 B, ~1,273 B headroom) with a dated justification comment ("Plan 07-02: SafeMarkdown renderer, +N bytes, no SheetJS"). SafeMarkdown's locked feature surface (D-I3-01) was NOT crippled to fit.

## Threat surface

T-07-02-XSS (load-bearing) is **mitigated**: SafeMarkdown emits React element nodes only (no innerHTML escape hatch → literal `<...>` is escaped to inert text) AND applies the `sanitizeHref` allowlist (no `javascript:`/`data:`/`vbscript:` live href). Pinned by the Task-1 XSS-guard tests + the no-innerHTML source scan. T-07-02-RW (rewrite corruption) is **mitigated**: `inlineRefTitles` is idempotent, degrades unresolved tokens to bare IDs, never throws, and is wrapped in a try/catch in the reader handler. T-07-02-IL / T-07-02-DoS **accepted** (no new boundary crossed; linear parse over a length-capped body). T-07-02-SC: **NO new runtime deps** (constraint honoured — `package.json` `dependencies` unchanged).

## Quality gates (Task 4 — all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `node scripts/check-css-scope.mjs` | PASS — 140 selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/build-worker.mjs` | PASS — dist/worker.js 2.4 MB |
| `node scripts/build-ui.mjs` | PASS — dist/ui/index.js 692.8 kB |
| `npx tsc --project tsconfig.manifest.json` | PASS — dist/manifest.js version '1.0.0' |
| `node scripts/check-ui-bundle-size.mjs` | PASS — **709,383 B ≤ 710,656 ceiling (recalibrated 688→694 kB, see Deviation #4)**; 0 SheetJS sentinels |
| `node --test "test/**/*.test.mjs"` | **2062 total / 2059 pass / 1 fail / 2 skip** — the 1 fail is the documented pre-existing `situation.artifacts: per-agent arrays sorted DESC by createdAt`; every other test passes |
| `grep -c paperclipInvocation dist/worker.js` | **5** (≥ 5 — SDK NOT externalized) |
| Version literal | `1.0.0` in package.json AND src/manifest.ts:337 AND dist/manifest.js — NO bump |
| No new dep / migration | `dependencies` unchanged (4 deps, none added); no migration file touched |
| Source greps | `safe-markdown.tsx` has 0 innerHTML escape hatch; `tldr-strip.tsx` + `ref-card.tsx` render via `SafeMarkdown`; ref-card null "permission-gated" branch present; `tldr-ref-titles.ts` imports `resolveRefsViaSdk` + `extractRefsFromBody`; `compile-tldr.ts` buildPrompt contains `busy founder`; `prose-with-ref-chips.tsx` + `ref-chip.tsx` diff EMPTY (READER-03 scope fence) |

## Tarball

- **filename:** `clarity-pack-1.0.0.tgz` (repo root)
- **sha256:** `46897f7a283bc8a5837de6594c5280e013bc6e92c1df500d5c0b6fcbc54c56ac`
- **size:** `709225` bytes (709.2 kB)
- **files:** 18 (dist/ + 13 migrations/ + README.md + package.json); 0 src/, 0 test/, 0 .png leaks
- **version:** 1.0.0 (unchanged)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `6efeb05` | feat(07-02): hand-rolled SafeMarkdown renderer (D-I3-01, RED→GREEN incl. XSS guard) |
| 2 | `7bced21` | feat(07-02): refs→title TL;DR post-processor wired into the reader (D-I3-02, RED→GREEN) |
| 3 | `673772f` | feat(07-02): SafeMarkdown both render targets + tighten compile prompt + READER-10 (D-I3-01/03) |
| 4 | (this commit) | docs(07-02): full gates + builds + pack + SUMMARY/STATE/ROADMAP/REQUIREMENTS |

---

## AUTONOMOUS post-build deploy + live BEAAA Playwright drill (run by the orchestrator 2026-05-29 — FULL PASS)

**Deployed:** `clarity-pack-1.0.0.tgz` sha256 `46897f7a283bc8a5837de6594c5280e013bc6e92c1df500d5c0b6fcbc54c56ac` installed on BEAAA via DEPLOY-RUNBOOK Path A in **2 SSH connections** (upload `rm+cat`-over-stdin one connection; install here-string one connection — `fs.protected_regular` blocks even root from truncating the beai-agent-owned /tmp tarball, so `rm` first is mandatory; the 2-connection shape avoided the fail2ban trip that 07-01's 5-connection burst hit). Plugin `status=ready version=1.0.0 id=a763176a-2f4d-4986-b190-b5151e42cc00`. Live drill via localhost:3100 tunnel + Playwright MCP on **BEAAA-828** (real Radix `browser_click` on the Reader tab; DOM read via `browser_evaluate`).

1. **Anchored-to excerpt renders markdown — ✅ PASS (primary proof).** `clarity-ref-card-quote` now contains real formatted elements `[h3, p, a, em, strong]` (`hasFormattedElements: true`); **no text node containing `## `** (`quoteHasLiteralHeading: false`, `literalMarkupVisible: false`). The excerpt that rendered literal `## BLUF … [BEAAA-702](/BEAAA/issues/BEAAA-702) *"…"*` in the 07-01 drill now renders the heading as `<h3>BLUF</h3>`, the link as `<a>`, the quote as `<em>`, bold as `<strong>`. Verifiable regardless of agent state (it's the 07-01-resolved upstream body).
2. **TL;DR strip renders markdown + refs→titles — ✅ PASS (Editor-Agent was RUNNING).** `tldrState: "populated"` (not "Compiling…"/paused); `clarity-tldr-body` contains formatted elements `[p, strong, code]`; `tldrRefWithTitle: true` — the body shows `BEAAA-828 — CEO opens 3 capacity conversations — ARE Pre-Bind Scan bundled beta …` (ID + title together). NOTE: the render + refs→title are applied at READ-time (post-process in issue-reader.ts), so they apply even to a cached TL;DR body; the tightened compile *prompt* (D-I3-03) shapes FUTURE compiles and is verified by the `compile-tldr.test.mjs` unit test (a fresh compile shows the headline+≤3-bullets+cap shape).
3. **XSS — ✅ proof-of-record (unit).** No live hostile-input fixture was reachable on BEAAA; the Task-1 unit XSS guards (no `javascript:` href emitted; `<script>` rendered inert; no `dangerouslySetInnerHTML`) are the proof of record. No XSS surface observed live.
4. **Scope-fence — ✅ PASS.** Inline prose ref CHIPS still render `ID · status` (`BEAAA-704 · done`, `BEAAA-713 · done`, `BEAAA-677 · done`) — READER-03 format UNCHANGED; 07-01 resolution untouched. Surface present; no "failed to render".

**Net drill verdict: FULL PASS.** READER-10 → Implemented (step 1 confirmed live; step 2 also confirmed since the agent was running). READER-02 reinforced by the live markdown-rendered, populated TL;DR strip.

## Self-Check: PASSED

- Created files exist: `src/ui/primitives/safe-markdown.ts`, `safe-markdown.tsx`, `src/worker/handlers/tldr-ref-titles.ts`, `test/ui/safe-markdown.test.mjs`, `test/worker/tldr-ref-titles.test.mjs`, `test/worker/compile-tldr.test.mjs`, `07-02-SUMMARY.md`, `clarity-pack-1.0.0.tgz` — all FOUND.
- Per-task commits exist: `6efeb05` (Task 1), `7bced21` (Task 2), `673772f` (Task 3) — all FOUND.
- Full gate battery green (Task 4) except the documented pre-existing `situation.artifacts` test; bundle ceiling recalibrated 688→694 kB (justified, zero SheetJS); tarball packed sha256 `46897f7a…`.
- Live BEAAA deploy + Playwright drill NOT run in this build task — orchestrator-pending (verdicts TBD above).
