# Milestones

## v1.6.0 Stuck-Agent Reply-In-Place (Shipped: 2026-06-16)

**Phases completed:** 13 phases, 57 plans, 44 tasks

**Key accomplishments:**

- A plain comment resumes a stuck agent on BEAAA — in BOTH the awaiting-answer and the

`status='blocked'` cases — with no special transition required to trigger the resume.

- 1. [Rule 1 - Bug] `walkBlockerChain` swallowed ROOT relations.get throws, defeating the D-10 degrade.
- 1. [Test alignment] Deleted the two dedicated humanize test files alongside the source.
- 1. [Rule 1 - Bug] Dead `data-terminal-kind='HUMAN_ACTION_ON'` CSS selector lost the ON YOU panel highlight.
- 1. [Rule 1 - Bug] Corrected a wrong RED-test fixture for the WR-05 reached-via-external assertion
- 1. [Rule 3 - Blocking] Widened ScrubCtx.logger meta type to stay assignable from the SDK PluginLogger
- 1. [Rule 1 - stale test] build-employees-rollup split-identity assertion updated to 'assign'
- [Rule 3 — Blocking] `build-employees-rollup.test.mjs` Test 10 rewritten to the NY-02 contract
- 1. [Rule 3 - Blocking] Migration comment wording vs over-broad AC grep
- 1. [Rule 3 - clarification] `finalizeTldr` import kept but card cache uses the typed repo.
- 1. [Rule 3 - Blocking] Behavior test could not import the `.tsx` component
- Situation Room employee row (`employee-row.tsx`):
- 1. [Rule 3 - Blocking] UI bundle exceeded the 735 kB ceiling
- 1. [Rule 3 - Blocking] UI bundle exceeded the size ceiling
- Task 1 — Wave-0 verification (`16-SCHEMA-VERIFY.md`, commit `356bc00`).
- Task 1+2 — shared prefetch + org-backlog consumption (`feat` commit `dc225c0`, RED test `3d0704b`).
- Task 1 (`16a38b5`) — bound + deadline-floor the shared edge-graph build.
- Task 1 — SWR snapshot cache + extracted pure `buildNeedsYou` + handler serve-last-good
- 1. [Rule 1 - Bug] Flipped four `requestWakeup`-was-called assertions across three test suites
- 1. [Rule 1 - Bug] chat-stream-bridge tests broke when the scope gate was added
- 1. [Rule 1 - Bug] Governor placement: gate the START dispatch, not the whole per-company call
- 1. [Rule 1 - Bug] Static gate handler-count assertion: `>= 2`, not `>= 3`
- Task 1 — Governed creation-time wake
- 1. [Rule 1 — Bug] Acceptance-grep substring false positive in founder-resolution.ts
- 1. [Rule 1 — Bug] snapshot-prefetch round-trip-count test broke on the new wait SELECT
- 1. [Rule 3 — Blocking] New `OperationKind` member + readback branch in agent-task-delivery.ts (outside `files_modified`)
- 1. [Rule 3 - Blocking] `node --check` on `.tsx` unsupported in this environment
- `node --check <ts>` → `node --test`
- 1. [Rule 1 - Bug] Updated two reply-in-place surface tests that encoded the OLD inline Open↗ pattern
- 1. [Rule 3 - Blocking] Adjusted two pre-existing source-grep tests to match the read-time re-scrub wrapping
- Task 1 — `looksDone` + `getTldrBodiesByScopeIds`.
- 1. [Rule 2 - Correctness] Added `isActionCardLive` (age-only liveness) instead of reusing `isActionCardFresh`
- 1. [Rule 2 - Correctness] Added `rowToCardDisplay` (+ `ActionCardDisplay`) as the single DISPLAY-only projection
- Task 1 — snapshot-prefetch count drift (D-05).
- Task 1 — widen the CI test glob (HYG-01 / D-03).
- Task 1 — engine verdict + reachable predicate (commit 5cbeb54).
- 1. [Rule 1 - Bug] Pre-existing pending-posture test asserted the old literal 'Send'
- Task 1 — Situation Room employee row (commit 890547a).
- Task 1 — SR + Reader + primitive source-grep tests extended to the nudge path (commit fb6593c).

---

## v1.5.0 Truthful & Legible Situation Room (Shipped: 2026-06-15)

**Phases completed:** 12 phases, 52 plans, 43 tasks

**Key accomplishments:**

- A plain comment resumes a stuck agent on BEAAA — in BOTH the awaiting-answer and the

`status='blocked'` cases — with no special transition required to trigger the resume.

- 1. [Rule 1 - Bug] `walkBlockerChain` swallowed ROOT relations.get throws, defeating the D-10 degrade.
- 1. [Test alignment] Deleted the two dedicated humanize test files alongside the source.
- 1. [Rule 1 - Bug] Dead `data-terminal-kind='HUMAN_ACTION_ON'` CSS selector lost the ON YOU panel highlight.
- 1. [Rule 1 - Bug] Corrected a wrong RED-test fixture for the WR-05 reached-via-external assertion
- 1. [Rule 3 - Blocking] Widened ScrubCtx.logger meta type to stay assignable from the SDK PluginLogger
- 1. [Rule 1 - stale test] build-employees-rollup split-identity assertion updated to 'assign'
- [Rule 3 — Blocking] `build-employees-rollup.test.mjs` Test 10 rewritten to the NY-02 contract
- 1. [Rule 3 - Blocking] Migration comment wording vs over-broad AC grep
- 1. [Rule 3 - clarification] `finalizeTldr` import kept but card cache uses the typed repo.
- 1. [Rule 3 - Blocking] Behavior test could not import the `.tsx` component
- Situation Room employee row (`employee-row.tsx`):
- 1. [Rule 3 - Blocking] UI bundle exceeded the 735 kB ceiling
- 1. [Rule 3 - Blocking] UI bundle exceeded the size ceiling
- Task 1 — Wave-0 verification (`16-SCHEMA-VERIFY.md`, commit `356bc00`).
- Task 1+2 — shared prefetch + org-backlog consumption (`feat` commit `dc225c0`, RED test `3d0704b`).
- Task 1 (`16a38b5`) — bound + deadline-floor the shared edge-graph build.
- Task 1 — SWR snapshot cache + extracted pure `buildNeedsYou` + handler serve-last-good
- 1. [Rule 1 - Bug] Flipped four `requestWakeup`-was-called assertions across three test suites
- 1. [Rule 1 - Bug] chat-stream-bridge tests broke when the scope gate was added
- 1. [Rule 1 - Bug] Governor placement: gate the START dispatch, not the whole per-company call
- 1. [Rule 1 - Bug] Static gate handler-count assertion: `>= 2`, not `>= 3`
- Task 1 — Governed creation-time wake
- 1. [Rule 1 — Bug] Acceptance-grep substring false positive in founder-resolution.ts
- 1. [Rule 1 — Bug] snapshot-prefetch round-trip-count test broke on the new wait SELECT
- 1. [Rule 3 — Blocking] New `OperationKind` member + readback branch in agent-task-delivery.ts (outside `files_modified`)
- 1. [Rule 3 - Blocking] `node --check` on `.tsx` unsupported in this environment
- `node --check <ts>` → `node --test`
- 1. [Rule 1 - Bug] Updated two reply-in-place surface tests that encoded the OLD inline Open↗ pattern
- 1. [Rule 3 - Blocking] Adjusted two pre-existing source-grep tests to match the read-time re-scrub wrapping
- Task 1 — `looksDone` + `getTldrBodiesByScopeIds`.
- 1. [Rule 2 - Correctness] Added `isActionCardLive` (age-only liveness) instead of reusing `isActionCardFresh`
- 1. [Rule 2 - Correctness] Added `rowToCardDisplay` (+ `ActionCardDisplay`) as the single DISPLAY-only projection
- Task 1 — snapshot-prefetch count drift (D-05).
- Task 1 — widen the CI test glob (HYG-01 / D-03).

---

## v1.0.0 — v1 Final Internal (Shipped: 2026-06-01)

**Phases completed:** 11 phases (1, 2, 3, 4, 4.1, 4.2, 5, 6.1, 7, 8, 9), 67 plans, 110 tasks
**Timeline:** 2026-05-07 → 2026-06-01 (~25 days) · 750 commits · ~31,300 LOC TS/TSX · 219 test files
**Final shipped version:** v1.3.0 (live on BEAAA / AriClaw; plugin UUID `a763176a-2f4d-4986-b190-b5151e42cc00`)
**Distribution:** internal-only (local-tarball install via `paperclipai plugin install`); no npm publish (per project decision).

### What shipped

Clarity Pack — a Paperclip plugin adding four user-facing surfaces + one Editor-Agent on an unmodified Paperclip install, hardened against the same-origin trust model, additive-only schema (plugin namespace), coexistence-verified (disable/uninstall leaves data intact).

**Key accomplishments:**

1. **Pre-install safety harness (Phase 1)** — snapshot/restore/smoke-test CLI + rehearsed restore drill, so any clarity-pack action against live BEAAA has bounded, rehearsed blast radius. Rehearsal PASSED on Countermoves 2026-05-13.
2. **Four surfaces + Editor-Agent + opt-in (Phase 2)** — installable plugin with per-user opt-in gate, shared primitives (batch ref-resolver, deterministic blocker-chain flattener, state pills, ref chips), Reader-view detail tab, Situation Room page, and the Editor-Agent (Editorial Desk) as a governed managed Paperclip employee with self-loop filter + token cap + circuit breaker.
3. **Daily Bulletin (Phase 3)** — DST-safe 06:30-ET auto-compile with a two-pass pipeline (SQL-grounded facts → grounded LLM pass-1 → deterministic pass-2 verifier that rejects on number mismatch), "Requires Your Decision" inbox, department lineage threads, errata as a first-class append-only type, and a failed-compile banner. Closed on the v0.6.6 Countermoves drill.
4. **Employee Chat + true-task + Reader↔Chat bridge (Phases 4 / 4.1 / 4.2)** — hybrid real-time chat persisting as ordinary `public.issue_comments` (canonical), optimistic send with rollback, attachments as work-products, operator-initiated true-task creation, and deterministic issue-lineage routing between Reader and Chat. Coexistence proven (907 chat comments survived a plugin disable unchanged).
5. **Distribution & polish + Situation Room spec-complete (Phases 5 / 6.1)** — full-fidelity deliverable previewers (xlsx/pdf/md/png), event-derived AC auto-status, lockfile/a11y CI gates, and owner-resolution at the Critical Path leaf (`agent.takeOwnership` + inline 24h artifact chips) — closing the v1.0.0 "single human action" ship gate.
6. **Situation Room cockpit evolution (Phases 7 / 8 / 9)** — instance-agnostic ref-resolution + bulletin lineage (portability: works on any Paperclip instance), then a people-first cockpit (employees not issues, idle-loud posture), then an **actionable cockpit** where the hero Assign-owner path mutates the real Paperclip issue (`situation.assignOwner` — the plugin's first live core-issue write). Phase 9's R3 leaf-UUID gap was closed in 09-04 and re-verified live on BEAAA 2026-06-01 (agent-assign persisted, operator-attributed).

### Known deferred / follow-on items at close

- **`R3-self-assign-one-assignee`** (minor, open) — "Take it myself" trips the host `"Issue can only have one assignee"` rule on already-agent-owned rows. Not the leafIssueUuid bug; tracked in `09-VERIFICATION.md`. Candidate follow-on: clear-then-assign or "already owned by `<agent>`" messaging.
- **6 quick-tasks** flagged by the open-artifact audit as "missing" — all genuinely complete (each has a `status: complete` SUMMARY; work shipped). Root-caused to a `requireSafePath` long-Windows-path bug in the GSD audit tool (a direct read parses `status: complete` fine). Recorded in STATE.md Deferred Items. No real open work.

### Archived artifacts

- `.planning/milestones/v1.0.0-ROADMAP.md` — full phase details
- `.planning/milestones/v1.0.0-REQUIREMENTS.md` — all requirements with final status

<details>
<summary>Auto-extracted per-plan one-liners (raw, unfiltered — kept for traceability)</summary>

Generated by `gsd-sdk query milestone.complete`; includes some non-accomplishment fragments (security-finding lines, "Status:"/"One-liner:" labels). The curated list above is authoritative.

- Editor-Agent (Editorial Desk) declared as a managed Paperclip employee with self-loop filter + token cap + circuit breaker + pause banner; Reader view tab renders the seven mockup elements wired to the 02-02 primitives.
- DST-safe 06:30 ET scheduling kernel + the 0004 four-table bulletin migration + the bulletins typed repo — the scheduling + persistence foundation all of Phase 3 builds on.
- The real two-pass bulletin compile pipeline — SQL-grounded facts → grounded LLM pass-1 → deterministic pass-2 verifier → two-phase publish writing the canonical body as a `public.issues` bulletin issue.
- The full Bulletin viewing experience — 6-component React page, viewer-scoped Action Inbox, Approve/Decline bridge handlers, deterministic temporal-proximity lineage grouper.
- The additive 0006_chat.sql migration + typed chat-topics-repo with the CHT-NN allocator and message_uuid dedup — the foundation every chat handler reads from.
- The chat send/edit/realtime contract — `chat.send` (dedup → canonical `createComment` → id-map → auto-reopen), `chat.edit` (append-with-supersedes), worker stream bridge re-emitting onto a per-company SSE channel.
- The six chat worker handlers (roster/topics/messages/search/promote/pin), all opt-in-guarded server-side.
- CHAT-11 chat-disable coexistence check in CI; Phase 4 closed on a live Countermoves drill proving 907 chat comments survive a plugin disable unchanged.
- Reader↔Chat Bridge: deterministic issue-lineage routing (topic-itself / new-topic / existing-topic) + bidirectional issue↔conversation graph (origin_issue_id, backlink chips, "N conversations" header).
- Plan 05-01/05-02: DIST-01/02 + lockfile-audit + a11y + COEXIST-05 at the code tier.
- Phase 6.1: owner-resolution at the Critical Path leaf via `clarity_agent_owners` + `agent.takeOwnership`; inline 24h artifact chips; standalone `+ Create task`.
- Phase 7: instance-agnostic SDK ref-resolver + TL;DR cleanup + Situation Room blocked-backlog + bulletin lineage (filter + gloss + clickable affordances).
- Phase 8: people-first Situation Room — per-employee row strip, idle-loud sort, always-visible needs-you banner (v1.2.0).
- Phase 9: actionable cockpit — `situation.assignOwner` (first core-issue mutation), three-group people view, owner-picker popover, un-frozen banner, stand-down/resume (v1.3.0). R3 leaf-UUID gap closed in 09-04 + re-verified live 2026-06-01.

</details>

---
