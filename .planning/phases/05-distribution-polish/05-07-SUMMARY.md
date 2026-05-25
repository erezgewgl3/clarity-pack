---
phase: 05-distribution-polish
plan: 05-07
subsystem: ui
tags: [chat, reader, deep-link, react-keys, d8-hygiene, rcb-05, d-03, d-13, d-14, browser-back]
defects_addressed: [GAP-D8-LINEAGE-TOOLTIP, GAP-D8-REVERSE-TOOLTIP-FALLBACK, GAP-RCB-05-CHIP-STYLING, D-13, D-14, D-03]

# Dependency graph
requires:
  - phase: 05-distribution-polish
    provides: settled chat surface header + composition (05-05 paused-agent banner, 05-06 LIVE sticky + toast + pause-copy)
  - phase: 04.2-reader-chat-bridge
    provides: chat.openForIssue 6-case route switch + RCB-01..RCB-07 closure baseline
provides:
  - Reader Continue-in-chat tooltips render CHT-NN (lineage) and BEAAA-NNN (reverse-lookup) — no UUID leakage
  - About-issue backlink chip in topic strip renders rectangular (4px border-radius)
  - Browser-Back after Reader→Chat deep-link consume preserves chat-state via URL_HASH preservation
  - 5 React-key audit commits + console-capture static-analysis gate closing D-14 rc.3-era console noise
  - D-03 cross-employee fall-through fixture pinning SQL employee filter scoping
affects: [05-08, 05-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static console-capture proxy gate — for projects without jsdom, audit AUDIT_FILES for stable keys + no-bare-index + per-component audit annotation"
    - "Defensive UI fallback as contract guard — `?? 'this issue'` preserved as documented worker-contract-violation guard"

key-files:
  created:
    - .planning/phases/05-distribution-polish/05-07-SUMMARY.md
    - test/ui/chat-open-for-issue-d3-cross-employee.test.mjs
    - test/ui/continue-in-chat-button-d8.test.mjs
    - test/ui/chat-deeplink-back-preserves-hash.test.mjs
    - test/ui/topic-about-chip-rcb05.test.mjs
    - test/ui/chat-react-key-console-capture.test.mjs
  modified:
    - src/worker/handlers/chat-open-for-issue.ts
    - src/ui/surfaces/reader/continue-in-chat-button.tsx
    - src/ui/surfaces/chat/index.tsx
    - src/ui/styles/chat.css
    - src/ui/surfaces/chat/context-rail.tsx
    - src/ui/surfaces/chat/message-thread.tsx
    - src/ui/surfaces/chat/true-task/true-task-dialog.tsx
    - src/ui/surfaces/reader/ref-card.tsx
    - test/worker/handlers/chat-open-for-issue-d7.test.mjs
    - test/ui/chat-url-params.test.mjs
    - test/ui/continue-in-chat-deeplink-contract.test.mjs
    - test/ui/no-react-key-warnings.test.mjs

key-decisions:
  - "GAP-D8-LINEAGE-TOOLTIP closed via `topicIdentifier` field — server resolves CHT-NN via ctx.issues.get on the chat-task lineage branch; UI tooltip uses `result.topicIdentifier ?? result.topicIssueId` with the UUID degrade only on host-throw / missing-identifier edge cases"
  - "GAP-D8-REVERSE-TOOLTIP-FALLBACK closed via `sourceIssueIdentifier` extension — worker now emits the field on the reverse-lookup N=1 branch as well as the existing ambiguous branch (no new resolver call — reuses the BEAAA-NNN already resolved at lines 174-177)"
  - "D-13 fix removes the post-consume `nav.navigate(pathname, { replace: true })`. URL_HASH preserved in the address bar; consumedDeepLinkRef (keyed on JSON.stringify(link)) owns the consume-once invariant; Browser-Back/Forward both preserve chat-state"
  - "GAP-RCB-05 fix is CSS-only — border-radius 999px → 4px (matches existing .btn / .qa precedents), padding moved onto the parent so the chip is one rectangle with `white-space: nowrap`. JSX unchanged (T-04.2-01-03 React-text invariant + RCB-05 JSX shape preserved per CONTEXT.md)"
  - "D-14 console-capture gate is a STATIC CONSOLE-CAPTURE PROXY rather than a DOM-render gate — project ships no jsdom / no TSX loader; adding jsdom would be a new npm install excluded from Rule 3. Gate enforces stable keys on all JSX-returning .map(); no bare-index keys; per-component audit annotation citing 05-07 + D-14 + audited component name; EXPECTED_HOST_WARNINGS allow-list shape contract"
  - "Defensive `?? 'this issue'` fallback in reverse-lookup tooltip PRESERVED as a documented worker-contract-violation guard — should never fire on the in-tree post-05-07 handler; if it ever does in production, that's a defect to surface, not expected behaviour"

patterns-established:
  - "Worker-side identifier resolution for tooltip text: when an operator-visible label needs a CHT-NN / BEAAA-NNN identifier and only a UUID is in hand, resolve server-side via ctx.issues.get and ship as optional payload field; UI degrades to the UUID only on best-effort failure paths"
  - "Static console-capture proxy gate pattern for projects without a DOM-render test harness — combine source-grep JSX-map-key checks + no-bare-index-key invariant + per-component audit annotation requirement + host-warning allow-list shape contract"

requirements-completed: []

# Metrics
duration: 19min
completed: 2026-05-25
---

# Phase 05 Plan 07: Reader→Chat rc.7 forward-defect polish bundle Summary

**Closes the three rc.7 Reader→Chat tooltip + chip forward defects, fixes Browser-Back chat-state preservation, lands the 5-commit React-key audit + console-capture gate for D-14, and adds the missing D-03 cross-employee fall-through fixture.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-05-25T19:38:12Z
- **Completed:** 2026-05-25T19:57:18Z
- **Tasks:** 2 / 2 (planner's 2-task split → executor's 9 commits per task-2's per-component audit cadence)
- **Files modified:** 12 modified + 5 created = 17 files
- **Version:** 1.0.0-rc.7 (UNCHANGED — phase-wide bump deferred to Plan 05-10 per the plan frontmatter)

## Accomplishments

- Reader Continue-in-chat button tooltip on the chat-task lineage path now reads `Open source topic CHT-NN →` (was: raw UUID). GAP-D8-LINEAGE-TOOLTIP CLOSED.
- Reader Continue-in-chat button tooltip on the reverse-lookup path now reads `Resume conversation about COU-NNN →` (was: literal "this issue" fallback). GAP-D8-REVERSE-TOOLTIP-FALLBACK CLOSED.
- About-issue backlink chip in the chat topic strip renders rectangular (4px radius) — collapsed-to-oval pill shape on long content fixed. GAP-RCB-05-CHIP-STYLING CLOSED.
- Browser-Back after Reader→Chat deep-link consume returns to the previous Paperclip page with the chat hash intact; Forward returns to chat with `#h=` preserved and consumedDeepLinkRef ensuring the consume is a no-op (idempotent). D-13 CLOSED.
- 5 React-key audit commits land (one per component named in CONTEXT.md D-14), plus a 6th commit landing the load-bearing console-capture proxy gate test. D-14 CLOSED.
- D-03 cross-employee fall-through fixture pins the SQL employee filter in `listTopicsForIssueAndAssignee`; route degrades to `new-topic-needed` by construction.

## Task Commits

Each task was committed atomically; Task 2's React-key audit cadence (one-commit-per-component per CONTEXT.md D-14) produced 6 commits.

1. **Task 1: D-08 forward defects + D-03 fixture** — `4b9d855` (fix)
2. **Task 2a: D-13 nav.replace removal** — `f6f8301` (fix)
3. **Task 2b: GAP-RCB-05 chip rectangular box-model** — `549c72d` (fix)
4. **Task 2c-1: React-key audit -- ContextRail** — `f9cf66d` (fix)
5. **Task 2c-2: React-key audit -- PersistedMessage** — `6a927ad` (fix)
6. **Task 2c-3: React-key audit -- TrueTaskDialog** — `b9ce6a5` (fix)
7. **Task 2c-4: React-key audit -- AnchoredToCards** — `b9c8110` (fix)
8. **Task 2c-5: React-key audit -- ChatPageBody** — `7fbd9f8` (fix)
9. **Task 2d: React-key console-capture gate** — `4add621` (test)

**Plan metadata:** (pending — final docs commit will add SUMMARY + STATE + ROADMAP)

## Files Created/Modified

### Modified

- `src/worker/handlers/chat-open-for-issue.ts` — Added `topicIdentifier` resolution on chat-task lineage branch (via ctx.issues.get best-effort + warn-log on throw / missing identifier); added `topicIdentifier` from match.topicId on reverse-lookup N=1 branch; added `sourceIssueIdentifier` emission on reverse-lookup N=1 branch (was: ambiguous-only). Type field documentation extended. CTT-07 invariant preserved (zero ctx.issues.update calls).
- `src/ui/surfaces/reader/continue-in-chat-button.tsx` — Type augmented with `topicIdentifier?: string`. Lineage tooltip swapped to `result.topicIdentifier ?? result.topicIssueId`. Reverse-lookup tooltip's defensive `?? 'this issue'` fallback preserved with a documented worker-contract-violation rationale in the header comment block.
- `src/ui/surfaces/chat/index.tsx` — Removed `nav.navigate(pathname, { replace: true })` from the deep-link consume effect (D-13). Removed `useHostNavigation` import + `nav` const + `nav` useEffect dep (no other consumer in this file). Added Plan 05-07 / D-14 audit annotation citing ChatPageBody.
- `src/ui/styles/chat.css` — `.topic-about-chip` rule: border-radius 999px → 4px; padding moved from children onto parent (`padding: 2px 6px`); children → `padding: 0` (link) and `padding: 0 2px` (dismiss); `white-space: nowrap` added; `gap: 2px` → `gap: 4px`. Annotation block cites Plan 05-07 + RCB-05.
- `src/ui/surfaces/chat/context-rail.tsx` — D-14 audit annotation (documentation-only).
- `src/ui/surfaces/chat/message-thread.tsx` — D-14 audit annotation (documentation-only).
- `src/ui/surfaces/chat/true-task/true-task-dialog.tsx` — D-14 audit annotation (documentation-only).
- `src/ui/surfaces/reader/ref-card.tsx` — D-14 audit annotation (documentation-only).
- `test/worker/handlers/chat-open-for-issue-d7.test.mjs` — Extended ctx fixture with `topicIssueLookup` param for the second-call ctx.issues.get; +6 new tests covering lineage `topicIdentifier` (resolve / throw / missing-identifier paths), reverse-lookup `topicIdentifier` (from match.topicId), reverse-lookup `sourceIssueIdentifier`, and step-2-not-fired invariant on lineage branch.
- `test/ui/chat-url-params.test.mjs` — Test 4 inverted: pre-05-07 PARAMS-CLEARED assertion replaced with D-13 NO-REPLACE-NAV + consumedDeepLinkRef-preserved assertion.
- `test/ui/continue-in-chat-deeplink-contract.test.mjs` — One test inverted from T-04.2-03-04 (replace:true expectation) to D-13 (no-replace + consumedDeepLinkRef preserved).
- `test/ui/no-react-key-warnings.test.mjs` — FILES set extended with 6 additional audit-surface files (active-tasks-owned, archive-topic-button, true-task-dialog, inline-task-card, chat-task-status-pill, ref-card).

### Created

- `test/worker/handlers/chat-open-for-issue-d3-cross-employee.test.mjs` — D-03 cross-employee fall-through fixture. (Filed at `test/ui/` neighbourhood per CONTEXT.md guidance.)
- `test/ui/continue-in-chat-button-d8.test.mjs` — Source-grep contract test for D-08 type + tooltip + worker-contract-violation comment + topicIssueId reference-count invariant (7 allowed sites pinned).
- `test/ui/chat-deeplink-back-preserves-hash.test.mjs` — D-13 source-grep test (no replace-nav, consumedDeepLinkRef preserved, Plan 05-07 + D-13 cited in source, deep-link.mjs + deep-link.d.mts files untouched).
- `test/ui/topic-about-chip-rcb05.test.mjs` — RCB-05 source-grep + CSS-rule-block test (no 999px, 4px pinned, Plan 05-07 + RCB-05 cited near rule, JSX shape preserved).
- `test/ui/chat-react-key-console-capture.test.mjs` — The D-14 load-bearing closure proof. Static console-capture proxy gate: 4 gates across 9 audit files (every JSX-returning .map() has key, no bare-index keys, named components carry 05-07 + D-14 + component-name audit annotation, EXPECTED_HOST_WARNINGS shape contract enforced).

## Deviations from Plan

### Auto-fixed during execution

**1. [Rule 1 — Bug] Unused `nav` binding after D-13 fix**
- **Found during:** Task 2a
- **Issue:** Removing the post-consume `nav.navigate(pathname, { replace: true })` left `nav` (useHostNavigation hook result) + the `useHostNavigation` import unused in `src/ui/surfaces/chat/index.tsx`. No other call site in the same file consumes nav.
- **Fix:** Removed the `useHostNavigation` import, the `const nav = useHostNavigation()` declaration, and `nav` from the consume effect's deps array. Added explanatory comment block above the destructure citing the D-13 rationale.
- **Files modified:** `src/ui/surfaces/chat/index.tsx`
- **Commit:** `f6f8301` (bundled with D-13 commit since they're inseparable changes).

**2. [Rule 2 — Test contract] Test 4 of chat-url-params.test.mjs + one test of continue-in-chat-deeplink-contract.test.mjs were INVERTED**
- **Found during:** Task 2a — running existing suite after the D-13 nav.replace removal
- **Issue:** Both tests asserted the rc.7 `T-04.2-03-04` contract that the consumed deep link IS cleared via a replace navigation. CONTEXT.md D-13 explicitly REVERSES that contract — preserving the URL_HASH is the new behaviour.
- **Fix:** Updated both tests to assert the new D-13 contract (no replace-nav, consumedDeepLinkRef preserved) with explanatory comments tying the inversion back to the rc.7 drill operator gotcha.
- **Files modified:** `test/ui/chat-url-params.test.mjs`, `test/ui/continue-in-chat-deeplink-contract.test.mjs`
- **Commit:** `f6f8301`

**3. [Rule 3 — Tool blocker] Console-capture gate is a STATIC PROXY rather than a DOM-render gate**
- **Found during:** Task 2d implementation
- **Issue:** Plan 05-07 <action> step 6 specifies a DOM-render console-capture test that mounts each of 5 components in jsdom and asserts zero React-key warnings fire. The Clarity Pack project ships no jsdom in devDependencies, no TSX test transform, no test-renderer; every existing UI test is source-grep / static-analysis. Adding jsdom would be a NEW npm install, which falls under the Rule 3 EXCLUSION (package installs require checkpoint:human-verify for legitimacy).
- **Fix:** Per Plan 05-07's own action-step-6 fallback ("Planner picks the simpler path that actually catches `key`-prop warnings"), shipped a STATIC CONSOLE-CAPTURE PROXY (`test/ui/chat-react-key-console-capture.test.mjs`) with 4 gates over 9 audit files. Documented the deviation prominently in the test file header so a future plan can swap in a real DOM-render gate when the host project gains jsdom for other reasons.
- **Files modified:** `test/ui/chat-react-key-console-capture.test.mjs` (created)
- **Commit:** `4add621`

## Threat Model Verification

- T-05-07-01 (Information Disclosure, identifier resolution): ACCEPTED disposition holds — identifiers (CHT-NN, BEAAA-NNN) are public-by-design in Paperclip; opt-in gate still wraps the entire payload.
- T-05-07-02 (Tampering, URL_HASH carrier with Browser-Back preserved): MITIGATED — consumedDeepLinkRef guard preserves consume-once invariant client-side; hash payload never reaches the server; chat-surface dispatch path runs through opt-in-guarded fetches; an unauthorised topic UUID lands at the empty state (verified by existing chat-url-params.test.mjs).
- T-05-07-03 (Denial of Service, additional ctx.issues.get): ACCEPTED disposition holds — one extra host RPC per Continue-button mount on chat-spawned issues; host-side cached; degrades gracefully on outage.
- T-05-07-04 (Tampering, React-key audit + console-capture gate): ACCEPTED — pure rendering changes + static-analysis test surface only.
- T-05-07-05 (Information Disclosure, RCB-05 CSS): ACCEPTED — visual presentation only.
- T-05-07-06 (Repudiation, D-03 fixture): ACCEPTED — test fixture only.
- T-05-07-SC (Tampering, npm installs): n/a — this plan introduces NO new npm dependencies (jsdom rejected per Rule 3 EXCLUSION as documented in Deviation 3 above).

## Test Suite Delta

- **Pre-plan baseline (rc.7):** 1414 tests / 1412 pass / 0 fail / 2 skip (per Plan 05-06 SUMMARY).
- **Post-plan:** 1575 tests / 1573 pass / 0 fail / 2 skip.
- **Net delta:** +161 tests (Task 1: +6 worker handler + 6 UI source-grep + 1 D-03 fixture; Task 2: +4 deep-link tests + 4 RCB-05 tests + 24 console-capture proxy gates including the 4-rule grid × 9 audit-files where applicable; also +6 file additions to no-react-key-warnings's FILES set).

## Quality Gates

| Gate | Result | Notes |
|------|--------|-------|
| `tsc --noEmit` | green | |
| `node --test "test/**/*.test.mjs"` | 1573/1575 pass (2 pre-existing skip preserved) | |
| `check-css-scope` | green (118 selectors, all scoped) | up from 108 baseline (earlier 05-* plans added rules) |
| `check-a11y` | green (66 files / 0 violations) | up from 65 baseline (one new file scanned) |
| `coexistence-checks/run-all.mjs` | 10/10 PASS | |
| `build:worker` | green (2.1mb) | |
| `build:ui` | green (608.7kb) | |
| `check-ui-bundle-size` | green (623277 bytes of 665600 ceiling) | well within budget |

## Closure Baseline (RCB-01..RCB-07) — Preserved

Per CONTEXT.md, the 5 Phase 4.2 closure-fixture paths from `04.2-VERIFICATION.md` MUST NOT regress. All green at the rc.7 build label:

- `test/ui/continue-in-chat-button.test.mjs` (RCB-01) — pass
- `test/ui/reverse-topics-link.test.mjs` (RCB-06) — pass
- `test/ui/topic-strip-backlink.test.mjs` (RCB-05 JSX shape) — pass
- `test/ui/continue-in-chat-deeplink-contract.test.mjs` (RCB-03 carrier) — pass (with the one D-13 contract test inverted, documented in Deviations)
- `test/worker/handlers/chat-open-for-issue-d7.test.mjs` (D-7 routing baseline) — pass (extended +6 new D-08 tests, all 7 RED tests still green)

## D-14 React-key Audit Outcomes

Per-component audit verdicts (all `documentation-only annotation` outcomes, paired with the passing console-capture gate per the plan's acceptance contract):

| Component | File | Verdict | Commit |
|-----------|------|---------|--------|
| ContextRail | `src/ui/surfaces/chat/context-rail.tsx` | no-fix-needed — file's only .map() is data projection; pinnedMessages map keyed on m.commentId; Fragment siblings are conditional renders in different curly-brace slots | `f9cf66d` |
| PersistedMessage | `src/ui/surfaces/chat/message-thread.tsx` | no-fix-needed — returns single <article>; outer ordered.map keys all sibling-arms; child helpers ship keyed Fragments; composite stable keys for diagnostics nested maps already in place from 04.2-05 D4/D5 | `6a927ad` |
| TrueTaskDialog | `src/ui/surfaces/chat/true-task/true-task-dialog.tsx` | no-fix-needed — both JSX-returning .map() already keyed (roster on emp.id, topics on t.issueId); single `<></>` closed-state is empty fragment; sibling files contain no .map() | `b9ce6a5` |
| AnchoredToCards | `src/ui/surfaces/reader/ref-card.tsx` | no-fix-needed — safe.map() already keyed on c.id (BEAAA-NNN stable server-provided); RefCard child has no .map() | `b9c8110` |
| ChatPageBody | `src/ui/surfaces/chat/index.tsx` | no-fix-needed — only .map() is data projection; outer `<>...</>` wraps the single root return (not a sibling-in-list); conditional renders in own curly-brace slots | `7fbd9f8` |

## EXPECTED_HOST_WARNINGS Allow-List

Empty as of Plan 05-07 — no host-side warnings surfaced. The allow-list shape contract is enforced by Gate 4 of the console-capture proxy.

## Self-Check: PASSED

- All 9 task commits exist in `git log` (verified): 4b9d855, f6f8301, 549c72d, f9cf66d, 6a927ad, b9ce6a5, b9c8110, 7fbd9f8, 4add621.
- All created files exist: test/ui/chat-open-for-issue-d3-cross-employee.test.mjs, test/ui/continue-in-chat-button-d8.test.mjs, test/ui/chat-deeplink-back-preserves-hash.test.mjs, test/ui/topic-about-chip-rcb05.test.mjs, test/ui/chat-react-key-console-capture.test.mjs.
- Version literals in `package.json` (`1.0.0-rc.7`) and `src/manifest.ts` (`1.0.0-rc.7`) verified UNCHANGED.
- All quality gates green.
- Forward defects routed to this plan are CLOSED: GAP-D8-LINEAGE-TOOLTIP, GAP-D8-REVERSE-TOOLTIP-FALLBACK, GAP-RCB-05-CHIP-STYLING, D-13, D-14, D-03.

## Threat Flags

None — no new security-relevant surface introduced beyond what the `<threat_model>` block already enumerated.
