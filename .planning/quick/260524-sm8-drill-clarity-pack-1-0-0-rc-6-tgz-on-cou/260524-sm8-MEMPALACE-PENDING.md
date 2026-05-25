# MemPalace Drawers Pending — 260524-sm8 (rc.6 drill closure)

The executor (this agent) cannot call the `mempalace_add_drawer` MCP tool directly. The drawer content blocks below are ready for the orchestrator to file. Each drawer is one `mempalace_add_drawer` invocation with `wing=clarity_pack` and the specified `room`.

**Note:** The schema-correction drawer `drawer_clarity_pack_runbook_25ee9929ff9f1b17ce2ea0aa` (captures live `companies` schema introspection) was already filed mid-drill and must NOT be re-filed.

---

## Drawer 1 of 4 — clarity_pack / decisions

**Title:** `rc.6 drill PASS closure for 260524-sm8 — Reader refresh contract live-verified on Countermoves 2026-05-25`

**Tags:** `rc.6, ac-toggle, reader-refetch, drill-pass, countermoves, devtools-network-tab-proof, 260524-sm8`

**Body:**

> **Overall verdict: PASS — rc.6 contract verified live on Countermoves 2026-05-25.**
>
> **Contract under test:** rc.5 → rc.6 is a UI-tier-only change. When a manual AC checkbox toggle on the Reader view resolves with `{ok:true}`, `AcChecklist.onMutated` fires `usePluginData('issue.reader').refresh()` AND `usePluginData('reader.ac.autostatus').refresh()` in `ReaderViewReady`. Manifest unchanged; no schema, no migration, no capability change.
>
> **Tarball:** `clarity-pack-1.0.0-rc.6.tgz`, sha256 `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830`, 146,217 bytes. Build provenance: commits `e35cbe6` (feat — wire `usePluginData.refresh` from `ReaderViewReady` to `AcChecklist` via `onMutated`) · `82fc847` (test — 6 source-grep assertions) · `bd50484` (chore — version 1.0.0-rc.5 → 1.0.0-rc.6). Built by quick `260524-s2y`.
>
> **Load-bearing evidence (DevTools Network tab, Countermoves issue COU-2391):** at least 2 complete toggle cycles observed. Each `ac-toggle` POST (200, 162-195 ms) is followed immediately by `issue.reader` refetch (200, 181-199 ms, 0.4 kB) AND `reader.ac.autostatus` refetch (200, 174-183 ms, 0.4 kB). All 200; no 403/500. Total refetch chain ~360-380 ms per cycle. In rc.5 those two refetch rows would have been ABSENT — that absence was the symptom the rc.6 wiring closes.
>
> **COEXIST #6 identity-layer evidence:** plugin id UUID `0d4fc40a-0541-4b67-8979-9d346cb9c07b` preserved across uninstall → install; status `ready`; version moved rc.5 → rc.6. Manifest unchanged from rc.5; migration count delta zero.
>
> **Drill commits (mid-drill DRILL.md patches):**
> - `0b2b569` — initial DRILL.md assembly
> - `d80bc23` — Step 2: drop `PAPERCLIP_API_URL` export (auth-pattern GOTCHA 1); fix jq recursive walker for auth.json token extraction
> - `90e760f` — Step 2: fix `companies.issue_prefix` column name; inline psql UUID derivation for safety CLI `--company-id`
>
> **Operator confirmation:** Eric ran the drill end-to-end on Countermoves 2026-05-25 and reported "I did 9F. It looks like it's working." Per-step PASS/FAIL + Step 9 sub-table observations in [`260524-sm8-SUMMARY.md`](../.planning/quick/260524-sm8-drill-clarity-pack-1-0-0-rc-6-tgz-on-cou/260524-sm8-SUMMARY.md).
>
> **Production status:** clarity-pack v1.0.0-rc.6 live on Countermoves, status `ready`. Rollback not executed (not needed). REHEARSAL.md gate-bypass row auto-appended at Step 7.
>
> **Defects surfaced (4 mid-drill runbook patches, 3 forward-looking memories):** D-1 thru D-4 fixed in-flight via commits `d80bc23` + `90e760f`. D-5 / D-6 / D-7 filed as separate MemPalace drawers (see Drawers 2-4 of this filing).
>
> **Next forward steps:** D-5 (operator-runbook mitigation for next drill); D-6 (polish backlog — chat audit comment format consistency); D-7 (UX-design-needed — Reader→Chat continuation gap, routes to `/gsd:discuss-phase 4.2` + `/gsd:ui-phase`). rc.6 unblocks Phase 5 closure work; D-7 is in the polish backlog ahead of Phase 5 final.

---

## Drawer 2 of 4 — clarity_pack / runbook

**Title:** `D-5 COU-2391 is a weak rc.6 test case — require richer test issue OR DevTools Network observation as canonical Step 9 proof`

**Tags:** `rc.6, ac-toggle, reader-refetch, drill-runbook, operator-gotcha, test-issue-selection, 260524-sm8, D-5`

**Body:**

> **Finding (260524-sm8 drill, 2026-05-25):** the test issue `COU-2391` used for the in-browser Step 9 verification of the rc.6 AC-toggle → Reader-refetch contract has NO derived/agent-evaluated data that would visibly change on toggle. Specifically:
>
> 1. **No cached TL;DR.** The Reader's TL;DR slot shows a placeholder permanently because the Editor-Agent never ran a compile against COU-2391 (Editor-Agent is Phase 5 scope; Countermoves does not yet have one provisioned).
> 2. **Auto-status caption is frozen and decoupled.** The `auto: ✓ via agent · 12h ago` line reflects an INDEPENDENT agent detection from 12h prior and does NOT change when the human toggles the manual AC. This is BY DESIGN per Plan 05-03's A3 no-conflict locked decision: "Manual is the source of truth (A3 no-conflict). The MANUAL checkbox JSX is structurally untouched (Phase 2 regression-pin)." See `src/ui/surfaces/reader/ac-checklist.tsx` lines 8-15.
> 3. **The `ac-checklist` worker handler does NOT post an audit comment on toggle.** Confirmed by reading `src/worker/handlers/ac-checklist.ts`: the handler is exactly one `UPDATE` statement + return `{ok:true|false}`. No comment insert. The chat audit comment present on COU-2391 was posted by a SEPARATE agent run 12h ago during a DIST-03 drill (this is D-6 in the SUMMARY).
>
> **Consequence:** the rc.6 contract is firing but INVISIBLE to the naked eye on COU-2391. Every visible signal that would normally change is either absent, decoupled, or frozen. The DevTools Network tab is the ONLY deterministic proof on this issue. The drill closed because Eric opened DevTools and observed the 3-call cluster (`ac-toggle` → `issue.reader` refetch → `reader.ac.autostatus` refetch, all 200, total ~360-380 ms) across 2 cycles.
>
> **Mitigation for next drill — pick ONE of (a) or (b):**
>
> - **(a) Use a richer test issue.** Require a test issue WITH (i) a cached TL;DR generated by a real Editor-Agent run AND (ii) multiple AC sources whose toggle materially changes the autostatus derivation (e.g., toggling a manual AC that also has agent-detected evidence in a comment marker — then the Reader-side autostatus caption visibly updates because the manual checkbox changed even though the auto-detection-source comment did not). Operator should pre-stage such an issue on Countermoves before the drill.
>
> - **(b) Mandate DevTools Network observation as the canonical Step 9 proof.** Update the drill walkthrough's Step 9 preamble to require: (i) DevTools open with Network tab filtered to plugin endpoints; (ii) at least 2 toggle cycles captured; (iii) optionally a HAR file or screenshot attached to the SUMMARY for permanent evidence. Document the expected 3-call cluster shape in the walkthrough: `ac-toggle` (POST 200) → `issue.reader` (POST 200, ~0.4 kB) → `reader.ac.autostatus` (POST 200, ~0.4 kB) within ~1-2s.
>
> **Recommendation:** apply BOTH (a) and (b) in the next drill walkthrough — (a) maximises operator confidence at the visual layer; (b) is the structural fallback when visual cues are absent or decoupled (the situation that surfaced this finding).
>
> **Severity:** OPERATOR-RUNBOOK. No code change required. Affects drill repeatability and future operator confidence in declaring PASS without manually opening DevTools every time.
>
> **References:**
> - 260524-sm8 SUMMARY: `.planning/quick/260524-sm8-drill-clarity-pack-1-0-0-rc-6-tgz-on-cou/260524-sm8-SUMMARY.md` (D-5 entry + Step 9 sub-table)
> - Plan 05-03 A3 no-conflict design: `src/ui/surfaces/reader/ac-checklist.tsx` lines 8-15
> - rc.6 wiring source: `src/ui/surfaces/reader/index.tsx` line 308 + `src/ui/surfaces/reader/ac-checklist.tsx` line 155

---

## Drawer 3 of 4 — clarity_pack / decisions

**Title:** `D-6 chat audit comment format inconsistency on COU-2391 (mixed grammars AC: 1: ✓ vs AC[2]: done) — polish backlog`

**Tags:** `rc.6, ac-toggle, dist-03, comment-grammar, polish-backlog, 260524-sm8, D-6, plan-05-03`

**Body:**

> **Finding (260524-sm8 drill, 2026-05-25) — pre-existing observation, NOT a rc.6 regression.**
>
> The agent-posted audit comment on COU-2391 reads `AC: 1: ✓ AC[2]: done` — inconsistent formatting between row 1 (`AC: 1: ✓` — the canonical grammar per Plan 05-03) and row 2 (`AC[2]: done` — the bracket-alternate grammar per Plan 05-03).
>
> **Plan 05-03 (DIST-03) intentionally accepts BOTH grammars in the scanner** to be lenient on agent output (per `src/worker/handlers/reader-ac-autostatus.ts` — two regex grammars: canonical `AC: <id>: <state>` and bracket alternate `AC[<id>]: <state>`, multiline, case-insensitive on state ∈ {✓, done, complete, x}). The scanner does the right thing on mixed input.
>
> **Source attribution (NOT the `ac-checklist` worker handler):** the comment is NOT from `src/worker/handlers/ac-checklist.ts` (that handler does NO comment insert — confirmed by reading the file: it is exactly one `UPDATE` statement + return). The mixed-grammar audit comment was posted by a SEPARATE agent run 12h ago during a DIST-03 distribution drill. Likely candidates for the emitting code path: an Editor-Agent compile pass that summarised AC state in a structured comment, OR the DIST-03 drill's manual operator-side seeding.
>
> **Severity:** POLISH-BACKLOG. No rc.6 relevance; no blocking; the scanner handles it correctly. Worth a tracked follow-up so whichever agent generates this format emits a CONSISTENT single grammar.
>
> **Recommendation:** standardise on the canonical `AC: <id>: ✓` grammar (matches the operator's clipboard A4 copy-marker button per Plan 05-03's UI affordance — `src/ui/surfaces/reader/ac-checklist.tsx` lines 17-20). Bracket-alternate grammar remains accepted by the scanner for human typo tolerance, but agents should emit only the canonical form.
>
> **Next step:** file as a follow-up plan when the Editor-Agent emit path is touched next, or bundle into a Plan 05-04 polish pass.
>
> **References:**
> - 260524-sm8 SUMMARY: `.planning/quick/260524-sm8-drill-clarity-pack-1-0-0-rc-6-tgz-on-cou/260524-sm8-SUMMARY.md` (D-6 entry)
> - Plan 05-03 AC-autostatus scanner: `src/worker/handlers/reader-ac-autostatus.ts`
> - Plan 05-03 SUMMARY: `.planning/phases/05-distribution-polish/05-03-SUMMARY.md`

---

## Drawer 4 of 4 — clarity_pack / decisions

**Title:** `D-7 Reader → Chat continuation gap (UX-design-needed) — "Continue in chat →" button opens NEW task instead of resuming existing topic`

**Tags:** `phase-4.2, reader-chat-bridge, ux-design-needed, polish-backlog, rcb, chat-open-for-issue, chat-true-task, 260524-sm8, D-7, routes-to-discuss-phase`

**Body:**

> **NEW UX finding surfaced by Eric during the 260524-sm8 drill (2026-05-25).**
>
> **Observed behaviour:** the "Continue in chat →" golden button at the top of the Reader tab takes the user to the Chat tab BUT creates/opens a NEW task/topic instead of resuming the existing employee-chat thread tied to the current issue.
>
> **Eric's verbatim quote:** "when I'm in the reader and I'm looking at something, at one of the items, and I want to continue to chat with the agent on this topic, there's no real way to do it. As soon as I click the golden button, it takes me to the chat, but it tries to open a new task. There's the usability issue here. Then I need a UI/UI expert to address and figure out what the right plan is."
>
> **Inferred root cause (from worker-handler inventory at executor read-time):**
> - `src/worker/handlers/chat-true-task.ts` is the `chat.createTrueTask` action handler (per Plan 04.1-02) — the operator-composer entry point onto the shared `createTrueTask` helper. This handler ALWAYS creates.
> - `src/worker/handlers/chat-open-for-issue.ts` is the `chat.openForIssue` DATA handler (per Plan 04.2-01 RCB-02) — deterministic issue-lineage routing for the Reader-view Continue-in-chat primitive. Returns one of: `topic-itself` / `new-topic-needed` / `existing-topic`. This is the find-or-open routing surface.
> - **Likely defect:** the Reader's "Continue in chat →" button invokes (or the UI dispatch logic ends up invoking) the create-path even when the `chat.openForIssue` route is `existing-topic`. Confirm by reading the Reader `index.tsx` button click handler and tracing the dispatch into `chat/index.tsx` to see how the route is consumed.
>
> **Open design questions for the discuss-phase (NOT to be resolved here — Eric explicitly requested routing this to a UX expert):**
> 1. Should the button resume the MOST RECENT topic on this issue, or always land in a roster picker / topic picker?
> 2. What if no existing topic exists — silently create one with the issue's assignee, or prompt the operator?
> 3. What does the agent see (a continuation in their existing topic context, or a fresh thread)?
> 4. How does this interact with the existing reverse-topics list ("N conversations about this issue ↗" — RCB-06)?
> 5. If multiple existing topics exist on the same issue (e.g. operator chatted with CMO + CTO about COU-NNNN separately), which one does the button resume — most recent, or disambiguate UI?
>
> **Severity:** UX-DESIGN-NEEDED. Phase 4.x Employee Chat scope. rc.6 unblocks Phase 5 closure, but this is in the polish backlog ahead of Phase 5 final.
>
> **Next steps (in order):**
> 1. `/gsd:discuss-phase 4.2` (or new sub-phase) — settle the 5 design questions above with a UX-design-expert agent.
> 2. `/gsd:ui-phase` — produce the implementation plan once design is locked.
> 3. Implementation likely touches `src/ui/surfaces/reader/index.tsx` (the button click handler) + `src/ui/surfaces/chat/index.tsx` (dispatch on RCB-02 route).
>
> **References:**
> - 260524-sm8 SUMMARY: `.planning/quick/260524-sm8-drill-clarity-pack-1-0-0-rc-6-tgz-on-cou/260524-sm8-SUMMARY.md` (D-7 entry)
> - Plan 04.2-01 (RCB-02 routing handler design): `.planning/phases/04.2-reader-chat-bridge/04.2-01-PLAN.md` + `src/worker/handlers/chat-open-for-issue.ts`
> - Plan 04.1-02 (createTrueTask helper + chat.createTrueTask handler): `src/worker/handlers/chat-true-task.ts` + `src/worker/chat/true-task.ts`
> - Reader-side button (Plan 04.2-01 ContinueInChatButton primitive): `src/ui/surfaces/reader/index.tsx` (the click handler + the chat-open-for-issue data subscription)
> - Phase 4.2 closure state: MemPalace drawer `phase-4.2-closed` (already filed)
