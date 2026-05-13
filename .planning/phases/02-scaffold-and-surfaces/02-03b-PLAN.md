---
plan: 02-03b
phase: 2
phase_name: scaffold-and-surfaces
wave: 3.5
type: gap-closure
parent_plan: 02-03
depends_on: ["02-03"]
gap_closure: true
autonomous: false
files_modified:
  - src/worker/handlers/issue-reader.ts
  - src/worker/handlers/flatten-blocker-chain.ts
  - src/worker/handlers/editor-pause-status.ts
  - src/ui/surfaces/reader/index.tsx
  - src/ui/surfaces/reader/breadcrumb.tsx
  - src/ui/surfaces/reader/prose-with-ref-chips.tsx
  - src/ui/surfaces/reader/deliverable-preview.tsx
  - src/ui/surfaces/reader/ref-card.tsx
  - test/worker/issue-reader-integration.test.mjs
  - runbook/install-walkthrough.md
  - scripts/install-helper.sh
requirements:
  - "02-03 drill defect #1 — issue.reader handler returns thin data"
  - "02-03 drill defect #2 — flatten-blocker-chain returns 502"
  - "02-03 drill defect #3 — React key warnings on ClaritySurfaceRoot + AnchoredToCards"
  - "02-03 drill defect #4 — npm install kludge for local-path plugin install"
must_haves:
  truths:
    - "issue.reader handler returns body, ancestry, refCards, deliverable populated from Paperclip's ACTUAL API shapes (empirically verified against running Countermoves, not assumed from spec)"
    - "flatten-blocker-chain handler does not return 502; either returns the typed terminal or a graceful null"
    - "Every React list (.map) in ClaritySurfaceRoot + AnchoredToCards + ProseWithRefChips uses unique key props"
    - "Local-path plugin install no longer requires manual `npm install` in extracted dir — either bundled via scripts/install-helper.sh OR the SDK is bundled into worker.js OR documented as a known step in runbook/install-walkthrough.md"
    - "Reader tab on Countermoves renders ALL 7 mockup elements (Breadcrumb, TldrStrip, ProseWithRefChips with chips visible, AnchoredToCards with substantive excerpts, DeliverablePreview, AcChecklist, ActivityTimeline, LiveBlockerPanel) for a test issue with BEAAA-NNN refs in body"
  artifacts:
    - path: "test/worker/issue-reader-integration.test.mjs"
      provides: "Integration test that invokes the handler against a STUBBED Paperclip ctx with the ACTUAL shapes observed on Countermoves (body in correct field, ancestry method existence, etc.)"
      exports: []
    - path: "scripts/install-helper.sh"
      provides: "One-line bash helper that: extracts the tarball, runs npm install in extracted dir, invokes paperclipai plugin install. Replaces the 3-line manual sequence from tonight's drill."
      exports: []
  key_links:
    - from: "src/worker/handlers/issue-reader.ts"
      to: "Paperclip ctx.issues.get + ctx.issues.ancestry + ctx.issue.documents.read API shapes"
      via: "empirical observation against running Paperclip on Countermoves — read the SDK type definitions in ~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/types.d.ts and the actual response shapes via worker logs"
      pattern: "ctx\\.issues\\.|ctx\\.issue\\.documents\\."
---

<objective>
Close the four implementation defects that Plan 02-03's manual checkpoint (Task 3) surfaced on 2026-05-13 / 14 against the live Countermoves Paperclip instance. After this plan, the Reader tab renders all 7 mockup elements visually, the right-rail blocker panel does not return 502, React renders cleanly, and the local-path plugin install does not require manual node_modules materialization.

Purpose: tonight's drill proved that unit tests with mocked ctx do not catch real Paperclip API shape drift. This plan's deliverable is empirical knowledge of Paperclip's ACTUAL data shapes, baked into both the handlers and a new integration test layer that stubs the real shapes.

Output: a working Reader tab + a re-runnable rehearsal verdict of "approved — reader green" for sub-checks A-F. Closure for Plan 02-03.
</objective>

<execution_context>
@C:/Users/erezg/.claude/plugins/cache/gsd-plugin/gsd/2.38.8/workflows/execute-plan.md
@C:/Users/erezg/.claude/plugins/cache/gsd-plugin/gsd/2.38.8/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-scaffold-and-surfaces/02-CONTEXT.md
@.planning/phases/02-scaffold-and-surfaces/02-03-PLAN.md
@.planning/phases/02-scaffold-and-surfaces/02-03-SUMMARY.md
@.planning/phases/02-scaffold-and-surfaces/02-03-REHEARSAL-FINDINGS.md
@sketches/paperclip-fix-task-detail.html

<environment_facts>
- Drill target: live Countermoves Paperclip (82.29.197.74, db `paperclip_countermoves`, plugin installed at uuid `0d4fc40a-0541-4b67-8979-9d346cb9c07b`, status `ready`).
- Pre-drill snapshot exists: `2026-05-13T20-27-43Z` at `/home/eric/clarity-pack/.planning/snapshots/2026-05-13T20-27-43Z` on Countermoves.
- 5 platform pitfalls from 02-03 drill already filed to MemPalace (clarity_pack/runbook): SSH user (#1), ui.page.register cap (#2), apostrophe-in-comment regex bug (#3), CREATE INDEX rejected (#4), worker can't find SDK (#5).
- In-session fixes already applied + committed: manifest cap (#2), migration apostrophe (#3), migration CREATE INDEX removal (#4).
- Plugin is INSTALLED + reachable. We do NOT uninstall before this plan starts — incremental fixes happen in place via `paperclipai plugin enable/disable` or worker hot-reload if available.
</environment_facts>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Diagnose actual Paperclip API shapes</name>
  <files>test/worker/issue-reader-integration.test.mjs (NEW — empty initially), .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md (NEW — diagnostic notes)</files>
  <read_first>
    - .planning/phases/02-scaffold-and-surfaces/02-03-REHEARSAL-FINDINGS.md (the 4 defects with symptom + suspected root cause)
    - ~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/types.d.ts on Countermoves (SDK type signatures for ctx.issues.*, ctx.issue.*, ctx.activity.*, ctx.host.*)
    - ~/paperclip/server/src/services/plugin-worker.ts or similar (host-side shape of what's piped to the worker)
  </read_first>
  <action>
    1. SSH to Countermoves as eric, `cd ~/paperclip`.
    2. Inspect Paperclip's compiled SDK: `cat ~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/types.d.ts | grep -A 20 "ctx\\.issues\\|ctx\\.issue\\|ctx\\.activity"`.
    3. For each of these methods used by `issue.reader` handler, capture the EXACT return shape:
       - `ctx.issues.get(issueId)` — field for body? `body` / `description` / `markdown`?
       - `ctx.issues.ancestry(issueId)` — exists? returns {project, milestone, parent}?
       - `ctx.issue.documents.read(issueId, opts)` — exists? returns {filename, last_write_at}?
       - `ctx.activity.log.read({issueId, limit})` — exists? returns events with `kind` field?
       - `ctx.http.fetch(...)` — what's the actual companies/issues URL pattern (memory notes 01-04 fix: `/api/companies/{id}/issues` post-2026-05-13)?
    4. For `flatten-blocker-chain` 502: tail `plugin_logs` table for that plugin uuid filtered to the request time. Identify the exception or missing-method.
    5. Write a diagnostic doc `02-03b-API-SHAPES.md` capturing what each method ACTUALLY returns (or "does not exist on this SDK version"). One section per method. Include the exact error or response payload.
    6. Stub the integration test file with describe-blocks named after each handler, leave them as `it.todo(...)` initially.
  </action>
  <verify>
    <automated>test -f .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md && grep -c "^##" .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md</automated>
  </verify>
  <acceptance_criteria>
    - 02-03b-API-SHAPES.md exists with one section per method/API we use, citing the actual SDK type signature OR the actual runtime response shape OR "method does not exist".
    - Every silent-failure in `issue.reader` is mapped to a specific cause (wrong field name, missing method, wrong URL, auth issue).
  </acceptance_criteria>
  <done>Empirical knowledge of Paperclip's actual API shapes documented and available to Task 2's rewrite.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewrite issue.reader, flatten-blocker-chain, editor-pause-status handlers against actual shapes + fix React key warnings + materialize SDK install helper</name>
  <files>src/worker/handlers/issue-reader.ts, src/worker/handlers/flatten-blocker-chain.ts (verify), src/worker/handlers/editor-pause-status.ts, src/ui/surfaces/reader/index.tsx, src/ui/surfaces/reader/ref-card.tsx, src/ui/surfaces/reader/prose-with-ref-chips.tsx, src/ui/surfaces/reader/breadcrumb.tsx, src/ui/surfaces/reader/deliverable-preview.tsx, test/worker/issue-reader-integration.test.mjs, scripts/install-helper.sh</files>
  <read_first>
    - .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md (Task 1 output)
    - test/worker/issue-reader.test.mjs (existing mocked-ctx tests — DO NOT delete; supplement with integration tests using real shapes)
    - .planning/phases/02-scaffold-and-surfaces/02-03-REHEARSAL-FINDINGS.md (defects #3 + #4)
  </read_first>
  <action>
    1. **issue-reader.ts handler:** replace assumed field accesses with the actual ones from 02-03b-API-SHAPES.md. Bug-likely items: `issue.body` may be `issue.description` or `issue.markdown_body`; `ctx.issues.ancestry` may not exist (substitute a derivation from `issue.parent_id` walking up via repeated `ctx.issues.get`); `ctx.issue.documents.read` may need `ctx.documents.read` or similar.
    2. **issue-reader.ts wrap in try/catch per-section:** each of the 7 data slices (tldr, refCards, ancestry, acItems, activity, deliverable, issueBody) wraps in `try { ... } catch (e) { ctx.log.warn(...); return <default>; }` so partial-API failures degrade gracefully without making the whole tab blank.
    3. **flatten-blocker-chain.ts:** investigate the 502 root cause from Task 1. Likely either a missing method (e.g., `ctx.issues.relations.get` not available) or a missing capability. Fix the cause; fall back to a structured "No active blockers" terminal when the chain is empty.
    4. **React key warnings:** every `.map(...)` in ReaderView, AnchoredToCards, ProseWithRefChips, Breadcrumb, AcChecklist, ActivityTimeline must emit a stable `key={...}` prop. ProseWithRefChips currently uses `key={`ref-${match.index}`}` but text-node siblings between chips don't have keys when React.Fragments are flattened. Wrap text-node siblings in `<React.Fragment key={`text-${i}`}>` or use explicit `<span key={...}>` wrappers.
    5. **scripts/install-helper.sh:** new bash script. Inputs: a tarball path. Steps: extract to a temp dir, run `npm install --no-fund --no-audit --omit=dev --include=dev` so the SDK is available (devDeps include the SDK), touch dist/manifest.js to bust mtime cache, run `paperclipai plugin install <extracted-dir>`. Idempotent.
    6. **Update runbook/install-walkthrough.md** to mention scripts/install-helper.sh as the canonical local-install path.
    7. **Integration tests:** in test/worker/issue-reader-integration.test.mjs, write a fake ctx that returns the SHAPES captured in 02-03b-API-SHAPES.md (not the spec-assumed shapes). The handler should produce a populated result (body present, ancestry populated, refs extracted, deliverable resolved). RED → GREEN cycle for each handler.
    8. Run tests RED → GREEN. Commit atomically (one commit per handler fix, plus one for the install helper, plus one for React keys, plus one for runbook).
  </action>
  <verify>
    <automated>find test -name "*.test.mjs" -type f -exec node --test {} \; 2>&1 | grep -E "^ℹ (tests|pass|fail)" | awk '/^ℹ tests/{t+=$3}/^ℹ pass/{p+=$3}/^ℹ fail/{f+=$3}END{print "TOTAL:",t,"tests,",p,"pass,",f,"fail"}' && test -f scripts/install-helper.sh && test -x scripts/install-helper.sh && grep -E "key=\\{" src/ui/surfaces/reader/prose-with-ref-chips.tsx</automated>
  </verify>
  <acceptance_criteria>
    - All existing 84 tests still pass + new integration tests pass (target ≥90 total).
    - `scripts/install-helper.sh` exists, is executable, and runs end-to-end against a fresh tarball without manual node_modules step.
    - No React key warnings appear in the browser console after deploying the new build.
    - `issue.reader` handler returns body / ancestry / refs / deliverable populated for the standard test-issue fixture.
    - `flatten-blocker-chain` does not return 502; either returns a typed terminal or a graceful empty state.
  </acceptance_criteria>
  <done>Handlers shaped to Paperclip's actual APIs, fail-soft per-section, React clean, install workflow ergonomic.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Re-run the Reader rehearsal against Countermoves</name>
  <what-built>
    Plan 02-03b deliverables on top of Plan 02-03's installed plugin: handlers now match Paperclip's actual API shapes, install ergonomics improved, React clean.
  </what-built>
  <how-to-verify>
    Operator follows this script. Plugin is already installed on Countermoves at `clarity-pack@0.2.0` — incremental rebuild + reinstall via uninstall+reinstall or `plugin enable`.

    1. **Snapshot bookend (pre):** `cd ~/clarity-pack/scripts/safety && node cli.mjs snapshot --db-url="$DATABASE_URL"`. Save snapshot id.

    2. **Build + ship:**
       - Windows: `npm pack`
       - `scp -i $HOME\.ssh\countermoves_vps_ed25519 .\clarity-pack-0.1.0-smoke.tgz eric@82.29.197.74:/home/eric/`
       - SSH: `~/clarity-pack/scripts/install-helper.sh /home/eric/clarity-pack-0.1.0-smoke.tgz` (uses the new helper from Task 2; replaces the manual extract+install dance).

    3. **Visual re-check (sub-check A from 02-03 Task 3):**
       - Open `https://countermoves.gl3group.com`, navigate to the COU-4 "test issue" (created during 02-03 drill — body has BEAAA-141, BEAAA-203, BEAAA-417).
       - Click Reader tab.
       - EXPECT all 7 mockup elements visible:
         - Breadcrumb at top (project → milestone → parent → this task)
         - TL;DR strip (may show real TL;DR if Editor-Agent has run, or "Compiling TL;DR..." if not)
         - **Body prose with BEAAA-NNN rendered as inline chips** (the key visual our v1 promises)
         - **Anchored to (resolved)** section with at least 1 card showing title + status pill + excerpt
         - **The deliverable** placeholder section with "coming in Phase 5" sub-line
         - AC checklist (empty state OK)
         - Activity timeline (with at least 4 events)
         - Right-rail **Live blocker · on you** panel with one typed terminal OR a graceful "No active blockers" state

    4. **React console clean:** browser console shows no React key warnings, no 502s from `flatten-blocker-chain`.

    5. **Sub-checks B-F from 02-03 Task 3:**
       - B (governance parity): edit issue body → TL;DR regenerates → pause Editor-Agent in admin → next edit does NOT regenerate → PauseBanner appears
       - C (self-loop): one compile completes → next heartbeat does NOT recompile
       - D (token-cap): 50K body → row in editor_agent_failures → no TL;DR update
       - E (circuit-breaker): force 3 failures → agent auto-pauses → PauseBanner appears
       - F (schema): `\dt public.*` unchanged from pre-install baseline

    6. **Snapshot bookend (post):** another snapshot. Rehearse restore via `pnpm clarity-safety verify <id>`.

    7. **Append a row to runbook/REHEARSAL.md** under `## Phase 2 install rehearsals`: date, Paperclip SHA, mode, pre-snapshot id, post-snapshot id, verdict.

    8. **Reply with verdict.** If A-F all PASS: "approved — reader green". If anything fails: which sub-check, what symptom.
  </how-to-verify>
  <resume-signal>"approved — reader green" closes Plan 02-03 entirely (ROADMAP checkbox + STATE counter). Any FAIL routes back to planner.</resume-signal>
</task>

</tasks>

<success_criteria>
- All 4 defects from 02-03 drill closed.
- Reader tab visually matches sketches/paperclip-fix-task-detail.html on Countermoves.
- B-F sub-checks all PASS.
- runbook/REHEARSAL.md gets a new row.
- scripts/install-helper.sh is the documented canonical local-install path going forward.
- A new feedback memory filed in MemPalace: "always integration-test handlers against actual Paperclip API before claiming Reader is shipped".
</success_criteria>

<output>
After Task 3 PASS, create `.planning/phases/02-scaffold-and-surfaces/02-03b-SUMMARY.md` recording:
- The 4 actual Paperclip API shape drifts found and how they were resolved (this becomes durable knowledge for 02-04, Phase 3, Phase 4)
- The install-helper.sh contract (what it accepts, what it leaves behind)
- Updated test count
- Commits
- The post-drill snapshot id
- Operator notes / additional gotchas
</output>
</content>
