---
plan: 02-03c
phase: 2
phase_name: scaffold-and-surfaces
wave: 3.7
type: gap-closure
parent_plan: 02-03b
depends_on: ["02-03b"]
gap_closure: true
autonomous: false
files_modified:
  - src/ui/surfaces/reader/index.tsx
  - src/ui/surfaces/reader/live-blocker-panel.tsx
  - src/ui/primitives/use-resolved-company-id.ts
  - src/worker/handlers/companies-resolve.ts
  - src/worker/index.ts
  - src/manifest.ts
  - test/ui/use-resolved-company-id.test.mjs
  - test/worker/companies-resolve.test.mjs
  - test/ui/reader-view-null-context.test.mjs
  - test/ui/live-blocker-panel-null-context.test.mjs
  - .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md
requirements:
  - "02-03b drill defect — useHostContext().companyId null for detail-tab slots"
  - "02-03b drill defect — React key warnings on ClaritySurfaceRoot + AnchoredToCards (verify post-companyId fix)"
  - "02-03b drill artifact — companyPrefix-to-companyId resolution path"
  - "Test-coverage gap — UI handlers' null-companyId path"
must_haves:
  truths:
    - "useHostContext().companyId on Countermoves Paperclip 2026.512.0 is empirically documented in 02-03c-HOST-CONTEXT.md — exact null/populated shape captured per slot type (detail-tab vs page vs settingsPage) from a running plugin"
    - "ReaderView and LiveBlockerPanel never pass empty string companyId to usePluginData — either a resolved UUID, OR they render an explicit 'resolving company context…' placeholder, OR they fall back to a parsed-from-URL companyPrefix that the worker accepts"
    - "Reader tab on Countermoves COU-4 renders all 8 mockup elements (Breadcrumb, TldrStrip, ProseWithRefChips with chips visible, AnchoredToCards empty-state or substantive cards, DeliverablePreview, AcChecklist, ActivityTimeline, LiveBlockerPanel typed terminal or graceful empty)"
    - "Console clean — no React key warnings, no companyId-required errors, no 502s"
    - "Every UI component calling useHostContext() has a vitest/jsdom integration test that mocks companyId=null and asserts the component renders a degraded state (placeholder or fallback), NOT silently passes empty string to a worker handler"
  artifacts:
    - path: ".planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md"
      provides: "Empirical documentation of what useHostContext() actually returns for each slot type on Paperclip 2026.512.0. Captures companyId / companyPrefix / projectId / entityId / entityType / parentEntityId / userId / renderEnvironment exactly as observed. Becomes durable reference for Phases 3-5."
      exports: []
    - path: "src/ui/primitives/use-resolved-company-id.ts"
      provides: "useResolvedCompanyId() hook — returns {companyId, loading, error}. Prefers useHostContext().companyId; falls back to companyPrefix → worker resolve-companyPrefix call; final fallback to URL parsing. Single source of truth for every Clarity Pack UI surface that needs a UUID."
      exports: ["useResolvedCompanyId"]
    - path: "src/worker/handlers/companies-resolve.ts"
      provides: "companies.resolve-prefix worker handler. Input: {companyPrefix}. Output: {companyId, displayName}. Uses ctx.companies.list + filter (since SDK doesn't expose ctx.companies.getByPrefix at 2026.512.0). Capability required: companies.read (already declared)."
      exports: ["registerCompaniesResolve"]
  key_links:
    - from: "src/ui/surfaces/reader/index.tsx"
      to: "useResolvedCompanyId() instead of useHostContext().companyId direct read"
      via: "swap the direct companyId access for the resolver hook; render an explicit loading placeholder while resolver is in flight"
      pattern: "useResolvedCompanyId\\(\\)"
    - from: "src/ui/surfaces/reader/live-blocker-panel.tsx"
      to: "useResolvedCompanyId() — same retrofit"
      via: "same"
      pattern: "useResolvedCompanyId\\(\\)"
---

<objective>
Close Plan 02-03b Task 3 drill's blocking defect: `useHostContext().companyId` returns `null` for detail-tab slots on Paperclip 2026.512.0, causing both the `issue.reader` and `flatten-blocker-chain` worker handlers to bail per their fail-loud companyId guards. After this plan, the Reader tab renders all 8 mockup elements against the live Countermoves Paperclip; the React key warnings are either eliminated or rooted to a separate cause; and the UI→handler boundary has integration tests covering the null-companyId case.

Purpose: 02-03b drill proved that unit tests mocking `useHostContext()` with populated companyId values cannot catch this class of defect. This plan's primary deliverable is empirical knowledge of what the host actually pipes (per slot type), a robust resolver hook that doesn't silently pass empty strings to the worker, and integration tests that exercise the null path.

Output: a re-runnable rehearsal verdict of "approved — reader green" closing Plan 02-03 entirely. ROADMAP checkbox flips and STATE.md counter advances on PASS.
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
@.planning/phases/02-scaffold-and-surfaces/02-03-REHEARSAL-FINDINGS.md
@.planning/phases/02-scaffold-and-surfaces/02-03b-PLAN.md
@.planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md
@runbook/REHEARSAL.md
@sketches/paperclip-fix-task-detail.html

<environment_facts>
- Drill target: live Countermoves Paperclip (82.29.197.74, db `paperclip_countermoves`, plugin installed at uuid `0d4fc40a-0541-4b67-8979-9d346cb9c07b`, status `ready`).
- Plugin tarball known-shipping path: `clarity-pack-0.1.0-smoke.tgz` (shasum captured per build).
- Install path validated: `~/clarity-pack/scripts/install-helper.sh /home/eric/clarity-pack-0.1.0-smoke.tgz` works end-to-end after commit `27c1ef8`.
- Pre-install snapshot pattern: `cd ~/clarity-pack/scripts/safety && export DATABASE_URL=$(sudo cat /etc/paperclip/db.env | grep DATABASE_URL | cut -d= -f2-) && node cli.mjs snapshot --db-url="$DATABASE_URL"` (requires interactive SSH for the sudo prompt).
- 02-03b drill defects #1, #2 from 02-03 REHEARSAL-FINDINGS are CLOSED (handler shapes); defect #3 (React keys) IS NOT CLOSED — bundled keys are correct but warnings still fire; defect #4 (install kludge) is CLOSED.
- Plugin is INSTALLED + reachable. Iteration loop for this plan: edit → build → npm pack → scp → ssh → `paperclipai plugin uninstall clarity-pack` (non-destructive, preserves namespace) → install-helper.sh → hard-refresh browser. Two-minute round-trip per iteration on Hostinger.
- MemPalace drawer `drawer_clarity_pack_runbook_ebb49c580cbee4ec9a04259b` captures the 02-03b drill verdict and is the durable record of the entry point.
- SDK type files to read on Countermoves for Task 1: `~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/ui/hooks.d.ts` and `dist/ui/types.d.ts`.
</environment_facts>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Empirically document what useHostContext() returns per slot type</name>
  <files>.planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md (NEW), src/ui/surfaces/reader/index.tsx (TEMP instrumentation — reverted before commit), src/ui/situation-room-stub.tsx (TEMP instrumentation), src/ui/settings-stub.tsx (TEMP instrumentation)</files>
  <read_first>
    - .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md (Section 5 — initial useHostContext shape)
    - On Countermoves: ~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/ui/hooks.d.ts (every hook signature)
    - On Countermoves: ~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/ui/types.d.ts (PluginHostContext interface; PluginRenderEnvironmentContext interface)
    - On Countermoves: ~/paperclip/server/src/services/plugin-ui-runtime.ts OR similar host-side file that builds the PluginHostContext object piped into the plugin UI — look for which fields are set vs left null per slot type
  </read_first>
  <action>
    1. Read the SDK `dist/ui/hooks.d.ts` exhaustively on Countermoves. List every hook the SDK exposes: `useHostContext`, `useHostNavigation`, `usePluginData`, `usePluginAction`, plus any `useDetailTab*`, `useEntity*`, `useCompanies*` siblings. Capture exact signatures + return types.
    2. Read the host-side Paperclip code that constructs the `PluginHostContext` value. Find the function that builds it; identify the branch logic that decides which fields are populated for each slot type (`detailTab` / `page` / `settingsPage`). If the function uses route params, capture the route shapes (e.g., `/:companyPrefix/issues/:issueKey` for detail tabs).
    3. **Add temporary instrumentation** to ReaderView, SituationRoom stub, and SettingsPage stub: at the top of each, log `console.log('[clarity-host-context]', JSON.stringify(useHostContext()))`. Build, pack, ship, install on Countermoves.
    4. **Visit each slot in the browser** and capture the actual logged values:
       - detailTab: navigate to COU-4 → Reader tab → capture log
       - page (situation-room): navigate to `/COU/plugins/clarity-pack/situation-room` → capture log
       - settingsPage: navigate to user settings → Clarity Pack section → capture log
    5. Write `02-03c-HOST-CONTEXT.md` with one section per slot type. For each: the SDK-declared field set, the EMPIRICALLY-observed field values (populated vs null), and one paragraph of conclusion explaining what the UI can trust.
    6. **Revert the instrumentation.** The console.log lines must not ship. Rebuild without them.
    7. Validate the doc structure with `grep -c "^## " .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md` (must be ≥3, one per slot type).
  </action>
  <verify>
    <automated>test -f .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md && grep -c "^## " .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md | awk '{if($1 >= 3) print "PASS"; else print "FAIL"}'</automated>
    <manual>The doc must answer: (a) for detail-tab slot, what fields are populated? Is companyPrefix non-null when companyId is null? (b) what hooks does the SDK expose that we missed? (c) is there a documented expectation about which fields are nullable?</manual>
  </verify>
  <acceptance_criteria>
    - 02-03c-HOST-CONTEXT.md exists with ≥3 sections (one per slot type).
    - Every field of PluginHostContext is documented as "always populated", "always null", or "conditional on X" per slot type, with empirical evidence (console-log capture) cited.
    - No console.log instrumentation remains in src/.
  </acceptance_criteria>
  <done>Empirical truth captured. Task 2's resolver design is grounded in evidence, not spec assumptions.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build useResolvedCompanyId() hook + companies.resolve-prefix worker handler + retrofit ReaderView and LiveBlockerPanel</name>
  <files>src/ui/primitives/use-resolved-company-id.ts (NEW), src/worker/handlers/companies-resolve.ts (NEW), src/worker/index.ts (register new handler), src/manifest.ts (verify companies.read declared), src/ui/surfaces/reader/index.tsx (swap to resolver), src/ui/surfaces/reader/live-blocker-panel.tsx (swap to resolver), test/ui/use-resolved-company-id.test.mjs (NEW), test/worker/companies-resolve.test.mjs (NEW), test/ui/reader-view-null-context.test.mjs (NEW), test/ui/live-blocker-panel-null-context.test.mjs (NEW)</files>
  <read_first>
    - .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md (Task 1 output — drives the hook's fallback chain)
    - On Countermoves: `dist/ui/hooks.d.ts` for `useHostContext` signature confirmation
    - SDK types: `ctx.companies.list(companyId?): Promise<Company[]>` OR `ctx.companies.get(...)` shape
    - src/ui/surfaces/reader/index.tsx and live-blocker-panel.tsx as they stand at HEAD
    - test/ui/reader-view.test.mjs (existing pattern for jsdom mounting; supplement, do not delete)
  </read_first>
  <action>
    1. **Design the resolver fallback chain.** Based on Task 1 findings, the chain is one of:
       - **Case A** (companyPrefix populated even when companyId is null) — preferred: prefer companyId; else resolve companyPrefix via worker handler; else error placeholder.
       - **Case B** (only entityId populated) — fall back to: parse URL pathname `/:companyPrefix/issues/...`; pass companyPrefix to worker resolver; resolver looks up company.
       - **Case C** (host bug — should populate but doesn't) — same as Case B but file an upstream issue against `paperclipai/paperclip`.
    2. **RED — write the failing tests first:**
       - `test/worker/companies-resolve.test.mjs`: stub ctx with `companies.list` returning `[{id:'uuid-1', companyKey:'COU', ...}, ...]`. Call the handler with `{companyPrefix: 'COU'}`. Assert it returns `{companyId: 'uuid-1', displayName: ...}`. Also: edge case (prefix not found → throws), edge case (no prefix passed → throws).
       - `test/ui/use-resolved-company-id.test.mjs`: jsdom-mount a tiny test component that calls `useResolvedCompanyId()`. Mock `useHostContext()` to return three shapes: (i) companyId populated → assert hook returns that companyId immediately; (ii) companyId null + companyPrefix populated → assert hook calls worker resolver and returns the resolved UUID; (iii) both null → assert hook returns `{companyId: null, loading: false, error: 'no-company-context'}`.
       - `test/ui/reader-view-null-context.test.mjs`: mount ReaderView with `useHostContext` returning `companyId: null, companyPrefix: 'COU'`. Mock the resolver hook to delay resolution. Assert ReaderView renders the explicit "Resolving company context…" placeholder (NOT an empty surface). Then resolve the mock; assert ReaderView re-renders with the populated handler call.
       - `test/ui/live-blocker-panel-null-context.test.mjs`: same pattern.
    3. **GREEN — implement:**
       - `src/worker/handlers/companies-resolve.ts`: register `companies.resolve-prefix`. Use `ctx.companies.list()` (verify exact SDK signature in Task 1's host-context doc) + filter by `companyKey === params.companyPrefix`. Throw on missing prefix or no match. Capability `companies.read` already declared per current manifest.ts:58.
       - Register the handler in `src/worker/index.ts` alongside the existing 4 handlers.
       - `src/ui/primitives/use-resolved-company-id.ts`: implement the hook per Task 1 finding. Use `usePluginData('companies.resolve-prefix', {companyPrefix})` for the fallback path. Return shape: `{companyId: string | null, loading: boolean, error: 'no-company-context' | null}`.
       - `src/ui/surfaces/reader/index.tsx`: replace `const { companyId, userId } = useHostContext()` with `const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId(); const { userId } = useHostContext();`. If `companyLoading`, render `<ClaritySurfaceRoot name="reader"><p className="clarity-reader-loading">Resolving company context…</p></ClaritySurfaceRoot>`. If `companyError`, render an explicit error placeholder. Otherwise proceed to the existing `usePluginData('issue.reader', { issueId, companyId })` call.
       - `src/ui/surfaces/reader/live-blocker-panel.tsx`: same retrofit.
       - Manifest: verify `companies.read` is in the capabilities list (it is per manifest.ts:58). No changes needed unless Task 1 finds a NEW capability requirement.
    4. **Tests RED → GREEN per handler/hook/component.** Commit atomically: one for the worker handler, one for the resolver hook, one for ReaderView retrofit, one for LiveBlockerPanel retrofit.
    5. **Update the existing integration tests** at `test/worker/issue-reader-integration.test.mjs` and `test/worker/flatten-blocker-chain.test.mjs` (if exists): add an "empty companyId" case to verify the handlers' fail-loud guards behave as designed; they should remain a safety net even though the UI now refuses to call them with empty companyId.
  </action>
  <verify>
    <automated>cd "C:\Users\erezg\Documents\Claude\Projects\Clarity Pack" && node --test test/ 2>&1 | tail -5</automated>
    <manual>grep -E "useResolvedCompanyId|companies\\.resolve-prefix" src/ui/surfaces/reader/index.tsx src/ui/surfaces/reader/live-blocker-panel.tsx — both files must reference the resolver, not the raw useHostContext companyId field.</manual>
  </verify>
  <acceptance_criteria>
    - All existing tests still pass + new tests pass (target ≥98 total; current is ~90 per 02-03b commit `8273ee7`).
    - ReaderView and LiveBlockerPanel NEVER pass empty string companyId to usePluginData. Confirmed by grep: no `companyId ?? ''` in either file after the retrofit.
    - useResolvedCompanyId() hook returns a resolved UUID via the worker fallback when companyPrefix is populated.
    - The Reader's "Resolving company context…" placeholder renders during the resolver's in-flight window (verified by jsdom test).
  </acceptance_criteria>
  <done>UI no longer passes empty companyId. Worker has a resolver. Tests cover the null-context path.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Re-investigate React key warnings (post-companyId fix)</name>
  <files>.planning/phases/02-scaffold-and-surfaces/02-03c-REACT-KEYS.md (NEW), src/ui/surfaces/reader/index.tsx (potentially), src/ui/primitives/clarity-surface-root.tsx (potentially)</files>
  <read_first>
    - Tasks 1+2 output (the live Reader is now rendering with populated data — different from the empty-state case where 02-03b's warnings were observed)
    - Plan 02-03b-PLAN.md acceptance criteria for defect #3
    - The Plan 02-03 commit `f89f44b` "UI wiring + manifest capabilities + React keys"
    - dist/ui/index.js lines 102, 110, 177, 373-388 (the bundled output we already verified has keys)
  </read_first>
  <action>
    1. **After Task 2 lands, re-run the rehearsal drill to observe the React console** — the warnings observed in 02-03b drill were against an empty-data Reader. With populated data, the warnings may have resolved (different render path) or may persist (true bug).
    2. **If warnings persist**, capture screenshot + exact warning text. Run `console.dir()` on the component tree to see which array React is flagging. Likely root causes to investigate:
       - The host's plugin-loader wrapping our exported components in `React.Children.toArray` or `React.cloneElement` (would lose static-array key tracking).
       - React 19 strict-mode behavior interacting with our esbuild JSX-runtime output.
       - A subtle case in `useHostNavigation().linkProps` (used by Breadcrumb) emitting fragments without keys when called for boundary cases.
    3. **If warnings are gone**, document that in 02-03c-REACT-KEYS.md as a follow-on finding — Task 2's data populate fixed the cascade.
    4. **If warnings persist + we identify a fix**, apply it. Add a vitest test that asserts no key warnings (capture `console.error` calls during render, fail the test if any contain "key").
    5. **If warnings persist + the fix requires Paperclip host changes**, document the workaround (suppress for known-safe arrays via explicit React.Fragment wrapping with stable keys) and file an upstream issue. Do NOT block Plan 02-03c closure on a host bug — note it as a known-cosmetic-warning in REHEARSAL.md.
    6. Write 02-03c-REACT-KEYS.md with: observed-after-Task-2 state, root cause (if found), fix applied (if any), residual gap (if any).
  </action>
  <verify>
    <automated>test -f .planning/phases/02-scaffold-and-surfaces/02-03c-REACT-KEYS.md</automated>
    <manual>Browser console on COU-4 Reader tab post-Task-2 install: either zero key warnings, or warnings documented as host-bug-workaround in REHEARSAL.md.</manual>
  </verify>
  <acceptance_criteria>
    - 02-03c-REACT-KEYS.md exists.
    - Either (a) no warnings in browser console, OR (b) explicit upstream-bug note with workaround + filed-issue link.
    - If a fix landed, it's covered by a unit test that captures console.error.
  </acceptance_criteria>
  <done>React key warnings are either eliminated or formally classified as out-of-scope host bug.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Re-run the Reader rehearsal against Countermoves</name>
  <what-built>
    Plan 02-03c deliverables on top of Plan 02-03b's installed plugin: UI now resolves companyId via the fallback chain (companyId → companyPrefix → URL parsing), all 8 mockup elements render with populated data, React console is either clean or has explicit host-bug-classified residue, and the UI→handler boundary has integration tests covering the null-context path.
  </what-built>
  <how-to-verify>
    Operator follows this script. Plugin is already installed on Countermoves at uuid `0d4fc40a-…` per 02-03b drill; rebuild + ship + uninstall (non-destructive) + reinstall via install-helper.sh.

    1. **Snapshot bookend (pre):**
       ```bash
       ssh -i $HOME\.ssh\countermoves_vps_ed25519 eric@82.29.197.74
       # interactive session — sudo will prompt for password
       cd ~/clarity-pack/scripts/safety
       export DATABASE_URL=$(sudo cat /etc/paperclip/db.env | grep -E '^DATABASE_URL=' | cut -d= -f2-)
       node cli.mjs snapshot --db-url="$DATABASE_URL"
       ```
       Save the snapshot id.

    2. **Build + ship from Windows:**
       ```powershell
       cd "C:\Users\erezg\Documents\Claude\Projects\Clarity Pack"
       node scripts/build-worker.mjs
       node scripts/build-ui.mjs
       npx tsc --project tsconfig.manifest.json
       Remove-Item .\clarity-pack-0.1.0-smoke.tgz -ErrorAction SilentlyContinue
       npm pack
       scp -i $HOME\.ssh\countermoves_vps_ed25519 .\clarity-pack-0.1.0-smoke.tgz eric@82.29.197.74:/home/eric/
       ```

    3. **Uninstall + reinstall on Countermoves** (same SSH session — sudo cache preserved):
       ```bash
       pnpm paperclipai plugin uninstall clarity-pack
       ~/clarity-pack/scripts/install-helper.sh /home/eric/clarity-pack-0.1.0-smoke.tgz
       pnpm paperclipai plugin list   # confirm status=ready
       ```

    4. **Visual re-check (sub-check A from 02-03 Task 3, repeated):**
       - Open `https://countermoves.gl3group.com` with DevTools (Console + Network tabs) open BEFORE navigating
       - Hard-refresh (`Ctrl+F5`) to bust the cached UI bundle
       - Navigate to COU-4 → Reader tab
       - **EXPECT all 8 mockup elements visible AND populated:**
         - Breadcrumb (project + parent visible, even if "No project" → just the parent hop)
         - TL;DR strip ("Compiling TL;DR…" or a real TL;DR if Editor-Agent has run)
         - **Body prose with BEAAA-NNN rendered as inline chips** (the v1 promise — Eric should see this for the first time)
         - **Anchored to (resolved)** section — either real cards if the refs resolve, or a clear "No upstream references in this task" empty state (NOT silently empty due to companyId)
         - Deliverable preview placeholder with "coming in Phase 5"
         - AC checklist (empty state OK)
         - Activity timeline with comment events
         - Right-rail Live blocker panel — typed terminal OR graceful "No active blockers" (NOT the synthesized `EXTERNAL / startId and companyId required` error)

    5. **Console clean:** browser console shows no `companyId required` errors, no 502s from `flatten-blocker-chain`, and either no React key warnings OR only warnings that 02-03c-REACT-KEYS.md formally classified as out-of-scope.

    6. **Sub-checks B-F from 02-03 Task 3** (carried forward):
       - B (governance parity): edit issue body → TL;DR regenerates → pause Editor-Agent in admin → next edit does NOT regenerate → PauseBanner appears
       - C (self-loop): one compile completes → next heartbeat does NOT recompile
       - D (token-cap): 50K body → row in editor_agent_failures → no TL;DR update
       - E (circuit-breaker): force 3 failures → agent auto-pauses → PauseBanner appears
       - F (schema): `\dt public.*` unchanged from pre-install baseline

    7. **Snapshot bookend (post):** another snapshot. Rehearse restore via `node cli.mjs verify <id>`.

    8. **Append a row to runbook/REHEARSAL.md** under `## Phase 2 Reader-tab visual rehearsals`: date, plugin version, plugin uuid, issue, pre-snapshot id, components rendered (8/8 if PASS), console clean (✓ or ❌), verdict, operator.

    9. **Reply with verdict.** If A-F all PASS: `approved — reader green`. Plan 02-03 + 02-03b + 02-03c all CLOSE; ROADMAP checkbox flips; STATE.md counter advances. Any FAIL routes back to planner with explicit symptom.
  </how-to-verify>
  <resume-signal>"approved — reader green" closes Plans 02-03, 02-03b, and 02-03c (ROADMAP checkbox + STATE counter). Any FAIL routes back to planner.</resume-signal>
</task>

</tasks>

<success_criteria>
- 02-03b drill's blocking defect (null companyId) is closed via the resolver hook.
- All 8 Reader components render with populated data on Countermoves COU-4.
- React key warnings are either gone or formally classified as host-bug-out-of-scope.
- runbook/REHEARSAL.md gets a new row under `## Phase 2 Reader-tab visual rehearsals` with verdict.
- 02-03c-HOST-CONTEXT.md becomes durable reference for every future plugin surface (Phases 3-5 build on this).
- Auto-memory feedback rule `feedback_test-usehostcontext-null-companyId.md` is satisfied by Task 2's new tests.
- A new MemPalace drawer files the "approved — reader green" closure or the specific symptom of any FAIL.
</success_criteria>

<output>
After Task 4 PASS, create `.planning/phases/02-scaffold-and-surfaces/02-03c-SUMMARY.md` recording:
- Empirical findings from Task 1 — what useHostContext() actually returns per slot type (becomes Phase 3/4/5 reference)
- The resolver hook's contract — when it's needed, what it falls back to
- Updated test count (target ≥98)
- React key warnings disposition (fixed / classified / open)
- Commits
- Pre/post-drill snapshot ids
- Operator notes / additional gotchas
- Confirmation that the `feedback_test-usehostcontext-null-companyId.md` rule is now satisfied by integration tests
</output>
</content>