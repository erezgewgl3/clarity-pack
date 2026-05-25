---
phase: 05-distribution-polish
plan: 08
subsystem: clarity-pack-phase-4.1-power-features
tags:
  - phase-05
  - chat
  - archive
  - storage-pin
  - power-features
  - migration
  - manifest
  - d-15
  - d-16
  - d-17
  - d-18
  - d-19
  - d-20
dependency_graph:
  requires:
    - "04.1-05"  # chat.topic.archive toggle shape (pin/archive mirror)
    - "04.1-08"  # listArchivedChatTopicsForEmployee (D-15 extends pattern)
    - "04.2-04"  # toast primitive + ToastProvider (hoisted to ClaritySurfaceRoot here)
    - "05-05"    # ClaritySurfaceRoot already extended (wave-4 dep)
    - "05-06"    # right-rail Pinned chips ABOVE the Storage pin block (Plan 05-08 owns the live pin)
    - "05-07"    # chat-surface React-key audit + D-13 nav.replace removal (overlapping chat edits settled)
  provides:
    - "migrations/0010_chat_topics_pinned.sql (additive pinned_at column; D-20)"
    - "chat.topic.pin action handler (CTT-07 by construction; D-20)"
    - "chat.topic.bulkUnarchive action handler (D-16)"
    - "chat.topic.archive PIN_EXEMPT guard (D-20 reverse invariant)"
    - "chat.archivedTopics company-scoped variant (employeeAgentId now optional; D-15)"
    - "chat.topics carrier extension (pinnedAt; D-20)"
    - "ArchivePage page-slot at /<companyPrefix>/archive (D-15)"
    - "ClaritySurfaceRoot ToastProvider hoist + 'archive' surface member (D-17)"
    - "ClaritySurfaceHeader shared + Create-task button on Reader/Situation/Bulletin/Chat (D-17)"
    - "Removed duplicate <ToastProvider> from ChatPageBody (D-17 hoist)"
    - "DiagnosticsToggle per-topic localStorage persistence (D-18)"
    - "ComposerShortcutsPopover with TWO ? triggers (D-19)"
    - "Storage pin card live wiring with pinned_at visual state (D-20)"
    - "ChatTopic UI type carries pinnedAt?: string | null (D-20 carrier)"
  affects:
    - "src/worker/db/chat-topics-repo.ts"
    - "src/worker/handlers/chat-topic-archive.ts"
    - "src/worker/handlers/chat-archived-topics.ts"
    - "src/worker/handlers/chat-topics.ts"
    - "src/worker.ts"
    - "src/manifest.ts"
    - "src/ui/primitives/clarity-surface-root.tsx"
    - "src/ui/primitives/theme.css"
    - "src/ui/surfaces/chat/index.tsx"
    - "src/ui/surfaces/chat/composer.tsx"
    - "src/ui/surfaces/chat/context-rail.tsx"
    - "src/ui/surfaces/chat/topic-strip.tsx"
    - "src/ui/surfaces/chat/diagnostics-toggle.tsx"
    - "src/ui/surfaces/chat/actions-row.tsx"
    - "src/ui/surfaces/chat/archive-panel.tsx"
    - "src/ui/surfaces/reader/index.tsx"
    - "src/ui/surfaces/situation-room/index.tsx"
    - "src/ui/surfaces/bulletin/index.tsx"
    - "src/ui/styles/chat.css"
    - "src/ui/index.tsx"
tech-stack:
  added: []  # NO new runtime deps. All work uses existing primitives.
  patterns:
    - "Additive plugin-namespace migration (matches 0006/0007/0008/0009 shape)"
    - "Verbatim handler clone with substitutions (chat-topic-pin.ts mirrors chat-topic-archive.ts)"
    - "Single round-trip bulk write with SQL-level guard (pinned_at IS NULL OR $1 = false in bulkSetChatTopicArchived)"
    - "Page-slot three-gate composition (opt-in + companyId + userId)"
    - "Hoisted ToastProvider into ClaritySurfaceRoot (one source for every surface)"
    - "Source-grep contract tests for UI components (no JSX runtime needed)"
    - "Per-topic localStorage key shape clarity:diagnostics:<topic-id>"
    - "Composer-scoped keypress trigger (textarea onKeyDown, never window listener)"
key-files:
  created:
    - "migrations/0010_chat_topics_pinned.sql"
    - "src/worker/handlers/chat-topic-pin.ts"
    - "src/worker/handlers/chat-topic-bulk-unarchive.ts"
    - "src/ui/surfaces/archive/archive-page.tsx"
    - "src/ui/primitives/clarity-surface-header.tsx"
    - "src/ui/surfaces/chat/shortcuts-popover.tsx"
    - "src/ui/styles/archive.css"
    - "test/worker/db/chat-topics-repo-pinned.test.mjs"
    - "test/worker/handlers/chat-topic-pin.test.mjs"
    - "test/worker/handlers/chat-topic-bulk-unarchive.test.mjs"
    - "test/worker/handlers/chat-archived-topics-all.test.mjs"
    - "test/worker/handlers/chat-topics-pinned-at.test.mjs"
    - "test/worker/handlers/chat-topic-archive-pin-exempt.test.mjs"
    - "test/manifest/archive-page-slot.test.mjs"
    - "test/ui/archive-page.test.mjs"
    - "test/ui/clarity-surface-header.test.mjs"
    - "test/ui/diagnostics-toggle-persistence.test.mjs"
    - "test/ui/composer-shortcuts-popover.test.mjs"
    - "test/ui/context-rail-storage-pin.test.mjs"
  modified:
    - "src/worker/db/chat-topics-repo.ts"
    - "src/worker/handlers/chat-topic-archive.ts"
    - "src/worker/handlers/chat-archived-topics.ts"
    - "src/worker/handlers/chat-topics.ts"
    - "src/worker.ts"
    - "src/manifest.ts"
    - "src/ui/primitives/clarity-surface-root.tsx"
    - "src/ui/primitives/theme.css"
    - "src/ui/surfaces/chat/index.tsx"
    - "src/ui/surfaces/chat/composer.tsx"
    - "src/ui/surfaces/chat/context-rail.tsx"
    - "src/ui/surfaces/chat/topic-strip.tsx"
    - "src/ui/surfaces/chat/diagnostics-toggle.tsx"
    - "src/ui/surfaces/chat/actions-row.tsx"
    - "src/ui/surfaces/chat/archive-panel.tsx"
    - "src/ui/surfaces/reader/index.tsx"
    - "src/ui/surfaces/situation-room/index.tsx"
    - "src/ui/surfaces/bulletin/index.tsx"
    - "src/ui/styles/chat.css"
    - "src/ui/index.tsx"
    - "test/ui/chat-archive-panel.test.mjs"
    - "test/ui/chat-context-rail.test.mjs"
decisions:
  - "D-15 archive route is /<companyPrefix>/archive (NOT /clarity-pack/archive — CONTEXT.md slip corrected per memory clarity-pack-plugin-page-routes)"
  - "D-16 bulk-unarchive: NO confirmation modal regardless of N (reversible action; CTT-07 invariant holds)"
  - "D-17 ToastProvider HOISTED into ClaritySurfaceRoot — every surface gets useToast() in scope; chat in-body provider REMOVED"
  - "D-18 diagnostics key shape: clarity:diagnostics:<topic-id> (single boolean per topic); graceful degrade on null topicId"
  - "D-19 dual ? triggers collapsed into a single event.key === '?' branch (Shift+/ on US keyboards covers both SP1 + SP3 paths)"
  - "D-20 pinned_at TIMESTAMPTZ NULL (mirrors archived_at shape from migration 0008); pinning is archive-exempt only, NOT pin-to-top"
  - "bulkSetChatTopicArchived SQL-level guard `pinned_at IS NULL OR $1 = false` is load-bearing for any future bulk-archive variant"
  - "NO version bump in this plan (checker BLOCKER 1) — phase-wide rc.7 → 1.0.0 lives ONLY in Plan 05-10"
metrics:
  duration_minutes: 75
  completed: "2026-05-25T20:41:00Z"
---

# Phase 05 Plan 08: Phase 4.1 Power Features Summary

Ships five Phase 4.1 power features locked in CONTEXT.md D-15..D-20 — archive full-view (D-15), bulk-unarchive (D-16), cold-task-from-global (D-17), per-topic diagnostics persistence (D-18), composer shortcuts popover (D-19), and Storage-pin = exempt from archive (D-20) — across a single additive migration, two new worker handlers, one extended handler (PIN_EXEMPT), one new page-slot, one shared header primitive, and four UI surfaces — without touching the version literal (Plan 05-10 owns the bump).

## What Was Built

### Task 1 — Migration + repo extensions (commit `2d19947`)

- `migrations/0010_chat_topics_pinned.sql` — additive `ALTER TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics ADD COLUMN IF NOT EXISTS pinned_at timestamptz DEFAULT NULL`. Idempotent; apostrophe-free comments; ends on a semicolon-terminated statement; passes the host's DDL prefix validator (Plan 03-03 Countermoves lock).
- `ChatTopicRow` grows optional `pinned_at?: string | null`; `listChatTopicsForEmployee` SELECT now pulls `pinned_at`.
- Four new repo helpers:
  - `setChatTopicPinned(ctx, companyId, topicIssueId, pinned)` — flips pinned_at between `now()` and `NULL` (mirrors `setChatTopicArchived` byte-for-byte).
  - `isChatTopicPinned(ctx, companyId, topicIssueId)` — SELECT 1 round-trip; returns true when pinned_at is non-null, false when null OR row absent.
  - `bulkSetChatTopicArchived(ctx, companyId, topicIssueIds, archived)` — single round-trip `UPDATE … WHERE company_id = $2 AND issue_id = ANY($3::text[]) AND (pinned_at IS NULL OR $1 = false)`. Empty input array short-circuits to `{ updated: 0 }` without a DB call.
  - `listAllArchivedChatTopics(ctx, companyId)` — company-scoped variant of the employee-scoped archive list; ORDER BY archived_at DESC NULLS LAST.
- 9 new tests in `chat-topics-repo-pinned.test.mjs`; DDL validator gate covers migration 0010.

### Task 2 — Two new handlers + chat.topics carrier + chat.archivedTopics extension (commit `340f2ed`)

- `src/worker/handlers/chat-topic-pin.ts` — verbatim clone of `chat-topic-archive.ts` with substitutions (action key `chat.topic.pin`; error code `PIN_FAILED`). CTT-07 invariant by construction — Test 6 spies on `ctx.issues.update` across both pin=true and pin=false paths and asserts zero invocations.
- `src/worker/handlers/chat-topic-bulk-unarchive.ts` — archive full-view's bulk-select Unarchive action. Validates `topicIssueIds: string[]`; empty array short-circuit; CTT-07 zero-host-issue-mutation by construction.
- `chat-archived-topics.ts` — `employeeAgentId` is now OPTIONAL. When omitted/empty, returns the company-scoped listing via the new `listAllArchivedChatTopics` helper. Response shape grows `pinnedAt: string | null` (D-20 carrier). The `EMPLOYEE_AGENT_ID_REQUIRED` error code is RETIRED; the existing employee-scoped path (Plan 04.1-08 archive panel) is preserved.
- `chat-topics.ts` — per-row mapping adds `pinnedAt: row.pinned_at ?? null` (D-20 carrier). All pre-existing fields preserved (snapshot-tested in `chat-topics-pinned-at.test.mjs` Test 16).
- `src/worker.ts` registers both new handlers next to `registerChatTopicArchive`.
- 28 new handler tests across 4 files.

### Task 3 — chat.topic.archive PIN_EXEMPT guard (commit `c830aa5`)

- `chat-topic-archive.ts` adds a PIN_EXEMPT short-circuit: when `archived === true`, the handler reads `isChatTopicPinned` and returns `{ error: 'PIN_EXEMPT', topicIssueId }` BEFORE the `setChatTopicArchived` call. The un-archive direction (archived=false) proceeds unconditionally. A pinned-read failure (defensive) routes to `ARCHIVE_FAILED` (deny-by-default).
- 6 new PE-tests + existing 11 chat-topic-archive tests continue to pass (no regression). PE5 spy confirms `ctx.issues.update` is never called across PE1/PE2/PE3 paths.

### Task 4 — ArchivePage page-slot + ClaritySurfaceRoot ToastProvider hoist (commit `be3d5cd`)

- `src/manifest.ts` — new page slot `{ type: 'page', id: 'clarity-archive', exportName: 'ArchivePage', routePath: 'archive' }`. Route resolves to `/<companyPrefix>/archive` (NOT `/clarity-pack/archive` — per memory `clarity-pack-plugin-page-routes`). Manifest slot count: 5 → 6.
- `src/ui/primitives/clarity-surface-root.tsx` — `ClaritySurfaceName` grows `'archive'` member AND wraps `{children}` in a single `<ToastProvider>`. Every surface that renders `<ClaritySurfaceRoot>` now has `useToast()` in scope — the prerequisite for Task 5's cross-surface `Task created` toast.
- `src/ui/surfaces/archive/archive-page.tsx` — three-gate composition (opt-in → companyId → userId). Body fetches `chat.archivedTopics` with no `employeeAgentId` (company-scoped path from Task 2). Renders bulk-select checkboxes, search-by-title input, employee filter dropdown (from chat.roster — NO_UUID_LEAK: roster name lookup falls back to literal `'unassigned'`, never the UUID), sticky `Selected (N) — Unarchive` bar. Bulk unarchive dispatches `chat.topic.bulkUnarchive` + toast `N topics unarchived` (no confirmation modal).
- `src/ui/styles/archive.css` — full-page archive surface CSS, scoped under `[data-clarity-surface="archive"]`. Wired into `src/ui/index.tsx` style injection.
- `src/ui/surfaces/chat/archive-panel.tsx` — the "View all archived →" button is wired to `nav.navigate(/<companyPrefix>/archive)` via `useHostNavigation` (SCAF-09; no raw anchor). Plan 04.1-08's console-warn no-op stub is REMOVED.
- 11 new ArchivePage tests + 3 manifest slot tests + 1 chat-archive-panel test updated (Plan 04.1-08 console.warn lock explicitly superseded by D-15).

### Task 5 — ClaritySurfaceHeader + cross-surface mount + chat ToastProvider de-dup (commit `c653d8f`)

- `src/ui/primitives/clarity-surface-header.tsx` — new shared header. Right-aligned `<button>+ Create task</button>` opens `<TrueTaskDialog mode="cold">`; on success fires `showToast({ message: 'Task created' })` via the hoisted `useToast()` regardless of which surface mounted it. No window keydown listener — chat's actions-row keeps the `T` shortcut in parallel.
- Mounted on Reader / Situation Room / Bulletin / Chat (4 surfaces). Each passes the right defaults; chat threads the currently-selected employee through `defaultAssigneeAgentId` + `defaultEmployeeName` so the dialog opens with the chatted employee preselected.
- `src/ui/surfaces/chat/index.tsx` — the in-body `<ToastProvider>` wrapper from Plan 04.1-09 is REMOVED. `ChatPageBody`'s `useToast()` now resolves to the provider hoisted in `ClaritySurfaceRoot`. The `useToast` import remains (still used in-body).
- `src/ui/primitives/theme.css` appends `.clarity-surface-header` + `.clarity-cold-task-btn` rules, each row scoped under all 5 `data-clarity-surface` ancestor selectors.
- 14 new CSH tests; the Plan 04.1-09 "ToastProvider wraps ChatPageBody" lock in `chat-context-rail.test.mjs` is explicitly superseded and updated to pin the new hoist contract.

### Task 6 — D-18 diagnostics persistence + D-19 shortcuts popover + D-20 storage-pin UI + ChatTopic type (commit `ce9d1e0`)

- **D-18:** `DiagnosticsToggle` accepts a `topicId?: string | null` prop and reads `clarity:diagnostics:<topicId>` from localStorage on mount/topicId change. On click, writes `'1'` or `'0'` under the same key. localStorage failures (privacy mode, quota) are swallowed in try/catch — the in-memory React state still drives this-session UI. Per-topic key shape ensures Topic A's state is fully independent of Topic B's. `null`/`undefined` topicId is the graceful-degrade path (rc.7 session-only behavior). `ChatActionsRow` threads `diagnosticsTopicId={topic?.issueId ?? null}` from the parent.
- **D-19:** `src/ui/surfaces/chat/shortcuts-popover.tsx` — new `<ComposerShortcutsPopover>`. Renders a static list of shortcuts as React text (NO `dangerouslySetInnerHTML`). Click-outside via a window `mousedown` listener deferred with `setTimeout(0)` (mirrors archive-panel pattern). Composer extends `handleKeyDown`: when `e.key === '?'` and no Ctrl/Meta/Alt, `preventDefault()` + `setShortcutsPopoverOpen(true)` regardless of textarea content (the SP1 + SP3 paths collapse onto the same key check; SP2 literal-? is reachable via popover dismiss + retype). Escape closes the popover + restores focus to the textarea. Any printable key closes the popover and reaches the textarea (no `preventDefault`).
- **D-20:** `topic-strip.tsx` `ChatTopic` type grows `pinnedAt?: string | null` (carrier). `context-rail.tsx` Storage pin block is now a `<button type="button">` with `onClick` dispatching `chat.topic.pin` with `{ topicIssueId, pinned: !currentlyPinned, companyId, userId }`. Visual: pinned topics render `📌 Pinned — exempt from archive`; unpinned render the rc.7 copy. Success path fires `showToast({ message: 'Topic pinned' | 'Topic unpinned' })` AND calls the new `onPinChanged` callback so the parent (`ChatPageBody`) bumps `refreshKey` and chat.topics refetches the updated `pinned_at`.
- New CSS rules for `.pin-row.pin-row--btn`, `.pin-row.pin-row--pinned`, and `.composer-shortcuts-popover` (and children) appended to chat.css, all scoped under `[data-clarity-surface="chat"]`.
- 26 new tests across 3 files.

## Verification

### Quality Gates

| Gate | Result |
|------|--------|
| `tsc --noEmit` | clean |
| `node --test` full suite | **1801 pass / 0 fail / 3 pre-existing skip** (was 1775 at Task 5 commit; +26 net from Task 6) |
| `pnpm build:worker` (via `node scripts/build-worker.mjs`) | exit 0; `dist/worker.js` 2.1 MB |
| `pnpm build:ui` (via `node scripts/build-ui.mjs`) | exit 0; `dist/ui/index.js` 637.6 kB |
| `pnpm build:manifest` (via `npx tsc --project tsconfig.manifest.json`) | exit 0 |
| `node scripts/check-css-scope.mjs` | **121 top-level selectors, all scoped under `[data-clarity-surface]`** |
| `node scripts/check-a11y.mjs` | **69 files scanned, 0 violations** |
| `node scripts/check-ui-bundle-size.mjs` | 652,913 bytes (637.6 kB) of 665,600 byte ceiling; no SheetJS sentinels |
| `node scripts/coexistence-checks/run-all.mjs` | **10/10 PASS** (COEXIST-01..10) |
| `test/migrations/ddl-prefix-validator.test.mjs` | migration 0010 passes the host validator (validator-conformant) |

### Plan-Level Invariants

- **CTT-07** — `grep -v '^//' src/worker/handlers/chat-topic-pin.ts | grep -c 'ctx\.issues\.\(update\|delete\)'` → **0**; same for `chat-topic-bulk-unarchive.ts` and `chat-topic-archive.ts` (PIN_EXEMPT guard does NOT introduce host-issue mutation). chat-topics.ts pinnedAt carrier is read-only.
- **NO_UUID_LEAK** — ArchivePage test AP7 asserts `employeeNameById.get(...) ?? 'unassigned'` (NEVER the UUID).
- **Additive-only schema** — `migrations/0010_chat_topics_pinned.sql` contains exactly one `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement; no DROP/ALTER/TRUNCATE on public.*.
- **Plugin route pattern** — manifest entry uses `routePath: 'archive'`, NOT `'clarity-pack/archive'` (memory `clarity-pack-plugin-page-routes` honored).
- **D-19 dual triggers** — `grep -c "e\.key === '?'" src/ui/surfaces/chat/composer.tsx` ≥ 1; `grep -c "shiftKey" src/ui/surfaces/chat/composer.tsx` ≥ 1.
- **D-20 carrier** — `grep -c "pinnedAt:\s*row\.pinned_at" src/worker/handlers/chat-topics.ts` ≥ 1; `grep -c "pinnedAt" src/ui/surfaces/chat/topic-strip.tsx` ≥ 1.
- **D-17 cross-surface toast** — `grep -c "ToastProvider" src/ui/primitives/clarity-surface-root.tsx` ≥ 1; chat surface in-body ToastProvider removed (`grep -v '^//' src/ui/surfaces/chat/index.tsx | grep -c "<ToastProvider"` → **0**).
- **No version bump** — `grep -c "1.0.0-rc.7" package.json` → **1**; `grep -c "1.0.0-rc.7" src/manifest.ts` → **1**. Both unchanged from rc.7 baseline.

### Coexistence Guarantees Re-Verified

- **#3 (additive schema)** — migration 0010 ADD COLUMN IF NOT EXISTS only.
- **#6 (clean uninstall preserves data)** — pinned_at column lives in plugin namespace; survives disable; --purge opt-in only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Chat-archive-panel View-all link test updated**
- **Found during:** Task 4
- **Issue:** `test/ui/chat-archive-panel.test.mjs` Test "View all link is a no-op stub for Phase 4.2" asserted `console.warn` + the `phase-4.2-deferred-from-4.1` memory pointer — both removed per Plan 05-08 D-15 which promotes the link to a real navigation.
- **Fix:** Test now asserts `nav.navigate`, `/archive`, and `companyPrefix` (the new contract); ensures `console.warn` is GONE.
- **Files modified:** `test/ui/chat-archive-panel.test.mjs`
- **Commit:** `be3d5cd`

**2. [Rule 1 — Bug] chat-context-rail.test.mjs ToastProvider lock updated**
- **Found during:** Task 5
- **Issue:** Plan 04.1-09 locked `<ToastProvider>` to wrap `ChatPageBody` inside chat/index.tsx; Plan 05-08 D-17 (checker BLOCKER 4) hoists ToastProvider into ClaritySurfaceRoot and explicitly supersedes this lock.
- **Fix:** Test now asserts ChatPage no longer mounts a `<ToastProvider>` wrapper, AND pins `ClaritySurfaceRoot` as the new source.
- **Files modified:** `test/ui/chat-context-rail.test.mjs`
- **Commit:** `c653d8f`

**3. [Rule 3 — Blocker] chat.css scope-test mass quote conversion**
- **Found during:** Task 6 (full-suite run after appending D-19/D-20 CSS rules)
- **Issue:** `test/ui/chat-shell.test.mjs` requires every chat.css selector to match `[data-clarity-surface="chat"]` with **double** quotes. Newly-appended rules used single quotes (general CSS convention). The pre-existing 308 selectors all used double quotes — single quotes were inconsistent with the test contract.
- **Fix:** `sed -i "s/[data-clarity-surface='chat']/[data-clarity-surface=\"chat\"]/g" src/ui/styles/chat.css` converted 12 occurrences to double quotes. New rules now match the existing convention; test green.
- **Files modified:** `src/ui/styles/chat.css`
- **Commit:** `ce9d1e0` (rolled into Task 6 since the test failure surfaced when Task 6 ran the full suite)

### Tests Updated to Pin New Contracts (NOT regressions; explicit supersession)

- `test/ui/chat-archive-panel.test.mjs` — Plan 04.1-08 console.warn stub lock superseded by D-15.
- `test/ui/chat-context-rail.test.mjs` — Plan 04.1-09 ToastProvider-wraps-ChatPageBody lock superseded by D-17.
- `test/worker/handlers/chat-archived-topics-all.test.mjs` (NEW) — pins the post-D-15 behavior that `chat.archivedTopics` no longer returns `EMPLOYEE_AGENT_ID_REQUIRED`.

### Authentication Gates Encountered

None.

## Threat Flags

No new security-relevant surface beyond what the threat model documents (T-05-08-01..T-05-08-12, T-05-08-SC). All new code adheres to:

- CTT-07 invariant (no host issue mutation) — regression-guarded by per-handler `ctx.issues.update` zero-call spies.
- NO_UUID_LEAK — ArchivePage rows fall back to `'unassigned'` literal, never the UUID.
- No `dangerouslySetInnerHTML` introduced anywhere.
- No raw `fetch()` calls from UI; all data flows through `usePluginData` / `usePluginAction`.
- All new selectors scoped under `[data-clarity-surface=...]` (check-css-scope.mjs exit 0).

## Self-Check

**Files claimed as created:**

- `migrations/0010_chat_topics_pinned.sql` — FOUND
- `src/worker/handlers/chat-topic-pin.ts` — FOUND
- `src/worker/handlers/chat-topic-bulk-unarchive.ts` — FOUND
- `src/ui/surfaces/archive/archive-page.tsx` — FOUND
- `src/ui/primitives/clarity-surface-header.tsx` — FOUND
- `src/ui/surfaces/chat/shortcuts-popover.tsx` — FOUND
- `src/ui/styles/archive.css` — FOUND
- 12 new test files — FOUND

**Commits claimed:**

- `2d19947` (Task 1) — FOUND
- `340f2ed` (Task 2) — FOUND
- `c830aa5` (Task 3) — FOUND
- `be3d5cd` (Task 4) — FOUND
- `c653d8f` (Task 5) — FOUND
- `ce9d1e0` (Task 6) — FOUND

## Self-Check: PASSED

## Pointer to Next Plan

**Plan 05-10** (v1.0.0 final closure) is gated on all of Plans 05-04..05-09 completing. Status of those:

| Plan | Status |
|------|--------|
| 05-04 (DIST-04 + visual baseline) | CODE-COMPLETE 2026-05-25 |
| 05-05 (Zero-rabbit-holes finishers) | CODE-COMPLETE 2026-05-25 |
| 05-06 (Phase 4.1 surface polish) | CODE-COMPLETE 2026-05-25 |
| 05-07 (Phase 4.2 polish bundle) | CODE-COMPLETE 2026-05-25 |
| 05-08 (Phase 4.1 power features) | **CODE-COMPLETE 2026-05-25 (this plan)** |
| 05-09 (Tooling + infra cleanup) | CODE-COMPLETE 2026-05-25 |

**Next action:** `/gsd:execute-phase 5 --plan 05-10` — v1.0.0 final closure (version bump rc.7 → 1.0.0, npm publish, canonical ALL-paths drill on Countermoves).
