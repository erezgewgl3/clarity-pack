---
status: resolved
trigger: "BEAAA CPU load since plugin install — operator suspects clarity-pack is recursive / hitting the DB too much. Confirmed: Editor-Agent heartbeat causes self-amplifying DB churn + unbounded operation-issue growth."
created: 2026-06-03
updated: 2026-06-03
target_version: 1.4.4
deploy: BEAAA (live) — bookended-by-snapshots (automated DO backup); version bump BOTH package.json AND src/manifest.ts
---

# Debug: editor-heartbeat-db-churn

## Symptoms

- **Expected:** clarity-pack adds negligible steady-state DB/CPU load to the Paperclip host.
- **Actual:** plugin makes ~6.25 host calls/sec and ~3.8/sec self-triggered heartbeats (each a reconcile + issues.get DB round-trip), and has accumulated ~1,275 `tldr-compile` operation issues in `public.issues` that are never cleaned up.
- **Timeline:** present since install, across all versions (the event-subscription architecture dates to Phase 2/3).
- **Reproduction:** any issue/comment activity in the instance; the plugin's own operation issues self-trigger the heartbeat.
- **Live evidence (BEAAA, 2026-06-03):** 33-min worker-log capture — 921 "skipped own operation issue" recursion-guard hits in ~4 min (~3.8/sec); ~1,275 accumulated tldr-compile op issues (counted via localhost Paperclip API, offset binary-search). Worker process idle 0.1% CPU (the churn is DB-side, not worker-CPU-side — why earlier "idle" reads missed it). NOTE: the DOMINANT machine load is host-side (`/heartbeat-runs/<id>/log` polling firehose ~92/sec from open Dashboard tabs) and is OUT OF SCOPE for this plugin hotfix.

## Current Focus

hypothesis: CONFIRMED — three independent code defects compound into steady self-amplifying DB churn + unbounded op-issue accumulation.
next_action: Fixes 1, 2, 4 applied + locally verified (build + tests + tsc). Fix 3 (op-issue GC) SPLIT to a follow-up (no safe host API + dead job scope — see Fix-3 verification below). STOP at operator checkpoint — operator runs the bookended (DO-backup) local-tarball v1.4.4 deploy + the BEAAA worker-log re-capture separately.
test: per-fix unit tests landed (test/worker/op-issue-set.test.mjs + test/worker/heartbeat-dispatcher.test.mjs, 17 tests); full worker suite 1176/1176 pass; tsc clean; worker+manifest build clean (dist/manifest.js = 1.4.4). Live verification (the ~3.8/sec self-triggered heartbeat rate dropping to near-zero) deferred to the operator's BEAAA deploy.
reasoning_checkpoint: diagnosis is operator-validated; this session was FIX-and-verify, not re-investigation.

## Evidence (confirmed root causes)

- timestamp: 2026-06-03 — **RC1 (per-event amplification, no debounce).** `src/worker.ts:472-504` subscribes to issue.created/issue.updated/issue.comment.created and fires `reconcileEditorAgent()` (`src/worker/agents/editor.ts:100` — host round-trip, no cache) + `handleEditorHeartbeat()` SYNCHRONOUSLY, one event at a time, for every issue/comment event in the whole instance. The plugin's own operation issues generate events that re-enter the heartbeat (caught by `isOwnOperationIssue` AFTER a reconcile + issues.get). The original code comments state the design INTENT was to "bundle events per heartbeat-window" — never implemented.
- timestamp: 2026-06-03 — **RC2 (unbounded operation-issue growth).** `src/worker/agents/agent-task-delivery.ts` `startAgentTask` creates operation issues (`ctx.issues.create`, surfaceVisibility:'plugin_operation', originKind `plugin:clarity-pack:operation:tldr-compile`, status 'todo'); idempotency reuses only NON-terminal ones, so each scope re-compiled after its prior op went `done` spawns a NEW row. Nothing ever deletes/GCs them (grep-confirmed: no DELETE/hide). ~1,275 accumulated on BEAAA, growing. Every `startAgentTask` idempotency `ctx.issues.list` and every situation-snapshot `EXCLUDE_OPERATION_ISSUES_SQL` filter scans across them.
- timestamp: 2026-06-03 — **RC3 (dead tag-based self-loop guard).** `src/worker.ts:489` builds the heartbeat event with `tags: []` (always empty), so the tag-based half of `filterSelfLoopEvents` (`src/worker/agents/self-loop-filter.ts` — EDITOR_WRITE_TAG / BULLETIN_TAG_PREFIX) can never fire. Only the `author_id` check protects against the v0.6.5-class recursion — fragile.

## Eliminated

- hypothesis: "clarity-pack is idle / not the load source" (prior 2026-05-29 + v1.4.3 conclusions) — PARTIALLY WRONG. Those measured the WORKER PROCESS CPU (idle 0.1%) and HTTP `/plugins/` volume, not the plugin's Postgres-side work. The DB churn is real (~3.8/sec self-triggered heartbeats + ~1,275-row accumulation).
- hypothesis: "infinite recursion (v0.6.5 redux)" — NO. The `isOwnOperationIssue` originKind guard holds; recursion is BOUNDED. The problem is per-event amplification + accumulation, not an unbounded loop.
- hypothesis: "MemPalace-on-VPS is the load" — NO. mempalace-mcp idle at ~0.9% CPU.

## Planned Fix (4 parts — priority order)

- **Fix 1 (biggest, structural):** batch + debounce the heartbeat dispatcher in `src/worker.ts`. Accumulate events into a per-company buffer; flush on a ~10–15s debounce (or size cap). Per flush: reconcile ONCE (cache agentId per company), dedupe issueIds, run ONE batched `handleEditorHeartbeat`. Restores the documented design intent.
- **Fix 2:** in-memory bounded (LRU/TTL) Set of operation-issue IDs the plugin creates (populate in `startAgentTask`); in the worker.ts event handler, drop events whose `entityId` is in the set BEFORE any reconcile/DB call. Zero-DB recursion guard. Keep the `isOwnOperationIssue` originKind guard as the durable restart backstop (in-memory set is empty after restart).
- **Fix 3 (capability verification FIRST):** GC terminal (done/cancelled) operation issues older than the recency window, run from the every-minute compile-bulletin job (already runs `drainTldrOperations` per company). VERIFY first: can `ctx.issues.update` set `hidden_at`, or is there an `issues.delete`? Delivery ctx has only list/create/requestWakeup; the job ctx has the fuller client and `issues.update` IS a declared capability. `standing-numbers.ts` already filters `hidden_at IS NULL`, so hiding shrinks scans. Clears the existing ~1,275 and bounds future growth. If no safe host API exists, fall back to documenting + an index, and split to a follow-up.
- **Fix 4:** repair the dead `tags:[]` self-loop guard — pass real tags through if the host event carries them; otherwise rely on Fix 2's ID set. Restores defense-in-depth.

## Constraints
- Live BEAAA deploy → bookended-by-snapshots (automated DO backup). Version bump BOTH `package.json` AND `src/manifest.ts` → v1.4.4 (host reads dist/manifest.js).
- Additive-only plugin-namespace schema; degrade-safe; NO AI in determinism paths; instance-agnostic (no company-prefix literals); Editor-Agent governance parity preserved.
- Deploy mechanics: SSH `ariclaw` (root@46.101.105.87), runs as beai-agent, pm2 `paperclip`, namespace `plugin_clarity_pack_cdd6bda4bd`. Embedded PG localhost:54329 (password not retrievable). Localhost Paperclip API works without auth for read-only counts. Local-tarball deploy (npm pack → scp → uninstall+install).
- Phase 16 Waves 1-2 are committed (16-01, 16-02 on master); Waves 3-4 paused, resume AFTER this hotfix.

## Fix-3 capability verification (2026-06-03 — BLOCKING FINDING)

Verified against `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` (@paperclipai/plugin-sdk@2026.512.0):

- **No `issues.delete`.** `PluginIssuesClient` (types.d.ts:1057-1151) exposes list/get/create/update/assertCheckoutOwner/getSubtree/requestWakeup(s)/listComments/createComment/createInteraction/suggestTasks/askUserQuestions/requestConfirmation/documents/relations/summaries — there is NO delete method.
- **`issues.update` CANNOT set `hidden_at`.** The patch type (types.d.ts:1097) is `Partial<Pick<Issue, "title"|"description"|"status"|"priority"|"assigneeAgentId"|"assigneeUserId"|"billingCode"|"originKind"|"originId"|"originRunId"|"requestDepth"|"executionWorkspaceId"|"executionWorkspacePreference">> & { blockedByIssueIds?; labelIds?; executionWorkspaceSettings? }`. `hidden_at` is NOT in the picklist — the host rejects it.
- **The host for the GC is also dead-scope.** The debug plan proposed running the GC "from the every-minute compile-bulletin job". On BEAAA that job's invocation scope is dead (PR #6547): `ctx.companies.list()` throws every tick and the v1.4.3 adaptive backoff (`SCOPE_FAILURE_THRESHOLD=2`, `SCOPE_BACKOFF_MS=15min`) means the job effectively never runs the per-company body. So even a valid GC API would not fire there.

**Decision (per the debug plan's own contingency):** Fix 3 is SPLIT to a follow-up. No safe host API exists to hide/delete the accumulated ~1,275 op issues from the plugin, and the host that would run the GC is dead-scope. Future-proofing options for the follow-up: (a) a host-side one-time SQL bleed (operator, like the Plan 04.1-11 bulletin bleed-stop) to clear the backlog; (b) request an `issues.delete` / `hidden_at`-capable update in the SDK; (c) move GC to a host invocation scope that is actually live. Fixes 1+2 already STOP the growth driver (the self-triggered heartbeat that spawns the ops), so the accumulation rate drops sharply even without GC.

## Resolution
root_cause: The Editor-Agent heartbeat dispatcher ran a per-event `reconcileEditorAgent` + single-event `handleEditorHeartbeat` for EVERY issue/comment event instance-wide, and the plugin's own operation issues re-entered that path (dropped only AFTER a reconcile + `issues.get`) — ~3.8 self-triggered heartbeats/sec of DB churn on BEAAA, plus unbounded `tldr-compile` op-issue accumulation (~1,275) with no GC.
fix: |
  v1.4.4 (applied + locally verified; NOT yet deployed):
  - Fix 1 (RC1) — new `src/worker/agents/heartbeat-dispatcher.ts` `HeartbeatDispatcher`: per-company event buffer, ~12s debounce (DEFAULT_HEARTBEAT_DEBOUNCE_MS) with a 50-issue burst cap, reconcile ONCE per flush (agentId cached per company), dedupe issueIds, ONE batched `handleEditorHeartbeat`. `src/worker.ts` now feeds host events into the dispatcher instead of the per-event reconcile+heartbeat loop. Restores the long-documented "bundle events per heartbeat-window" intent.
  - Fix 2 (recursion guard) — new `src/worker/agents/op-issue-set.ts` `OwnOperationIssueSet` (bounded TTL/LRU: OP_ISSUE_TTL_MS=20min, OP_ISSUE_SET_MAX=2000). `startAgentTask` (`agent-task-delivery.ts`) remembers each op-issue id it creates/reuses; the dispatcher drops events whose entityId is remembered (and any actorType==='plugin' event) BEFORE any reconcile/DB call — a zero-DB recursion short-circuit. The durable `isOwnOperationIssue` originKind guard is retained as the worker-restart backstop (set is empty after boot).
  - Fix 4 (RC3) — verified the host `PluginEvent` carries NO top-level `tags` field, so the dead `tags:[]` had nothing to pass through; documented honestly. Defense-in-depth is now the author_id check (filterSelfLoopEvents, unchanged) PLUS Fix-2's remembered-op-issue id short-circuit PLUS the actorType==='plugin' drop. The tag clause remains for any future tag-carrying event source.
  - Fix 3 (op-issue GC) — SPLIT to a follow-up (see Fix-3 verification above): SDK exposes no `issues.delete`, `issues.update` cannot set `hidden_at`, and the compile-bulletin job that would host the GC is dead-scope (PR #6547). Fixes 1+2 stop the growth driver regardless.
  - Version bumped to 1.4.4 in BOTH package.json AND src/manifest.ts (dist/manifest.js verified = 1.4.4). No schema change; additive, degrade-safe, instance-agnostic, governance parity preserved (nothing resumes/invokes an agent).
verification: |
  - New unit tests: test/worker/op-issue-set.test.mjs (8) + test/worker/heartbeat-dispatcher.test.mjs (9) — 17 pass. Cover: batch-collapse (5 events → 1 reconcile + 1 heartbeat), issueId dedupe, Fix-2 remembered-op + actorType-plugin drop-before-reconcile, burst-cap early flush, agentId cache across flushes, unresolvable-agent skip, TTL expiry, LRU eviction.
  - Full worker suite: 1176/1176 pass. Full repo suite: 2633 pass / 7 fail — the 7 failures are pre-existing REQUIREMENTS.md traceability-doc tests (test/phases/04-traceability.test.mjs + 04.1-traceability.test.mjs, CHAT-*/CTT-* rows); they read a planning doc, touch NONE of the changed code, and are unrelated to this hotfix.
  - tsc --noEmit clean. node scripts/build-worker.mjs clean (dist/worker.js 2.5mb, contains HeartbeatDispatcher + rememberOwnOperationIssue + isRememberedOwnOperationIssue). Manifest build clean (dist/manifest.js version = 1.4.4).
  - LIVE verification DONE (2026-06-03, commit b376725): deployed v1.4.4 to BEAAA via bookended local-tarball flow — pre-deploy app DB backup `paperclip-20260603-164528.sql.gz` (128.1M) + automated DO filesystem backup as the bookend; tarball sha256 69607fdc… verified on box; uninstall-then-install → `clarity-pack v1.4.4 (ready)` id=a763176a-2f4d-4986-b190-b5151e42cc00; pm2 restart; worker boot line at 16:48:55. A 150s post-deploy worker-log window showed "skipped own operation issue" = **0** (v1.4.3 baseline ~3.8/sec / ~570 per 150s), Editor-Agent heartbeat thrash = 0, only 2 legit new op-issues created, total worker-log volume ~2 lines/sec (was ~330/sec). The self-amplifying heartbeat DB churn is eliminated in production. (Caveat: ambient UI traffic was lighter at capture time — 0 POST /plugins — but "skipped own operation issue" is the fix-specific, UI-independent signal.) The op-issue ACCUMULATION (~1,275) is unchanged — that is the Fix-3 follow-up; Fixes 1+2 stop the growth DRIVER so it no longer climbs.
files_changed:
  - src/worker.ts (replaced per-event heartbeat loop with HeartbeatDispatcher wiring; async event handler)
  - src/worker/agents/heartbeat-dispatcher.ts (NEW — Fix 1 batch+debounce + Fix 2 read short-circuit)
  - src/worker/agents/op-issue-set.ts (NEW — Fix 2 bounded TTL/LRU op-issue id set)
  - src/worker/agents/agent-task-delivery.ts (startAgentTask populates the op-issue set)
  - test/worker/heartbeat-dispatcher.test.mjs (NEW)
  - test/worker/op-issue-set.test.mjs (NEW)
  - src/manifest.ts (version 1.4.3 → 1.4.4 + changelog note)
  - package.json (version 1.4.3 → 1.4.4)
