---
phase: 07-clarity-surfaces-quality-and-portability-instance-agnostic-r
plan: 01
subsystem: worker / ref-resolution + portability + chat-label UI
tags: [worker, ref-resolution, portability, sdk, READER-03, READER-04, PRIM-01, PRIM-02, chat-ui]
requires:
  - src/shared/reference-resolver.ts (UNCHANGED — the byId-keyed pure resolver the fetcher must satisfy)
  - "@paperclipai/plugin-sdk PluginIssuesClient.get(issueId, companyId) + .list({companyId})"
  - companies-resolve.ts (already returns { companyId, displayName })
  - src/ui/surfaces/reader/prose-with-ref-chips.tsx (the portable prefix-narrow pattern mirrored server-side)
provides:
  - src/worker/handlers/sdk-ref-fetch.ts (NEW shared resolver — per-ref ctx.issues.get + cached ctx.issues.list-and-match fallback; echoes id = requested identifier)
  - issue-reader.ts inline fetcher rewritten to the SDK (no ?ids= http.fetch; camelCase field mapping)
  - resolve-refs.ts handler rewritten to the SDK (mirror; D-09 owner-name enrichment preserved)
  - editor.ts exports prefixFromIdentifier; extractRefsFromBody(body, identifier?) prefix-narrowed (de-BEAAA'd)
  - useResolvedCompanyId returns displayName on every arm (URL-prefix fallback, never a literal)
  - roster-rail.tsx + chat/index.tsx global-search render the company display name (BEAAA literals gone)
affects:
  - "READER-03/READER-04 — ref chips now resolve to real title + status on EVERY instance (was 'BEAAA-NNN · unknown')"
  - "Portability — non-BEAAA instances (COU/ACME) now extract + resolve their own refs"
  - "TL;DR inputs path (issue-reader.ts:~200) — refs now extracted prefix-narrowed (unblocks deferred item 3 titles)"
tech_stack:
  added: []
  patterns:
    - "Per-ref ctx.issues.get(identifier, companyId) in Promise.all + ONE cached ctx.issues.list({companyId})-and-match-on-.identifier fallback (per-invocation cache, not module scope)"
    - "Fetcher echoes id = the REQUESTED identifier (not host i.identifier, not the null host key) so reference-resolver byId.get(ref) hits"
    - "PRIM-01 redefined: one fetcher invocation at the resolveRefs boundary (per-ref get is N parallel calls inside it)"
    - "Viewer gate without _viewer_can_read: a non-null ctx.issues.get is treated as readable; get-returns-null → unknown placeholder (excerpt null)"
    - "Exact-prefix extraction from issue.identifier (escapeRegex'd) with broad /\\b[A-Z][A-Z0-9]{1,7}-\\d+\\b/g fallback when identifier is null — shared prefixFromIdentifier helper"
    - "Company display name via companies.resolve-prefix displayName, URL-prefix fallback, NEVER a literal"
key_files:
  created:
    - src/worker/handlers/sdk-ref-fetch.ts
    - test/worker/editor.test.mjs
  modified:
    - src/worker/handlers/issue-reader.ts
    - src/worker/handlers/resolve-refs.ts
    - src/worker/agents/editor.ts
    - src/ui/primitives/use-resolved-company-id.ts
    - src/ui/surfaces/chat/roster-rail.tsx
    - src/ui/surfaces/chat/index.tsx
    - test/worker/issue-reader.test.mjs
    - test/worker/issue-reader-integration.test.mjs
    - test/worker/issue-reader-degradation.test.mjs
    - test/worker/resolve-refs.test.mjs
decisions:
  - "Shared prefixFromIdentifier helper (exported from editor.ts) used by BOTH worker extraction sites — no third copy; issue-reader.ts derives issueIdentifier once and passes it to both extractRefsFromBody calls."
  - "list-fallback caches per fetcher invocation (safer for freshness), NOT module scope."
  - "Test fixture identifiers COU-/ACME- for the portability tests; BEAAA- proven NON-matching on a COU issue."
  - "_viewer_can_read replacement: non-null ctx.issues.get == readable; the live drill confirms whether get enforces viewer perms server-side (open item, not a guessed code path)."
metrics:
  duration: "~1 session (autonomous)"
  tasks_completed: 6
  files_created: 2
  files_modified: 10
  completed_date: "2026-05-28"
  suite: "2027 total / 2024 pass / 1 fail (pre-existing situation.artifacts) / 2 skip"
---

# Phase 7 Plan 01: Ref-resolution + portability (prerequisite chunk) Summary

**One-liner:** Both worker ref-resolution paths rewritten from the SSRF-blocked `?ids=` HTTP batch to per-ref `ctx.issues.get` + cached `ctx.issues.list`-match fallback (fetcher echoes `id = requested identifier` so chips resolve to real titles, not `· unknown`); both worker extraction regexes de-BEAAA'd via a shared `prefixFromIdentifier`; two chat `BEAAA` labels replaced by the resolved company display name. Version stays 1.0.0; no migration; no new runtime deps.

## What shipped

### 1. Ref resolution rewrite (both worker paths) — READER-03/04, PRIM-01/02

The Reader's "zero rabbit-holes" core value was broken on EVERY instance: in-prose `BEAAA-NNN` chips rendered `"BEAAA-807 · unknown"`. Root cause (three bugs, confirmed in 07-RESEARCH.md): (a) `ctx.http.fetch` to `localhost:3100` is SSRF-blocked on paperclipai@2026.525.0; (b) the `?ids=` batch filter is ignored by the host's general-list endpoint; (c) the stale snake_case mapping read `i.key` (null) so the resolver's `byId` map never matched the requested identifier.

- **New shared resolver `src/worker/handlers/sdk-ref-fetch.ts`** (`resolveRefsViaSdk`): resolves each unique requested identifier via `ctx.issues.get(identifier, companyId)` in parallel (`Promise.all`); for any `null`, lazily calls `ctx.issues.list({ companyId })` ONCE (cached per-invocation), builds an `identifier → Issue` map, and resolves the nulls client-side (the SDK `list` has no ids[]/identifier filter). Each resolved Issue is paired with the **requested identifier** so each caller echoes `id = requested`. Unresolvable ids are omitted → the pure `resolveRefs()` emits its `unknown` placeholder.
- **issue-reader.ts inline fetcher** rewritten to call `resolveRefsViaSdk` and map the REAL camelCase SDK Issue fields (`title / status / assigneeUserId / description`). Dropped the `apiBase` / `?ids=` / `ctx.http.fetch` path and the stale `RawHostIssue` type. `http` is now optional on `IssueReaderCtx`. Outer try/catch preserved (resolution failure → `refCards = []`).
- **resolve-refs.ts handler** rewritten to mirror issue-reader via the same shared resolver. The D-09 POST-resolution enrichment is preserved byte-for-byte: `ownerName` via `ctx.agents.get(assigneeUserId, companyId)` (dedup distinct owners; degrade to null on throw; **NO_UUID_LEAK**); `descriptionExcerpt` / `bodyExcerptForViewer` from `i.description`. `ResolveRefsCtx.http` removed (dead path un-typeable); `issues: Pick<…,'get'|'list'>` added.
- **The pure `src/shared/reference-resolver.ts` is UNCHANGED.** The fetcher satisfies its `byId.get(ref)` contract by echoing the requested identifier as `id`.
- **PRIM-01 redefined** as "one fetcher invocation at the resolveRefs boundary" — per-ref `get` is N parallel calls inside the single invocation. Both PRIM-01 tests now assert zero `?ids=` http.fetch + the per-ref get count.
- **PRIM-02 / `_viewer_can_read`:** that field does not exist on the SDK Issue. A non-null `ctx.issues.get` result is treated as readable-by-caller (the SDK proxies the caller's auth); `get`-returns-null → unknown placeholder (excerpt null). Whether `get` enforces viewer perms server-side is the live-drill open item (T-07-01).

### 2. Extraction de-BEAAA (both regexes + shared helper) — portability

- **editor.ts**: new exported pure `prefixFromIdentifier(identifier)` (`COU-2486` → `COU`; null for non-canonical shapes, restricted to `[A-Z][A-Z0-9]{1,7}`). `extractRefsFromBody(body, identifier?)` now narrows to `\b<escapeRegex(prefix)>-\d+\b` when a prefix is derivable, else the broad `/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g`. Mirrors the already-portable UI `prose-with-ref-chips.tsx`.
- **Threaded through ALL extraction sites** (so no path stays BEAAA-hardcoded): editor.ts `readTldrInputs` (re-fetched `target.identifier`), editor.ts `handleEditorHeartbeat` inputs (`issue.identifier`), and BOTH issue-reader.ts call sites — the refCards extraction AND the line-~200 TL;DR-inputs call — pass the derived `issueIdentifier`. The module-level BEAAA-only `REF_PATTERN` is removed from issue-reader.ts.
- **Net-new `test/worker/editor.test.mjs`** (extractRefsFromBody had ZERO tests): `prefixFromIdentifier` cases; `COU-12` matches + `BEAAA-807` does NOT match on a `COU-2486` issue; `ACME-9` matches + `COU-3` does not on an `ACME-7` issue; null-identifier broad fallback matches both; metachar-identifier rejected (no regex injection).

### 3. Chat company-label swap — UI

- **use-resolved-company-id.ts**: `ResolvedCompanyId` carries `displayName: string | null` on every arm. Path 5 (resolver landed) = `companies.resolve-prefix` `displayName`; Path 1 (host-context short-circuit) + loading + error = the URL prefix (`extractCompanyPrefixFromPathname`). NEVER a literal.
- **roster-rail.tsx**: new `companyName?: string | null` prop; the roster header reads `<n> · <companyName>` (count alone when null). Both `BEAAA` literals gone.
- **chat/index.tsx**: `ChatPageOptedIn` threads `displayName → companyName` through `ChatPageBody` to `RosterRail` and the global-search placeholder (`Search all chats and tasks across <name>…`, name-less when null).

## Which resolution path the TESTS exercise

The unit/integration test fakes exercise the **`ctx.issues.get` direct path** — every fake `get` returns the ref issue keyed by its human identifier, so the `Promise.all(get)` resolves all refs and the `ctx.issues.list` fallback returns `[]` and is never the resolution path. The `list`-match fallback is covered structurally (the stub exists and would surface a regression) but the question "does the host `get` accept a human identifier vs only a UUID" is **not** answerable from the test fakes — that is the runtime probe the live BEAAA drill performs (see the checklist below; record which path fired from the worker log).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 - blocking] RED-gate TAP reporter.** The plan's RED-gate command greps for `not ok` / `# fail N` (TAP markers), but `node --test` defaults to the spec reporter (`✔`/`✖`) when piped, so the grep saw no TAP markers and the gate falsely reported "RED GATE VIOLATED" on the first run. Fixed by adding `--test-reporter=tap` to the gate run; RED then visibly confirmed (`# fail 7`). No behavior change — the tests had correctly failed; only the gate's output format needed forcing.

**2. [Rule 1 - test correctness] Hostile-identifier RED test premise corrected during GREEN.** One net-new editor test asserted `extractRefsFromBody('COU-1 appears', 'C.*-9')` returns `[]`. The locked `prefixFromIdentifier` shape restricts the prefix to `[A-Z][A-Z0-9]{1,7}`, so `'C.*-9'` yields null → extraction correctly falls back to the broad pattern and returns `['COU-1']` (the safe, correct outcome — no regex injection). The test assertion (not the code) was wrong; corrected to assert `prefixFromIdentifier('C.*-9') === null` + the broad-fallback result. `escapeRegex` stays as belt-and-braces.

**3. [Rule 2 - de-BEAAA completeness] Heartbeat extraction site also threaded.** The plan named THREE call sites (editor definition + 2 issue-reader sites). `handleEditorHeartbeat` (editor.ts) was a 4th `extractRefsFromBody(body)` call that would have stayed BEAAA-hardcoded; it now passes `issue.identifier` too. Required for correct portability of the heartbeat TL;DR-input path.

**Test-file naming:** the plan's `files_modified` lists `test/worker/editor.test.mjs`; the existing editor tests live in `test/worker/editor-agent.test.mjs`. Created the net-new `test/worker/editor.test.mjs` for the extraction cases (matches the plan's frontmatter + verify command), leaving `editor-agent.test.mjs` untouched.

## Threat surface

No new network endpoints, auth paths, or schema changes. T-07-01 (excerpt viewer gate) is the documented open item resolved during the drill. T-07-02 (NO_UUID_LEAK) preserved. T-07-03/04 (DoS / ReDoS) accepted — patterns are linear, the prefix is regex-escaped, the `list` fallback fires at most once per invocation. T-07-SC: NO new runtime deps (constraint honoured).

## Quality gates (Task 6 — all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `node scripts/check-css-scope.mjs` | PASS — 140 selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/build-worker.mjs` | PASS — dist/worker.js 2.4 MB |
| `node scripts/build-ui.mjs` | PASS — dist/ui/index.js 686.8 kB |
| `npx tsc --project tsconfig.manifest.json` | PASS — dist/manifest.js version '1.0.0' |
| `node scripts/check-ui-bundle-size.mjs` | PASS — 703,238 bytes ≤ 704,512 ceiling; 0 SheetJS sentinels |
| `node --test "test/**/*.test.mjs"` | 2027 total / **2024 pass / 1 fail / 2 skip** — the 1 fail is the documented pre-existing `situation.artifacts` test; every other test passes |
| `grep -c paperclipInvocation dist/worker.js` | **5** (≥ 5 — SDK NOT externalized) |
| Version literal | `1.0.0` in package.json AND src/manifest.ts:337 AND dist/manifest.js — NO bump |
| Source greps | no `?ids=` in issue-reader.ts / resolve-refs.ts / sdk-ref-fetch.ts; no `BEAAA` literal in roster-rail.tsx; no `across BEAAA` in chat/index.tsx; `prefixFromIdentifier` exported from editor.ts; BOTH issue-reader.ts `extractRefsFromBody` call sites pass a 2nd (identifier) arg |

## Tarball

- **filename:** `clarity-pack-1.0.0.tgz` (repo root)
- **sha256:** `baafb66a4117e0e792e8567ba1370ec585edc9d05acfc43960d025dbe3fc9124`
- **size:** `707108` bytes (707.1 kB)
- **files:** 18 (dist/ + migrations/ + README.md + package.json); 0 src/, 0 test/, 0 .png leaks
- **version:** 1.0.0 (unchanged)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | `a7fe79c` | flip issue.reader + resolve-refs resolution tests to the SDK ctx.issues.get contract |
| 2 (GREEN) | `46ae942` | issue.reader resolves refs via ctx.issues.get + list fallback (+ shared sdk-ref-fetch.ts) |
| 3 (GREEN) | `af63ed5` | resolve-refs resolves via the same SDK fetcher (D-09 enrichment preserved) |
| 4 | `7cd908b` | de-BEAAA both worker extraction regexes via shared prefixFromIdentifier |
| 5 | `7c4af6b` | UI labels — resolved company display name; drop hardcoded BEAAA |
| 6 | (this commit) | full gates + builds + pack + SUMMARY/STATE/ROADMAP |

---

## AUTONOMOUS deploy + live BEAAA Playwright drill (run by the orchestrator — verdicts TBD)

> Performed by the orchestrator window AFTER this build/pack — the build subagent does NOT deploy
> (it lacks the localhost:3100 tunnel + BEAAA SSH + Playwright MCP). Deploy is **PRE-AUTHORIZED**
> (memory `autonomous-deploy-authorization`): the bookended-by-snapshots rule is satisfied by the DO
> daily backup + the rehearsed Phase 1 restore — NO manual pre-deploy snapshot needed. Deploy via
> DEPLOY-RUNBOOK.md Path A. Requires the LOCAL environment (authenticated localhost:3100 tunnel +
> BEAAA SSH `ssh ariclaw`); fail2ban bans rapid SSH (timeouts ≠ down box — space connections). Tunnel
> notes: Radix tabs need a real `browser_click`; read state via `browser_evaluate`; the BROWSER can
> fetch `localhost:3100` REST to confirm host issue shapes, the WORKER cannot.
>
> Install the tarball above (verify sha256 `baafb66a4117e0e792e8567ba1370ec585edc9d05acfc43960d025dbe3fc9124`).

1. **Chips resolve (the headline fix).** Open a BEAAA task whose body contains a `BEAAA-NNN`
   reference; click into the Reader tab (`browser_click` the Radix tab); `browser_evaluate` the chip
   DOM — assert at least one ref chip renders the referenced issue's real title + status, NOT
   `· unknown`. **Verdict: TBD.**
2. **Which path fired (the SDK probe).** Tail the worker log during step 1; record whether
   `ctx.issues.get` resolved the identifier directly OR the `ctx.issues.list`-match fallback fired.
   This is the runtime answer to "does host `issues.get` accept a human identifier vs only a UUID"
   (07-RESEARCH §3 open question). **Verdict: TBD.**
3. **`_viewer_can_read` open item (T-07-01).** From the browser, fetch `localhost:3100` REST for a
   referenced issue and confirm whether the excerpt rendered in the chip matches the viewer's
   permitted view — i.e. whether `ctx.issues.get` enforces viewer perms server-side. **Verdict: TBD.**
   If it does NOT enforce, file a follow-up to gate excerpts (do NOT block this plan).
4. **Portability sanity.** On the live instance, confirm the prefix-derived extraction matches the
   instance's own prefix (BEAAA on BEAAA) and that a stray cross-company token in a body is NOT
   chip-ified. **Verdict: TBD.**
5. **Labels.** Confirm the chat roster header + global-search placeholder show the resolved company
   name (or URL prefix), not the literal `BEAAA`. **Verdict: TBD.**

## Orchestrator deploy status (2026-05-28) — gates re-verified + pushed; deploy BLOCKED on fail2ban (Path B awaits operator)

The orchestrator window independently re-ran the full gate battery (trust-but-verify; project rule "don't trust executor summaries — verify against running code") and all gates reproduced green:

- `npx tsc --noEmit` clean; `check-css-scope` 140 scoped; worker(2.4 MB)+UI(703,238 B)+manifest builds OK; `check-ui-bundle-size` 703,238 ≤ 704,512 (1,274 B headroom); `grep -c paperclipInvocation dist/worker.js` = 5; version `1.0.0` in package.json + src/manifest.ts + dist/manifest.js.
- Full suite reproduced **2027 total**, only the documented pre-existing `situation.artifacts` test fails. Two transient FAILs during the loaded full-suite run (`visual/sketch-regression 03-bulletin.png` waitForLoadState timeout; `chat/chat-messages U7 WATCHDOG-FIRE-AND-FORGET` 120 ms > 85 ms timing) both **PASS in isolation** (4/4 and 29/29) — confirmed machine-load flakes, not regressions.
- All source greps reproduced (no `?ids=`, no `BEAAA` labels, `prefixFromIdentifier` exported, both call sites pass the identifier).

**Pushed:** origin/master advanced `4f11bf8..e4c206f` (all 10 local commits incl. the 6 plan commits). `git log origin/master..HEAD` is empty (runbook §1 pre-flight satisfied).

**Deploy — Path A started, then SSH blocked mid-flight:**
- `ssh ariclaw whoami` → `root` (Path A selected).
- Built + `npm pack` → `clarity-pack-1.0.0.tgz` sha256 `baafb66a4117e0e792e8567ba1370ec585edc9d05acfc43960d025dbe3fc9124` / 707,108 B (reproducible — matches the executor's pack byte-for-byte).
- Upload (rm-first dance, runbook §3 A2) **SUCCEEDED**; remote `sha256sum /tmp/clarity-pack-1.0.0.tgz` = `baafb66a…` (matches). **The tarball is staged + SHA-verified on the box.**
- The §3 A3 install here-string then timed out **"during banner exchange"**, and a single probe 90 s later got a full TCP connect timeout — the classic **fail2ban DROP** signature (gotcha §10; several rapid connections whoami+rm+scp+sha tripped the jail). Eric hardens SSH on every box (likely a long bantime). Per the operator instruction "do NOT retry-spam; STOP and hand me Path B," the orchestrator stopped Path A rather than fight the ban (the live drill in the section above ALSO needs the SSH tunnel, which is equally blocked).

**Handover = DEPLOY-RUNBOOK §3-bis Path B (SSH-independent):** flip repo PUBLIC → DO Web Console paste the §B3 clone-build-install block (it produces the identical artifact; `grep -c paperclipInvocation dist/worker.js` must print ≥ 5, NOT 0) → flip repo PRIVATE. Expected tail `key=clarity-pack status=ready version=1.0.0 id=a763176a-…`. ALTERNATIVELY, once fail2ban releases (~15–30 min), a single Path-A retry of just the §3 A3 install here-string works — the verified tarball is already at `/tmp/clarity-pack-1.0.0.tgz` on the box.

**The 5 live-drill verdicts above remain TBD** — they are the runtime probe (SDK get-by-identifier path + `_viewer_can_read` T-07-01) and the proof that flips READER-03/04 to Implemented. READER-03/04 stay un-flipped until the live chip-resolution drill PASSES post-deploy.

## Self-Check: PASSED

- Created files exist: `src/worker/handlers/sdk-ref-fetch.ts`, `test/worker/editor.test.mjs`, `07-01-SUMMARY.md`, `clarity-pack-1.0.0.tgz` — all FOUND.
- Per-task commits exist: `a7fe79c`, `46ae942`, `af63ed5`, `7cd908b`, `7c4af6b` — all FOUND.
- Modified source/test files staged + committed across Tasks 1–5; full gate battery green (Task 6) except the documented pre-existing `situation.artifacts` test.
- Orchestrator: gates re-verified green, pushed to origin/master, tarball uploaded + SHA-verified on the box; install blocked by fail2ban → Path B handed to operator; live-drill verdicts TBD pending deploy.
