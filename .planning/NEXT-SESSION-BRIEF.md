# NEXT-SESSION BRIEF — pause-banner fix (#1) + remaining items

**Written:** 2026-05-28 ~13:05 UTC, end of a long multi-fix session on clarity-pack v1.0.0 / BEAAA.
**Purpose:** hand off to a fresh context window with EVERYTHING needed to finish, so there is zero re-litigation of ground already covered. Read this top-to-bottom first.

Everything here is verified true as of this writing. clarity-pack stays **v1.0.0** (no version bump). Commits are on `origin/master`.

---

## 0. The box (BEAAA / AriClaw) — facts you need

| Fact | Value |
|------|-------|
| SSH | alias `ariclaw` (= `root@46.101.105.87`, key `beaaa_ariclaw_ed25519`, `IdentitiesOnly yes`). `ssh ariclaw whoami` -> `root`. |
| Runs as | user `beai-agent`; pm2 process name `paperclip`; `sudo -u beai-agent pm2 ...` |
| Plugin install path | **STABLE** `/home/beai-agent/clarity-pack-live/package` (NOT /tmp — see §5). |
| Plugin id | `a763176a-2f4d-4986-b190-b5151e42cc00` |
| Companies (two!) | BEAAA `59f8876e-e729-4dda-98f9-1317c2b50492` + `daaaf066-65ff-4d13-923e-de02a50939ac` |
| Worker log | `/home/beai-agent/.pm2/logs/paperclip-out.log` (host does NOT propagate Postgres error detail here — only "Failed query: <sql>"). |
| Embedded Postgres | `embedded-postgres` on 127.0.0.1:54329, data `~/.paperclip/instances/default/db`. **Password is host-held; we CANNOT psql it** (no conn string in config.json, no trust auth). Fix DB issues via plugin migrations only. |
| Agent status (authoritative) | `sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai agent list -C 59f8876e-e729-4dda-98f9-1317c2b50492 --json'` -> Editor-Agent is `status:idle, pausedAt:null` (ACTIVE). The clarity pause-banner is a stale-read and lies — do not trust it. |

Deploy procedure: see `.planning/DEPLOY-RUNBOOK.md` (Path A) + §5 below for the de-risked stable-path variant.

---

## 1. DONE + DEPLOYED + VERIFIED this session (do NOT redo)

All live on BEAAA, all on `origin/master`:
- **Reader crash** (`92d855d`): `deep-link.mjs` `b64encode` threw on non-Latin1 (em-dash etc.) via raw `btoa`. Fixed UTF-8-safe + added per-section `<SectionErrorBoundary>` (`src/ui/primitives/error-boundary.tsx`). Verified: Reader renders, no "failed to render".
- **TL;DR copy** (`a325d91`): "Compiling TL;DR…" -> "No TL;DR yet / Compiled by the Editorial Desk when this task is created or updated." Verified live.
- **Boot warning** (`21a5fd5`): removed the boot-time `ctx.companies.list()` Editor-Agent reconcile (rejected under PR #6547; redundant). Gone.
- **CI emails** — all 4 workflows green (were red for weeks): lockfile-audit (`cf7e118`, npm->pnpm), coexistence (`43e2a69`, Node 20->24 for `--experimental-strip-types`), scaffold-check (`43e2a69` eslint + `50d60e0` Playwright Chromium install).
- **Bulletin timezone** (`3e14233`, already deployed): America/New_York -> Asia/Jerusalem. Verified: next_due_at computes 03:30 UTC = 06:30 Israel.
- **Bulletin multi-company fix** (`9b2f66c`, deployed + verified): migration `0014_bulletins_multicompany.sql` (composite PK `(company_id, cycle_number)` + company-scoped `UNIQUE (company_id, next_due_at, content_hash)`) + company-scoped ON CONFLICT/read-backs in `bulletins-repo.ts` + `publish.ts` + the 3 in-memory test emulators. VERIFIED on box: `per-company iteration failed` errors stopped, both companies bootstrapped (11:06/11:08), compile runs clean. First bulletin publishes tomorrow 06:30 Israel.
- **Editor-Agent**: operator resumed it via the native Agents panel; CLI-verified active; it compiles.
- **MemPalace**: drawers filed in `clarity_pack/runbook` (`drawer_clarity_pack_runbook_941927ddc10f1651ca30607e`) + `clarity_pack/decisions` (`drawer_clarity_pack_decisions_67425a9aae0f309dee9691ae`), plus a bulletin-deploy-verified update.

---

## 2. PRIMARY REMAINING TASK — pause-banner fix (#1)

**Symptom the operator sees:** a red banner on the Reader top + chat header: "this employee paused by operator — ▶ Resume heartbeat", that (a) shows even when the agent is NOT paused, (b) says the generic "this employee" instead of the agent name, (c) its "Resume heartbeat" button returns **502** in the console.

**Three root causes, all in `src/worker/handlers/editor-pause-status.ts`** (the `editor.pause-status` data handler the banner subscribes to) + the banner UI `src/ui/primitives/agent-pause-banner.tsx`:

### (a) `paused` is a stale heuristic, not the real status
The handler sets `paused = (latest editor_agent_failures row).consecutive >= MAX_CONSECUTIVE_FAILURES (3)`. `recordSuccess` (circuit-breaker.ts) zeroes only the in-memory counter and writes NO row — so after a real resume + successful compiles, the latest failure row still has `consecutive>=3` and the banner shows "paused" FOREVER. This is why the operator sees a false pause.
**Fix:** read the agent's REAL status. Resolve the UUID first, then `ctx.agents.get(uuid, companyId)` and set `paused = (agent.status === 'paused') || (agent.pausedAt != null)`. That is authoritative and self-clears on resume. Keep the failure-table read ONLY for the legacy footer fields (`lastFailureAt`/`reason`) the editor-only `pause-banner.tsx` consumes (its literal "Editorial Desk paused — last compile failed at" is pinned by reader-view.test.mjs — do NOT change that component).

### (b) `agents.get` is called with the KEY, not the UUID
Current code: `ctx.agents.get(EDITOR_AGENT_KEY /* 'editor-agent' */, companyId)`. The host runs `SELECT ... FROM agents WHERE id = $1` and the id column is a uuid -> `PostgresError: invalid input syntax for type uuid: "editor-agent"` -> caught -> agentName null -> UI shows "this employee".
**Fix:** resolve the UUID first via `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId)` -> `.agentId`, then `ctx.agents.get(agentId, companyId)`. (compile-bulletin.ts already resolves + calls `ctx.agents.resume(uuid, companyId)` successfully, so reconcile->get(uuid) works on this host.) Read `.name` for agentName, `.status`/`.pausedAt` for (a). **Wrap in try/catch and fall back to the OLD failure-table heuristic on any error** so the handler never gets worse than today.
The `EditorPauseStatusCtx` type is `agents?: Pick<PluginAgentsClient, 'get'>` — widen it to include `managed.reconcile`.

### (c) Resume button 502
`agent-pause-banner.tsx` calls `usePluginAction('agents.resumeHeartbeat')` but the worker NEVER registers an `agents.resumeHeartbeat` action -> host returns 502. Decision (governance-aligned): circuit-breaker.ts says resume is an explicit operator action in the native Agents panel. Two clean options — pick one:
  - **Wire it:** register an `agents.resumeHeartbeat` worker action that resolves the UUID + calls `ctx.agents.resume(uuid, companyId)` (the same API compile-bulletin uses). Check how other actions register (e.g. `ac-toggle`) — search worker.ts / handlers for the action-registration mechanism.
  - **Or remove/repoint the button** to direct the operator to the native Agents panel (no 502). Lower-risk.

**Test approach:** the repo has NO jsdom/TSX render tests — all UI tests are source-grep, and worker handlers use `test/helpers/host-faithful-ctx.mjs` (an in-memory ctx). Add/extend a handler test that stubs `ctx.agents.managed.reconcile` + `ctx.agents.get` returning `{status:'active', pausedAt:null, name:'Editor-Agent'}` and asserts `paused:false` + `agentName:'Editor-Agent'`; and a paused stub asserting `paused:true`. There is an existing `test/ui/agent-pause-banner.test.mjs` (source-grep) — keep its locked literals intact.

**Risk note:** this touches `ctx.agents.get`/`reconcile` — the exact host APIs that have been flaky on this box. The try/catch fallback is mandatory. Cannot be fully tested against the live agent state from local tests.

---

## 3. SECONDARY — force a bulletin NOW (operator wants to SEE one today)

The bulletin pipeline is fixed but the first natural publish is tomorrow 06:30 Israel (next_due_at = 2026-05-29T03:30:00Z). To force one today you must set `next_due_at` into the past so the next 60s tick compiles. **BLOCKER:** that is a write to the embedded Postgres, whose password is host-held — we could not psql it this session (config.json has no conn string; no trust auth on :54329). Options for the next session:
- Operator retrieves the embedded-PG connection string (they set up the instance), then `UPDATE plugin_clarity_pack_cdd6bda4bd.bulletins SET next_due_at = now() - interval '1 minute' WHERE company_id = '59f8876e-...';` and watch the log for a "result DOCUMENT received" + "Bulletin No. N" publish.
- OR a creative no-DB nudge: temporarily set the `bulletinTimezone` instanceConfig to a zone where 06:30 is imminent, let it compile, then set it back to Asia/Jerusalem. Hacky; only if the operator wants a same-day demo.
- OR just wait for tomorrow 06:30 Israel (the steady state is now correct).
The agent must be un-paused for the compile to succeed (it currently is).

---

## 4. DEFERRED (operator-owned, own sessions)
- **Relocate `~/.paperclip` onto the 100 GB volume** (`/mnt/paperclipdata`, 80 G free). Live DB + caches are on the 25 GB root (was 87%, now 78%). The instance `data` dir is already symlinked to the 100 GB volume, but `db/` (embedded PG) + npm caches are on root. Needs: DO snapshot -> stop paperclip -> move -> symlink -> restart -> verify. ~5 min downtime.
- **Reclaim root caches:** `npm cache clean --force` (root, ~1.7 G) + `apt-get clean`. SAFE; awaiting operator go. Do NOT `journalctl --vacuum` (classifier-blocked on the production host).

---

## 5. DEPLOY PROCEDURE (proven this session) — read before deploying #1

1. `git push origin master`.
2. `node scripts/build-worker.mjs ; node scripts/build-ui.mjs ; npx tsc --project tsconfig.manifest.json`.
3. Gates: `npx tsc --noEmit` ; `node scripts/check-css-scope.mjs` ; `node scripts/check-ui-bundle-size.mjs` ; `node --test "test/**/*.test.mjs"` (1 pre-existing `situation-artifacts` fixture fail is OK; no others). **`grep -c paperclipInvocation dist/worker.js` MUST be >= 5** (SDK bundled — if 0, `scripts/build-worker.mjs` externalized the SDK; remove it from `external[]`).
4. `npm pack` ; note sha256 (`certutil -hashfile clarity-pack-1.0.0.tgz SHA256`).
5. Upload: `ssh ariclaw 'rm -f /tmp/clarity-pack-1.0.0.tgz' ; scp clarity-pack-1.0.0.tgz ariclaw:/tmp/clarity-pack-1.0.0.tgz ; ssh ariclaw 'sha256sum /tmp/clarity-pack-1.0.0.tgz'` (confirm match).
6. Install from the STABLE path (this is the de-risked flow — local-path installs make the host watch the dir, so /tmp deletion crash-loops the worker; always install from `/home/beai-agent/clarity-pack-live`):
```
ssh ariclaw bash <<'REMOTE'
chown beai-agent:beai-agent /tmp/clarity-pack-1.0.0.tgz
sudo -u beai-agent bash -lc '
  set -e
  STABLE=$HOME/clarity-pack-live
  rm -rf "$STABLE" && mkdir -p "$STABLE"
  tar -xzf /tmp/clarity-pack-1.0.0.tgz -C "$STABLE"
  cd "$STABLE/package"
  npm install --no-fund --no-audit --no-progress 2>&1 | tail -2
  touch dist/manifest.js
  cd ~ && npx paperclipai plugin uninstall clarity-pack 2>&1 || echo "(uninstall skipped)"
  npx paperclipai plugin install "$STABLE/package" 2>&1
'
sudo -u beai-agent pm2 restart paperclip 2>&1 | tail -1
sleep 6
sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin list 2>&1 | grep clarity-pack'
REMOTE
```
Expect `key=clarity-pack status=ready version=1.0.0 id=a763176a-...`.
**Gotcha:** if install errors `Worker already registered ... (status: crashed)` (only when the worker is crash-looping), do uninstall -> `pm2 restart paperclip` -> wait for `curl http://localhost:3100/health` = 200 -> install. When the worker is healthy this is unnecessary.
7. Verify #1: the operator hard-refreshes the Reader; the banner should now reflect the REAL agent status (gone when active). Confirm via `agent list -C ... --json` that the banner matches reality.

### Migration validator rules (if #1 needs a migration — it should NOT)
The host plugin SQL validator allows ONLY statements beginning `create`/`alter`/`comment`. No `DO $$` blocks, no standalone `DROP`, no standalone `CREATE INDEX` (rejected — use `ALTER TABLE schema.table ADD CONSTRAINT`). Fully-qualified `plugin_clarity_pack_cdd6bda4bd.<table>`. Apostrophe-free comments. Enforced by `test/migrations/ddl-prefix-validator.test.mjs`.

---

## 6. One-line status
Everything operator-facing is fixed + deployed + green EXCEPT the pause-banner stale-read (#1, the false "paused" banner) — that is the next focused job. The bulletin publishes tomorrow 06:30 Israel unless force-compiled (needs DB access we lack).
