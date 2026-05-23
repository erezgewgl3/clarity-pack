#!/usr/bin/env node
// scripts/probes/carrier-survival.mjs
//
// Plan 04.2-03 Task 1 — Empirical carrier-survival probe.
//
// PROBE SHAPE: B (in-Countermoves live console probe)
//
// Probe Shape A (paperclip-plugin-dev-server boot) was evaluated and rejected:
//   - The SDK ships `paperclip-plugin-dev-server` (node_modules/@paperclipai/
//     plugin-sdk/dist/dev-cli.js) BUT it is a pure static UI-asset server with
//     SSE hot-reload — NOT a Paperclip host runtime. It does NOT provide
//     globalThis.__paperclipPluginBridge__.sdkUi (the bridge object that
//     useHostNavigation / useHostLocation pull their real impl from per
//     node_modules/@paperclipai/plugin-sdk/dist/ui/runtime.js line 9). Without
//     that bridge, navigate() and useHostLocation() throw "Paperclip plugin UI
//     runtime is not initialized" (runtime.js lines 4-7) — there is no host
//     navigation behaviour to observe.
//   - This repo's `node --test` runner has no React render harness, so even if
//     a fake bridge were stubbed in, we would only learn about the fake, not
//     about the live Paperclip host. That is precisely the docstring-vs-runtime
//     drift that shipped GAP-RCB-03 twice (MemPalace `router-fake-vs-production-
//     host`).
//
// Probe Shape B (this script's contents) is therefore the only path to a
// LIVE-HOST observation. Eric pastes the snippets below into the DevTools
// console on the live Countermoves Paperclip instance and records the
// verbatim output back into the OPERATOR-OUTPUT section at the bottom of
// this file. A continuation agent then writes the chosen CARRIER=<NAME>
// line at the top, and Task 2 grep-branches on it.
//
// THIS SCRIPT runs under `node scripts/probes/carrier-survival.mjs` and
// prints the operator snippets so the walkthrough is reproducible from one
// committed artifact. It does NOT perform the probe itself.
//
// ============================================================================
// CARRIER=PENDING_OPERATOR_PROBE
// ============================================================================
// After the operator runs the snippets below and reports verbatim output, a
// continuation agent replaces this line with one of:
//   CARRIER=URL_HASH          — useHostLocation().hash preserved end-to-end
//   CARRIER=SESSION_STORAGE   — sessionStorage.getItem readable on chat mount
//   CARRIER=WORKER_HANDOFF    — both UI carriers stripped; need a row handoff
// The line is a single deterministic grep target for Task 2.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Snippet 1 — URL HASH carrier survival probe (priority 1, cheapest fix).
// ----------------------------------------------------------------------------
// Tests whether `useHostLocation().hash` is preserved end-to-end through
// useHostNavigation().navigate('/COU/chat#h=<encoded>'). The fragment is
// client-side-only per RFC 3986 — never sent to the server, never passed
// through path-routing. If hash strips, the host's resolveHref is doing
// something pathological. Cheapest fix candidate by far.
const URL_HASH_PROBE = `
// === Plan 04.2-03 Task 1 — URL HASH carrier survival probe ===
// Paste into the DevTools console on https://countermoves.gl3group.com while
// viewing the Reader tab of an issue (e.g. COU-2215).
// The probe emits a navigate() with a #h=... fragment carrying a base64-JSON
// payload, then captures useHostLocation().hash / window.location.hash /
// pathname at the chat surface mount. Records verbatim output to console.

(async () => {
  const probePayload = { route: 'urlHashProbe', sentinel: 'CARRIER_PROBE_2026_05_23' };
  const encoded = encodeURIComponent(btoa(JSON.stringify(probePayload)));
  const target = '/COU/chat#h=' + encoded;
  console.log('[probe url-hash] outbound navigate target =', target);
  console.log('[probe url-hash] window.location.hash BEFORE navigate =', window.location.hash);

  // Trigger the same navigate path the Continue button uses. Two ways:
  // (a) Click the existing Continue button (live 0.9.1 path; uses { state })
  //     and observe whether the URL bar shows the bare path (our 04.2-02
  //     evidence). NOT what we want for this probe.
  // (b) Manually drive useHostNavigation().navigate. The cleanest way to do
  //     this without rebuilding the plugin is to set window.location.hash
  //     to '#h=' + encoded and CLICK the Continue button — the host's
  //     navigate() will then run with the URL already carrying a hash. If
  //     useHostLocation().hash exposes it on the chat surface, hash survives.
  //
  // Procedure for the operator:
  //   1. With this snippet pasted, scroll up — see the outbound target above.
  //   2. Manually navigate to:   /COU/chat#h=<encoded shown above>
  //      either by typing the URL into the address bar + Enter, OR by
  //      assigning:  window.location.href = target
  //   3. Once the chat surface mounts, run Snippet 1b BELOW.

  window.__clarityProbeUrlHashTarget = target;
  window.__clarityProbeUrlHashPayload = probePayload;
  console.log('[probe url-hash] Step 1 done. Now navigate to:', target);
  console.log('[probe url-hash] (paste:  window.location.href = window.__clarityProbeUrlHashTarget  )');
})();
`.trim();

const URL_HASH_PROBE_1B = `
// === Plan 04.2-03 Task 1 — URL HASH carrier survival probe — Step 2 ===
// Paste this AFTER the navigation lands on /COU/chat#h=... and the chat
// surface has rendered.

(() => {
  const observed = {
    'window.location.hash': window.location.hash,
    'window.location.pathname': window.location.pathname,
    'window.location.search': window.location.search,
  };
  console.log('[probe url-hash] OBSERVED at chat surface mount:');
  console.log(JSON.stringify(observed, null, 2));

  // useHostLocation() is a React hook — we cannot call it from console outside
  // a component. Instead read history.state (react-router internal) AND
  // window.location.hash. The host bridge sits on top of react-router, so
  // history.state mirrors what useHostLocation().state holds.
  console.log('[probe url-hash] history.state =', JSON.stringify(history.state, null, 2));

  // Decode the encoded payload back, if hash is present.
  if (window.location.hash.startsWith('#h=')) {
    try {
      const enc = window.location.hash.slice(3);
      const decoded = JSON.parse(atob(decodeURIComponent(enc)));
      console.log('[probe url-hash] DECODED payload from window.location.hash =', JSON.stringify(decoded));
      console.log('[probe url-hash] VERDICT: URL_HASH SURVIVES — payload decoded back end-to-end.');
    } catch (err) {
      console.log('[probe url-hash] VERDICT: URL_HASH STRIPPED — decode failed:', err.message);
    }
  } else {
    console.log('[probe url-hash] VERDICT: URL_HASH STRIPPED — window.location.hash is empty.');
  }

  // Copy this block into OPERATOR-OUTPUT below.
})();
`.trim();

// ----------------------------------------------------------------------------
// Snippet 2 — SESSION_STORAGE carrier survival probe (priority 2, fallback).
// ----------------------------------------------------------------------------
// Only run if URL hash is STRIPPED. Tests whether a sessionStorage write
// from the Reader surface is readable on the chat surface mount across a
// host-driven cross-route navigation.
const SESSION_STORAGE_PROBE = `
// === Plan 04.2-03 Task 1 — SESSION_STORAGE carrier survival probe ===
// Paste into the DevTools console on https://countermoves.gl3group.com while
// viewing the Reader tab of an issue (e.g. COU-2215). ONLY RUN if Snippet 1
// (URL hash) showed STRIPPED.

(async () => {
  const probePayload = { route: 'sessionStorageProbe', sentinel: 'CARRIER_PROBE_2026_05_23' };
  sessionStorage.setItem('clarity-chat-deep-link', JSON.stringify(probePayload));
  console.log('[probe sessionStorage] Wrote payload to sessionStorage[clarity-chat-deep-link]');
  console.log('[probe sessionStorage] Now navigate manually to /COU/chat via address bar OR ');
  console.log('[probe sessionStorage] (paste:  window.location.href = "/COU/chat"  )');
  console.log('[probe sessionStorage] Then run Snippet 2b BELOW.');
})();
`.trim();

const SESSION_STORAGE_PROBE_2B = `
// === Plan 04.2-03 Task 1 — SESSION_STORAGE carrier survival probe — Step 2 ===
// Paste this AFTER the navigation lands on /COU/chat and the chat surface
// has rendered.

(() => {
  const raw = sessionStorage.getItem('clarity-chat-deep-link');
  console.log('[probe sessionStorage] sessionStorage.getItem(clarity-chat-deep-link) =', raw);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      console.log('[probe sessionStorage] PARSED payload =', JSON.stringify(parsed));
      console.log('[probe sessionStorage] VERDICT: SESSION_STORAGE SURVIVES — value readable post-navigation.');
    } catch (err) {
      console.log('[probe sessionStorage] VERDICT: SESSION_STORAGE STRIPPED — parse failed:', err.message);
    }
  } else {
    console.log('[probe sessionStorage] VERDICT: SESSION_STORAGE STRIPPED — value missing at chat mount.');
  }
  // Cleanup the probe key (real fix would do removeItem after read in
  // chat/index.tsx mount).
  sessionStorage.removeItem('clarity-chat-deep-link');
})();
`.trim();

// ----------------------------------------------------------------------------
// Snippet 3 — WORKER_HANDOFF probe (priority 3, last resort — NOT EXECUTED).
// ----------------------------------------------------------------------------
// Heavy: requires migrations/0010 + a new handler. We DEFER the full probe
// per the plan — record NOT PROBED if both UI carriers fail.
const WORKER_HANDOFF_NOTE = `
// === Plan 04.2-03 Task 1 — WORKER_HANDOFF carrier — NOT PROBED ===
// Probing this would require shipping a migration + new handler pair before
// the carrier is even confirmed worth shipping. Per the plan it is the last
// resort — only build it if Snippets 1 and 2 both showed STRIPPED.
// Rationale recorded in OPERATOR-OUTPUT below.
`.trim();

// ----------------------------------------------------------------------------
// printOperatorWalkthrough — emits the snippets for the operator.
// ----------------------------------------------------------------------------
function printOperatorWalkthrough() {
  const lines = [];
  lines.push('='.repeat(78));
  lines.push('Plan 04.2-03 Task 1 — Carrier-survival probe — OPERATOR WALKTHROUGH');
  lines.push('='.repeat(78));
  lines.push('');
  lines.push('Target: live Countermoves Paperclip instance');
  lines.push('  URL: https://countermoves.gl3group.com');
  lines.push('  Reader tab of an assigned issue (e.g. COU-2215 from the 04.2-02 drill)');
  lines.push('');
  lines.push('Probe order — STOP at the first SURVIVES verdict:');
  lines.push('  1. URL hash  (priority 1, cheapest fix)');
  lines.push('  2. sessionStorage  (priority 2, fallback)');
  lines.push('  3. worker-handoff  (priority 3, NOT PROBED here — last resort)');
  lines.push('');
  lines.push('Each snippet block below is ONE paste into the DevTools console.');
  lines.push('Copy verbatim output back into OPERATOR-OUTPUT section at the bottom');
  lines.push('of this file (or into a captured artifact');
  lines.push(`${path.basename(HERE)}/carrier-survival-<YYYY-MM-DD>.md ).`);
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 1 — URL HASH PROBE — Step A (run on Reader tab)');
  lines.push('-'.repeat(78));
  lines.push(URL_HASH_PROBE);
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 1B — URL HASH PROBE — Step B (run AFTER navigation to /COU/chat#h=...)');
  lines.push('-'.repeat(78));
  lines.push(URL_HASH_PROBE_1B);
  lines.push('');
  lines.push('--- IF Snippet 1 verdict = SURVIVES, STOP and record CARRIER=URL_HASH ---');
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 2 — SESSION_STORAGE PROBE — Step A (run on Reader tab)');
  lines.push('-'.repeat(78));
  lines.push(SESSION_STORAGE_PROBE);
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 2B — SESSION_STORAGE PROBE — Step B (run AFTER navigation to /COU/chat)');
  lines.push('-'.repeat(78));
  lines.push(SESSION_STORAGE_PROBE_2B);
  lines.push('');
  lines.push('--- IF Snippet 2 verdict = SURVIVES, record CARRIER=SESSION_STORAGE ---');
  lines.push('--- IF BOTH 1 and 2 STRIPPED, record CARRIER=WORKER_HANDOFF ---');
  lines.push('');
  lines.push('-'.repeat(78));
  lines.push('SNIPPET 3 — WORKER_HANDOFF NOTE (NOT PROBED)');
  lines.push('-'.repeat(78));
  lines.push(WORKER_HANDOFF_NOTE);
  lines.push('');
  lines.push('='.repeat(78));
  lines.push('OPERATOR-OUTPUT — paste verbatim console output here:');
  lines.push('='.repeat(78));
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('carrier-survival.mjs')) {
  console.log(printOperatorWalkthrough());
}

export {
  URL_HASH_PROBE,
  URL_HASH_PROBE_1B,
  SESSION_STORAGE_PROBE,
  SESSION_STORAGE_PROBE_2B,
  WORKER_HANDOFF_NOTE,
  printOperatorWalkthrough,
};

// ============================================================================
// OPERATOR-OUTPUT (verbatim console output from Countermoves probe run)
// ============================================================================
//
// PENDING — operator has not yet run the probe.
//
// Once Eric reports the verbatim console output, a continuation agent
// records the results below in this format:
//
//   ---
//   ## Snippet 1 — URL HASH
//   - window.location.hash (AT CHAT MOUNT) = "<verbatim>"
//   - window.location.pathname             = "<verbatim>"
//   - history.state                        = "<verbatim JSON>"
//   - Decoded payload                      = "<verbatim>" OR "(decode failed: ...)"
//   - VERDICT: SURVIVES | STRIPPED
//
//   ## Snippet 2 — SESSION_STORAGE  (only if Snippet 1 STRIPPED)
//   - sessionStorage.getItem('clarity-chat-deep-link') = "<verbatim>"
//   - Parsed payload                                   = "<verbatim>"
//   - VERDICT: SURVIVES | STRIPPED
//
//   ## Snippet 3 — WORKER_HANDOFF — NOT PROBED
//   (rationale)
//
//   ## Final chosen carrier: CARRIER=<NAME>
//   Justification: <one-line — cite the verbatim observed value from Snippet 1 or 2>
//   ---
//
// The continuation agent then writes the chosen CARRIER=<NAME> line at the
// CARRIER= comment near the top of this file and proceeds to Task 2.
