---
quick: 260531-b8w
plan: 01
subsystem: ui/reader
tags: [reader, redesign, sketch-003, sketch-004, ref-chips, typography, v1.2.2]
requires:
  - sketch 003-reader-layout-hierarchy variant-b (pixel ground truth)
  - sketch 004-tldr-type-and-chips variant-b + shared .iref demo
provides:
  - Reader 003-B no-rail TL;DR-first single-column layout
  - Reader 004-B host-native editorial type + two-weight ref-chips
  - RefChip variant='full'|'inline' API (light inline form)
  - SafeMarkdown refVariant threading
affects:
  - src/ui/surfaces/reader/index.tsx
  - src/ui/surfaces/reader/prose-with-ref-chips.tsx
  - src/ui/primitives/ref-chip.tsx
  - src/ui/primitives/safe-markdown.tsx
  - src/ui/primitives/theme.css
tech-stack:
  patterns:
    - reader-scoped CSS custom props (--clarity-reader-serif / --clarity-reader-mono)
    - variant-prop threading through a module-level render pipeline (default-preserving)
key-files:
  created: []
  modified:
    - src/ui/surfaces/reader/index.tsx
    - src/ui/primitives/theme.css
    - src/ui/primitives/ref-chip.tsx
    - src/ui/primitives/safe-markdown.tsx
    - src/ui/surfaces/reader/prose-with-ref-chips.tsx
    - src/manifest.ts
    - package.json
    - test/ui/chat-ref-chip-issue-link.test.mjs
    - scripts/check-ui-bundle-size.mjs
decisions:
  - "Kept the full RefChip render path byte-identical; added a parallel inline render so all ref-chip-title / ref-chip-peek / hidden-as-ref invariants survive."
  - "Reader-scoped fonts via two custom props on [data-clarity-surface='reader'] — base Geist/Geist Mono/Instrument Serif untouched so chat/bulletin/situation-room keep their lock."
  - "JetBrains Mono applied via reader-scoped overrides that win on specificity; shared bare [data-clarity-surface] Geist Mono rules left intact for other surfaces."
  - "dist/ is fully gitignored (zero tracked dist files, all prior releases too) — the build is the ship by SUCCEEDING; dist artifacts are rebuilt at pack/install time, not committed."
metrics:
  tasks: 3
  files_changed: 9
  duration: ~45m
  completed: 2026-05-31
---

# Quick 260531-b8w: Reader redesign (003-B + 004-B) Summary

Translated the two LOCKED Reader-redesign sketches into the live React/CSS build and shipped as v1.2.2: 003-B drops the plugin's redundant right rail for a single ~760px TL;DR-first reading column with a "Show full task" disclosure and an inline-relocated LiveBlockerPanel; 004-B scopes the Reader surface to host-native editorial type (system-ui body, Newsreader BLUF with true 400/600 weights, JetBrains Mono IDs) and gives ref-chips a second light inline form so dense mid-sentence ref-runs read as prose.

## Per-task commits

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | 003-B TL;DR-first no-rail layout | `147f186` | index.tsx, theme.css |
| 2 | 004-B host-native type + light inline ref-chips | `138301c` | theme.css, ref-chip.tsx, safe-markdown.tsx, prose-with-ref-chips.tsx |
| 3 | v1.2.2 bump + test reconcile + build | `019444b` | package.json, src/manifest.ts, test/ui/chat-ref-chip-issue-link.test.mjs, scripts/check-ui-bundle-size.mjs |

## What shipped

**Task 1 — 003-B layout (sketch 003 variant-b lines 237-274 + 003-C 81-88):**
- Removed the `.clarity-reader-body` grid + `<aside class="clarity-reader-rail">`; the Reader is now a single `.clarity-reader-column`, with the reader root constrained to `max-width: 760px`.
- Reading order after the breadcrumb: TL;DR briefing → relocated LiveBlockerPanel (`.clarity-reader-onyou` full-width banner, quiet when healthy by construction — the panel already returns null with no live blocker) → Acceptance (AcChecklist) → Deliverable → `<details className="clarity-reader-disclosure"><summary>Show full task</summary>` wrapping the raw body (ProseWithRefChips) + ActivityTimeline.
- All 13 `<SectionErrorBoundary name="..." resetKey={entityId}>` wraps preserved (moved sections kept their boundaries); `<PauseBanner>` stays mounted LAST, outside the column. The resolver chain, all loading/error placeholders, the `resolveReaderData`/`lastGoodRef` scroll-stability pattern, and the TL;DR compile-poll useEffect are untouched.

**Task 2 — 004-B type + two-weight chips (sketch 004 variant-b lines 45-47 + .iref 70-78 + demo 156-180):**
- Reader-scoped font block on `[data-clarity-surface='reader']`: `font-family: system-ui` + two custom props `--clarity-reader-serif: Newsreader…` and `--clarity-reader-mono: 'JetBrains Mono'…`. The base `[data-clarity-surface]` Geist declaration is untouched.
- `.clarity-tldr-body` → Newsreader 400 (1.12rem/1.55); `.clarity-tldr-body strong` → Newsreader 600 (true bold BLUF lead).
- Reader-scoped JetBrains Mono override for `.clarity-ref-chip-id` / `.clarity-ref-card-id` / `.clarity-activity-kind` (wins on specificity; shared Geist Mono rules untouched → chat/situation-room unaffected).
- `RefChip` gains `variant?: 'full' | 'inline'` (default `'full'`). The inline form renders `id` (mono) + a status-colored `.clarity-ref-chip-dot` + plain title with the `.clarity-ref-chip--inline` modifier (no border, underline-on-hover). The shared wrap + hover-peek + nav anchor are retained on both forms.
- `SafeMarkdown` threads `refVariant` (default `'full'`) through `renderBlock` → `renderInline` → `<RefChip variant=…>`. `ProseWithRefChips` passes `refVariant="inline"` for the body; anchored-to + TL;DR follow-on refs keep the full chip.

**Task 3 — release:**
- Version 1.2.1 → 1.2.2 in BOTH `package.json` and `src/manifest.ts`. dist/manifest.js (built) carries 1.2.2.
- `pnpm build` (worker + ui + manifest) exit 0; `tsc --noEmit` exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking gate] Recalibrated UI bundle ceiling 729 → 735 kB**
- **Found during:** Task 3 (post-build full suite).
- **Issue:** The redesign's legitimate UI code (+5,712 B → 748,552 B) pushed `dist/ui/index.js` 2,056 B over the prior 729 kB ceiling, failing `check-ui-bundle-size`.
- **Fix:** Bumped the single ceiling constant to 735 kB (752,640 B, ~4 kB headroom) with a cited comment, following the file's own documented empirical-recalibration precedent (Plan 05-04 / 05-11 / 07-x / 08-02). Verified zero SheetJS sentinels (XLSX/SheetJS/!ref all false) — the delta is real feature code, not a bloat leak. Stays under the 740 kB visual-regression sanity ceiling.
- **Files modified:** scripts/check-ui-bundle-size.mjs
- **Commit:** `019444b`

### Test reconciled

**`test/ui/chat-ref-chip-issue-link.test.mjs` — D3 "falls back to a span when companyPrefix is unavailable"** — the no-prefix branch's `className="clarity-ref-chip"` literal became `className={chipClassName}` (the 004-B two-weight chip resolves chipClassName to `'clarity-ref-chip'` for full, `'clarity-ref-chip clarity-ref-chip--inline'` for inline). The test's INTENT (no-prefix branch returns a `<span>`, never a broken anchor) is unchanged; the regex was widened to accept either the old literal OR the new `{chipClassName}` form, with a cited comment. Coverage NOT weakened — it still asserts a `<span>` in the `if (!companyPrefix)` branch. No SectionErrorBoundary or PauseBanner invariant test was touched.

## Deferred Issues

**`test/worker/handlers/situation-artifacts.test.mjs:352` — "per-agent arrays sorted DESC by createdAt"** — PRE-EXISTING out-of-scope failure documented in STATE.md (Plan 08-02 gates: "2373 pass, 1 pre-existing out-of-scope situation-artifacts fail"). This quick task touched zero worker/situation code, so the failure is unrelated to the Reader redesign. Logged to `deferred-items.md`; not fixed (SCOPE BOUNDARY). Final suite: 2373 pass / 1 fail = the known-good baseline.

## Known Stubs

None — all data paths were already wired (this is a layout/type restructure of existing components, not new data surfaces).

## Verification

- check-css-scope: 212 top-level selectors, all scoped under `[data-clarity-surface]`.
- check-ui-bundle-size: 748,552 B (731.0 kB) of 752,640 B ceiling; no SheetJS sentinels.
- `tsc --noEmit`: exit 0. `pnpm build` (worker+ui+manifest): exit 0; dist/ui/index.js + dist/worker.js + dist/manifest.js emitted.
- Full `node --test "test/**/*.test.mjs"`: 2373 pass / 1 pre-existing out-of-scope fail / 2 skipped (build-gated dist-css + ref-chip dist).
- Version 1.2.2 in package.json AND src/manifest.ts AND built dist/manifest.js.

## Self-Check: PASSED

- Commits `147f186`, `138301c`, `019444b` — all FOUND in git log.
- All modified source files present on disk.
- All Task verify gates green; version 1.2.2 confirmed in both sources + dist.
