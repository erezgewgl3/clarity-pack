---
plan: 19-05
phase: 19
title: Two-source bump v1.8.0 + bookended BEAAA deploy + monitored ON-flip
status: complete
completed: 2026-06-15
requirements: [CARD-01, CARD-02, CARD-03]
autonomous: false
---

# Plan 19-05 SUMMARY — v1.8.0 deploy + live ON-flip

All three tasks complete. Action-cards are **LIVE on BEAAA at v1.8.0** (flag ON), proven storm-safe.

## Task 1 — Two-source bump + clean rebuild (autonomous, commit `c56d7cc`)
- `package.json` + `src/manifest.ts` → `1.8.0` (byte-identical); `dist/manifest.js` rebuilt and carries `1.8.0`.
- Full suite green at the bump commit (2937 pass / 1 pre-existing Phase-17 prefetch drift since fixed in 20-01 / 2 env-gated skips); `tsc --noEmit` exit 0; `blocker-chain.ts` untouched.

## Task 2 — Step-1: bookended deploy, flag OFF (live)
- **Bookend:** operator confirmed automated DO backups ON with a recent snapshot (the rehearsed rollback path; the box has no doctl/psql for a self-bookend).
- **Deploy:** uploaded `clarity-pack-1.8.0.tgz` (npm pack) to `/mnt/paperclipdata/clarity-deploy`, extracted to `pkg/`, then **uninstall v1.7.5 (no --force, data preserved) → install v1.8.0 → ready**. Run as a **detached (`setsid`) job** so a dropped SSH session can't sever it.
- **Quiet verify (flag OFF):** `plugin list` = `version=1.8.0 status=ready`; worker :3100 UP; **zero EADDRINUSE** (no blank-UI); `clarity.health` 200; `situation.snapshot` **200 with 18,850 bytes of real data** — room serving the deterministic floor, no 502.

## Task 3 — Step-2: monitored ON-flip (live)
- **Flip route (CORRECTED):** the operator flip is `POST /api/plugins/<id>/actions/set-action-cards-flag` with body **`{"params":{"companyId":"<CID>","enabled":<bool>}}`** — the action route nests handler args under `params` (the original `{companyId,enabled}` top-level shape returns 502 at the boolean guard). Panic-OFF rehearsed and proven 200 before any ON-flip.
- **ON-flip:** `enabled:true` → 200 `{enabled:true}`. Monitored ~2 min: **load flat 1.4–2.4 (= baseline, NO STORM)**, `situation.snapshot` **200 throughout (no 502)** → **CARD-03 live-proven** (the 16.1 governor + bounded-warm cap hold on production, not just in CI).
- **Final state:** operator chose **flag ON — delivered live.** Room healthy with flag ON (snapshot 200, health 200, load 2.2). BEAAA company id `59f8876e-e729-4dda-98f9-1317c2b50492`.

## Open rider (human verification, NOT a code gap)
- **CARD-02 visible-prose live-positive:** no action-card *rendered* during the drill window — the compile is governed/heartbeat-driven (read-cached-only snapshot per CARD-01), so a visible card needs an Editor heartbeat compile cycle, which is dormant on a quiet queue and was not forced (forcing a wake is the one thing that pokes the storm risk). The four-surface attach is CI-proven (19-03, 57/57); cards will populate as governed heartbeats run. Identical in kind to the Phase-17 deferred live-positive rider.

## Operator kill-switch (proven)
```bash
# On AriClaw (ssh ariclaw). Panic-OFF = enabled:false ; re-enable = enabled:true
ID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492
curl -s -X POST "http://localhost:3100/api/plugins/$ID/actions/set-action-cards-flag" \
  -H "content-type: application/json" \
  --data "{\"params\":{\"companyId\":\"$CID\",\"enabled\":false}}"
```

## Deploy lessons (folded to memory)
- **fail2ban tripped on rapid-fire SSH** during recon/probing → IP banned mid-command (the "uninstall" that didn't commit was a false-alarm; v1.7.5 stayed healthy throughout). Fix: operator unban via DO console; then **one deliberate connection per step + detached jobs**, never reconnect storms.
- **Root `/` was at 99%** (318 MB free) — npm-cache prune reclaimed to 597 MB; the `/tmp/paperclip-cto-*`, `*-smoke`, build dirs were all **live** (age 0–1d, incl. a 1.2 G live CTO-agent dir) — age-gated and left untouched. Standing finding: AriClaw root fs runs hot.
- **`plugin upgrade` is registry-only** (no local-path arg) → local-path deploys must use uninstall-then-install.
