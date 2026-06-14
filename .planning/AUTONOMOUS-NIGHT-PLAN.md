# AUTONOMOUS NIGHT PLAN — Clarity Pack (no-rabbit-holes hardening)

**For:** a fresh Claude Code window running UNATTENDED overnight. Eric is away from the keyboard and has granted **full autonomous + live-deploy authorization** (see `.claude` memories `autonomous-deploy-authorization`, `feedback_countermoves-throwaway-credential`). Drive this end-to-end, deploy to live BEAAA, verify, and write `.planning/MORNING-REPORT.md`. **Do not wait for human input** unless a STOP rule below is hit.

**Starting state (2026-06-15):** Phase 18 CLOSED, live on BEAAA at **v1.7.1**, `status=ready`. All surfaces render (a blank-UI incident was fixed tonight). Working tree on `master`, clean except untracked screenshots/scratch. `node_modules` is installed. Read `.planning/phases/18-no-rabbit-holes-plain-english/18-04-SUMMARY.md` and the memory `phase-18-closed` first for full context.

---

## OPERATING RULES (read before doing anything)

1. **Atomic commits**, conventional messages, end every commit body with:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
2. **Test before deploy.** `npx tsc --noEmit` clean + `node --test "test/**/*.test.mjs"`. KNOWN-ACCEPTABLE failures (do NOT try to fix, do NOT treat as regressions): the Playwright visual/sticky tests (browser binaries not installed) and the pre-existing CHAT-01..11 / CTT-01..08 traceability-debt rows. Any OTHER failure is yours to fix or revert.
3. **One consolidated deploy.** Implement + locally test ALL of tonight's code changes FIRST, then do ONE version bump + ONE deploy at the end (minimizes live-box risk + fail2ban exposure). Only re-deploy if a fix depends on live behavior you must observe.
4. **Data safety (hard):** NEVER `plugin uninstall --force` (purges namespace data). NEVER psql the embedded PG. Migrations additive-only. Bookend = DO automated daily backups (already on); no manual snapshot needed for code-only deploys.
5. **fail2ban discipline:** batch SSH into ≤2 connections per deploy (one scp, one install heredoc). If SSH starts timing out, fail2ban is engaged — wait 20 min and retry (use a Bash background sleep loop / Monitor; do NOT hammer). The DO Web Console (Path B) is out-of-band but interactive — avoid unless stuck.
6. **STOP-and-report (write to MORNING-REPORT.md and move to the next item, do NOT guess) if:** a fix isn't cleanly fixable in-plugin (e.g. needs a host change), a deploy fails twice, schema/data would be mutated, a test regression you can't resolve in ~2 attempts, or anything destructive/irreversible. Skipping an item with a clear note is SUCCESS; guessing on a risky change is FAILURE.
7. **Scope discipline:** do the tiers in order. Don't start a higher tier until the lower one is committed + green. It's fine to not finish everything — finish cleanly and report.
8. Each surface/UI change you can, **verify live** (see VERIFY section). If live visual verification is unavailable (Playwright auth lapsed), fall back to programmatic checks + flag the item "needs Eric eyeball (2 min)" in the morning report.

---

## WORK QUEUE (priority order)

### TIER 1 — in-plugin "no rabbit holes" fixes (do all; highest value, ours to fix)

**T1-A. Unresolved-reference 404 loop.** The host/page repeatedly fetches `GET /api/issues/<weekly-issue-id>#document-<weekly-doc-key>` (literal unresolved placeholders) every ~2-4s — visible in the Reader/issue console. An unresolved reference IS a rabbit hole.
- Investigate the emitter: is Clarity's ref-resolution (`src/worker/handlers/resolve-refs.ts`, `issue-reader.ts`, or a UI ref chip) generating a link from a literal `<…>` template placeholder found in a task body/deliverable? Use `/gsd:debug` discipline (reproduce → root-cause → fix).
- **Acceptance:** literal angle-bracket placeholder refs (`<…>`) are NOT emitted as fetchable URLs/links; they render as inert plain text (or are dropped) — no repeating 404. Add a test. If the emitter turns out to be host code (not Clarity), STOP-and-report with evidence (out of our control).

**T1-B. Deliverable inline preview.** On BEAAA-972 the Reader showed "Preview unavailable — open in classic Paperclip" — a miss on "every deliverable previewed in place."
- Root-cause why preview is unavailable. Strong suspect: the host's SSRF block on `ctx.http.fetch` to localhost/private IPs (DEPLOY-RUNBOOK §Pitfalls #275; handled defensively in `resolve-refs.ts`/`issue-reader.ts`). Determine which deliverable types fail and whether an in-plugin path exists (e.g. `ctx.issues.documents` read instead of an http fetch, correct capability/absolute URL).
- **Acceptance:** at least the common deliverable types preview inline in the Reader; document any type that genuinely cannot (with the reason). If the only path is a host change, STOP-and-report with the specific limitation.

**T1-C. Blocker-chain "single named human action" completeness.** Needs-you rows flatten well, but Watch-list rows showed endpoints like `BEAAA-663 — agent stuck`. Confirm EVERY blocked/needs-you row terminates in a *named human action* (or an honest "assign an owner" affordance), not an "agent stuck" dead-end that forces a drill.
- Audit `flatten-blocker-chain` / `build-employees-rollup` / `org-blocked-backlog` render paths. Where a chain ends in "agent stuck" with no actionable next step, ensure it surfaces the named human action or the assign/open affordance.
- **Acceptance:** no needs-you/Watch row renders a terminal "agent stuck" with no actionable affordance; add/extend a test. If the data genuinely has no human action (truly autonomous), the honest "moving · no action needed" / "assign an owner" wording is acceptable.

**T1-D. Self-health check (the blank-UI would have been caught).** The whole UI was blank for days with no signal. Add a lightweight health surface: on Clarity surface mount, detect "plugin worker not ready / bundle/contributions mismatch" and render an honest banner instead of a silent blank; optionally a worker-side `plugin health`-style self-report.
- **Acceptance:** if a Clarity surface cannot mount its data (worker error / not-ready), the user sees an explicit "Clarity is reloading / unavailable — <reason>" message, never a blank frame. Add a test for the error/degraded path. Keep it tiny and degrade-safe; do NOT touch the Phase-16 perf floor or add new DB reads on the hot path.

### TIER 2 — Phase 20 hygiene (do if Tier 1 is committed + green; low risk, high "honestly-green" value)
- Resolve the 7 CHAT-01..11 / CTT-01..08 traceability-debt rows (add the missing REQUIREMENTS.md rows OR formally mark them deferred — see `18-VERIFICATION.md` for what's missing). Goal: the suite is honestly green except genuine env (Playwright browser) gaps.
- Refresh any stale version label; confirm DO automated backups are ON (the continuous-deploy bookend). Requirements HYG-01..04 in ROADMAP.md.
- Use `/gsd:execute-phase 20` if you want full GSD structure, or do it directly — your judgment.

### TIER 3 — only if everything above is clean AND you have clear runway (higher risk; slip-safe)
- **Phase 19 — Action-cards async re-architecture (flag-gated, LAST feature phase).** See ROADMAP.md Phase 19 (CARD-01/02/03). This is the biggest item and the named-action prose payoff, but it's complex. If you start it, follow `/gsd:plan-phase 19` then `/gsd:execute-phase 19`; keep `ACTION_CARDS_ENABLED` gated; it is explicitly slip-safe to v1.6 — **leaving it PLANNED-not-executed is an acceptable outcome.** Do NOT half-ship it.

### ALWAYS — pure docs (safe, do regardless)
- **Host-feature ask for Open↗ auto-land.** Write `.planning/HOST-ASK-reader-tab-deeplink.md`: a crisp request to the Paperclip team to honor `?tab=<slot>` / `#tab=<slot>` OR add a detailTab `defaultTab` hint, with the live probe evidence from `scripts/probes/reader-tab-deeplink.mjs` (TIER1_HONORED=false). This unblocks the #1 rabbit-hole (Open↗ lands on default tab, not the Reader) which is NOT fixable in-plugin.

---

## BUILD / DEPLOY (one consolidated pass at the end)

Reference: `.planning/DEPLOY-RUNBOOK.md` (authoritative) + tonight's confirmed gotchas below.

1. Two-source version bump **1.7.1 → 1.7.2** (or 1.8.0 if Phase 19 lands): `package.json` AND `src/manifest.ts` byte-identical. Verify `dist/manifest.js` carries it.
2. Build: `node scripts/build-worker.mjs && node scripts/build-ui.mjs && npx tsc --project tsconfig.manifest.json`. (The `pnpm build` script's nested `pnpm` calls fail in some shells — run the three steps directly. Use `corepack pnpm exec tsc …` if `pnpm` isn't on PATH.) Sanity: `grep -c paperclipInvocation dist/worker.js` must be **≥5** (SDK bundled, not externalized). Then `npm pack`.
3. Self-open a tunnel from Bash (Eric's may be gone): `ssh -f -N -L 3100:localhost:3100 ariclaw` (alias preconfigured; key works from Bash).
4. Upload + install (≤2 SSH connections): `ssh ariclaw 'rm -f /tmp/clarity-pack-<v>.tgz'` → `scp clarity-pack-<v>.tgz ariclaw:/tmp/…` → then ONE heredoc `ssh ariclaw bash <<'EOF' … EOF` that: chowns to beai-agent, `plugin uninstall clarity-pack` (clean — NOT --force), unpack + `npm install` + `plugin install /tmp/clarity-pack-build/package`, sleep, `plugin list | grep clarity`; if status != ready, `plugin enable clarity-pack` (self-heal), re-check. Expect `status=ready version=<v>`.
   - Gotcha: the real data volume is `/mnt/paperclipdata/dot-paperclip` (the `.paperclip` is a symlink — `find` won't follow a symlinked start path; use `-L` or the resolved path).
   - Gotcha: do NOT `pm2 restart` to clear a stuck worker — it can cause `EADDRINUSE :3100` flapping. A clean uninstall+install (healthy worker) or `plugin enable` is the right path.

## VERIFY (after deploy)

- Programmatic (always do): `ssh ariclaw "… plugin list | grep clarity"` → `status=ready version=<v>`; `curl -m10 -o /dev/null -w '%{http_code}' http://localhost:3100/` → 200.
- Live visual (try; may need Eric's auth): Playwright MCP `browser_navigate http://localhost:3100/BEAAA/situation-room` then `browser_snapshot`. If it shows the logged-in app, run the per-item checks (Reader on BEAAA-972, the leak-scan `evaluate`, deliverable preview, no `<weekly-…>` 404 in console). Pattern: to activate the Reader detailTab, set `el.id='__t__'` on the "Reader" button via `browser_evaluate` then `browser_click` `#__t__` (a JS `.click()` does NOT switch the host tab). Scan INSIDE the largest `[class*="clarity-reader"]` element (the classic body is always visible above the tab bar and is NOT Clarity).
- **If Playwright hits a login wall / can't reach** → do NOT block. Record the item as "code+deploy verified; live visual needs Eric eyeball (2 min)" in MORNING-REPORT.md with the exact URL + what to look for.

## MORNING REPORT (the deliverable)

Write `.planning/MORNING-REPORT.md`: for EACH item — DONE-&-verified / DONE-needs-eyeball / DEFERRED-with-reason / NOT-STARTED — with commit hashes, the live version shipped, what you verified and how, any STOP-rule hits, and a 3-line "what Eric should glance at" list. Be honest; a smaller set done-and-proven beats a large set half-done.

## RESUME

If interrupted (`/compact`, crash), re-read THIS file + MORNING-REPORT.md (your running log) + `git log` to see what's committed, and continue from the first incomplete item. This file is the source of truth.
