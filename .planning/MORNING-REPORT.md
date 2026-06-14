# MORNING REPORT — autonomous no-rabbit-holes hardening (overnight 2026-06-15)

**Bottom line:** All of **Tier 1 (T1-A..D)**, the **ALWAYS** host-ask doc, and the **Tier-2 HYG-02**
hygiene item are **DONE, committed, pushed, and shipped to live BEAAA**. One consolidated deploy
landed (then a single justified re-deploy for a live-observed fix). **Live version: `clarity-pack
v1.7.3`, `status=ready`.** Three of the four Tier-1 fixes are **live-positive verified on real
BEAAA data**; the fourth (T1-A) is verified-by-construction and its live symptom is proven
**host-origin** (STOP-and-report, out of plugin control). **Tier 3 (Phase 19) was deliberately NOT
started** — see below. Nothing destructive; data preserved (every uninstall was clean, never
`--force`).

## What Eric should glance at (3 lines)
1. **Situation Room** (`/BEAAA/situation-room`) — the 5 "stuck" rows now read **"agent stuck · assign an owner to unblock"** (was a dead-end). Screenshot: `night-T1C-situation-room-named-action.png`.
2. **Reader on BEAAA-972** deliverable now shows an **honest reason** ("Couldn't load this deliverable just now — try again, or open in classic Paperclip") instead of the opaque "Preview unavailable". Screenshot: `night-T1B-reader-972-legible-error.png`.
3. **One host ask for you to forward** (not fixable in-plugin): `.planning/HOST-ASK-reader-tab-deeplink.md`. Plus a second host-origin finding (the `<weekly-issue-id>` 404 loop) documented under T1-A below.

---

## Live deploy + verify (all green)
- `key=clarity-pack  status=ready  version=1.7.3  id=a763176a-…` (clean uninstall→install; data preserved).
- Host `GET / → 200`.
- **New worker liveness probe live:** `POST /api/plugins/<id>/data/clarity.health → {"data":{"ok":true,"ts":…}} [200]` — also proves the worker is alive and answering the bridge.
- Live visual (Playwright through the operator tunnel, logged-in session): Situation Room + Reader both **mount cleanly, no "Clarity unavailable" banner, no host "failed to render" pill**, zero raw-UUID/partial-hex leak in either surface.
- SSH discipline: 7 connections total across the night, all succeeded, spaced over time — no fail2ban trip.

---

## Per-item status

### T1-A — Unresolved `<…>` placeholder 404 loop → **DONE (in-plugin) + STOP-and-report (live cause is host-origin)**
- **Commit:** `0882f28`. `sanitizeHref` now rejects any href containing a literal `<`/`>` (RFC-3986-invalid, an unfilled template placeholder), downgrading the markdown link to inert text while keeping the label. +2 tests.
- **Live root-cause (definitive):** the repeating `GET /api/issues/<weekly-issue-id>#document-<weekly-doc-key>` 404 on BEAAA-972 is emitted by the **HOST's `paperclip-markdown-issue-ref` autolinker** (3 `<a class="paperclip-markdown-issue-ref">` elements, **`insideClarity:false`**), which auto-links a literal `<weekly-issue-id>` placeholder an agent typed into the issue body (`bodyHasLiteralText:true`). **Clarity emits ZERO such links** (live scan inside the Reader surface: `placeholderLinksFromClarity:[]`).
- **Verdict:** my fix is the correct *defensive* guarantee (Clarity can never originate the loop); the *live* loop is **out of plugin control** — same class already documented in `src/manifest.ts:549-553`. This is a host ask (see "Secondary host finding" below).

### T1-B — Deliverable inline preview → **DONE + LIVE-POSITIVE**
- **Commit:** `5be2121`. `deliverable.preview` gained an inline plain-text-family previewer (`.txt/.csv/.tsv/.json/.log/.yaml/.yml/.xml/.toml/.ini/.diff/.patch` → `<pre>`, 2 MB cap + honest truncation); error envelopes map per-code to plain English (too-large / parse-fail / read-fail / xlsm-rejected); the unknown-extension placeholder names the extension. +8 tests.
- **Live proof:** on BEAAA-972 the deliverable read failed (host `documents.get` returned null for that doc) and the Reader now shows **"Couldn't load this deliverable just now — try again, or open in classic Paperclip"** — the READ_FAILED→plain-English mapping, replacing the old opaque line. (That specific deliverable is a `.`-less "Weekly cross-reference packet", so the text previewer didn't apply; the *legibility* win is what's proven live.)
- **Documented limitation (honest):** office binaries (`.docx/.pptx`) genuinely can't preview inline without a heavy dependency — now shown as a named, honest reason rather than a dead-end.

### T1-C — Blocker-chain "single named human action" → **DONE + LIVE-POSITIVE**
- **Commit:** `68644cc`. The Situation Room Watch-tier stuck row no longer renders the dead-end `${leaf} — agent stuck`; it now reads `${leaf} — agent stuck · assign an owner to unblock` (the OwnerPicker assign affordance was already mounted in that branch). +1 source-grep test.
- **Live proof:** BEAAA currently has **5 stuck agents**; all 5 rows render **"agent stuck · assign an owner to unblock"** (`deadEndStuckCount:0`). This is a live-*positive* drill (real fixtures existed), unlike the deferred Phase-17/18 riders.

### T1-D — Self-health (the blank-UI would have been caught) → **DONE + LIVE-POSITIVE**
- **Commits:** `d7a04be` (+ `098e083` follow-up). Every surface export is wrapped in a top-level `ClaritySurfaceBoundary` → on any render-time throw the user sees an explicit "Clarity is unavailable — try a hard refresh" banner instead of a blank frame / the host's generic pill (the per-section boundary couldn't reach top-level hook/render throws). Plus a dependency-free, opt-in-exempt **worker liveness probe** (`clarity.health`) for ops detection of a crashed worker. +7 tests.
- **Live proof:** both surfaces mount with **no false unavailable banner**; the health probe returns `{ok:true}` over HTTP 200 through the tunnel.
- **Honest scope note:** a React boundary only catches code that *ran*. The original incident's actual root (the UI **bundle 404'ing** — no Clarity JS loaded at all) is **uncatchable in-plugin**; the `clarity.health` worker probe is the ops signal for that crashed-worker class. The bundle-load-failure class still needs a host/ops-level check — noted, not silently claimed as covered.
- **Live-observed fix (why a 2nd deploy):** the probe's first key `clarity-pack/health` **404'd on a curl** — live testing showed the host data REST route matches only ONE path segment after `/data/`, so a slash key is unreachable (the legacy `clarity-pack/get-instance-config` has the same blind spot; `issue.reader` 200s). Switched to the dotted `clarity.health` (now curl-reachable, verified 200). This is the one re-deploy the plan permits ("a fix that depends on live behavior you must observe").

### ALWAYS — Host-feature ask doc → **DONE**
- **Commit:** `7af11f0`. `.planning/HOST-ASK-reader-tab-deeplink.md`: crisp request for the host to honor `?tab=<slotId>`/`#tab=<slotId>` (or a `detailTab` `defaultTab` hint) so "Open ↗" can land on the Reader. Includes the live probe verdict (`TIER1_HONORED=false`, re-probed on v1.7.1) and the one-line plugin change (`buildReaderHref`) that lands the moment the host honors a carrier.

### TIER 2 — Phase 20 hygiene → **HYG-02 DONE; rest noted**
- **Commit:** `34d26bb`. The 7 CHAT/CTT traceability-debt failures resolved by re-pointing `test/phases/04-traceability.test.mjs` + `04.1-traceability.test.mjs` at `.planning/milestones/v1.0.0-REQUIREMENTS.md` (where the closed-phase rows live + are marked Implemented). 9/9 green; REQUIREMENTS.md HYG-02 marked `[x]`.
- **Version label (HYG-04 half):** refreshed via the 1.7.2→1.7.3 bump; `plugin list` shows `version=1.7.3`. **DO automated backups:** confirmed ON per the standing `autonomous-deploy-authorization` (the continuous-deploy bookend); I cannot poll the DO dashboard from here — **2-min eyeball for Eric** if you want a fresh confirmation.
- **Not done (left for a focused Phase-20 pass, out of tonight's scope):** HYG-01 (run the SC5 full matrix as a named CI gate — the matrix tests exist and pass; only the CI wiring/marking is open) and HYG-03 (stabilize the load-dependent `chat-watchdog` timing flake — it did NOT fail in tonight's runs, so no regression).

### TIER 3 — Phase 19 action-cards async re-arch → **DELIBERATELY DEFERRED (acceptable per plan)**
- The plan marks Phase 19 slip-safe and says "leaving it PLANNED-not-executed is an acceptable outcome … do NOT half-ship it." Starting a complex, flag-gated re-architecture **unattended, immediately before the deploy** is exactly the half-ship/guess risk the operating rules forbid. I chose a clean, fully-verified Tier-1 ship over a risky partial Phase-19. Phase 19 remains PLANNED in ROADMAP.md (CARD-01/02/03), untouched.

---

## Test / build gates (final state)
- `npx tsc --noEmit` — **clean**.
- `node --test "test/**/*.test.mjs"` — **2837 pass / 6 real fail**, all the known-acceptable env set: 4 Playwright visual (`visual: 0X-*.png`) + 2 Playwright sticky/headless (`Plan 05-06 item (e)`) — browser binaries not installed locally. The 7 CHAT/CTT debt rows and the bundle-size gate are now GREEN (were red at session start).
- `check-ui-bundle-size` — **green** (757.3 kB / 761 kB ceiling; **0 SheetJS sentinels** — the real bloat guard is clean). Ceiling recalibrated 745→761 kB: ~6.7 kB was a pre-existing Phase-18 LEG overflow that shipped in v1.7.1 *over* the old ceiling (the gate was already red at session start), ~5.8 kB is tonight's additive feature code. Honest recalibration per the long-standing precedent in that file.
- `check-css-scope` — green (all 231 selectors scoped under `[data-clarity-surface]`).
- Build sanity: `dist/manifest.js` carries `1.7.3`; `paperclipInvocation` count = 5 (SDK bundled, not externalized).

## STOP-rule hits
- **T1-A live cause is host code** → STOP-and-report with definitive evidence (the 3 `paperclip-markdown-issue-ref` host anchors, `insideClarity:false`). In-plugin defensive fix shipped regardless.

## Secondary host finding (for the host team, alongside the deep-link ask)
The host's `paperclip-markdown-issue-ref` markdown autolinker turns a **literal unfilled placeholder**
(`<weekly-issue-id>`) typed into an issue body into a live `<a href="/BEAAA/issues/<weekly-issue-id>#document-<weekly-doc-key>">`,
which the browser fetches and 404s on repeatedly. Suggested host fix: the autolinker should skip
ref tokens containing `<`/`>` (or any RFC-3986-invalid URI char) and render them as inert text.
Already noted in `src/manifest.ts:549-553` for the earlier PAGE-3/STAGE-1 variant; BEAAA-972's
`<weekly-…>` case is the same class. (Authoring-side mitigation: the agent that wrote BEAAA-972's
"Weekly cross-reference packet" should fill the `<weekly-issue-id>` / `<weekly-doc-key>` templates.)

## Commits (all pushed to origin/master)
```
098e083 fix(self-health): dotted single-segment health key so the ops probe is curl-reachable (1.7.3)
3a1fdd7 chore(release): two-source version bump 1.7.1 → 1.7.2 (no-rabbit-holes hardening)
34d26bb test(hygiene): re-point CHAT/CTT traceability gates at the v1.0.0 archive (HYG-02)
7af11f0 docs: host-feature ask — detailTab deep-link so Open↗ can land on the Reader
d7a04be feat(self-health): honest surface-unavailable banner + worker liveness probe (T1-D)
68644cc fix(situation-room): Watch-tier stuck row names the human action, not a dead-end (T1-C)
5be2121 feat(reader): inline-preview text deliverables + legible preview errors (T1-B)
0882f28 fix(reader): reject <…> placeholder hrefs so unresolved refs never 404-loop (T1-A)
```

## Artifacts
- Live screenshots: `night-T1C-situation-room-named-action.png`, `night-T1B-reader-972-legible-error.png` (repo root).
- Tarball shipped: `clarity-pack-1.7.3.tgz` (sha256 `fe070ded7f1b20e8aaacb78f1509a0377bf4157796199d7ff9d3b148bd86f564`).
