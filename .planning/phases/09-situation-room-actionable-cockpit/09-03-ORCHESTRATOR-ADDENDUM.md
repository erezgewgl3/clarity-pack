# 09-03 Orchestrator Addendum — Reader drill rider

**Operator decision — 2026-05-31, during `/gsd:execute-phase 9`.**

Plan 09-03 ships **v1.3.0**, which is the **first live appearance on BEAAA** of the
**v1.2.2 Reader redesign** (Quick task `260531-b8w`; locked sketches **003-B + 004-B**):

- TL;DR-first **no-rail** ~760px reading column (plugin right rail dropped)
- "Show full task" disclosure; `LiveBlockerPanel` relocated inline
- Host-native editorial type scoped to `[data-clarity-surface='reader']`
  (system-ui body / Newsreader BLUF 400/600 / JetBrains Mono IDs)
- Two-weight ref-chips (`.clarity-ref-chip--inline` for mid-sentence refs)

BEAAA currently runs **v1.2.1**, so the v1.2.2 Reader code has never been live.
Phase 9 implements **no** Reader code — it only inherits the already-committed v1.2.2
Reader and carries it live via the v1.3.0 build/deploy.

## Required of the 09-03 live drill

In **addition** to the 11 Situation Room acceptance checks, the Playwright live drill MUST
spot-check the Reader on BEAAA after deploy:

1. Open a task's Reader (detail tab) on BEAAA.
2. Confirm: single ~760px reading column, **no** plugin right rail.
3. Confirm: "Show full task" disclosure present and toggles.
4. Confirm: host-native editorial type (Newsreader BLUF, system-ui body, mono IDs).
5. Confirm: inline ref-chips render as prose for mid-sentence refs (not the bordered chip).

Record the Reader spot-check as a **supplementary check** in `09-VERIFICATION.md`
(does not gate the 9 Situation Room requirements R1–R9, but must be reported PASS/FAIL).
