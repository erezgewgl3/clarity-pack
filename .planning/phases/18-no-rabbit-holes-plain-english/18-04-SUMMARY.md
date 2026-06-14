---
phase: 18-no-rabbit-holes-plain-english
plan: 04
status: complete
requirements: [LEG-01, LEG-02, LEG-03]
version_shipped: 1.7.1
completed: 2026-06-15
---

# 18-04 SUMMARY — Ship Phase 18 to live BEAAA + live drill

## Outcome

Phase 18 (LEG-01 + LEG-02 + LEG-03) is **live on BEAAA at v1.7.1**, `status=ready`. The deploy
also **resolved a pre-existing production incident**: the entire Clarity UI had been rendering
blank on v1.6.0. The live drill passed LEG-01/02 with one gap caught-and-fixed in-flight
(LEG-02 Reader activity-actor UUID leak → fixed in 1.7.1 and re-verified live). LEG-03's
present-case has no live fixture and is unit-test-proven (live-positive deferred, Phase-17 pattern).

## Version trail

- Two-source bump 1.6.0 → **1.7.0** (package.json + src/manifest.ts byte-identical; dist/manifest.js verified) — commit 4e09620.
- Gap fix (Reader activity-actor scrub) — commit 3f06cc7.
- Two-source bump 1.7.0 → **1.7.1** — commit 6031042.
- Built worker (SDK bundled, paperclipInvocation=5) + UI + manifest; `npm pack` → clarity-pack-1.7.1.tgz (sha 8e748dbc…).

## Bookend (Task 2)

Rollback bookend = DO automated daily backups (the safety-CLI snapshot tooling does NOT apply to
this box; DO snapshot restore is the rollback path). Deploy is **code-only — NO new schema
migration** (migrations through 0018 already applied; 18-03's closeAsDone reuses issues.update),
so the additive-only/data-preservation guarantees hold by construction. Per autonomous-deploy
authorization + the already-degraded (blank-UI) state, the daily backup satisfied the bookend.

## INCIDENT resolved — blank Clarity UI on BEAAA v1.6.0

Root cause established by live diagnosis (tunnel + SSH):
- Every Clarity surface rendered as the host's empty slot frame; `ui-contributions` returned 304
  (registration intact, so tabs/nav showed) but the **UI bundle 404'd** (`index.js?v=…`).
- The plugin's UI bundle was missing on disk (real data volume is `/mnt/paperclipdata/dot-paperclip`
  via the `.paperclip` symlink — earlier finds returned empty only because `find` doesn't follow a
  symlinked start path).
- The worker log showed `listen EADDRINUSE 127.0.0.1:3100` — the plugin **worker had crashed** on a
  port-bind conflict during the fail2ban-interrupted v1.6.0 deploy (2026-06-11), leaving a stale
  "worker already registered (crashed)" entry that blocked re-activation.
- Fix: clean reinstall put the bundle back; `plugin enable` on the freshly-restarted host (empty
  worker registry) activated to `status=ready` **without `--force`**, so plugin namespace data
  (chat topics, TL;DR cache, action cards) was preserved.

## Live drill verdict (v1.7.1, verified via Playwright through the operator tunnel)

| Requirement | Result | Evidence |
|---|---|---|
| Deploy / blank-UI | ✅ PASS | All surfaces render; `key=clarity-pack status=ready version=1.7.1`; host `GET / 200` |
| **LEG-01** Open↗→Reader | ✅ PASS (Tier-2) | Inline cross-refs funnel through `buildReaderHref` → `/BEAAA/issues/<id>` (no carrier). **Acceptance-risk flagged, not absorbed:** Tier-2 lands on the classic tab unless the host adds a tab-deep-link; Tier-1 probe deferred (re-runnable now that the Reader renders). |
| **LEG-02** Situation Room | ✅ PASS | DOM scan: rawUUIDs=[], agentHex=[], chtHex=[], runHex=[] |
| **LEG-02** Chat | ✅ PASS (no live data) | Scan clean; no chat topics exist on BEAAA → chip humanization is unit-test-proven (chat-chip-humanized), not live-exercised |
| **LEG-02** Reader | ✅ PASS (gap fixed) | Reader panel scan clean; activity actors resolve to real names ("Claims Architect", "Head of Compliance", "Head of Underwriting & AI Risk") or readable "local-board" — previously leaked full UUIDs (54d017b2…, 93e0b62b…). Screenshot: v1.7.1-BEAAA-972-reader-actors-resolved.png |
| **LEG-03** affordance | ◑ PARTIAL | Correctly **absent** on BEAAA-972 (not done-but-blocked) and on the 2 needs-you SR rows (none has a done-phrase TL;DR). No live done⊥blocked fixture exists right now → present-case unit-test-proven (looks-done-affordance, looks-done), live-positive deferred (Phase-17 pattern). |
| PERF | ✅ (by construction) | Phase-16 SWR floor unchanged; 18-03 added ONE O(1) batched degrade-wrapped read (tldr-bodies-batch unit-proven); SR rendered promptly in the live session. |

## Gap caught + fixed in-flight (LEG-02)

The live drill found the Clarity Reader's recent-activity timeline leaked raw comment-author UUIDs
(`commentToActivity` set actor = authorUserId/authorAgentId verbatim; `activity-timeline.tsx` rendered
`{e.actor}`). A pre-existing leak LEG-02 should have covered but missed. Fix (3f06cc7, worker-only):
- Floor: every actor passes `rescrubPersisted` → no UUID/`agent#<hex>` can reach the UI.
- Quality: `resolveActivityAuthorNames` resolves UUID/partial-hex authors via `ctx.agents.get`
  (deduped, O(unique authors), carried-name short-circuit), degrade-safe to AGENT_FALLBACK.
- Readable non-UUID authors (e.g. "local-board") preserved.
- 7/7 new tests (issue-reader-activity-actor-scrub); never emits UUID_RE/PARTIAL_HEX_RE.

## Pre-existing secondary findings (logged, OUT of Phase-18 scope)

1. **`<weekly-issue-id>` 404 poll** — the host/page repeatedly fetches
   `/api/issues/<weekly-issue-id>#document-<weekly-doc-key>` (a literal unresolved placeholder) every
   ~2-4s. Present on v1.6.0 too. A legibility/correctness smell worth a follow-up (likely a malformed
   deliverable/ref URL); not part of LEG-01/02/03.
2. **Classic task-body raw UUIDs** — agents typed strings like "Head of Compliance (uuid)" into task
   descriptions; the host's classic markdown renders them. Out of Clarity's control (Clarity does not
   render the classic body); a content/authoring issue, not a Clarity leak.

## Riders / follow-ups

- LEG-01 Tier-1 re-probe (host tab-deep-link) now possible on the working Reader → optional one-line
  upgrade if the host honors `?tab=`/`#tab=`.
- LEG-03 live-positive demo (affordance present on a real done⊥blocked item) — re-drill when such an
  item exists.
- Deploy lesson: fail2ban trips after ~6-9 rapid SSH connections; batch upload+install into ≤2
  connections and prefer `plugin enable` self-heal over pm2 restart (avoids EADDRINUSE flapping).

## Verification

- Two-source byte-identical bump; tarball built; full suite green except the known env/debt set
  (Playwright browser-not-installed visual/sticky + pre-existing CHAT/CTT traceability-debt rows).
- `status=ready version=1.7.1` on BEAAA; surfaces render; Reader actors scrubbed (live-verified).
