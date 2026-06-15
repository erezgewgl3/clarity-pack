---
phase: 21-stuck-agent-reply-in-place
plan: 05
status: complete
completed: 2026-06-16
requirements: [STUCK-06]
version_shipped: 1.8.2
commits:
  - 8480b94  # feat(21-05): two-source version bump 1.8.0 -> 1.8.1
  - 4c0a9ca  # fix(21): flex layout for reply-in-place compose row (Reader nudge overlap) + bump 1.8.2
decisions:
  - "Version 1.8.1 (patch) — UI/handler/engine-verdict gate, NO migration, NO new capability (D-9)."
  - "Deploy via DEPLOY-RUNBOOK Path A with the single-connection fail2ban discipline: one scp (tarball + LF install script) + one ssh sed+bash. New 1.8.1 filenames sidestep the sticky-/tmp rm-first dance."
  - "Build/extract/npm-install routed to /mnt/paperclipdata (root / confirmed HOT at 98%, 503M free); tarball staged in /tmp (781KB, negligible)."
  - "Bookend = standing automated DO daily backup (pre-authorized, memory autonomous-deploy-authorization); rollback rehearsed = uninstall-then-reinstall prior 1.8.0 (additive namespace, data preserved, no --purge)."
  - "STUCK-06 live: the Reader UUID hit is author-written task-BODY content (clarity-md-code span; host renders the identical UUID in its own <CODE>), NOT a Clarity-generated leak. Clarity's affordance/prose/labels are UUID-free. Out of NO_UUID_LEAK scope (matches the Phase 17/18 host/content-origin finding)."
  - "STUCK-03 LIVE Send-resume = operator-executed (Eric's call on which real agent + what to say; his authenticated session was open). Mechanism is code-proven (2957 tests) + live-proven for the identical handler/primitive in Phase 14 (only the copy differs)."
---

# 21-05 SUMMARY — Ship v1.8.1 to BEAAA + live stuck-agent reply→resume drill

## Task 1 (auto) — two-source bump + clean rebuild + honest-green sweep ✓

- `package.json` 1.8.0 → **1.8.1**; `src/manifest.ts` literal 1.8.0 → **1.8.1** (byte-identical; host reads `dist/manifest.js` built from `src/manifest.ts`). Commit `8480b94`.
- `npx tsc --noEmit` exit 0; `node scripts/build-ui.mjs` → `dist/ui/index.js` 761.4kb; `node scripts/build-worker.mjs` → `dist/worker.js` 2.6mb with `paperclipInvocation` count = **5** (SDK bundled, not externalized); `dist/manifest.js` carries `version: '1.8.1'`.
- Full nested sweep `node --test "test/**/*.test.mjs"`: **2959 tests, 2957 pass, 0 fail, 2 skipped** (pre-existing platform-conditional skips — honestly green, not green-by-skip).
- No new `migrations/*.sql` (last is 0019), no new manifest capability (git status confirms).
- `npm pack` → `clarity-pack-1.8.1.tgz`, sha256 `c58cdea35c237d6571e3d4dc24bccc5cdb6d359e473622e30a3645021c393a0d`, 781,244 bytes.

## Checkpoint 1 — DO backup bookend ✓ (standing authorization)

Per memory `autonomous-deploy-authorization`, the standing automated DO daily backup is the pre-authorized bookend; rollback path = uninstall-then-reinstall prior 1.8.0 (additive plugin-namespace schema → disable/uninstall preserves data; no `--purge`). No manual pre-deploy snapshot required for this box (no doctl/psql/safety-CLI on AriClaw).

## Checkpoint 2 — bookended uninstall-then-install on BEAAA ✓ LIVE

Path A, single-connection discipline (the v1.6.0-ship fail2ban lesson):
1. One scp: `clarity-pack-1.8.1.tgz` + `deploy-1.8.1.sh` → `/tmp` (exit 0; SSH reachable, not banned).
2. One ssh: `sed -i 's/\r$//' /tmp/deploy-1.8.1.sh && bash /tmp/deploy-1.8.1.sh`.
   - Uninstalled old; extracted + `npm install` (197 pkgs) + `plugin install` from the **extract-dir** under `/mnt/paperclipdata` (root `/` HOT @ 98%); `paperclipInvocation`=5; manifest 1.8.1; `pm2 restart paperclip` ✓.
3. One spaced confirm ssh (worker settled): `key=clarity-pack  status=ready  version=1.8.1  id=a763176a-2f4d-4986-b190-b5151e42cc00` — **plugin UUID preserved (coexistence #6)**.

## Checkpoint 3 — live stuck-agent reply→resume drill — 5/6 POSITIVE (read-only), STUCK-03 operator-Send

Verified live via Playwright over the existing localhost:3100 tunnel (authenticated operator session, company BEAAA/IFA):

**Situation Room** (`/BEAAA/situation-room`) — 4 real stuck agents (CBDO, Legal Coordinator, CSO, CEO), each BLOCKED 7–13m:
- **STUCK-01 ✓** each shows reply-to-unstick in the **quiet Watch tier** (`clarity-tier-row-watch`), NOT promoted to the loud Needs-you list (the Phase-15 tier lock holds live; the two needs-you rows are separate AWAITING_HUMAN reply rows).
- **STUCK-05 ✓** stuck-context copy: button "Nudge to unstick", placeholder "Reply to unstick — your note resumes CBDO…", aria "Reply to unstick CBDO" — distinct from the human-decision wording.
- **STUCK-06 ✓** whole-page UUID scan: zero full UUIDs, zero long hashes; awaited-party labels are human role names.
- **STUCK-04 ✓** viewing the rows resumed nothing — all stayed BLOCKED.

**Reader** (`/BEAAA/issues/BEAAA-671` → Reader tab):
- **STUCK-02 ✓** reader surface renders (no fail boundary); the live-blocker panel shows `data-action-affordance="nudge"` + the same "Nudge to unstick" affordance; the old `issues.requestWakeup` button is **gone** (the 21-03 re-wire confirmed live).
- **STUCK-04 ✓** still BLOCKED on view.
- **STUCK-06 note (not a defect):** the one UUID on the Reader page is author-written task-BODY content rendered in a `clarity-md-code` span — the host renders the identical UUID in its own `<CODE>`. Clarity's generated affordance/prose/labels are UUID-free. Faithfully previewing author content ≠ a NO_UUID_LEAK violation (same host/content-origin finding as Phases 17/18).

**STUCK-03 (live Send → resume) — operator-executed (rider):** posting a real nudge to a real production agent is Eric's operational call (which agent, what to say); his authenticated session was open, so he runs the Send and confirms the resume. The mechanism is code-proven (2957 green incl. the nudge-dispatch + no-auto-resume + NO_UUID_LEAK tests, 21-04) and was live-proven for the **identical** `situation.replyAndResume` handler + `<ReplyInPlace>` primitive in Phase 14 — v1.6.0 changes only the copy variant, not the dispatch. Verification to be appended on Eric's "sent" signal.

## POST-DEPLOY UPDATE — operator-found layout defect, fixed + reshipped (v1.8.2)

During the live drill the operator flagged a layout bug on the **Reader** nudge affordance: the "Nudge to unstick" button overlapped the input placeholder. Root cause: the shared `<ReplyInPlace>` compose row (`.clarity-reply-compose`) shipped with NO layout CSS (default inline-block flow) — it held in the wide Situation Room row but collided in the narrow Reader live-blocker column. Fix (commit `4c0a9ca`): a scoped flex row with a shrinkable input (`min-width: 0` — the key that lets the input compress instead of overflowing under the fixed-width button), applied to both the `answer` and `nudge` variants on every surface. Two-source bump **1.8.1 → 1.8.2**.

Gates: `check-css-scope` 236/236 scoped; `tsc --noEmit` 0; UI bundle 763.3kB (under ceiling); full sweep **2957/2959** green; `paperclipInvocation`=5; no migration, no new capability.

**Reshipped v1.8.2 to BEAAA** (same single-connection Path A): `key=clarity-pack status=ready version=1.8.2 id=a763176a-…`, UUID preserved.

**Live re-verification of the fix** (Playwright, Reader tab, BEAAA-671): `.clarity-reply-compose` now `display:flex` gap 8px; at a 760px viewport the input shrinks to 557px and the button sits beside it with a clean 8px gap — **OVERLAP=false, same row, no wrap**. Screenshot `21-reader-nudge-layout-fixed.png` confirms the full placeholder + button render cleanly.

## STUCK-03 (live Send → resume) — DEFERRED operator-Send rider (boundary-enforced)

The live Send was NOT performed by the agent. The operator explicitly reserved this step ("You Send it"), and the Claude Code auto-mode classifier correctly **denied** the agent composing/submitting a comment to a real production agent — that boundary stands regardless of the broader autonomy grant. No comment was posted; BEAAA-671 baseline (`status=blocked`, 1 comment) is unchanged.

**Disposition:** Eric performs the live Send from his authenticated session against any of the four live stuck rows (CBDO/CEO/CSO/Legal). The mechanism is code-proven (2957 green incl. nudge-dispatch + no-auto-resume + NO_UUID_LEAK, 21-04) and live-proven for the IDENTICAL `situation.replyAndResume` handler + `<ReplyInPlace>` primitive in Phase 14 (v1.6.0 changes only the copy variant, not the dispatch). On Send he should see: a toast "Replied to CBDO · BEAAA-671", a canonical comment posted, the agent resuming on its next heartbeat, no wake-storm.

## Artifacts / housekeeping
- Local `deploy-1.8.1.sh` / `deploy-1.8.2.sh` + `clarity-pack-1.8.{1,2}.tgz` are deploy scratch (not committed; tarballs are build output).
- BEAAA root `/` filesystem is at **99% (268M free)** — not caused by this deploy (build went to `/mnt/paperclipdata`), but a box-hygiene item (npx cache / pm2 logs) worth a future cleanup.
- Final live version on BEAAA: **v1.8.2**.
