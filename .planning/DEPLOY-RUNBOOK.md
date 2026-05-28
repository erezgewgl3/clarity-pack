# clarity-pack → BEAAA (AriClaw) DEPLOY RUNBOOK

**For:** any Claude Code session that has committed a fix to GitHub master and needs to deploy it to the live BEAAA production instance.
**Authoritative as of:** 2026-05-28. Hard-won during the v1.0.0 ship session — every gotcha below cost real back-and-forth.
**Read this top-to-bottom before running anything.**

---

## 0. Mental model — how BEAAA is wired (this is NOT a standard Paperclip install)

| Fact | Value | Why it matters |
|------|-------|----------------|
| Host | DigitalOcean Droplet "AriClaw" | Not Hostinger; not the Countermoves test box. |
| Public IP | `46.101.105.87` | |
| OS | Ubuntu 24.04 LTS | |
| SSH alias | `ariclaw` (configured in `~/.ssh/config` → root@46.101.105.87, key `beaaa_ariclaw_ed25519`, `IdentitiesOnly yes`) | `ssh ariclaw whoami` should print `root`. |
| Paperclip runtime | `npx paperclipai run` (NOT a git checkout, NOT pnpm) | The CLI lives in an npx cache; there is no `~/paperclip` workspace. |
| Paperclip version | `paperclipai@2026.525.0` | Newer than the SDK clarity-pack historically built against. The whole reason for tonight's fix chain. |
| Runs as user | `beai-agent` (NOT root, NOT `eric`, NOT `paperclipuser`) | Every plugin command must be `sudo -u beai-agent`. |
| Process manager | pm2, service `pm2-beai-agent.service`, process name **`paperclip`** | Restart = `sudo -u beai-agent pm2 restart paperclip`. |
| Postgres | EMBEDDED, `127.0.0.1:54329` (NOT 5432), data at `/home/beai-agent/.paperclip/instances/default/db` | Requires a password we don't have; don't try to psql it. |
| Plugin id (host-assigned) | `a763176a-2f4d-4986-b190-b5151e42cc00` | Used in `/api/plugins/<id>/...` URLs. |
| Primary company id | `59f8876e-e729-4dda-98f9-1317c2b50492` (URL prefix `BEAAA`) | There's a second company `daaaf066-65ff-4d13-923e-de02a50939ac` too. |
| GitHub repo | `github.com/erezgewgl3/clarity-pack` (PRIVATE by default) | Path B clone needs it temporarily public. |
| OpenClaw | downstream agent runtime (Paperclip → OpenClaw via webhook) | clarity-pack does NOT touch it; ignore it. |
| Rollback bookend | DO automated daily backups + operator-taken DO snapshots | The safety-CLI snapshot tooling does NOT apply to this box. DO snapshots are the rollback path. |

---

## 1. Pre-flight — confirm the fix is committed and pushed

Before deploying anything, the fix MUST be on GitHub master (Path B clones from there; Path A scp's a locally-built tarball but you still want the source pushed for traceability).

```powershell
# From C:\Users\erezg\Documents\Claude\Projects\Clarity Pack
git status                      # working tree should be clean (everything committed)
git log --oneline -5            # confirm your fix commit is here
git log --oneline origin/master..HEAD   # should be EMPTY (everything pushed)
```

If `origin/master..HEAD` shows commits, push them: `git push origin master`.

Also confirm the build is sane locally:

```powershell
node scripts/build-worker.mjs
node scripts/build-ui.mjs
npx tsc --project tsconfig.manifest.json
npx tsc --noEmit
node scripts/check-css-scope.mjs
node scripts/check-ui-bundle-size.mjs
node --test "test/**/*.test.mjs"   # 1 pre-existing situation-artifacts fixture failure is OK; no OTHER failures
```

---

## 2. Choose a deploy path

- **Path A (preferred when SSH works):** scp the tarball + SSH-driven install. Faster, fewer moving parts.
- **Path B (fallback when SSH is fail2ban-blocked):** DO Web Console + GitHub clone + build-on-box. No tarball upload needed; survives SSH lockout.

**Test SSH first:**

```powershell
ssh ariclaw whoami
```

- Prints `root` → **use Path A**.
- Times out (`Connection timed out`) → SSH is fail2ban-blocked from too many connections. **Use Path B**, or wait 15-30 min for fail2ban to release and retry Path A.

---

## 3. PATH A — scp + SSH deploy (when `ssh ariclaw whoami` prints `root`)

### A1. Build + pack locally

```powershell
node scripts/build-worker.mjs ; node scripts/build-ui.mjs ; npx tsc --project tsconfig.manifest.json ; npm pack
Get-FileHash clarity-pack-1.0.0.tgz -Algorithm SHA256 | Select-Object -ExpandProperty Hash
```

Note that SHA — you'll confirm it landed intact on the box.

### A2. Upload (the remove-first dance is MANDATORY)

```powershell
ssh ariclaw 'rm -f /tmp/clarity-pack-1.0.0.tgz' ; scp -i "$HOME\.ssh\beaaa_ariclaw_ed25519" clarity-pack-1.0.0.tgz root@46.101.105.87:/tmp/clarity-pack-1.0.0.tgz ; ssh ariclaw 'sha256sum /tmp/clarity-pack-1.0.0.tgz'
```

**WHY the `rm -f` first:** the prior tarball on the box is owned by `beai-agent` (we chown it during install). On a sticky-bit `/tmp`, even root scp can't `open(O_TRUNC)` over a file it doesn't own — you get `dest open ... Permission denied`. Removing it first sidesteps that. Confirm the remote sha matches your local Get-FileHash output.

### A3. Install (single PowerShell here-string piped to `ssh ariclaw bash`)

PowerShell mangles inline quotes/parens/pipes when passed as an `ssh ariclaw '...'` arg. ALWAYS use the `@'...'@` here-string form, piped to `ssh ariclaw bash`, so bash on the box reads the script from stdin verbatim:

```powershell
@'
chown beai-agent:beai-agent /tmp/clarity-pack-1.0.0.tgz
echo "=== uninstall old ==="
sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin uninstall clarity-pack 2>&1'
echo "=== unpack + npm install + plugin install ==="
sudo -u beai-agent bash -lc '
  set -e
  rm -rf /tmp/clarity-pack-build && mkdir -p /tmp/clarity-pack-build
  tar -xzf /tmp/clarity-pack-1.0.0.tgz -C /tmp/clarity-pack-build
  cd /tmp/clarity-pack-build/package
  npm install --no-fund --no-audit --no-progress 2>&1 | tail -3
  touch dist/manifest.js
  npx paperclipai plugin install /tmp/clarity-pack-build/package 2>&1
'
echo "=== reload worker ==="
sudo -u beai-agent pm2 restart paperclip 2>&1 || echo "PM2_RESTART_FAILED — see section 5"
echo "=== confirm registered ==="
sleep 4
sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin list 2>&1 | grep clarity-pack'
'@ | ssh ariclaw bash
```

**Expected tail:** `key=clarity-pack  status=ready  version=1.0.0  id=a763176a-...`

Skip to **section 4 (verify)**.

---

## 4 (continued in PATH B section)... see below

---

## 3-bis. PATH B — DO Web Console + GitHub clone (when SSH is blocked)

### B1. Flip the repo PUBLIC temporarily

GitHub → repo Settings → "Change repository visibility" → Public → confirm by typing the repo name.

Verify in an **incognito browser window**: `https://github.com/erezgewgl3/clarity-pack` should load WITHOUT a sign-in prompt. If `git clone` later asks for a username, the repo is still private — the visibility change didn't take.

### B2. Open the DO Web Console

DO dashboard → Droplets → AriClaw → blue **"Web Console"** button (top-right). A browser tab opens with a root shell: `root@AriClaw:~#`. This is out-of-band — immune to fail2ban.

### B3. Paste the clone-build-install block (ONE paste, whole thing)

```bash
sudo -u beai-agent bash <<'BEAI_DEPLOY'
set -e
cd /tmp
rm -rf clarity-pack-src
echo "=== 1/5 Cloning master from GitHub ==="
git clone --depth 1 https://github.com/erezgewgl3/clarity-pack.git clarity-pack-src
cd clarity-pack-src
echo "=== 2/5 Installing build deps (~1-2 min) ==="
npm install --no-fund --no-audit --include=dev --no-progress 2>&1 | tail -5
echo "=== 3/5 Building worker + UI + manifest ==="
node scripts/build-worker.mjs 2>&1 | tail -3
node scripts/build-ui.mjs 2>&1 | tail -3
npx tsc --project tsconfig.manifest.json 2>&1 | tail -3
echo "=== 4/5 Packing + sanity-check bundle ==="
npm pack 2>&1 | tail -3
ls -la clarity-pack-1.0.0.tgz
grep -c paperclipInvocation dist/worker.js
echo "(^ paperclipInvocation count should be >=5: confirms the SDK is bundled into the worker, not externalized)"
echo "=== 5/5 Uninstall old + install new ==="
rm -rf /tmp/clarity-pack-build && mkdir -p /tmp/clarity-pack-build
tar -xzf clarity-pack-1.0.0.tgz -C /tmp/clarity-pack-build
cd /tmp/clarity-pack-build/package
npm install --no-fund --no-audit --no-progress 2>&1 | tail -3
touch dist/manifest.js
npx paperclipai plugin uninstall clarity-pack 2>&1 || echo "(uninstall failed; continuing)"
npx paperclipai plugin install /tmp/clarity-pack-build/package 2>&1
BEAI_DEPLOY
echo
echo "=== reload worker ==="
sudo -u beai-agent pm2 restart paperclip 2>&1 || echo "PM2_RESTART_FAILED — see section 5"
echo "=== confirm registered ==="
sleep 4
sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin list 2>&1 | grep clarity-pack'
```

**What to watch for:**
- Step 1: `Cloning into 'clarity-pack-src'...` — if it prompts for a **username**, the repo isn't public yet (go back to B1).
- Step 2: ~190 packages added in 30-60s. npm deprecation warnings are noise — ignore.
- Step 3: `dist\worker.js 2.4mb`, `dist\ui\index.js ~675kb`.
- Step 4: `paperclipInvocation` count prints `5` or higher. **If it prints `0`, the SDK got externalized — STOP, the worker will fail with invocation-scope errors. The build is wrong; check `scripts/build-worker.mjs` has `@paperclipai/plugin-sdk` REMOVED from the `external` array.**
- Step 5: ends with `✓ Installed clarity-pack v1.0.0 (ready)`.
- Final line: `key=clarity-pack  status=ready  version=1.0.0  id=a763176a-...`

### B4. Flip the repo back to PRIVATE

GitHub → Settings → Change visibility → Private. Do this immediately after the install succeeds. The cloned copy on the box (`/tmp/clarity-pack-src`) is local-only and wiped on reboot.

---

## 4. VERIFY (both paths)

The plugin UI is loaded into the host page; the browser caches the bundle by a `?v=<timestamp>` param that changes on each install, so a normal reload picks up the new code.

**If you have Playwright (MCP) and an SSH tunnel forwarding localhost:3100 → AriClaw:3100:**

```
browser_navigate http://localhost:3100/BEAAA/issues/BEAAA-828
# click the Reader tab, wait 4s, then check:
#  - NO element containing "Clarity Pack: failed to render"
#  - a [data-clarity-surface="reader"] element IS present
# Also sample 2-3 other issues to confirm the fix is general, not per-issue.
```

Quick programmatic check via browser_evaluate after clicking Reader:
```js
() => {
  const fail = [...document.querySelectorAll('*')].some(e =>
    e.children.length===0 && /failed to render/i.test(e.textContent||''));
  const surface = document.querySelector('[data-clarity-surface="reader"]');
  return { failBoundary: fail, surfacePresent: !!surface };
}
// WANT: { failBoundary: false, surfacePresent: true }
```

You can also hit the data handler directly to confirm 200 (not 502):
```js
async () => {
  const r = await fetch('/api/plugins/a763176a-2f4d-4986-b190-b5151e42cc00/data/issue.reader?_='+Date.now(),
    {method:'POST',headers:{'content-type':'application/json'},cache:'no-store',
     body:JSON.stringify({companyId:'59f8876e-e729-4dda-98f9-1317c2b50492',
       params:{issueId:'5cc1bc60-73ee-42af-8907-37131bdfeb4d',userId:'local-board'}})});
  return { status: r.status };   // WANT 200
}
```

**If you do NOT have a tunnel/Playwright:** ask the operator to open the BEAAA Paperclip UI in their browser, hard-refresh (Ctrl+Shift+R), open a couple of issues' Reader tabs, and confirm no "failed to render."

---

## 5. PM2 RECOVERY — if `pm2 restart paperclip` says "Process or Namespace paperclip not found"

This happened during the v1.0.0 session — pm2 lost the named-process binding while the daemon kept running (UI still served on :3100). Plugin install hot-reloads the worker on its own, so the plugin change still takes effect, BUT pm2 won't auto-restart paperclip on reboot until you repair the registration.

From a working shell (SSH or Web Console):

```bash
# 1. See current state
sudo -u beai-agent pm2 list

# 2a. If paperclip is MISSING but a dump exists, restore it:
sudo -u beai-agent pm2 resurrect
sudo -u beai-agent pm2 list   # confirm paperclip is back

# 2b. If resurrect doesn't bring it back, start fresh + save:
sudo -u beai-agent bash -lc 'cd ~ && pm2 start "npx paperclipai run" --name paperclip'
sudo -u beai-agent pm2 save    # persist so reboot auto-starts it
sudo -u beai-agent pm2 list
```

**Note:** the daemon being detached from pm2 does NOT block a plugin deploy — `paperclipai plugin install` triggers a worker hot-reload regardless. The pm2 repair is about reboot-survival, not about this deploy taking effect. If you're mid-deploy and hit PM2_RESTART_FAILED, the plugin is still installed; finish verifying (section 4), then repair pm2 (this section) when convenient.

---

## 6. ROLLBACK — if a deploy makes BEAAA worse

1. **Plugin-level:** `sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin uninstall clarity-pack'` — removes the plugin; Paperclip's native UI is untouched (coexistence guarantee). Plugin data in the `plugin_clarity_pack_*` Postgres schema is preserved.
2. **Reinstall the last-known-good** by checking out the prior good commit, building, and installing (Path A or B with that commit).
3. **Nuclear:** restore the DO snapshot the operator took before the session. DO dashboard → AriClaw → Backups & Snapshots → restore. This reverts the WHOLE box — only if the DB or filesystem is corrupted, which a plugin install should never cause (additive-only migrations).

---

## 7. GOTCHA INDEX (every one of these cost real time tonight — read before improvising)

1. **`paperclipai plugin install <file.tgz>` fails with "Missing package.json".** The CLI wants a DIRECTORY, not a tarball. Always `tar -xzf` into a build dir and install the `.../package` subdir. (The blocks above already do this.)
2. **scp "Permission denied" on `/tmp/...tgz`.** File owned by beai-agent on sticky `/tmp`; root can't truncate-overwrite. `ssh ariclaw 'rm -f /tmp/...tgz'` first.
3. **PowerShell + `ssh ariclaw '...'` mangles parens/quotes/pipes** → `bash: -c: line 1: syntax error near unexpected token '('`. Use `@'...'@ | ssh ariclaw bash`.
4. **`pnpm` is NOT installed on the box.** Build scripts call `node scripts/build-*.mjs` directly — that works. Don't `npm run build` (it shells out to pnpm). Run the three build steps individually.
5. **`npx paperclipai ...` as `sudo -u beai-agent` fails with EACCES spawn sh** if CWD is `/root` (mode 700, beai-agent can't read it). Always `cd ~ &&` first inside the `bash -lc`.
6. **`pm2 logs paperclip --lines N | tail -K` fails: "tail: option used in invalid context".** pm2 output contains a literal `--`. Read the file directly: `tail -N /home/beai-agent/.pm2/logs/paperclip-out.log`.
7. **DO Web Console truncates trailing output** when you copy-paste it elsewhere. Trust file-size (`ls -la`) + `grep -c` counts over full dumps.
8. **The worker bundle MUST inline `@paperclipai/plugin-sdk`** (not externalize it). If `grep -c paperclipInvocation dist/worker.js` is 0, the build externalized the SDK and the worker will fail every host call with "missing/expired/unknown invocation scope." Fix: `scripts/build-worker.mjs` `external` array must NOT contain `@paperclipai/plugin-sdk`.
9. **paperclipai@2026.525.0 blocks `ctx.http.fetch` to localhost/private IPs (SSRF mitigation)** and requires the `http.outbound` capability + absolute URLs. The codebase already handles this with defensive degradation in `resolve-refs.ts` + `issue-reader.ts` — do NOT remove it.
10. **fail2ban locks SSH after rapid repeated connections.** That's why Path B exists. If you've been deploying via SSH and it starts timing out, switch to Path B or wait 15-30 min.

---

## 8. ONE-LINE SUMMARY FOR THE IMPATIENT

> SSH works → Path A (scp + here-string install). SSH blocked → Path B (repo public → Web Console clone+build+install → repo private). Either way: confirm `status=ready version=1.0.0`, verify Reader renders on a few issues with Playwright, repair pm2 if it lost the `paperclip` process.
