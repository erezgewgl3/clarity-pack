---
quick_id: 260524-sm8
type: drill
status: complete
completed: 2026-05-25
tarball: clarity-pack-1.0.0-rc.6.tgz
tarball_sha256: 063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830
tarball_size_bytes: 146217
target: countermoves.gl3group.com (Hostinger VPS 82.29.197.74)
operator: eric
drill_pass: true
gaps_found: []
snapshot_id: skipped-by-operator-discretion
coexist_evidence:
  plugin_id_uuid_preserved: true
  plugin_id_uuid: 0d4fc40a-0541-4b67-8979-9d346cb9c07b
  version_before: 1.0.0-rc.5
  version_after: 1.0.0-rc.6
  manifest_unchanged: true
  schema_unchanged: true
  migration_count_delta: 0
  byte_identical_data: not-measured-rc6-is-ui-tier-only
contract_verified: true
contract_proof: devtools-network-tab-3-call-cluster
test_issue: COU-2391
toggle_cycles_observed: 2
network_observations:
  ac_toggle_status: 200
  ac_toggle_latency_ms_range: "162-195"
  issue_reader_refetch_status: 200
  issue_reader_refetch_latency_ms_range: "181-199"
  reader_ac_autostatus_refetch_status: 200
  reader_ac_autostatus_refetch_latency_ms_range: "174-183"
  total_refetch_latency_ms_range: "360-380"
  rc5_baseline: refetches-absent
defects_filed:
  - D-1: paperclip-api-url-env-poisoning (FIXED-IN-DRILL via commit d80bc23)
  - D-2: jq-recursive-walker-for-auth-token (FIXED-IN-DRILL via commit d80bc23)
  - D-3: companies-column-name-issue_prefix (FIXED-IN-DRILL via commit 90e760f)
  - D-4: company-id-must-be-uuid-not-prefix (FIXED-IN-DRILL via commit 90e760f)
  - D-5: COU-2391-weak-rc6-test-case (NEW MemPalace drawer — runbook)
  - D-6: chat-audit-comment-format-inconsistency (NEW MemPalace drawer — decisions; pre-existing, NOT rc.6 regression)
  - D-7: reader-to-chat-continuation-gap (NEW MemPalace drawer — decisions; routes to /gsd:discuss-phase + /gsd:ui-phase)
tags: [drill, operator, countermoves, rc.6, ac-toggle, reader-refetch, snapshot-bookended, devtools-network-tab-proof]
---

# 260524-sm8 Drill Summary — clarity-pack-1.0.0-rc.6.tgz on Countermoves

## One-liner

**rc.6 manual AC toggle → Reader refetch contract operator-verified PASS on live Countermoves Paperclip — 3-call cluster (`ac-toggle` → `issue.reader` refetch → `reader.ac.autostatus` refetch) observed in DevTools Network panel across 2 complete toggle cycles; all 200; ~360-380 ms total refetch latency; rc.5's stale-data-until-F5 regression is GONE.**

---

## Contract Under Test

rc.5 → rc.6 is a UI-tier-only change. Manifest unchanged. No schema, no migration, no capability list change, no worker handler change, no Editor-Agent change.

When a manual AC checkbox toggle on the Reader view resolves with `{ok:true}`, `AcChecklist.onMutated` fires `usePluginData('issue.reader').refresh()` AND `usePluginData('reader.ac.autostatus').refresh()` in `ReaderViewReady`. The cached Reader payload (TL;DR, blocker chain, deliverable preview, AC items, auto-status caption) re-fetches without a manual page reload. On `{ok:false}`, no refresh fires.

rc.5 regression behaviour confirmed FIXED: the AC item's checkbox visually flipped but Reader-side data (TL;DR / autostatus chip) stayed stale until a manual page reload. In rc.6, the Network tab shows the two refetch rows fire automatically within ~1-2s of every successful toggle.

Source provenance (rc.6, quick `260524-s2y` SUMMARY):
- `src/ui/surfaces/reader/index.tsx` line 308 — `onMutated={() => { void refresh(); void refreshAcAuto(); }}`
- `src/ui/surfaces/reader/ac-checklist.tsx` line 155 — conditional `onMutated?.()` inside `.then((res) => res.ok === true)`
- Build provenance: `clarity-pack-1.0.0-rc.6.tgz` sha256 `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830`, built by commits `e35cbe6` (feat) · `82fc847` (test) · `bd50484` (chore version bump) — see [`260524-s2y-SUMMARY.md`](../260524-s2y-fix-ac-toggle-invalidates-manifest-gap-a/260524-s2y-SUMMARY.md).

---

## Pre-drill State (Step 7 evidence)

- Plugin id pre-upgrade: `0d4fc40a-0541-4b67-8979-9d346cb9c07b`
- Pre-upgrade version: `1.0.0-rc.5`, status `ready`
- Tarball under test: `clarity-pack-1.0.0-rc.6.tgz`, sha256 `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830`, 146,217 bytes

---

## Mid-drill In-session Corrections (already committed)

Three commits landed during the drill itself, addressing operator-gotchas surfaced by the live run. These are documented as defects D-1 through D-4 below.

| Commit | What it fixed | DRILL.md step |
|--------|---------------|---------------|
| `0b2b569` | Initial DRILL.md assembly (Task 1) | n/a — baseline |
| `d80bc23` | Step 2: drop bad `export PAPERCLIP_API_URL` (violated `paperclip-auth-pattern` GOTCHA 1 → 403s); fix jq path from `.profiles[].token` to recursive `.. \| objects \| select(.token? ...) \| .token` walker (auth.json on Countermoves has top-level keys `{credentials, version}` keyed by apiBase, NOT a `.profiles` field) | Step 2 |
| `90e760f` | Step 2: fix wrong column name `prefix` → `issue_prefix`; replace static `PAPERCLIP_COMPANY_ID=COU` (prefix) with inline psql UUID derivation (safety CLI `--company-id` requires UUID, not prefix string) | Step 2 |

---

## Per-step PASS/FAIL Table

| Step | Description | Result | Notes |
|------|-------------|--------|-------|
| 1 | SSH in to Countermoves VPS | **PASS** | `eric@82.29.197.74` reached via `countermoves_vps_ed25519` key. |
| 2 | Canonical env re-export | **PASS-after-3-patches** | `PAPERCLIP_API_URL` left unset (gotcha #1 — see D-1); recursive jq walker yielded 58-char `pcp_board_*` token (D-2); defensive `unset PAPERCLIP_INSTANCE_ID` confirmed; `COMPANY_UUID` derived as `62b33a78-4f4a-4ab7-9977-a27be86f9853` via inline psql against `companies.issue_prefix='COU'` (D-3 + D-4). |
| 3 | Confirm `paperclip_restoring` DB exists | **PASS** | Idempotent CREATE confirmed via "already exists" grep — DB present from prior drills. |
| 4 | SCP tarball + sha256 verify | **PASS** | `-rw-rw-r-- 1 eric eric 146217 May 25 05:29` + sha256 `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830` — exact match against build artifact. |
| 5 | Pre-install snapshot (bookend) | **SKIPPED** | Skipped at operator discretion. Deviation from CLAUDE.md bookended-by-snapshots rule. Mitigation: rc.5 → rc.6 is UI-tier-only (no schema/migration/manifest change per `260524-s2y-SUMMARY.md`); fallback rollback path is `paperclipai plugin uninstall clarity-pack` followed by re-install of `rc.5.tgz` — plugin-namespace data preserved across uninstall by COEXIST guarantee #6 (additive-only schema). See Deviations section. |
| 6 | Verify snapshot | **SKIPPED** | Predicated on Step 5. |
| 7 | Upgrade rc.5 → rc.6 (gated bypass) | **PASS — COEXIST #6 verified at identity layer** | `--gate-bypass` honored; REHEARSAL.md row appended automatically. Uninstall clean. `install-helper.sh` extracted + npm-installed 96 packages in 11s. Post-install `plugin list`: `key=clarity-pack status=ready version=1.0.0-rc.6 id=0d4fc40a-0541-4b67-8979-9d346cb9c07b` — **UUID identical pre/post-upgrade**, version moved rc.5 → rc.6. (Row counts not captured pre/post because Step 5 snapshot was skipped; the load-bearing identity evidence — plugin-id UUID preservation — holds.) |
| 8 | Post-install smoke | **PASS-with-expected-skip** | After fixing `--company-id` from prefix → UUID (D-4): 4/5 PASS — `health: PASS`, `issues: PASS`, `agents: PASS`, `plugins: PASS` + `heartbeat: SKIPPED` ("no editor-agent id" — expected, Editor-Agent is Phase 5 scope). Initial run with prefix failed at `issues: HTTP 403` (root cause D-4). |
| 9 | rc.6 contract — DevTools Network observation | **PASS — load-bearing assertion confirmed** | See Step 9 sub-table below. |
| 9.f | Spot-check other 4 Reader paths | **PASS** | Operator confirmed: "I did 9F. It looks like it's working." |
| 10 | Rollback path | **not-executed** | Nothing broke. |
| 11 | REHEARSAL.md row appended | **PASS** | By gate-bypass at Step 7; `gate: bypass honored; entry appended to runbook/REHEARSAL.md`. |

### Step 9 expanded sub-table — DevTools Network tab observation (the load-bearing proof)

Test issue: **COU-2391**. ≥2 complete toggle cycles observed in DevTools Network panel.

| Sub-step | Cue | BEFORE | AFTER | Result |
|----------|-----|--------|-------|--------|
| 9.a | Issue id picked | n/a | `COU-2391` | **PASS** |
| 9.b | Reader-side captures (snapshot) | TL;DR placeholder (Editor-Agent never compiled against COU-2391); blocker terminal absent; deliverable preview absent; AC checklist statuses captured; auto-status caption frozen at `auto: ✓ via agent · 12h ago` (DIST-03 detection from prior agent run) | n/a (pre-toggle) | **PASS** (captured) |
| 9.c | `ac-toggle` action — Network tab | n/a | response `200`, latency 162-195 ms across cycles | **PASS — {ok:true} resolution path triggers refresh chain** |
| 9.d-A | `issue.reader` refetch immediately after toggle | (was absent in rc.5) | response `200`, 0.4 kB, latency 181-199 ms | **PASS — refetch fired** |
| 9.d-B | `reader.ac.autostatus` refetch immediately after toggle | (was absent in rc.5) | response `200`, 0.4 kB, latency 174-183 ms | **PASS — refetch fired** |
| 9.d-C | Total refetch latency per cycle | n/a | ~360-380 ms | **PASS — within ~1-2s contract** |
| 9.d-D | NO 403/500 across the cluster | n/a | all 200 | **PASS** |
| 9.e | Regression check — rc.5's stale-data-until-F5 behaviour is GONE | rc.5 would have shown the two refetch rows ABSENT | both refetch rows PRESENT and firing | **PASS — load-bearing regression assertion confirmed** |
| 9.f | Other 4 Reader paths spot-check (TL;DR / blocker chain / deliverable preview / auto-status chip + console clean) | (state before toggle) | unchanged; no new console errors; operator confirmed "It looks like it's working" | **PASS** |

**Network tab evidence summary:** Each `ac-toggle` POST (200, 162-195 ms) is followed immediately by `issue.reader` refetch (200, 181-199 ms, 0.4 kB) and `reader.ac.autostatus` refetch (200, 174-183 ms, 0.4 kB). All 200; no 403/500. Total refetch chain ~360-380 ms per cycle. In rc.5 those two refetch rows would have been ABSENT — that absence was the symptom the rc.6 wiring closes. The cluster fired across **≥ 2 complete toggle cycles**, ruling out a one-off.

---

## COEXIST #6 Evidence

rc.6 is a UI-tier-only change. Manifest unchanged. Schema delta: zero (no new migrations). Capability list: unchanged. Worker handlers: unchanged (`src/worker/handlers/ac-checklist.ts` is byte-identical to rc.5 — does the UPDATE, returns `{ok:true|false}`).

Identity-layer evidence (the load-bearing COEXIST #6 proof when row-count pre/post is unavailable):

| Property | Pre-upgrade (rc.5) | Post-upgrade (rc.6) |
|----------|--------------------|-----------------------|
| Plugin key | `clarity-pack` | `clarity-pack` |
| Plugin id UUID | `0d4fc40a-0541-4b67-8979-9d346cb9c07b` | `0d4fc40a-0541-4b67-8979-9d346cb9c07b` |
| Status | `ready` | `ready` |
| Version | `1.0.0-rc.5` | `1.0.0-rc.6` |
| Manifest delta | n/a | NONE (UI-tier-only change) |
| Migration delta | n/a | ZERO (no `migrations/00NN_*.sql` added) |

The plugin-id UUID survived uninstall → install — that's COEXIST #6 at the identity level. Row counts in `plugin_clarity_pack_cdd6bda4bd.*` were not captured pre/post (snapshot skipped — see Deviations), but the data-layer guarantee holds by construction because rc.6 ships no schema or migration delta.

---

## Smoke Result (Step 8)

Initial run with `--company-id=COU` (prefix): FAIL at `issues: HTTP 403` (root cause D-4 — `--company-id` requires UUID, not prefix).

Final run with `--company-id=$COMPANY_UUID` (62b33a78-4f4a-4ab7-9977-a27be86f9853):

```
health: PASS
issues: PASS
agents: PASS
plugins: PASS
heartbeat: SKIPPED  (no editor-agent id — expected; Editor-Agent is Phase 5 scope)
```

4/5 PASS + 1 expected-skip. Smoke verdict: **PASS-with-expected-skip**. The heartbeat-skip is structurally expected on Countermoves — the Editor-Agent has not yet been provisioned (Phase 5 territory); the safety CLI emits SKIPPED rather than FAIL when the editor-agent id is unconfigured.

---

## Deviations

1. **Step 5 (pre-install snapshot) — SKIPPED at operator discretion.** Departure from CLAUDE.md's bookended-by-snapshots rule. Mitigation rationale: rc.5 → rc.6 is UI-tier-only with NO schema change, NO migration, NO manifest change, NO worker handler change (per [`260524-s2y-SUMMARY.md`](../260524-s2y-fix-ac-toggle-invalidates-manifest-gap-a/260524-s2y-SUMMARY.md)); the fallback rollback path is `pnpm paperclipai plugin uninstall clarity-pack` followed by re-install of `clarity-pack-1.0.0-rc.5.tgz` — plugin-namespace data is preserved across uninstall by COEXIST guarantee #6 (additive-only schema). The plugin-id UUID survived the upgrade (see COEXIST #6 Evidence) — the identity-layer evidence holds even without the data-layer row-count comparison the snapshot would have enabled.

2. **Step 6 (verify snapshot) — SKIPPED.** Predicated on Step 5; no snapshot to verify.

3. **Step 2 (canonical env re-export) — required 3 in-flight patches.** The drill walkthrough as initially assembled (`0b2b569`) carried 4 operator gotchas (D-1 through D-4) that surfaced on the live run and were patched into DRILL.md before the affected step executed cleanly. All four patches are committed (`d80bc23`, `90e760f`) and the walkthrough on disk now reflects the working forms. Future drills inherit the fixes.

4. **Step 9 test issue COU-2391 is a weak rc.6 test case (D-5).** The issue has no derived/agent-evaluated data that would visibly change on toggle (no cached TL;DR; auto-status frozen 12h ago and decoupled from manual state by Plan 05-03's A3 no-conflict design; the `ac-checklist` worker handler does not post an audit comment on toggle). Every visible signal that would normally change is either absent, decoupled, or frozen — making the DevTools Network tab the only deterministic proof on this issue. That tab observation is what closed the drill. Mitigation for next drill: see D-5 mitigation in MemPalace Filings.

---

## Defects Filed (D-1 through D-7)

### D-1 — DRILL Step 2 exported `PAPERCLIP_API_URL` (FIXED IN DRILL — commit `d80bc23`)

- **Violation:** `paperclip-auth-pattern` MemPalace drawer GOTCHA 1 — "Don't export `PAPERCLIP_API_URL` when running snapshot. If set, paperclipai CLI's stored auth (keyed to `http://localhost:3100`) won't match. Child process gets 403 'Board access required' on plugin list."
- **Symptom:** every Step block in the initial DRILL re-poisoned env.
- **Fix:** replaced with defensive `unset PAPERCLIP_API_URL` across all 7 VPS blocks; safety CLI smoke now passes URL via `--api-url=...` flag instead.
- **Status:** RESOLVED in-flight; DRILL.md on disk reflects the working form.

### D-2 — DRILL Step 2 jq path `.profiles[].token` wrong shape (FIXED IN DRILL — commit `d80bc23`)

- **Symptom:** `auth.json` on Countermoves has top-level keys `{credentials, version}` keyed by apiBase string (per `paperclip-auth-pattern` drawer); does NOT have a `.profiles` field. Empty token export → child procs 403.
- **Fix:** replaced with recursive walker `jq -r '.. | objects | select(.token? // empty | type == "string") | .token' | head -1` — works against any auth.json shape; yields a 58-char `pcp_board_*` token.
- **Status:** RESOLVED in-flight.

### D-3 — DRILL Step 2 SELECT used non-existent column `prefix` (FIXED IN DRILL — commit `90e760f`)

- **Symptom:** the company-lookup `SELECT id FROM companies WHERE prefix='COU'` errored at `column "prefix" does not exist`.
- **Root cause:** actual column is `issue_prefix` (UNIQUE-indexed). Discovered via live `\d companies` introspection.
- **Fix:** corrected the SELECT to `WHERE issue_prefix='COU'`.
- **Status:** RESOLVED in-flight. Full `companies` schema captured as MemPalace drawer `drawer_clarity_pack_runbook_25ee9929ff9f1b17ce2ea0aa` (clarity_pack/runbook) — drop-in reference for future drills.

### D-4 — DRILL Step 2 default `PAPERCLIP_COMPANY_ID=COU` is the wrong shape (FIXED IN DRILL — commit `90e760f`)

- **Symptom:** safety CLI smoke fails at `issues: HTTP 403` (the first scoped-by-company check) when `--company-id` is passed the prefix string.
- **Root cause:** safety CLI `--company-id` requires the company UUID, NOT the prefix.
- **Fix:** inline `psql "$DB_URL" -tAc "SELECT id FROM companies WHERE issue_prefix='COU';"` derivation makes the UUID the default. Derived UUID for Countermoves: `62b33a78-4f4a-4ab7-9977-a27be86f9853`.
- **Status:** RESOLVED in-flight.

### D-5 — COU-2391 is a weak rc.6 test case (NEW MemPalace drawer — `clarity_pack/runbook`)

- **Observation:** the test issue used has no derived/agent-evaluated data that would visibly change on toggle:
  - No cached TL;DR (placeholder permanent because the Editor-Agent never ran a compile against it).
  - Auto-status subline is frozen at 12h ago and decoupled from manual state — per Plan 05-03 design (`ac-checklist.tsx` lines 8-15): "Manual is the source of truth (A3 no-conflict)"; the `auto: ✓ via agent · 12h ago` line reflects an agent's independent detection and does NOT change when the human toggles.
  - The `ac-checklist` worker handler (`src/worker/handlers/ac-checklist.ts`) does NOT post an audit comment on toggle — it does the UPDATE only. The chat audit comment present on COU-2391 was posted by a SEPARATE agent run 12h ago (see D-6).
- **Consequence:** the rc.6 contract is firing but INVISIBLE to the naked eye on this issue. Every visible signal that would normally change is either absent, decoupled, or frozen. The DevTools Network tab is the only deterministic proof on COU-2391 — and that was what closed the drill.
- **Mitigation for next drill (file as MemPalace drawer `clarity_pack/runbook`):** require either (a) a test issue WITH cached TL;DR + multiple AC sources whose toggle materially changes the autostatus derivation, OR (b) **mandatory DevTools Network observation as the canonical Step 9 proof, with a screenshot or HAR capture attached to the SUMMARY**. Document this in the next drill walkthrough's Step 9 preamble.
- **Severity:** OPERATOR-RUNBOOK (no code change required; affects drill repeatability and future operator confidence).

### D-6 — Chat audit comment format inconsistency (NEW MemPalace drawer — `clarity_pack/decisions`)

- **Pre-existing observation (NOT a rc.6 regression):** the agent-posted audit comment on COU-2391 reads `AC: 1: ✓ AC[2]: done` — inconsistent formatting between row 1 (`AC: 1: ✓` — canonical grammar) and row 2 (`AC[2]: done` — bracket-alternate grammar). The Plan 05-03 (DIST-03) AC-autostatus scanner accepts both grammars by design (two regex grammars per Plan 05-03 worker handler `src/worker/handlers/reader-ac-autostatus.ts`), but a mixed-format audit comment is visually noisy.
- **Source attribution:** the comment is NOT from the `ac-checklist` worker handler (that does no comment insert — confirmed by reading `src/worker/handlers/ac-checklist.ts`). It was posted by a SEPARATE agent run 12h ago that generated the audit message during a DIST-03 distribution drill.
- **Severity:** POLISH-BACKLOG. No rc.6 relevance; no blocking. Worth a tracked follow-up so whichever agent generates this format emits a consistent single grammar (recommend canonical `AC: <id>: ✓` to match the operator's clipboard A4 copy-marker button per Plan 05-03).

### D-7 — Reader → Chat continuation gap (NEW MemPalace drawer — `clarity_pack/decisions`; routes to `/gsd:discuss-phase` + `/gsd:ui-phase`)

- **NEW UX finding raised by Eric** during the drill. Observed behaviour: the "Continue in chat →" golden button at the top of the Reader tab takes the user to the Chat tab but creates/opens a NEW task/topic instead of resuming the existing employee-chat thread tied to this issue.
- **Eric's verbatim quote:** "when I'm in the reader and I'm looking at something, at one of the items, and I want to continue to chat with the agent on this topic, there's no real way to do it. As soon as I click the golden button, it takes me to the chat, but it tries to open a new task. There's the usability issue here. Then I need a UI/UI expert to address and figure out what the right plan is."
- **Inferred root cause** (from worker-handler inventory):
  - `src/worker/handlers/chat-true-task.ts` is the `chat.createTrueTask` action handler (per Plan 04.1-02) — the operator-composer entry point onto the shared `createTrueTask` helper. This handler always CREATES.
  - `src/worker/handlers/chat-open-for-issue.ts` is the `chat.openForIssue` DATA handler (per Plan 04.2-01 RCB-02) — deterministic issue-lineage routing for the Reader-view Continue-in-chat primitive. Returns one of: `topic-itself` / `new-topic-needed` / `existing-topic`. This handler is the find-or-open routing surface.
  - Likely defect: the Reader's "Continue in chat →" button invokes (or routes through UI logic that ends up invoking) the create-path even when the `chat.openForIssue` route is `existing-topic`. Confirm by reading the Reader `index.tsx` button click handler and tracing the dispatch.
- **Open design questions for the discuss-phase (NOT to be resolved in this SUMMARY — Eric explicitly wants this routed to a UX expert):**
  1. Should the button resume the MOST RECENT topic on this issue, or always land in a roster picker?
  2. What if no existing topic exists — silently create or prompt?
  3. What does the agent see (continuation in their context, or fresh thread)?
- **Severity:** UX-DESIGN-NEEDED. Phase 4.x Employee Chat scope; rc.6 unblocks Phase 5 closure, but this is in the polish backlog ahead of it.
- **Next step:** `/gsd:discuss-phase 4.2` (or a follow-on number) + `/gsd:ui-phase` once design questions are settled.

---

## Production Status (after the drill)

- Live on Countermoves: `clarity-pack` v `1.0.0-rc.6`, status `ready`, plugin id `0d4fc40a-0541-4b67-8979-9d346cb9c07b`.
- Rollback: NOT executed; not needed.
- COEXIST guarantees preserved: #3 (additive-only schema) holds (no migrations added in rc.6); #6 (clean uninstall preserves data) holds at the identity layer (plugin-id UUID preserved across uninstall → install).
- rc.6 contract: operator-confirmed live. The Reader↔AC-toggle refresh chain is the canonical 3-call cluster (`ac-toggle` → `issue.reader` refetch → `reader.ac.autostatus` refetch).
- REHEARSAL.md: gate-bypass row auto-appended by Step 7.

---

## MemPalace Filings

Four drawers to be filed by the orchestrator via the `mempalace_add_drawer` MCP tool. The schema-correction drawer `drawer_clarity_pack_runbook_25ee9929ff9f1b17ce2ea0aa` is already filed (mid-drill, captures `companies` schema introspection) — do NOT re-file.

| # | Wing / Room | Title | Source |
|---|-------------|-------|--------|
| 1 | `clarity_pack/decisions` | rc.6 drill PASS closure for 260524-sm8 — Reader refresh contract live-verified | overall verdict + commits + contract proof (this SUMMARY) |
| 2 | `clarity_pack/runbook` | D-5 COU-2391 weak rc.6 test case + mitigation for next drill | this SUMMARY's D-5 entry |
| 3 | `clarity_pack/decisions` | D-6 chat audit comment format inconsistency (polish backlog) | this SUMMARY's D-6 entry |
| 4 | `clarity_pack/decisions` | D-7 Reader → Chat continuation gap (UX-design-needed; routes to /gsd:discuss-phase + /gsd:ui-phase) | this SUMMARY's D-7 entry |

Drawer content blocks for the orchestrator to file are in [`260524-sm8-MEMPALACE-PENDING.md`](./260524-sm8-MEMPALACE-PENDING.md).

---

## Commits Referenced by This Drill

| Hash | Task | Type | Purpose |
|------|------|------|---------|
| `0b2b569` | Task 1 | docs | Initial DRILL.md assembly |
| `d80bc23` | Task 2 mid-drill | docs | DRILL Step 2: drop `PAPERCLIP_API_URL` export (D-1); fix jq recursive walker (D-2) |
| `90e760f` | Task 2 mid-drill | docs | DRILL Step 2: fix `companies.issue_prefix` column (D-3); inline UUID derivation for `--company-id` (D-4) |

Build provenance (rc.6 tarball, from quick `260524-s2y`):

| Hash | Type | Purpose |
|------|------|---------|
| `e35cbe6` | feat | wire usePluginData.refresh from ReaderViewReady to AcChecklist via onMutated |
| `82fc847` | test | pin AC toggle → Reader refresh contract (6 source-grep assertions) |
| `bd50484` | chore | version 1.0.0-rc.5 → 1.0.0-rc.6 |

---

## Self-Check: PASSED

Verified by direct artifact inspection during composition:

- `260524-sm8-PLAN.md` — exists; read in full; Task 3 + Task 4 spec honored verbatim.
- `260524-sm8-DRILL.md` — exists; reflects the patched form (commits `d80bc23`, `90e760f` applied).
- Tarball metadata (sha256, size, built-by commits) — cross-checked against [`260524-s2y-SUMMARY.md`](../260524-s2y-fix-ac-toggle-invalidates-manifest-gap-a/260524-s2y-SUMMARY.md) frontmatter; exact match.
- Worker handler attributions for D-5 / D-6 / D-7 — confirmed by reading `src/worker/handlers/ac-checklist.ts` (no comment insert), `src/worker/handlers/chat-true-task.ts` (always creates), `src/worker/handlers/chat-open-for-issue.ts` (find-or-open routing).
- Plan 05-03 design comment in `src/ui/surfaces/reader/ac-checklist.tsx` lines 8-15 confirms manual-vs-auto-status decoupling (load-bearing for D-5).
- Commits `0b2b569`, `d80bc23`, `90e760f` — present in `git log` (visible in the recent commits list at session start).
