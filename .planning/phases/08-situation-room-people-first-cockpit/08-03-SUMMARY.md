# Plan 08-03 SUMMARY — BEAAA live drill + v1.2.0 ship (Phase 8 closure)

**Status:** COMPLETE — Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30
**Tasks:** 4/4 (T1 version bump + gates + pack · T2 deploy · T3 live Playwright drill [blocking human-verify, operator-approved] · T4 closure docs + commit)

## What shipped

v1.2.0 — the people-first Situation Room cockpit — deployed and drilled live on BEAAA.

- **Version bump (two-source rule):** `package.json` + `src/manifest.ts` both 1.1.11 → 1.2.0, plus a Phase 8 release-history note in manifest.ts. Built manifest carries `version: '1.2.0'`; the only residual `1.1.11` is a historical comment (acceptance-allowed).
- **Tarball:** `clarity-pack-1.2.0.tgz` — sha256 `de16e83f0829f3b7f61f2035a4cdcdee961aa498f4dbd946f73f3b861a700d66`, 745,815 B. SDK inlined (5 `paperclipInvocation` refs).
- **Deploy:** DEPLOY-RUNBOOK Path A (scp `/tmp` + here-string `ssh ariclaw bash` install as `beai-agent` + `pm2 restart paperclip`). Remote sha256 byte-identical. `paperclipai plugin list` → `key=clarity-pack status=ready version=1.2.0 id=a763176a-2f4d-4986-b190-b5151e42cc00` (UUID preserved across upgrade — COEXIST #6).
- **Live drill:** Playwright over the 18-agent BEAAA roster — **6/6 Success Criteria PASS** + M4 mount-order PASS. See `08-VERIFICATION.md` for per-criterion + per-requirement evidence.

## Gates

typecheck ✔ · full suite 2374 (2371 pass / 2 skip / **1 pre-existing out-of-scope `situation-artifacts` fail**, proven independent at `d526987`, logged to deferred-items) · check-css-scope (200 scoped) ✔ · build worker/ui/manifest ✔ · check-ui-bundle-size (742,840 / 746,496 B) ✔ · pack ✔.

## Standout drill findings

1. **Fresh-compute robustness:** the people-first strip is computed per request, so the full cockpit renders even when the materialized-snapshot job is dead. The legacy ROOM-01..08 agent grid renders empty on cold-start (dead-job path) — **pre-existing behavior byte-identical to v1.1.11 (proven at `d526987`), NOT a Phase 8 regression**. Phase 8 kept the cached-path `...payload` spread intact.
2. **M3 N/A:** every blocked chain had a non-null `ownerAgentId` (= focusIssue.assigneeAgentId per B1) → open-chat buttons correctly ENABLED; click deep-links to `/BEAAA/chat#h=<base64 {employee:agentId}>`, chat opens scoped. The disabled-degrade (`__unowned__`) path didn't occur on the live roster. Cosmetic note: button labels "Open chat with Unassigned" (human-owner field) while the link targets the assignee agent.
3. State pills render the LOCKED palette live: blocked red `rgb(220,38,38)` · stale/idle amber `rgb(180,83,9)`/`rgb(217,119,6)` · reviewing/running green `rgb(21,128,61)`/`rgb(22,163,74)`.

## Deviations

- REQUIREMENTS.md index table read "Complete" (set by the 08-01/08-02 executors) rather than the plan's expected "Pending"; flipped to the project-standard "Implemented (…)" with closure notes.
- Drill driven via Playwright MCP by Claude (operator-authorized "I deploy + drill"); operator approved the 6/6 verdict at the blocking checkpoint.

## mn2 sequencing

Closure commit contains ONLY docs + version bump (package.json, src/manifest.ts, REQUIREMENTS.md, STATE.md, ROADMAP.md, 08-VERIFICATION.md, 08-03-SUMMARY.md). Plan 08-01 + 08-02 source landed under their own commits.

VERIFICATION: `.planning/phases/08-situation-room-people-first-cockpit/08-VERIFICATION.md`.
