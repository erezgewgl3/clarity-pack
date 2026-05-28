# OVERNIGHT FIX BRIEF — Reader crash on YAML-shaped artifact-spec bodies

**Created:** 2026-05-28 ~00:00 UTC at session-end.
**Operator:** asleep. Autonomous session running until success or `OVERNIGHT-REPORT.md` is written.
**Boundary:** **NO PRODUCTION DEPLOYS.** All work is local: diagnose → fix → test → commit → push. Operator deploys via DO Web Console in the morning.

---

## The bug (verbatim from session-end + operator follow-up)

clarity-pack v1.0.0 is live on BEAAA AriClaw. **The Reader tab fails to render on most BEAAA issues.** Confirmed repro: `localhost:3100/BEAAA/issues/BEAAA-828` → click Reader tab → host's error boundary catches the React exception and shows:

> `Clarity Pack: failed to render`

Initial session-end testing on BEAAA-142 showed the Reader surface element present with section headings, which I read as "renders cleanly." Operator follow-up corrected: "Neither does it work for most of the issues. The rendering issue as well." So the **rendering pathology is widespread, not edge-case**. The DOM-presence check I did was misleading — sections may be present in the DOM as placeholders while CONTENT degrades or sub-components crash silently. **Treat this as P0 with wide blast radius, not a narrow YAML-spec edge case.**

### Investigation pivot

The "BEAAA-828 specifically crashes" framing in earlier sections of this brief is now **only one repro**, not the bounding case. The autonomous session should:

- Sample MULTIPLE BEAAA issues (BEAAA-828, BEAAA-142, BEAAA-141, BEAAA-125, BEAAA-138, BEAAA-682, BEAAA-79 — IDs visible in the Properties panel of BEAAA-142's screenshot at session-end).
- Classify which ones crash with the error boundary vs which ones render-but-degrade.
- Identify the FAILURE PATTERN common to the crashing ones — is it body length? specific tokens? null/undefined fields in the issue.reader response? A specific data shape combination?
- Diagnose the underlying UI defect, not just a per-symptom band-aid.

## What's been confirmed working

- The worker handlers are healthy:
  - `POST /api/plugins/.../data/issue.reader` returns **200** with valid 5,177-byte payload for BEAAA-828.
  - `POST /api/plugins/.../data/resolve-refs` returns **200** with the defensive-degradation payload (`title: "BEAAA-706"`, `status: "unknown"`, …).
- All 5 BEAAA hotfixes that shipped tonight are live in the bundle:
  1. SDK bundled into worker.js (`adf858d`) — no host-side SDK resolution drift
  2. `agent.name` carried through `EmployeeSnapshot` + displayed on Situation Room cards (`c4eb677`)
  3. `REF_PATTERN` scoped to current company prefix via `extractCompanyPrefixFromPathname` (`c4eb677`)
  4. `http.outbound` capability declared in manifest (`2af6284`)
  5. `resolve-refs` + `issue-reader` use absolute URLs + defensive degradation when `ctx.http.fetch` is host-blocked (`1d185af`, `b923db1`)

## Crash signal — where to look

The error boundary that catches the throw is **the HOST's** boundary (class `rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive` — Paperclip's shadcn copy). It means **the Clarity Pack `ReaderView` exported component threw at render**.

Both worker handlers respond 200 — so the throw is **inside the UI component tree**, on the data the handlers return, on this specific issue's shape.

### What's special about BEAAA-828

Inspect the `issue.reader` response for `5cc1bc60-73ee-42af-8907-37131bdfeb4d` (BEAAA-828's UUID). The session-end inspection revealed:

- `tldr: null` (Editor-Agent hasn't compiled yet — expected)
- `refCards: []` (defensive degradation returned empty; OK)
- `ancestry.milestone.title` is **>1,000 characters** — the entire "IFA rates and insures AI agents…" pitch paragraph. That's not a normal title; it's an issue's BODY being passed as a milestone.title. **Strong hypothesis: a Reader sub-component renders this string in a context that breaks (overflow, layout, key collision, ellipsis truncation past Unicode boundary, etc.)**.

Other shape clues:
- Body is YAML-shaped with many `<UPPER>-<NUM>` tokens (`BEAAA-704`, `BEAAA-702`, `BEAAA-706`, `BEAAA-577`, `BEAAA-707`, `BEAAA-585`, `BEAAA-13`).
- After the company-prefix-scoped REF_PATTERN fix, only `BEAAA-*` tokens are chip candidates — `PAGE-1`, `DAY-3`, `GATE-2` are no longer matched (verified via the patched regex).
- The host's own body auto-linker still 404s on `PAGE-1` / `DAY-3` (Paperclip-side, not clarity-pack — ignore).

## Investigation plan (do this in order)

1. **Reproduce locally.** The SSH tunnel from the operator's machine to BEAAA may or may not still be alive — try `fetch('http://localhost:3100/...')` from Playwright at the start. If reachable, snapshot the full `issue.reader` payload for BEAAA-828 (`POST /api/plugins/.../data/issue.reader` with `companyId: 59f8876e-e729-4dda-98f9-1317c2b50492`, `params: { issueId: "5cc1bc60-73ee-42af-8907-37131bdfeb4d", userId: "local-board" }`). Save it as a fixture at `test/fixtures/beaaa-828-reader-payload.json` (do not commit the file if it contains PII; use sanitized synthetic version that matches the structural pathology).

2. **If tunnel is dead:** construct a synthetic fixture that reproduces the pathology. Per session diagnosis: a `Reader` data payload where `ancestry.milestone.title` is a 1,000+ char string (full lorem-ipsum-shaped paragraph) + body contains 10+ `BEAAA-NNN` tokens.

3. **Render the Reader in a jsdom-backed unit test.** The codebase already uses `node --test`. Add a new test file `test/ui/surfaces/reader/reader-yaml-body-render.test.mjs` that:
   - Mocks `usePluginData('issue.reader', …)` to return the synthetic pathological payload
   - Mocks `usePluginData('resolve-refs', …)` to return defensive-degraded refs
   - Mocks `useHostLocation` + `useHostNavigation` + `useResolvedUserId` (existing patterns in the codebase — copy from `test/ui/surfaces/situation-room/*.test.mjs`)
   - Calls `renderToStaticMarkup` or `renderToString` from `react-dom/server` on `<ReaderView ... />`
   - **Asserts the render does NOT throw.**
   - If it throws, the test catches the error and asserts the error message contains diagnostic info pointing to the offending component.

4. **Once the test reproduces the crash**, fix the offending component. Likely candidates (in priority order):
   - `src/ui/surfaces/reader/anchored-to.tsx` (renders ancestry, including milestone) — long milestone.title is the prime suspect
   - `src/ui/surfaces/reader/prose-with-ref-chips.tsx` (renders body with chip parsing) — may choke on long bodies with many matches
   - `src/ui/surfaces/reader/recent-activity.tsx` (renders comments — may have a fragile key/list pattern)
   - `src/ui/surfaces/reader/reader-view.tsx` (the top-level — may have a null-deref on ancestry shape)
   - `src/ui/primitives/ref-chip.tsx` (consumes resolve-refs result — may throw on unresolved/null shape)

5. **The fix should be DEFENSIVE.** Wrap risky renders in `<ErrorBoundary>` per-section so ONE bad section doesn't take down the whole Reader. The codebase may already export an `ErrorBoundary` primitive — search before adding.

6. **Add the regression test passing**. Confirm the test fails before the fix, passes after.

7. **Run the full suite + quality gates.**
   - `node --test "test/**/*.test.mjs"` → must not introduce new failures (the 1 pre-existing `situation-artifacts` fixture failure is acceptable)
   - `npx tsc --noEmit` → must be clean
   - `node scripts/check-css-scope.mjs` → must be 139 selectors all scoped
   - `node scripts/check-ui-bundle-size.mjs` → must stay under 696,320 bytes (current ceiling, bumped 2026-05-27)

8. **Rebuild + repack** to verify the tarball builds end-to-end:
   - `node scripts/build-worker.mjs`
   - `node scripts/build-ui.mjs`
   - `npx tsc --project tsconfig.manifest.json`
   - `npm pack`
   - Note the resulting `clarity-pack-1.0.0.tgz` sha256 in the OVERNIGHT-REPORT.

9. **Atomic commit + push to GitHub master.** Commit message follows the codebase pattern (see recent commits like `b923db1`, `c4eb677` for shape). Co-Authored-By trailer.

10. **Write `.planning/OVERNIGHT-REPORT.md`** before exiting (see structure below).

## Deploy (when the operator is present to drive it)

The full, detailed, copy-paste deploy procedure is in **`.planning/DEPLOY-RUNBOOK.md`** — read it before attempting ANY deploy. It covers Path A (scp+SSH) and Path B (DO Web Console + GitHub clone), every gotcha, verification, pm2 recovery, and rollback.

**Autonomy rule:** the deploy itself is operator-gated (it needs SSH access OR the operator to flip repo visibility + drive the DO Web Console). If you are running UNATTENDED, do NOT deploy — finish the fix, commit, push, write the report, and put the exact deploy command block (from DEPLOY-RUNBOOK.md, filled in with this fix's specifics) into the report's "Deploy plan for the operator" section so the operator can one-shot it when they wake. If the operator IS present and asks you to deploy, follow DEPLOY-RUNBOOK.md exactly.

## Boundaries (HARD)

- **NO UNATTENDED production deploys.** If no operator is present, do not scp, ssh, or use the DO Web Console. Stage everything (commit + push + report) for the operator instead. (If the operator is actively present and directs a deploy, DEPLOY-RUNBOOK.md is the procedure.)
- **NO `STATE.md` / `ROADMAP.md` / `REQUIREMENTS.md` edits.** Those are operator-owned.
- **NO git operations beyond `add` / `commit` / `push origin master`.** No force-push, no amend, no rebase, no reset, no `--no-verify`.
- **NO repo visibility changes.** The repo is private. Leave it private.
- **NO changes to `package.json` version or `src/manifest.ts:337` version literal.** v1.0.0 is shipped.
- **NO bumping `@paperclipai/plugin-sdk`** — 2026.525.0 is correct.
- **NO removing the defensive degradation** in `resolve-refs.ts` or `issue-reader.ts`. They're load-bearing for the BEAAA SSRF block.
- **NO touching `MEMORY.md` / `.claude/` / Eric's memory files.**
- **Respect classifier blocks.** If a tool call is blocked by Claude Code's auto-mode classifier, STOP and document in the OVERNIGHT-REPORT — do not work around it.
- **Use `/gsd:debug` skill** if you need a structured multi-cycle debug loop. Otherwise drive with TodoWrite + the Investigation plan above.

## Success criteria

A successful overnight session produces:

1. A new regression test that reproduces the BEAAA-828 Reader crash (RED before fix, GREEN after).
2. A defensive fix in the offending component(s).
3. A green local test suite (1917+ passing, 1 pre-existing fixture fail allowed, 2 skipped — the count from session-end).
4. Green `tsc --noEmit`, `check-css-scope`, `check-ui-bundle-size`.
5. A rebuilt + repacked `clarity-pack-1.0.0.tgz` with the fix included.
6. One or more atomic commits pushed to `origin/master`.
7. `.planning/OVERNIGHT-REPORT.md` written with the contents below.

If you cannot reproduce or cannot fix within reasonable iterations (~6-10 cycles), document the partial progress in the OVERNIGHT-REPORT and stop. **Do not loop indefinitely on a wedged hypothesis.**

## Required `.planning/OVERNIGHT-REPORT.md` structure

```markdown
# Overnight Reader-Crash Fix — Report

**Status:** SHIPPED | PARTIAL | BLOCKED
**Cycles spent:** N
**Time elapsed:** ~Nh

## Diagnosis
[1-2 paragraphs on what was actually broken and where]

## Fix
[Files changed, why, and the specific defensive pattern used]

## Regression test
[Path + assertion shape; before-fix RED / after-fix GREEN]

## Quality gate results
- tsc: clean | N errors
- suite: N pass / N fail / N skip
- css-scope: N selectors, all scoped | violations: …
- ui-bundle-size: N bytes / ceiling N — OK | EXCEEDED
- tarball: clarity-pack-1.0.0.tgz sha256 …

## Commits pushed
- <hash> <subject>
- …

## Deploy plan for the operator
[Exact Web Console paste-block — same shape as session-end Path B]

## Outstanding / known follow-ups
[Things not fixed; reasons]
```

---

## SECONDARY TASK — Editor-Agent compile pipeline appears completely silent

The operator noted two symptoms at session-end:

- **"Compiling TL;DR…" placeholder never resolves** on BEAAA Reader views. Verified on BEAAA-142: the Reader otherwise renders correctly, but the TL;DR box stays in placeholder state indefinitely.
- ~~Bulletin route shows no content~~ — **REMOVED FROM SCOPE 2026-05-27 ~21:55Z** after pm2 log inspection. The `compile-bulletin` job is a cadence gate that runs every minute and correctly defers to `next_due_at = 2026-05-28T10:30:00.000Z` (06:30 ET tomorrow). Every dispatch completes successfully in ~60ms with the bootstrap-next-due-at log line. The bulletin will auto-generate at 10:30 UTC; the empty `/BEAAA/bulletin` route in the meantime is the designed placeholder. **Not a bug.** Do NOT investigate the bulletin cron path in the overnight session.

Both symptoms point at the **Editor-Agent compile pipeline** (compile-tldr heartbeat + compile-bulletin cron). The agent definition is registered (we confirmed at session-end: `Editor-Agent` appears in BEAAA's agent panel sidebar). What's likely failing is the **compile call path**.

**Hypothesized causes** (in priority order):

1. **The Editor-Agent has no LLM adapter configured on BEAAA.** Plugin install registered the agent definition, but the LLM provider (claude_local / process / etc.) must be configured by the operator via Paperclip's agent admin panel. Without it, the agent's heartbeat fires but the compile call has no LLM to invoke. Verify: `npx paperclipai agent list` or inspect via the Paperclip UI's Agents → Editor-Agent panel.

2. **The compile-tldr job uses `ctx.http.fetch` to call the host's `/api/issues/<id>` endpoint** — same SSRF block we hit on `resolve-refs` tonight. Search `src/worker/jobs/` and `src/worker/agents/editor.ts` for `ctx.http.fetch` calls. If found, apply the same defensive degradation pattern as `resolve-refs.ts`, OR refactor to `ctx.issues.get(issueId, companyId)`.

3. **The compile job depends on `ctx.agents.sessions.create` / `sendMessage` (the LLM seam)** which may itself require a capability we haven't declared or a host adapter config the BEAAA install doesn't have.

**Priority:** investigate ONLY after the BEAAA-828 Reader crash is fixed + committed. If the diagnosis takes more than ~2 cycles, document findings in the OVERNIGHT-REPORT under "Outstanding" and stop. The operator will resolve via the Paperclip admin panel if it's the LLM-adapter case.

**Hard rule:** even if you find a code-level fix for the TL;DR pipeline, do NOT change the Editor-Agent's manifest declaration (the `agents[]` field). That's been tested across multiple drills; do not regress it.

---

## NOTE ON UI ARTIFACTS

The Reader's reference chips will continue to show `<KEY> · unknown` (status=unknown, title=key) until the resolve-refs SSRF block is properly worked around (architectural refactor to `ctx.issues.get` parallel calls). That's a known cosmetic degradation, not a crash. The "zero rabbit-holes" PROJECT.md promise is partially broken; the architectural fix is deferred to a planned session, NOT this overnight run.

```
DUMMY-END-MARKER (do not delete — preserves the report-template fence above)

## Lessons / surprises
[Worth filing to MemPalace clarity_pack/runbook]
```

## Reference

- Session-end MemPalace closure drawer: `clarity_pack/decisions/v1.0.0-shipped-to-beaaa-2026-05-27` (drawer_id `drawer_clarity_pack_decisions_f1c8591b3f3b81087e35457e`).
- Tonight's commits on master: `0cc9787`, `91fbc25`, `06da602`, `adf858d`, `c4eb677`, `2af6284`, `1d185af`, `b923db1`.
- Live BEAAA state: AriClaw DO Droplet 46.101.105.87, embedded Postgres on 54329, pm2-beai-agent service, OpenClaw downstream.
- Pre-existing test failure to ignore: `test/worker/handlers/situation-artifacts.test.mjs` line 392 — fixture-only bug, validated against multiple HEADs.
