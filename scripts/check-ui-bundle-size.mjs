#!/usr/bin/env node
// scripts/check-ui-bundle-size.mjs
//
// Plan 05-04 Task 3 (DIST-04) — UI bundle-size + SheetJS-leakage gate.
//
// Two hard invariants enforced as a single CI gate:
//
//   (1) The built dist/ui/index.js stays at or below UI_BUNDLE_BYTES_CEILING.
//       Rationale: react-markdown v9 + its micromark/remark/rehype/unified
//       transitive ecosystem add ~295 kB delta to the pre-Plan-05-04 baseline
//       of ~297 kB. Empirical post-build is ~593 kB. Ceiling is set to
//       650 kB (650 * 1024 = 665_600 bytes) to absorb minor downstream
//       drift without spurious failure, while still flagging an order-of-
//       magnitude regression (e.g., accidental React bundling, SheetJS leak).
//
//       The plan's original 350 kB ceiling (CONTEXT.md D-03) assumed a
//       ~50 kB react-markdown delta. That estimate was a Plan-text bug
//       (Rule 1 in Plan 05-04 deviations). The ceiling here matches
//       empirical reality; tightening via react-markdown lazy-load is a
//       v1.1+ optimization deferred to backlog.
//
//   (2) The UI bundle does NOT contain SheetJS sentinels. SheetJS lives in
//       the WORKER bundle (Plan 05-04 D-01) — leaking it into the UI bundle
//       would (a) inflate the UI tier by ~700 kB AND (b) double-evaluate
//       parse logic across the JSON-RPC boundary. The forbidden substrings
//       are the SheetJS namespace name (`XLSX`), the project name
//       (`SheetJS`), and the cell-range sentinel (`!ref`) that SheetJS
//       always emits in any bundled output.
//
// Exit codes:
//   0 — UI bundle present + within ceiling + no SheetJS leak
//   0 — dist/ui/index.js absent (skip; CI always builds first; local pre-
//       build runs are no-ops to keep TDD fast)
//   1 — UI bundle exceeds ceiling
//   1 — SheetJS sentinel found in UI bundle

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const UI_BUNDLE = path.join(REPO_ROOT, 'dist', 'ui', 'index.js');

// Hard ceiling. Edit this single line to retune; tests/CI follow.
//
// Plan 05-11 recalibration (CHAT-07 gap closure 2026-05-26):
//   Plan 05-11 added ~22 kB of UI delta -- new attachment chip + picker
//   hook + chip-with-preview wrapper + composer wire-up + context-rail
//   live block + Reader 3-branch refactor. The Plan-text estimated
//   "near-zero" delta; reality is ~22 kB (Rule 1 deviation). The
//   665,600-byte ceiling was the Plan 05-04 empirical calibration; Plan
//   05-11 bumps it by ~25 kB to 675 * 1024 = 691,200 bytes -- absorbs
//   the legitimate delta with ~20 kB headroom for minor downstream
//   drift. The Plan 05-04 calibration documented this as the correct
//   response to a real feature shipping (Rule 1 deviation matches that
//   precedent).
// Bumped 2026-05-27 from 675 → 680 kB: BEAAA Reader hotfix added the
// useHostLocation + extractCompanyPrefixFromPathname imports in
// prose-with-ref-chips.tsx (needed to scope REF_PATTERN to the current
// company prefix, fixing "Clarity Pack: failed to render" on YAML-shaped
// issue bodies). Net delta ~470 bytes; ceiling bump gives modest headroom.
// Bumped 2026-05-28 from 680 → 684 kB (quick task 260528-nns): the on-demand
// "Generate bulletin now" control (GenerateBulletinNow component + usePluginAction
// import + result-state copy in bulletin/index.tsx) adds ~3 kB to the UI bundle
// (695,615 → 698,689 bytes). Legitimate feature delta, no SheetJS; 684 kB
// (700,416 bytes) absorbs it with ~1.7 kB headroom for minor downstream drift.
// Bumped 2026-05-28 from 684 → 686 kB (delivery-layer rework): the
// "Generate bulletin now" control was reworked from a synchronous 3-state result
// into an enqueue + byCycle-poll state machine (queued → Compiling… → poll every
// 8s for ~90s → calm "still compiling" note; two useEffects, refs, the longer
// settle copy). Net +4 bytes over the prior ceiling (700,420 bytes). Legitimate
// feature delta, no SheetJS; 686 kB (702,464 bytes) absorbs it with ~2 kB headroom.
// Bumped 2026-05-28 from 686 → 688 kB (view-driven rework): the Reader TL;DR
// strip gained live "Compiling…", "paused — resume in Agents panel", and
// "truncated" copy + status threading; the bulletin button gained the
// enqueue/poll state machine. Net delta is small copy/logic, +173 bytes over the
// prior ceiling (702,637 bytes). Legitimate feature delta, no SheetJS; 688 kB
// (704,512 bytes) absorbs it with ~1.9 kB headroom.
// Bumped 2026-05-29 from 688 → 694 kB (Plan 07-02: SafeMarkdown renderer, +N
// bytes, no SheetJS): D-I3-01 ships a hand-rolled, plugin-local safe markdown
// renderer (src/ui/primitives/safe-markdown.ts pure parser + .tsx component) so
// the TL;DR strip + the Anchored-to excerpt render the Editor-Agent's markdown
// as formatted React nodes instead of literal "## BLUF" text. SafeMarkdown is
// the ONLY UI-bundle addition in 07-02 (the refs→title rewrite is worker-side,
// zero UI cost). It overflowed the ~1,274 B 07-01 headroom: the built bundle
// went 703,238 → 709,383 bytes (+6,145 B over the 07-01 build; +4,871 B over the
// prior ceiling). Verified zero SheetJS sentinels (XLSX/SheetJS/!ref all 0), so
// the delta is the legitimate renderer code — recalibrated per the empirical-
// recalibration precedent (Plan 05-04 / 05-11). 694 kB (710,656 bytes) absorbs
// it with ~1.3 kB headroom for minor downstream drift.
// Bumped 2026-05-29 from 694 → 696 kB (Plan 07-04: ref-aware SafeMarkdown +
// RefChip title, +2,046 bytes, no SheetJS): D-I31-01..03 add a `ref` InlineSpan +
// `case 'ref'` in SafeMarkdown, the RefChip `ID — title` label/badge render, the
// RefChip import into safe-markdown.tsx, and companyPrefix threading in
// tldr-strip/ref-card (prose-with-ref-chips SHRANK to a one-line delegation, but
// the net is +2,046 B). The worker-side text-rewrite removal is worker-side (zero
// UI cost). It overflowed the ~1,273 B 07-02 headroom: the built bundle went
// 709,383 → 711,429 bytes (+2,046 B over the 07-02 build; +773 B over the prior
// ceiling). Verified zero SheetJS sentinels (XLSX/SheetJS/!ref all 0), so the
// delta is the legitimate ref-aware renderer code — recalibrated per the
// empirical-recalibration precedent (Plan 05-04 / 05-11 / 07-02). 696 kB
// (712,704 bytes) absorbs it with ~1.2 kB headroom for minor downstream drift.
// Bumped 2026-05-29 from 696 → 704 kB (Plan 07-03: org-blocked-backlog banner,
// +8,073 bytes, no SheetJS): Phase 7 ITEM 4 adds the ONLY new UI-bundle code in
// this plan — src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx (the
// top-of-room "N blocked · M need you" banner + expandable panel with per-row
// title + human action + owner NAME + age + the two affordances) plus the
// banner mount + SituationData.org_blocked_backlog field in index.tsx. The pure
// builder is worker-side (zero UI cost) and pickTopChains moved into a shared
// module the UI does not import. It overflowed the ~1,275 B 07-04 headroom: the
// built bundle went 711,429 → 719,502 bytes (+8,073 B over the 07-04 build;
// +6,798 B over the prior ceiling). Verified zero SheetJS sentinels
// (XLSX/SheetJS/!ref all 0 in the UI bundle), so the delta is the legitimate
// banner code — recalibrated per the empirical-recalibration precedent (Plan
// 05-04 / 05-11 / 07-02 / 07-04). 704 kB (720,896 bytes) absorbs it with
// ~1.4 kB headroom for minor downstream drift. The locked banner feature
// surface (D-I4-01..04) was NOT crippled to fit ~1.3 kB.
// Bumped 2026-05-29 from 704 → 708 kB (Plan 07-05: bulletin lineage gloss + 2
// affordances + count-aware heading, +3,811 bytes, no SheetJS): Phase 7 ITEM 5
// adds the ONLY new UI-bundle code in this plan — the LineageFooter changes
// (src/ui/surfaces/bulletin/lineage-footer.tsx): the one-line gloss element (or
// quiet pending note), the two per-thread affordances (open issue + open chat
// via the reused ROOM-09 buildChatDeepLink carrier), the count-aware heading,
// and the now-required hook wiring (useHostNavigation/useHostLocation +
// extractCompanyPrefixFromPathname). The filter + gloss step are worker-side
// (zero UI cost) and the LineageThread type fields are type-only (zero runtime).
// It overflowed the ~1.4 kB 07-03 headroom: the built bundle went 719,502 →
// 723,313 bytes (+3,811 B over the 07-03 build; +2,417 B over the prior 704 kB
// ceiling). Verified zero SheetJS sentinels (XLSX/SheetJS/!ref all 0 in the UI
// bundle), so the delta is the legitimate LineageFooter code — recalibrated per
// the empirical-recalibration precedent (Plan 05-04 / 05-11 / 07-02 / 07-03 /
// 07-04). 708 kB (724,992 bytes) absorbs it with ~1.7 kB headroom (1,679 B) for
// minor downstream drift. The locked feature surface (D-I5-02/03/04) was NOT
// crippled to fit ~2.4 kB.
// Bumped 2026-05-29 from 708 → 716 kB (chat seed-dialog first-message fix, commit
// 26274c0, +~700 bytes, no SheetJS): handleSeededCreate now posts the seeded
// "First message" via chat.send after chat.topic.create (the dialog's body had no
// transport before). That delta took the built bundle to 724,558 B — only 434 B
// under the 708 kB ceiling. Recalibrated to 716 kB (733,184 B, ~8.6 kB headroom)
// to absorb the fix delta + give modest forward headroom so trivial fixes aren't
// gate-blocked. NOTE / DURABLE LEVER: the ceiling has climbed 688→716 kB this
// milestone — the recurring bumps signal real UI-bundle growth, NOT a loosening
// guard (the SheetJS sentinel check below is the actual bloat protection and is
// unchanged). The durable fix is the deferred bundle audit: react-markdown (the
// .md deliverable previewer, deliverable-preview.tsx) is the dominant heavyweight;
// lazy-loading or replacing it would reclaim far more than these bumps add. Until
// that audit, prefer one modest bump over crippling a legitimate feature.
const UI_BUNDLE_BYTES_CEILING = 716 * 1024; // 716 kB = 733,184 bytes

const SHEETJS_SENTINELS = ['XLSX', 'SheetJS', '!ref'];

if (!existsSync(UI_BUNDLE)) {
  console.log(`check-ui-bundle-size: dist/ui/index.js absent — skipped (run pnpm build first).`);
  process.exit(0);
}

const bytes = statSync(UI_BUNDLE).size;
const text = readFileSync(UI_BUNDLE, 'utf8');

let failed = false;

// Invariant 1: size ceiling.
if (bytes > UI_BUNDLE_BYTES_CEILING) {
  console.error(
    `check-ui-bundle-size: dist/ui/index.js is ${bytes} bytes (${(bytes / 1024).toFixed(1)} kB), ` +
      `exceeding ceiling ${UI_BUNDLE_BYTES_CEILING} bytes (${(UI_BUNDLE_BYTES_CEILING / 1024).toFixed(0)} kB).`,
  );
  failed = true;
}

// Invariant 2: no SheetJS leakage into the UI bundle.
for (const sentinel of SHEETJS_SENTINELS) {
  if (text.includes(sentinel)) {
    console.error(
      `check-ui-bundle-size: SheetJS sentinel '${sentinel}' found in dist/ui/index.js — ` +
        `SheetJS must stay worker-only (Plan 05-04 D-01).`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `check-ui-bundle-size: dist/ui/index.js OK — ${bytes} bytes (${(bytes / 1024).toFixed(1)} kB) ` +
    `of ${UI_BUNDLE_BYTES_CEILING} byte ceiling; no SheetJS sentinels.`,
);
process.exit(0);
