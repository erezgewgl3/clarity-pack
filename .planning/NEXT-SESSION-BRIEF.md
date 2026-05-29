# NEXT-SESSION BRIEF — 3 tasks: Pin UI hardening + de-block requestWakeup + Launchers

**Written:** 2026-05-29, end of a long diagnostic session on clarity-pack **v1.0.0** / BEAAA.
**Purpose:** a fresh, autonomous window finishes THREE shippable tasks **today**, end-to-end (code → tests → build → deploy to BEAAA → live-verify). This brief is self-contained — read it top-to-bottom; do not re-litigate anything below.

**Operator intent (verbatim):** "shipping the Pin UI hardening, de-blocking the requestWakeup calls, and the launchers. Super important. Get that done today." Eric runs fully autonomous — deploy to BEAAA + live-drill WITHOUT pausing (daily backup + rehearsed Phase-1 restore satisfy the bookended-by-snapshots rule).

**Start the work via GSD** (CLAUDE.md enforces it): run `/gsd:quick` and point it at this brief, OR if you prefer to execute directly, this brief IS the plan — just keep atomic commits per task.

---

## 0. WHAT THIS SESSION LEARNED (load it before you touch code)

These findings are the WHY behind the three tasks. They are verified true as of 2026-05-29.

1. **The box-load scare was UI polling, NOT clarity-pack.** BEAAA hit load avg ~7. Root cause: open browser tabs (the Paperclip **Dashboard** auto-polling `/dashboard`,`/agents`,`/activity`,`/issues?limit=500`,`/live-runs` + an open agent page **tailing a live run log** via `/heartbeat-runs/<id>/log?offset=…`). Closing the tabs dropped load **6.8 → ~1.0 in ~2 min**; in a clean 60s window the clarity-pack worker made **0** `/plugins/` calls. **Do NOT chase clarity-pack as a CPU hog — it is idle at steady state.** Operator guidance: don't leave Dashboards / live-run pages open in multiple tabs. **During your own live verification, CLOSE every Paperclip tab when done** (and minimize tabs while testing) — your tabs ARE load.

2. **The Pin "round X" bug — fully root-caused.** The Pin button is `disabled={busy}`; `cursor:not-allowed` (= the operator's "round X") is the ONLY `.pa:disabled` style (chat.css:913-916). `onPin` sets `busy=true`, `await pin()`, resets in `finally`. Under the load-~7 conditions, the `chat.pin` action HTTP response took **>45s** (measured: a direct POST timed out at 45,021ms with no body). So `busy` stayed true → button bricked. **The pin DID persist** (DB write commits fast; `chat.messages` re-fetch showed `pinned:true`). So the action WORKS; only the *response ACK* was pathologically slow. At healthy load it should ACK fast — but the UI must never brick on a slow ACK. → **Task 1.**

3. **`requestWakeup` is BROKEN on this host (paperclipai@2026.525.0).** Worker log proved it: `Worker→host call "issues.requestWakeup" timed out after 30000ms` (19× in one burst) and `not allowed to perform "issues.requestWakeup": missing/expired/unknown invocation scope`. **Native wake (creating a comment / the agent's next heartbeat) already delivers** — that's what actually woke the agent for chat replies (Phase 4.1 deliberately dropped requestWakeup for exactly this reason). The two **awaited** `requestWakeup` calls block their handlers up to 30s each and congest the worker→host channel during compile bursts. → **Task 2** de-blocks them (fire-and-forget; keep the call, stop awaiting it).

4. **Paperclip was restarted this session** (`pm2 restart paperclip`, now restart #31, health 200, load ~1). It is healthy now.

---

## 0.5 THE BOX (BEAAA / AriClaw) — facts you need

| Fact | Value |
|------|-------|
| SSH | alias `ariclaw` (= `root@46.101.105.87`, key `beaaa_ariclaw_ed25519`, `IdentitiesOnly yes`). `ssh ariclaw whoami` → `root`. |
| Runs as | user `beai-agent`; pm2 process `paperclip`; `sudo -u beai-agent pm2 ...` |
| Plugin install path | **STABLE** `/home/beai-agent/clarity-pack-live/package` (NOT /tmp — local-path installs make the host watch the dir, so /tmp cleanup crash-loops the worker). |
| Plugin id | `a763176a-2f4d-4986-b190-b5151e42cc00` |
| Companies (two!) | BEAAA `59f8876e-e729-4dda-98f9-1317c2b50492` + `daaaf066-65ff-4d13-923e-de02a50939ac` |
| Worker log | `/home/beai-agent/.pm2/logs/paperclip-out.log` (host does NOT propagate Postgres error detail — only "Failed query: <sql>"). |
| Browser/app | reachable at `http://localhost:3100` (SSH tunnel). Chat lives at `/BEAAA/chat`, Situation Room `/BEAAA/situation-room`, Bulletin `/BEAAA/bulletin`. After a full reload the host SPA can sit on "Loading…" 15-30s before the plugin mounts — wait, don't conclude it's broken. |
| Throwaway credential | `ericg@gl3group.com` authorized for Playwright drills on BEAAA until v1.0.0 ships. |

---

## 1. TASK 1 — Pin UI hardening (optimistic + safety timeout)

**File:** `src/ui/surfaces/chat/message-thread.tsx`, the `PromoteActions` component (`onPin` ~L880-929, `onPromote` ~L821-878, the two `<button … disabled={busy}>` at ~L933-938).

**Goal:** the Pin button must NEVER brick waiting on a slow action ACK, and must give immediate feedback. The pin persists server-side, so an optimistic update + a safety timeout is correct and safe.

**Change `onPin` to:** flip the optimistic marker + toast IMMEDIATELY (don't wait), fire `pin(...)` without blocking `busy` for its full duration, and guarantee `busy` resets via BOTH a `.finally()` and an 8s safety `setTimeout`. On a CONFIRMED `{error}` result, revert the optimistic marker + show the inline error. A timeout/hang is NOT a confirmed failure (the write usually lands) — leave the optimistic marker; the next `onRefresh`/poll reconciles. Reference implementation:

```ts
const onPin = React.useCallback(async () => {
  if (busy) return;                       // double-click guard
  setBusy(true);
  setFeedback(null);
  const nextPinned = !(pinned || optimisticPinned);
  setOptimisticPinned(nextPinned);        // optimistic — reflect intent now
  showToast({ message: nextPinned ? 'Message pinned' : 'Message unpinned' });
  // 2026-05-29: under box load, chat.pin ACK can take 45s+. NEVER brick the
  // button on a slow ACK — the write persists server-side regardless.
  const safety = setTimeout(() => setBusy(false), 8000);
  pin({ commentId, topicIssueId, companyId, userId, pinned: nextPinned })
    .then((result) => {
      const err = resultError(result);
      if (err) {
        setOptimisticPinned(!nextPinned);                 // revert
        setFeedback({ kind: 'error', text: `Could not pin (${err})` });
      } else {
        onRefresh?.();
      }
    })
    .catch(() => { /* timeout/hang ≠ confirmed failure; poll reconciles */ })
    .finally(() => { clearTimeout(safety); setBusy(false); });
}, [busy, pin, commentId, topicIssueId, companyId, userId, pinned, optimisticPinned, onRefresh, showToast]);
```

**Also apply the same 8s safety-timeout pattern to `onPromote`** (legacy inline path still `await`s `chat.promote`; the dialog path via `onPromoteMessage` returns early and is fine — but the safety timeout must protect the inline path so Promote can't brick either).

**Tests (repo idiom: UI = source-grep only; Node strip-types loads `.ts` but not `.tsx`).** Add a source-grep test (e.g. extend an existing `test/ui/*pin*` or create `test/ui/chat-pin-no-brick.test.mjs`) asserting that `message-thread.tsx`'s `onPin`: (a) contains a `setTimeout(` busy-reset safety, (b) calls `setOptimisticPinned` BEFORE awaiting `pin(`, and (c) has a `.finally(` that clears the timeout + resets busy. Keep any existing locked literals intact.

---

## 2. TASK 2 — De-block the two awaited `requestWakeup` calls

`requestWakeup` is broken on this host (times out 30s / scope-errors). Keep the call (it's harmless when it works, and native wake is the real mechanism) but **stop awaiting it** so it can't block the handler or congest the channel. There are EXACTLY TWO awaited sites (grep-verified — topic-watchdog.ts only mentions it in comments, no call):

**(a) `src/worker/handlers/chat-send.ts` L121-131.** Replace the `await ctx.issues.requestWakeup(...)` block with fire-and-forget, then return immediately:
```ts
// Fire-and-forget: requestWakeup is unreliable on this host (30s timeout /
// scope errors, 2026-05-29). Native wake (the comment above) already delivers;
// do NOT block the send ACK on it.
void Promise.resolve()
  .then(() => ctx.issues.requestWakeup(topicIssueId, companyId, {
    reason: 'clarity-pack chat: operator message',
    idempotencyKey: messageUuid,
  }))
  .catch((e) => ctx.logger?.info?.('chat.send: requestWakeup non-fatal (native wake applies)', {
    topicIssueId, reason: (e as Error).message,
  }));
return { ok: true, commentId: comment.id };
```

**(b) `src/worker/agents/agent-task-delivery.ts` L406-416 (`startAgentTask` step 3).** Same transform — change `await ctx.issues.requestWakeup(issue.id, …)` to the `void Promise.resolve().then(…).catch(…)` fire-and-forget form, then fall through to `return { operationIssueId: issue.id, reused }`. This is the bigger win — it's the storm source (every TL;DR/bulletin compile delivery fired this).

**Tests (worker = behavioral `.ts` with stubbed ctx via `test/helpers/host-faithful-ctx.mjs`).**
- `test/worker/chat/chat-send.test.mjs` already has assertions I added this session that `requestWakeup` IS called with `idempotencyKey === messageUuid`. Keep "is called", but **add/adjust the decisive test:** stub `requestWakeup` to return a promise that NEVER resolves, and assert `chat.send` STILL resolves promptly to `{ ok:true, commentId }` (proves de-blocking). Remove any assertion that requires requestWakeup to settle before the handler returns.
- Add an analogous test for `startAgentTask` in the agent-task-delivery suite: a never-resolving `requestWakeup` stub must not prevent `startAgentTask` from resolving `{ operationIssueId }`.

---

## 3. TASK 3 — Launchers (nav entry points for Situation Room / Bulletin / Chat)

clarity-pack declares its pages as `ui.slots` (manifest.ts: `situation-room` L474, `bulletin` L481, `chat` L488, `archive` L500) but ships **no launchers**, so the only way to reach them is a direct URL. Add launcher nav entries.

**The API is confirmed (from the host repo `packages/shared/src/types/plugin.ts` + `constants.ts`):**
- `PaperclipPluginManifestV1.launchers?: PluginLauncherDeclaration[]` is a **top-level manifest field** (sibling to `ui`).
- `PluginLauncherDeclaration = { id: string; displayName: string; description?: string; placementZone: PluginLauncherPlacementZone; exportName?: string; entityTypes?: PluginUiSlotEntityType[]; order?: number; action: PluginLauncherActionDeclaration; render?: PluginLauncherRenderDeclaration }`
- `PluginLauncherActionDeclaration = { type: PluginLauncherAction; target: string; params?: Record<string,unknown> }`
- `PluginLauncherPlacementZone` ∈ `"page" | "detailTab" | "taskDetailView" | "dashboardWidget" | "sidebar" | "sidebarPanel" | "projectSidebarItem" | "globalToolbarButton" | "toolbarButton" | "contextMenuItem" | "commentAnnotation" | "commentContextMenuItem"`
- `PluginLauncherAction` ∈ `"navigate" | "openModal" | "openDrawer" | "openPopover" | "performAction" | "deepLink"`
- Runtime alternative exists: `ctx.launchers.register(decl)` (PluginLaunchersClient) — prefer the **static manifest** declaration; fall back to runtime only if manifest launchers don't render.

**⚠️ VERIFY FIRST (3 unknowns — resolve before coding, via `gh` against the host repo):**
1. **`action.target` semantics for `navigate`** — is it the bare `routePath` (`"situation-room"`), a full `/<companyPrefix>/situation-room` path, or the slot `id`? Pages mount at `/<companyPrefix>/<routePath>` (memory `clarity-pack-plugin-page-routes`). Check how the host resolves it:
   `gh api repos/paperclipai/paperclip/contents/ui/src/plugins/launchers.tsx --jq '.content' | base64 -d` and `…/ui/src/plugins/slots.tsx`.
2. **Which `placementZone` actually renders a left-nav/sidebar entry** in this host version (start with `"sidebar"`; `"globalToolbarButton"` is the fallback). The same files above show which zones the host UI renders and where.
3. **Capability** — does declaring launchers need a manifest capability (current caps include `ui.page.register`)? Check `doc/plugins/PLUGIN_SPEC.md` launcher section + the manifest validator in `server/src/services/plugin-loader.ts`. Add the cap if required.

**Then add to `src/manifest.ts`** (top-level, after the `ui:` block) three entries — adjust `placementZone`/`target` per the verification:
```ts
launchers: [
  { id: 'clarity-launch-situation-room', displayName: 'Situation Room',
    description: 'Clarity Pack — live cockpit of every agent',
    placementZone: 'sidebar', order: 1,
    action: { type: 'navigate', target: 'situation-room' } },   // ← confirm target form
  { id: 'clarity-launch-bulletin', displayName: 'Daily Bulletin',
    description: 'Clarity Pack — morning editorial digest',
    placementZone: 'sidebar', order: 2,
    action: { type: 'navigate', target: 'bulletin' } },
  { id: 'clarity-launch-chat', displayName: 'Employee Chat',
    description: 'Clarity Pack — chat with any employee',
    placementZone: 'sidebar', order: 3,
    action: { type: 'navigate', target: 'chat' } },
],
```

**Tests (manifest = source-grep / structural).** Add `test/manifest/launchers.test.mjs` (or extend an existing manifest test) asserting the manifest exposes a `launchers` array with the three ids, each `action.type === 'navigate'` and `target` matching the page `routePath`s (`situation-room`/`bulletin`/`chat`). No UI-bundle growth (navigate launchers have no custom UI / `exportName`), so the bundle-size gate is unaffected.

---

## 4. VERSION BUMP — 1.0.0 → 1.1.0

Launchers add a feature → minor bump. **Bump BOTH** (the host reads `dist/manifest.js` built from `src/manifest.ts`, NOT package.json — memory `plugin-version-bump-two-sources`):
- `package.json` `"version"`: `1.0.0` → `1.1.0`
- `src/manifest.ts` L337 `version: '1.0.0'` → `version: '1.1.0'`
- Tarball becomes `clarity-pack-1.1.0.tgz` (update the deploy commands in §5 accordingly).
- Add a short release-history comment atop manifest.ts summarizing 1.1.0 (pin-no-brick UI + requestWakeup de-block + launchers).

---

## 5. BUILD → GATES → DEPLOY (proven flow; version = 1.1.0)

1. `git push origin master` (commit each task atomically first).
2. Build: `node scripts/build-worker.mjs ; node scripts/build-ui.mjs ; npx tsc --project tsconfig.manifest.json`
   (pnpm isn't on PATH on this Windows box — run the scripts directly with `node`, and `tsc` via `node_modules/.bin/tsc` or `npx tsc`.)
3. Gates (all must pass):
   - `npx tsc --noEmit`
   - `node scripts/check-css-scope.mjs`
   - `node scripts/check-ui-bundle-size.mjs`  (ceiling 716 KB; Task 1 adds trivial JS, launchers add none)
   - `node --test "test/**/*.test.mjs"`  (one pre-existing `situation-artifacts` fixture failure is OK; no OTHER failures. The U7 watchdog test is timing-flaky under load — re-run in isolation if it fails.)
   - **`grep -c paperclipInvocation dist/worker.js` MUST be ≥ 5** (SDK bundled). If 0, `scripts/build-worker.mjs` externalized the SDK — remove it from `external[]` and rebuild.
4. `npm pack` ; `certutil -hashfile clarity-pack-1.1.0.tgz SHA256` (note the sha).
5. Upload: `ssh ariclaw 'rm -f /tmp/clarity-pack-1.1.0.tgz' ; scp clarity-pack-1.1.0.tgz ariclaw:/tmp/clarity-pack-1.1.0.tgz ; ssh ariclaw 'sha256sum /tmp/clarity-pack-1.1.0.tgz'` (confirm match).
6. Install from the STABLE path:
```
ssh ariclaw bash <<'REMOTE'
chown beai-agent:beai-agent /tmp/clarity-pack-1.1.0.tgz
sudo -u beai-agent bash -lc '
  set -e
  STABLE=$HOME/clarity-pack-live
  rm -rf "$STABLE" && mkdir -p "$STABLE"
  tar -xzf /tmp/clarity-pack-1.1.0.tgz -C "$STABLE"
  cd "$STABLE/package"
  npm install --no-fund --no-audit --no-progress 2>&1 | tail -2
  touch dist/manifest.js
  cd ~ && npx paperclipai plugin uninstall clarity-pack 2>&1 || echo "(uninstall skipped)"
  npx paperclipai plugin install "$STABLE/package" 2>&1
'
sudo -u beai-agent pm2 restart paperclip 2>&1 | tail -1
sleep 6
sudo -u beai-agent bash -lc "cd ~ && npx paperclipai plugin list 2>&1 | grep clarity-pack"
REMOTE
```
Expect `key=clarity-pack status=ready version=1.1.0 id=a763176a-...`.
**Gotcha:** if install errors `Worker already registered … (status: crashed)`, do uninstall → `pm2 restart paperclip` → wait for `curl http://localhost:3100/health` = 200 → reinstall.

**Migration validator note:** none of these tasks need a migration. (If you ever add one: only `create`/`alter`/`comment` statements, fully-qualified `plugin_clarity_pack_cdd6bda4bd.<table>`, no `DO $$`, no standalone `CREATE INDEX` — use `ALTER TABLE … ADD CONSTRAINT`. Enforced by `test/migrations/ddl-prefix-validator.test.mjs`.)

---

## 6. LIVE VERIFICATION (you MUST see it; never claim it works unprove n)

Use Playwright at `http://localhost:3100`. **Keep tabs to a minimum and CLOSE them all when done** — open tabs are the load source (§0.1).

- **Task 1 (pin):** open `/BEAAA/chat` → Scanner Engineer → the BEAAA-808 topic. Hover an AGENT bubble, click ⚑ Pin. Expect: a toast immediately, the button re-enables within ≤8s (never stuck `cursor:not-allowed`), and after a refresh the message shows in the right-rail Pinned context AND the `⚑ Pinned` marker. Confirm via a direct `chat.messages` fetch that `pinned:true` persisted for that comment.
- **Task 2 (de-block):** in the worker log, confirm `chat.send` returns promptly and you no longer see send/compile handlers stalling on requestWakeup; the `requestWakeup … timed out after 30000ms` lines may still appear (host is still broken) but they're now fire-and-forget and must NOT block. Send a chat message and confirm the agent still replies (native wake intact).
- **Task 3 (launchers):** hard-refresh the Paperclip UI; confirm Situation Room / Daily Bulletin / Employee Chat now appear as nav entries in the chosen placement zone, and clicking each navigates to the right `/BEAAA/<routePath>` page. If they don't render, re-check the placementZone + target against `launchers.tsx`/`slots.tsx` (the most likely miss).

After verifying: **close all Playwright/Paperclip tabs** so you don't leave the box polling.

---

## 7. WRAP-UP
- Atomic commits (one per task) on `origin/master`; `Co-Authored-By` trailer as usual.
- Update MemPalace `clarity_pack` (`runbook` + `decisions`): the load root-cause (UI polling, not the worker), the requestWakeup-is-broken confirmation, the pin-no-brick fix, and launchers shipped at v1.1.0.
- Update STATE.md / this brief's status line.
- The DEBUG test artifacts in Scanner Engineer's chat (an archived "DEBUG seed-dialog test" topic + "debug probe 1247" / "Wake test 1407" comments) are still pending cleanup — low priority; offer the operator a hard-delete.

## One-line status
✅ DONE 2026-05-29 — all three tasks shipped as **v1.1.0** and LIVE-VERIFIED on BEAAA (pin-no-brick UI, requestWakeup de-block, sidebar launchers). Commits bf08f90 / 9c4370c / 1f112d8 / 3b6ca57; tarball 958edbc3… / 718,224 bytes; `status=ready version=1.1.0 id=a763176a`; box load ~0.08. Gates all green except the 1 known pre-existing `situation.artifacts` failure. Playwright drill: launchers render + navigate; pin returns 200, never bricks, persists across hard reload (right-rail + inline marker); worker log proves `chat.send 200` is not blocked by the 30s requestWakeup. Tabs closed after. **ONE OPEN ITEM:** `git push origin master` was blocked by the auto-mode guardrail — commits are on LOCAL master only (BEAAA is current via the local tarball; the remote is behind until Eric pushes or grants permission).

### (prior, pre-execution) One-line status
clarity-pack v1.0.0 live + healthy on BEAAA (load ~1 after restart). Three tasks queued for v1.1.0: pin-no-brick UI, requestWakeup de-block, and launcher nav entries. Box-load mystery solved (it was open UI tabs, not us).
