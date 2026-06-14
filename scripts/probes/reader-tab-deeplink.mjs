#!/usr/bin/env node
// scripts/probes/reader-tab-deeplink.mjs
//
// Plan 18-01 Task 1 — Live host Reader-tab deep-link feasibility probe (D-01).
//
// PROBE SHAPE: B (live-host DevTools-console probe), mirroring
//   scripts/probes/carrier-survival.mjs.
//
// WHY SHAPE B (and not an automated node --test):
//   The question this probe answers — "does the Paperclip HOST select the
//   `clarity-reader` detailTab when the issue URL carries `?tab=clarity-reader`
//   or `#tab=clarity-reader`?" — is decided entirely by Paperclip host code
//   that does NOT live in this repo (the host's issue-detail page + its
//   detailTab tab-bar selection logic; cf. 18-RESEARCH §1 finding C/D, A1).
//   - 18-RESEARCH finding C [VERIFIED: src/manifest.ts:784-790]: `clarity-reader`
//     is `type: 'detailTab'`, and the host mounts `ReaderView` ONLY once the
//     Reader tab is already the active tab. So Clarity CANNOT self-select the
//     tab from inside its own slot — if the host does not honor a URL param,
//     Tier-1 is closed BY CONSTRUCTION (no client-side workaround exists).
//   - Like carrier-survival.mjs, this repo's `node --test` runner has no React
//     render harness AND no live host bridge (globalThis.__paperclipPluginBridge__),
//     so an in-process test could only learn about a fake, never the live host.
//     That is the docstring-vs-runtime drift that shipped GAP-RCB-03 twice
//     (MemPalace `router-fake-vs-production-host`).
//
//   Therefore the only honest path to a verdict is a LIVE-HOST observation:
//   Eric pastes the snippet below into the DevTools console on the live BEAAA
//   Paperclip instance, navigates the two URL forms, and records the verbatim
//   verdict (TIER1_HONORED=true|false + winning carrier) back into the
//   OPERATOR-OUTPUT section at the bottom of this file. A continuation agent
//   then writes the chosen tier at the top, and Task 3's buildReaderHref helper
//   branches on it (the probe outcome changes ONLY one return line).
//
//   THIS SCRIPT runs under `node scripts/probes/reader-tab-deeplink.mjs` and
//   prints the operator snippet so the walkthrough is reproducible from one
//   committed artifact. It does NOT perform the probe itself.
//
// INSTANCE-AGNOSTIC INVARIANT (acceptance criterion):
//   This file contains NO company-prefix literal. The probe snippet derives the
//   company prefix from `window.location.pathname` AT RUNTIME on the live host —
//   exactly as every Clarity surface does via extractCompanyPrefixFromPathname
//   (src/ui/primitives/use-resolved-company-id.ts:57-63). The only fixed token
//   below is the slot id `clarity-reader` (the host-registered detailTab id from
//   src/manifest.ts:786), which is instance-independent.
//
// ============================================================================
// TIER1_HONORED=false  (winning carrier: NONE — Tier-2 fallback is FINAL)
// RE-PROBED LIVE 2026-06-15 on BEAAA v1.7.1 (Reader rendering restored), via the
// operator browser through the tunnel. Result on issue BEAAA-972:
//   baseline (no carrier)      → host default tab = Chat; Clarity Reader NOT active
//   /issues/<id>?tab=clarity-reader → Reader NOT auto-selected (carrier ignored)
//   /issues/<id>#tab=clarity-reader → Reader NOT auto-selected (carrier ignored)
// Conclusion: the host honors NEITHER carrier. Tier-1 is closed BY CONSTRUCTION
// (host mounts ReaderView only when its detailTab is already active; Clarity cannot
// self-select a host-owned tab — 18-RESEARCH finding C). buildReaderHref's Tier-2
// return (/<prefix>/issues/<id>) is FINAL; there is no one-line upgrade available.
// ACCEPTED SHORTFALL (SPEC line 28): Open↗ lands on the issue's default tab and the
// Clarity Reader is ONE CLICK away, not the terminal auto-landing. Making it auto-land
// requires a HOST feature (host honoring ?tab=/#tab=, or a detailTab defaultTab hint) —
// a future ask to the Paperclip host team, not an in-plugin fix.
// ============================================================================
// VERDICT (2026-06-14, continuation executor, checkpoint resume-signal = "tier2"):
//   The live deep-link probe COULD NOT BE RUN — the entire Clarity Pack UI was
//   rendering BLANK on live BEAAA v1.6.0 at execution time. Every surface (Reader,
//   Situation Room) showed only the host's empty slot frame. Live diagnosis: the
//   plugin's UI bundle 404s (`index.js?v=2026-06-11T07:…` → 404) and NO clarity-pack
//   plugin files exist on the real data volume (`/mnt/paperclipdata/dot-paperclip`),
//   while the host still serves CACHED `ui-contributions` metadata (304). This is a
//   broken/partial install (consistent with the fail2ban-interrupted v1.6.0 deploy:
//   the registration persisted, the files did not). It is NOT a probe-false result —
//   there was no working Reader tab to probe at all.
//
//   DECISION: ship the locked SPEC Tier-2 fallback NOW (D-02) — it is ALWAYS correct
//   regardless of host tab-deep-link feasibility — and DEFER the Tier-1 deep-link
//   probe to AFTER the UI is restored by the Phase 18 clean reinstall deploy (18-04).
//   Because buildReaderHref's tier choice is a one-line change in one file, the
//   Tier-1 upgrade is a trivial post-restore follow-up: re-run this probe against a
//   working Reader, then (only if a carrier wins) append it to the single return line.
//
// This top line is the machine-readable verdict. After the UI is restored (18-04),
// re-run the probe and rewrite it to one of:
//   TIER1_HONORED=true   (winning carrier: QUERY  → ?tab=clarity-reader)
//   TIER1_HONORED=true   (winning carrier: HASH   → #tab=clarity-reader)
//   TIER1_HONORED=false  (winning carrier: NONE   → Tier-2 fallback stays)
// Task 3's src/ui/primitives/reader-href.ts buildReaderHref() branches on it:
//   - TIER1_HONORED=true + QUERY → return `/${p}/issues/${id}?tab=clarity-reader`
//   - TIER1_HONORED=true + HASH  → return `/${p}/issues/${id}#tab=clarity-reader`
//   - DEFERRED / false           → return `/${p}/issues/${id}` (locked SPEC fallback, D-02)
//
// ACCEPTANCE-RISK NOTE (escalated per 18-RESEARCH §1 / SPEC line 28 — ACKNOWLEDGED):
//   With the Tier-2 fallback shipping, the classic issue page MAY be the terminal
//   landing, because Clarity cannot force-select a host-owned tab from inside
//   ReaderView (the detailTab mount model, finding C). LEG-01's "lands on the Reader,
//   not the classic wall" acceptance criterion is only physically satisfiable with a
//   host feature (host honors `?tab=`/`#tab=`, OR a host detailTab `defaultTab`
//   hint — neither is confirmed today, and could not be probed while the UI was down).
//   This risk is ACKNOWLEDGED, not silently absorbed; the honest Tier-2 fallback ships
//   and the Tier-1 upgrade is a one-line change once a working Reader exists to probe.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Snippet 1 — Reader-tab deep-link probe (run twice: QUERY form, then HASH form).
// ----------------------------------------------------------------------------
// Tests whether the host pre-selects the `clarity-reader` detailTab when the
// issue URL carries a tab-select carrier. The two carriers are probed
// belt-and-suspenders (18-RESEARCH §1 Tier-1): `?tab=` AND `#tab=`. The hash
// form is the more likely survivor (the host strips ?query before react-router
// per carrier-survival.mjs finding A) — BUT tab-selection may be read by the
// host router BEFORE the strip, so both are tried and the probe settles it.
//
// The snippet is INSTANCE-AGNOSTIC: it reads the live company prefix from
// window.location.pathname; nothing about BEAAA is hardcoded. The known issue
// to navigate is supplied by the operator at run time (the runbook suggests
// BEAAA-972, the live anchor) — it is NOT baked into this file.
const READER_TAB_PROBE = `
// === Plan 18-01 Task 1 — Reader-tab deep-link probe ===
// Paste into the DevTools console on the LIVE BEAAA Paperclip instance while
// viewing ANY issue (e.g. the classic body of BEAAA-972). The probe derives the
// company prefix from the current URL (instance-agnostic), builds both the
// ?tab= and #tab= forms for a target issue identifier you supply, navigates to
// each, and reports whether the host lands on the Clarity Reader tab.

(async () => {
  // --- Derive the company prefix from the live URL (NO hardcoded literal). ---
  // Mirrors extractCompanyPrefixFromPathname: first non-empty path segment.
  const seg = window.location.pathname.split('/').filter(Boolean);
  const companyPrefix = seg[0] || '';
  if (!companyPrefix) {
    console.log('[probe reader-tab] ABORT — could not derive companyPrefix from pathname:', window.location.pathname);
    return;
  }

  // --- Target issue identifier: edit this to the issue you are probing. ---
  // The runbook anchor is BEAAA-972; change it if that issue has moved state.
  const issueIdentifier = window.__clarityProbeIssueId || 'BEAAA-972';

  const SLOT = 'clarity-reader'; // host-registered detailTab id (manifest.ts:786)
  const queryForm = '/' + companyPrefix + '/issues/' + issueIdentifier + '?tab=' + SLOT;
  const hashForm  = '/' + companyPrefix + '/issues/' + issueIdentifier + '#tab=' + SLOT;

  console.log('[probe reader-tab] companyPrefix (derived) =', companyPrefix);
  console.log('[probe reader-tab] issueIdentifier         =', issueIdentifier);
  console.log('[probe reader-tab] QUERY form =', queryForm);
  console.log('[probe reader-tab] HASH  form =', hashForm);

  window.__clarityReaderTabProbe = { companyPrefix, issueIdentifier, queryForm, hashForm, slot: SLOT };

  console.log('');
  console.log('[probe reader-tab] PROCEDURE — run each form, then run Snippet 1B at the landing:');
  console.log('  Form A (query): window.location.href = window.__clarityReaderTabProbe.queryForm');
  console.log('  Form B (hash) : window.location.href = window.__clarityReaderTabProbe.hashForm');
  console.log('[probe reader-tab] After EACH navigation lands and the issue-detail');
  console.log('  page renders, paste Snippet 1B below to record which tab is active.');
})();
`.trim();

const READER_TAB_PROBE_1B = `
// === Plan 18-01 Task 1 — Reader-tab deep-link probe — Step B (observe landing) ===
// Paste this AFTER navigating to one of the two forms and the issue-detail page
// has rendered. It reports which detailTab the HOST selected. Run it once for
// the QUERY landing and once for the HASH landing; record both verdicts.

(() => {
  const SLOT = 'clarity-reader';

  // 1) Is the Clarity Reader surface actually mounted? The Reader root carries
  //    data-clarity-surface="reader" (see src/ui/surfaces/reader/index.tsx).
  //    detailTabs mount ONLY when their tab is active — presence == Reader is
  //    the active tab (18-RESEARCH finding C).
  const readerSurface = document.querySelector('[data-clarity-surface="reader"]');
  const readerMounted = !!readerSurface;

  // 2) Cross-check via the host tab-bar's active/selected tab, if discoverable.
  //    The host renders the issue-detail tab bar; the active tab is commonly
  //    marked aria-selected="true" or data-state="active". This is a best-effort
  //    secondary signal — the AUTHORITATIVE signal is readerMounted above
  //    (Clarity code runs iff the Reader tab is active).
  const activeTabEls = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [data-state="active"][role="tab"], button[aria-selected="true"]')];
  const activeTabLabels = activeTabEls.map((e) => (e.textContent || '').trim()).filter(Boolean);
  const activeTabMentionsReader = activeTabLabels.some((t) => /reader/i.test(t));

  const observed = {
    'window.location.pathname': window.location.pathname,
    'window.location.search': window.location.search,
    'window.location.hash': window.location.hash,
    readerSurfaceMounted: readerMounted,
    activeTabLabels,
    activeTabMentionsReader,
  };
  console.log('[probe reader-tab] OBSERVED at issue-detail landing:');
  console.log(JSON.stringify(observed, null, 2));

  const carrier = window.location.search.includes('tab=' + SLOT)
    ? 'QUERY'
    : window.location.hash.includes('tab=' + SLOT)
      ? 'HASH'
      : 'NONE';

  if (readerMounted) {
    console.log('[probe reader-tab] VERDICT: TIER1_HONORED=true  (winning carrier: ' + carrier + ')');
    console.log('[probe reader-tab]   The host selected the Clarity Reader tab from the URL carrier.');
  } else {
    console.log('[probe reader-tab] VERDICT: TIER1_HONORED=false  (carrier in URL: ' + carrier + ')');
    console.log('[probe reader-tab]   The host landed on the classic tab — the URL carrier did NOT');
    console.log('[probe reader-tab]   pre-select the Reader detailTab. Tier-2 fallback ships (D-02).');
    console.log('[probe reader-tab]   ACCEPTANCE-RISK: classic issue page may be the terminal landing');
    console.log('[probe reader-tab]   absent a host feature (18-RESEARCH §1 / SPEC line 28).');
  }
  // Copy this block into OPERATOR-OUTPUT below for BOTH the QUERY and HASH runs.
})();
`.trim();

// ----------------------------------------------------------------------------
// printOperatorWalkthrough — emits the snippets for the operator.
// ----------------------------------------------------------------------------
function printOperatorWalkthrough() {
  const lines = [];
  lines.push('='.repeat(78));
  lines.push('Plan 18-01 Task 1 — Reader-tab deep-link probe — OPERATOR WALKTHROUGH');
  lines.push('='.repeat(78));
  lines.push('');
  lines.push('Target: live BEAAA Paperclip instance (see .planning/DEPLOY-RUNBOOK.md §4');
  lines.push('  for tunnel/console access). Open the CLASSIC body of a known issue');
  lines.push('  (the runbook anchor is BEAAA-972; change it if that issue has moved');
  lines.push('  out of a blocked-awaiting state). The probe derives the company');
  lines.push('  prefix from the live URL — nothing instance-specific is hardcoded.');
  lines.push('');
  lines.push('Goal: decide TIER1_HONORED — does ?tab=clarity-reader OR #tab=clarity-reader');
  lines.push('  make the HOST pre-select the Clarity Reader detailTab?');
  lines.push('');
  lines.push('Procedure:');
  lines.push('  1. Paste SNIPPET 1 (Step A) — it prints both URL forms and stashes');
  lines.push('     them on window.__clarityReaderTabProbe.');
  lines.push('     (Optional: set window.__clarityProbeIssueId = "BEAAA-XXX" first to');
  lines.push('      probe a different issue.)');
  lines.push('  2. Navigate to the QUERY form:');
  lines.push('       window.location.href = window.__clarityReaderTabProbe.queryForm');
  lines.push('  3. When the issue-detail page renders, paste SNIPPET 1B — record the');
  lines.push('     verdict (TIER1_HONORED + carrier).');
  lines.push('  4. Navigate to the HASH form:');
  lines.push('       window.location.href = window.__clarityReaderTabProbe.hashForm');
  lines.push('  5. When it renders, paste SNIPPET 1B again — record the second verdict.');
  lines.push('  6. Copy BOTH verbatim outputs into OPERATOR-OUTPUT at the bottom of');
  lines.push('     this file, then report the verdict back to the executor:');
  lines.push('       "tier1" (name the winning carrier: query or hash), OR');
  lines.push('       "tier2" (neither carrier worked; fallback ships — acceptance-risk');
  lines.push('        acknowledged).');
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 1 — READER-TAB PROBE — Step A (run on any issue page)');
  lines.push('-'.repeat(78));
  lines.push(READER_TAB_PROBE);
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 1B — READER-TAB PROBE — Step B (run AT EACH landing: query, then hash)');
  lines.push('-'.repeat(78));
  lines.push(READER_TAB_PROBE_1B);
  lines.push('');
  lines.push('--- TIER1_HONORED=true  on EITHER form → record the winning carrier; Tier-1 ships.');
  lines.push('--- TIER1_HONORED=false on BOTH  forms → Tier-2 fallback ships (acceptance-risk noted).');
  lines.push('');
  lines.push('='.repeat(78));
  lines.push('OPERATOR-OUTPUT — paste verbatim console output here (QUERY run + HASH run):');
  lines.push('='.repeat(78));
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('reader-tab-deeplink.mjs')) {
  console.log(printOperatorWalkthrough());
}

export { READER_TAB_PROBE, READER_TAB_PROBE_1B, printOperatorWalkthrough };

// ============================================================================
// OPERATOR-OUTPUT (verbatim console output from the live BEAAA probe run)
// ============================================================================
//
// Probe run: 2026-06-14 — ATTEMPTED, NOT COMPLETED (live UI down).
//
// ## QUERY form  (/<prefix>/issues/<id>?tab=clarity-reader)
// - NOT RUN — no working Reader tab to land on (see below).
//
// ## HASH form  (/<prefix>/issues/<id>#tab=clarity-reader)
// - NOT RUN — no working Reader tab to land on (see below).
//
// ## Final verdict: TIER1_HONORED=DEFERRED  (winning carrier: NONE → Tier-2 ships)
// - Justification: at execution time the ENTIRE Clarity Pack UI was rendering
//   BLANK on live BEAAA v1.6.0 — every surface showed only the host's empty slot
//   frame. Live diagnosis: the plugin UI bundle 404s (index.js?v=… → 404) and NO
//   clarity-pack plugin files exist on /mnt/paperclipdata/dot-paperclip, while the
//   host serves CACHED ui-contributions metadata (304). Broken/partial install
//   (fail2ban-interrupted v1.6.0 deploy: registration persisted, files did not).
//   There was no working Reader tab to probe — this is NOT a probe-false result.
// - DECISION: ship the locked Tier-2 fallback now (D-02 — always correct); DEFER
//   the Tier-1 deep-link probe to AFTER the Phase 18 clean reinstall deploy (18-04)
//   restores the UI. Re-run THIS probe then; the Tier-1 upgrade is a one-line change.
// - ACCEPTANCE-RISK ACKNOWLEDGED: classic issue page may be the terminal landing
//   absent a host feature (18-RESEARCH §1 / SPEC line 28) — Tier-2 fallback ships
//   honestly per D-02; not silently absorbed.
// ---
