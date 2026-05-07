# Pitfalls Research

**Domain:** Paperclip plugin (`clarity-pack`) — same-origin trusted UI + heartbeat-driven Editor-Agent + four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat)
**Researched:** 2026-05-07
**Confidence:** HIGH on Paperclip-specific pitfalls (PLUGIN_SPEC.md fully read end-to-end + 1720 lines verified, plus 7 closed Paperclip GitHub issues/PRs cited); MEDIUM on agent-framework cost-runaway and dual-write divergence (industry literature, not BEAAA-specific telemetry); MEDIUM on cron/timezone pitfalls (well-documented externally, not yet wired into our scheduler choice).

This document is opinionated. Where the spec offers a footgun, the recommendation is "don't fire it" — not "be careful." Every pitfall maps to a phase and a verification step.

---

## Critical Pitfalls

### Pitfall 1: Plugin disable leaves an orphaned WebSocket / SSE / heartbeat consumer streaming under a 404 plugin id

**What goes wrong:**
Coexistence guarantee #6 says "clean uninstall preserves data." Spec §25.4.2 says hot uninstall removes event subscriptions, job schedules, webhook endpoints, and unmounts plugin UI components. But the Situation Room, the chat surface, and the Editor-Agent all maintain *long-lived* connections — auto-refresh polls (mockup says 30s/60s), real-time chat updates, agent run subscriptions. If the plugin is disabled while those connections are open in another browser tab, three things break:

1. The browser tab keeps polling `/api/plugins/clarity-pack/api/...` and receives 404 (or worse: 200-with-stale-data because the host route was unmounted but a cache layer responds). User sees a Situation Room frozen at "13:42 ET" indefinitely.
2. The Editor-Agent worker is shut down via `shutdown()` (10s grace per §12.5), but mid-flight bulletin compile or TL;DR generation gets cancelled and the partial output may be persisted as "today's bulletin" — a half-compiled artifact.
3. SSE/WebSocket clients have no built-in "the endpoint just disappeared" signal — they auto-reconnect (per Ktor/MDN reconnection semantics), creating a reconnect storm against the host until the user closes the tab.

**Why it happens:**
Hot lifecycle (§25.4) is a normative spec requirement, but it is implemented from the *host's* perspective: routes get unmounted, processes get killed. The plugin frontend has no equivalent of `componentWillUnmount` triggered remotely. Coexistence guarantee #6 (data preserved) is implicitly read as "plugin can be turned off cleanly" — but "cleanly" is a strong claim when long-lived connections are open in tabs the operator forgot about.

**How to avoid:**
- Subscribe to the host's `plugin.ui.updated` event (§25.4.5) and the broader plugin lifecycle event family. If the plugin's own `pluginId` enters `uninstalled` status, the UI must immediately tear down all open connections, render a "Clarity Pack is disabled" empty state, and stop polling.
- For every long-lived poller (Situation Room 60s recompute, chat live thread, bulletin watcher), use `usePluginData` (which routes through the host bridge — bridge errors propagate as `WORKER_UNAVAILABLE`/`CAPABILITY_DENIED` per §19.7). Never use raw `fetch` — the spec mandates this in §19.0.2 ("Plugin bundles must not access `window.fetch` or `XMLHttpRequest` directly for host API calls").
- On `WORKER_UNAVAILABLE` for >30s, stop the polling timer — do *not* exponential-backoff retry forever.
- Editor-Agent: every run must be CAS-guarded by previous status (matching the pattern Paperclip merged in **PR #4738** — "Guard run status updates with the observed previous status so stale finalizers do not emit duplicate terminal lifecycle events"). Bulletin compile must be transactional: write to a `bulletin_drafts` row, commit-flag only on full success.

**Warning signs:**
- Network tab shows >50 requests/min from one open Situation Room tab after plugin is disabled.
- A "Bulletin · No. 47" appears with empty Production section but populated Sales section (partial compile committed).
- Telemetry: count of 404s on `/api/plugins/clarity-pack/api/*` spikes after a disable.
- Code-review red flag: any use of `setInterval` that doesn't read the plugin status from `useHostContext()` first.

**Phase to address:**
Phase 1 (plugin scaffold) — write the lifecycle-aware polling primitive once, use it everywhere. Editor-Agent CAS guards are also Phase 1 (skeleton). Bulletin transactional commit is Phase 2.

**Sources:** PLUGIN_SPEC.md §12.5, §19.0.2, §19.7, §25.4.2, §25.4.5; paperclipai/paperclip PR #4738 ("complete documented plugin lifecycle event plumbing"); paperclipai/paperclip issue #5123 ("Fix external heartbeat orphan timeout race").

---

### Pitfall 2: Schema additivity violated through `plugin_state` namespace squatting

**What goes wrong:**
Coexistence guarantee #3 says "Schema is additive-only; plugin disable leaves data intact." Reading PLUGIN_SPEC.md §21, the *only* place clarity-pack can store plugin data is the host-provided generic tables: `plugin_state`, `plugin_entities`, `plugin_jobs`, `plugin_job_runs`, `plugin_webhook_deliveries`. The spec is explicit (§21.1.4): "Arbitrary third-party schema migrations are out of scope for the first plugin system." Phase 2 of the plugin system (§30) leaves "trusted-module migration path if truly needed" as future work.

But PR #5205 ("Expand plugin host surface") added **plugin-managed database namespaces and migration tracking** — meaning the spec has *already* drifted toward custom schemas. Plugin authors who reach for `plugin_state` only will be fine; plugin authors who reach for namespaced custom tables (which is now possible) own a migration story for the upgrade lifecycle (§25.2 — "Plugin upgrades do not automatically migrate plugin state. The plugin worker is responsible for migrating its own state on first access after upgrade").

The killer mode: clarity-pack v1 uses `plugin_state` with `namespace="bulletin"`, `state_key="issue-47"`. v1.1 ships and decides to use `plugin_entities` instead because it scales better for global search. The migration lives in the plugin worker. If migration runs partially (Editor-Agent crashes mid-migration, or operator force-purges via `pnpm paperclipai plugin purge` per §25.1.6), `plugin_state` rows + `plugin_entities` rows both exist for the same logical bulletin. Now "search global chat" returns duplicates, and "render bulletin No. 47" reads the wrong row.

**Why it happens:**
The host does not run plugin-defined schema migrations (§25.2). The plugin must version its own state (`schema_version` field inside `value_json`). Plugin authors typically forget this until v2 ships and they need to read v1 data. Worse: the unique constraint on `plugin_state` is `(plugin_id, scope_kind, scope_id, namespace, state_key)` — meaning two namespaces holding "the same" data is *legal*; nothing prevents drift.

**How to avoid:**
- Every value written to `plugin_state` or `plugin_entities` MUST embed `{ schemaVersion: 1, ... }`. Read-path branches on `schemaVersion`, never on absence-of-field heuristics.
- Define one `namespace` per surface and document it in SPEC.md: e.g., `bulletin`, `tldr-cache`, `chat-attachment-pin`, `agent-state-snapshot`, `editor-prefs`. No surface may write into another surface's namespace.
- If clarity-pack ever introduces a namespaced *custom* table (using the new plugin-managed DB namespaces from PR #5205), the migration path is: add new schema → backfill from `plugin_state` → verify counts match → flag-flip read path → drop old `plugin_state` writes → after grace period, hard-delete (the four-phase "expand-and-contract" pattern). Coexistence guarantee #3 (additive-only) implies *never* drop until grace expires.
- Test the disable-and-re-enable cycle in CI on every PR. The 30-day retention in §25.1.3 means a re-enable within 30 days must read the same data; the test must verify byte-equality of `plugin_state` rows pre- and post-disable.

**Warning signs:**
- Two rows in `plugin_state` for the same logical bulletin (different `state_key` values).
- `plugin_state` row count grows monotonically with no purge events — the plugin is forgetting to delete old TL;DR caches.
- `pnpm paperclipai plugin purge clarity-pack` removes more than the documented count of rows.
- Code-review red flag: any `INSERT INTO plugin_state` not preceded by a schema-version check.

**Phase to address:**
Phase 1 — establish namespace registry in SPEC.md, schema-version field in every state value. Phase 4 (Clipmart) — re-verify before public release.

**Sources:** PLUGIN_SPEC.md §21.1, §21.3, §25.1, §25.2; paperclipai/paperclip PR #5205 ("Expand plugin host surface"); industry: Strapi schema-data-loss issue #19141; Shopware issue #553 ("Destructive migration on plugin uninstall").

---

### Pitfall 3: Same-origin trust model footgun — plugin UI bypasses the bridge and calls Paperclip HTTP APIs directly

**What goes wrong:**
PLUGIN_SPEC.md §11 (current implementation caveats) and PROJECT.md Constraints both warn explicitly: "Plugin UI bundles run as same-origin JavaScript inside the main Paperclip app — treated as trusted code, not sandboxed. Manifest capabilities gate worker-side host RPC calls but do NOT prevent plugin UI code from calling Paperclip HTTP APIs directly." This is a *capability bypass*: the plugin worker only has the capabilities the operator approved (e.g., `issues.read`, `issue.comments.create`), but the UI bundle can `fetch('/api/issues/...', {credentials: 'include'})` and do anything Eric's session permits — including things the worker is *not* allowed to do (e.g., `issues.checkout`, `approval.decided`).

The §15.2 "Forbidden Capabilities" list is meaningless from the UI side. A plugin UI bug — or a malicious dependency in the plugin's npm tree (transitive react component that ships an unexpected fetch on mount) — has full Eric-session privilege. The spec acknowledges this in §19.0.2: "The host may enforce Content Security Policy rules that restrict plugin network access to the bridge endpoint only." May. Not must. Not implemented.

For clarity-pack specifically, the chat surface accepts user-typed messages and is a likely vector: a malicious markdown renderer or attachment preview component could exfiltrate Eric's session against an external server (data exfiltration), or silently call `/api/budget/override` (privilege escalation against forbidden capabilities).

**Why it happens:**
The convenience of same-origin (no CORS dance, fast UI, design tokens "just work") is exactly why the spec ships this way. The trust model is "the operator vets the plugin." For clarity-pack v1, the operator and the author are both Eric — so in practice this is fine. But two things make it actually bite:
1. **Dependency supply chain.** clarity-pack needs Markdown, syntax highlighting, table rendering, file preview, image thumbnails, possibly diff rendering. Every transitive dep is trusted.
2. **Future Clipmart submission.** The PROJECT explicitly defers Clipmart but expects to revisit. A v1 codebase that liberally uses raw `fetch` will need a painful audit before submission.

**How to avoid:**
- **MUST: zero raw `fetch` for Paperclip-internal data.** Every host call goes through `usePluginData` / `usePluginAction` per §19.0.2. Lint rule (eslint custom rule) that fails CI on any `fetch(`, `axios(`, or `XMLHttpRequest` referencing a Paperclip API path.
- **MUST: zero outbound network from the UI bundle.** Telemetry, error reporting, font loading, image CDNs — all blocked. If the host adds a CSP header, clarity-pack must be CSP-compliant before that lands so it doesn't break later.
- **Pin every transitive dependency** in `pnpm-lock.yaml`. Monthly `pnpm audit` + license review. No optional dependencies, no `postinstall` scripts.
- **Editor-Agent governance parity (Decision #6, coexistence #4) verified:** ship a test that proves the Editor-Agent worker has *exactly* the capabilities of an "agent" actor — no `issues.checkout` override, no `approval.decided`, no `budget.incident.resolved`. Cross-check with §15.2 forbidden list.
- **For Clipmart-readiness:** when the spec adds optional CSP enforcement (Phase 2 of the plugin system, §30), be ready to opt in immediately.

**Warning signs:**
- Any `fetch` import in the UI bundle.
- A new transitive dependency that increases the bundle network surface (test: build with `--analyze`, check imports).
- Editor-Agent makes a successful call to a `/api/approval/*` route — should be a hard fail in audit log.
- CSP violation in the browser console (when the host adds CSP).

**Phase to address:**
Phase 1 — establish the lint rule, the Editor-Agent capability test, and the bundle-no-network constraint *before* any other code is written. This is the cheapest place to enforce it. Phase 4 (Clipmart polish) — re-audit.

**Sources:** PLUGIN_SPEC.md §11 ("Current implementation caveats"), §15.2 ("Forbidden Capabilities"), §19.0.2 ("Bundle Isolation"); PROJECT.md Constraints (trust model paragraph).

---

### Pitfall 4: CSS bleed-through from clarity-pack styles into the host UI (and vice versa)

**What goes wrong:**
Plugin UI bundles render as ES modules in host extension slots (§19, §19.0.2 — *not* iframed in v1 of the plugin system). The host ships its own design tokens via `@paperclipai/plugin-sdk/ui`. The four mockups in `sketches/` ship a custom dark editorial palette (`--bg:#0E0D0A; --ink:#E8E1CF; --warn:#D9A23E; ...`) and custom fonts (`Geist`, `Geist Mono`, `Instrument Serif`). The Bulletin mockup uses a *completely different* palette (paper-cream, terracotta, Fraunces serif) — designed to look like a printed editorial, not the dark cockpit.

If clarity-pack ships these styles as global CSS (`:root { --bg: ... }` or `body { font-family: ... }`), they:
1. Bleed into the host shell (the Paperclip top nav, the classic dashboard, settings pages) — coexistence guarantee #2 violated ("Original UI never replaced").
2. Worse: the *Bulletin's* paper-cream palette could leak when a user navigates from `/bulletin` to a classic Paperclip page if the styles aren't scoped.
3. Even worse: the host's CSS could bleed *into* clarity-pack — a host upgrade changes the meaning of `--ink` and the Reader view's TL;DR strip suddenly renders unreadable.

The mockups themselves use raw `:root { --bg: ... }` and unscoped element selectors (`html,body { ... }`). Translating that 1:1 to React components ships the bug.

**Why it happens:**
The mockups are HTML demos, not production CSS. Devs port the look-and-feel by copying CSS variables to a global stylesheet because that's the path of least resistance. Shadow DOM and CSS Modules feel like extra work. The host design tokens (§19.0.1) "match the host theme" — but the mockups deliberately do *not* match the host theme; they're an editorial layer on top.

**How to avoid:**
- **Scope every clarity-pack style to a top-level `data-clarity-pack` attribute** (or a CSS Module wrapper). Never select `html`, `body`, `:root`, or unprefixed element selectors.
- The four surfaces each render inside an explicit boundary:
  - Reader view: `[data-clarity-surface="reader"]`
  - Situation Room: `[data-clarity-surface="room"]`
  - Bulletin: `[data-clarity-surface="bulletin"]`
  - Chat: `[data-clarity-surface="chat"]`
- All `:root`-scoped variables in the mockups become `[data-clarity-surface] { --bg: ... }`. Test: opening the host's classic dashboard with clarity-pack enabled must show zero color or font diff vs. clarity-pack disabled (visual regression test).
- For the Bulletin's *radically different* palette, also test that classic Paperclip remains pixel-identical when navigating away from the Bulletin route.
- **Don't use Shadow DOM** for v1 — adds complexity and breaks the host's `@paperclipai/plugin-sdk/ui` shared components. Scoped CSS Modules are sufficient.
- Visual regression in CI: snapshot of host classic dashboard `before-clarity-pack-install` vs. `after-install-and-disable` must match. Snapshot of host with clarity-pack enabled-but-toggle-off must match. (Coexistence guarantees #1 + #2 are testable here.)

**Warning signs:**
- Inspector shows `:root` rules from a clarity-pack stylesheet.
- Classic Paperclip dashboard background color changes when clarity-pack is installed.
- A clarity-pack global font import (e.g., `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`) — the mockups have one, and shipping it loads fonts globally for the host.
- Code-review red flag: any selector starting with `html`, `body`, `*`, or a bare element name (`button`, `input`).

**Phase to address:**
Phase 1 — establish the CSS module convention and the visual regression baseline before *any* surface ships. Phase 3 (Chat) and Phase 4 (Clipmart) are particularly at risk because they introduce new components.

**Sources:** PLUGIN_SPEC.md §19, §19.0.1, §19.0.2; sketches/*.html (raw `:root` and `html,body` rules in all four mockups).

---

### Pitfall 5: Opt-in toggle exists in profile settings but does not actually gate rendering

**What goes wrong:**
Coexistence guarantee #1 (Decision #5): "Per-user opt-in via profile toggle; default OFF for existing users." The mockups assume the user has opted in — but the spec doesn't mandate the host enforce this (the toggle is *plugin-defined* state). Three ways this fails:

1. The toggle lives in `plugin_state` with `scope_kind=user`, but the React routes (`/situation-room`, `/bulletin`, `/chat/...`) check it client-side only. A user who has *not* opted in but knows the URL can still load the route — and worse, the route triggers `usePluginData` calls that materialize bulletins and TL;DRs for them, racking up Editor-Agent compute.
2. The Reader view tab on issue pages (Surface 1, contributed via `ui.detailTab` slot per §19.3) appears for *all* users regardless of opt-in, because the host mounts slots based on plugin install, not per-user preference. Until the slot mounts, queries the toggle, and renders nothing — but the slot tab strip already shows "Reader view" as a tab.
3. The toggle exists but defaults to the wrong value after a host restart or plugin reinstall — `plugin_state` retention is 30 days (§25.1.3), but if the operator force-purges then reinstalls, all toggles default to OFF; if they reinstall within 30 days, the toggles come back ON. The user's experience is non-deterministic.

**Why it happens:**
PLUGIN_SPEC.md does not provide a host-level "this slot is opt-in" primitive. The plugin must implement the gate itself. Plugin authors typically gate the *content* of the slot (returns null), not the *visibility* of the slot's tab/sidebar entry — because the host renders the tab from the manifest declaration (§19.3) before the plugin's component mounts.

**How to avoid:**
- **Server-side enforcement:** every `getData` and `performAction` handler reads the user's opt-in state from `plugin_state` (scope_kind=user, scope_id=userId, namespace=`opt-in`, key=`enabled`). If `false`, return an explicit `OPT_IN_REQUIRED` error code. UI surfaces render an "Enable Clarity Pack in your profile" inline prompt.
- **Slot visibility:** for `detailTab` slots, the plugin's exported component must internally check the toggle and return `null` if disabled — but the *tab itself* will still appear because the host owns the tab strip. Workaround: name the tab "Clarity Reader" and have the rendered content be the opt-in CTA when disabled. This makes the toggle discoverable rather than hidden.
- **Default state:** the absence of a `plugin_state` row for a user *must* mean "opt-in = false" (existing-user default). Never write the default eagerly on user creation — that creates ambiguity between "user opted in then revoked" and "user never seen the toggle."
- **Verification test:** enable plugin, *do not* opt in as Eric, navigate to `/situation-room`, expect 0 calls to Editor-Agent compile, expect a "Enable Clarity Pack" CTA. Repeat for each surface.

**Warning signs:**
- Editor-Agent token spend before any user has clicked the opt-in toggle.
- A user-scoped `plugin_state` row appears for users who never visited Settings.
- The Reader view tab is *missing* on issue pages instead of showing an opt-in CTA (UX regression — the user has no way to discover it).

**Phase to address:**
Phase 1 — opt-in is a Phase 1 coexistence requirement; the gate must be in place before *any* surface renders.

**Sources:** PROJECT.md Coexistence guarantees #1; PLUGIN_SPEC.md §19.3, §21.3 (`plugin_state` scope_kind enum), §25.1.3.

---

### Pitfall 6: Editor-Agent runaway cost — heartbeat-driven recompile loop with no token ceiling

**What goes wrong:**
The Editor-Agent is a regular Paperclip employee under standard agent governance (Decision #6, coexistence #4) — same budget caps, pause/terminate, audit log. PLUGIN_SPEC.md §25.4.2 + Paperclip's own heartbeat lifecycle (PR #4738) confirm agent runs are heartbeat-driven with CAS-guarded transitions. The Editor-Agent's job is huge:
- Situation Room: recompile every 60s on view (per Decision #2). N viewers, M agents, P blocker chains → recompile cost is `N × O(M × P)` per minute.
- Daily Bulletin: 06:30 ET compile across all of yesterday's activity log + today's awaiting-you items.
- Reader view: TL;DR regenerated each time the task body changes (per the mockup: "*This summary is regenerated each time the task body changes.*").

Failure modes that have well-documented industry priors (AutoGen back-and-forth loops, LangGraph missing termination paths, CrewAI stuck-in-task loops):
1. A blocker chain with a cycle ("A blocks B, B blocks A") sends the chain-resolver into recursion → uncapped LLM context growth → token blowup.
2. The Reader view re-triggers TL;DR regeneration on its own write (the regeneration writes to the issue body / a comment, which fires `issue.updated`, which triggers another regeneration). Same pattern as Cloudflare's Sept 12 2025 outage where a service restart caused everyone's dashboard to re-authenticate at once — but for token spend.
3. Bulletin compile fails partway through. The retry kicks in (per heartbeat semantics — "Failed jobs are retryable" §17). Each retry re-reads the *full* day's activity log. Three retries = 3x token cost, and the bulletin still doesn't ship.

The Bulletin mockup itself shows a "Quiet alert: Researcher-Agent at 91% of weekly token cap with 36h to reset" — meaning the framework expects this and surfaces it. Good. But the *Editor-Agent itself* is the one writing that alert, so it's a self-policing failure mode.

**Why it happens:**
- "Agent that writes about agents" creates feedback loops by default.
- LLM-driven summarization has no natural termination — there's always more context to add. Without a hard token cap per call, costs scale super-linearly.
- Heartbeat retry semantics (§17 "Failed jobs are retryable") + at-least-once event delivery (§13.5) means the Editor-Agent will see the same trigger event multiple times and must be idempotent.

**How to avoid:**
- **Hard per-call ceilings:** every Editor-Agent LLM call has `max_tokens` set, `max_iterations` set, and a budget guard that aborts before exceeding 80% of the per-day cap.
- **Cycle detection in blocker chains:** before resolving a chain, run cycle detection (DFS with visited set; topological sort would fail on a cycle). If a cycle is found, surface it as a critical-path entry "Cycle detected between BEAAA-X, BEAAA-Y, BEAAA-Z — this is a planning bug, not a blocker on you." Never recurse blindly.
- **Idempotency keys:** every compile run keyed by `(surface, scope_id, content_hash)`. Re-firing the same compile with the same content_hash short-circuits to the cached result. Mockup's "Compiled in 38 seconds from 14 agent ledgers · 0 manual edits" implies this is already cached by content; make it explicit.
- **Don't trigger on own writes:** the Editor-Agent's writes to bulletins, TL;DRs, and critical-path narratives must be tagged with `actorType: plugin` (per §21.4) and the trigger filter (§16.1) must *exclude* events where `actor_type = plugin AND actor_id = clarity-pack-editor-agent`. This breaks the self-loop.
- **Circuit breaker:** if the Editor-Agent fails 3 compiles in a row, open the circuit. UI shows "Editorial desk paused — see audit log." Operator manually un-pauses.
- **Budget visibility on Situation Room footer:** show today's Editor-Agent spend inline. Operator sees "Compiler-Agent: $4.20 / $10 daily cap" and can act before blowup.

**Warning signs:**
- Token spend per Editor-Agent run grows >2x over a week without corresponding org-chart growth.
- Same `(surface, scope_id)` recompile fires more than 3x in 5 minutes.
- A bulletin row in `plugin_state` is rewritten >5 times before the 06:30 schedule.
- Heartbeat audit log shows Editor-Agent in `running` status for >5 minutes (normal compile is 38 seconds per the mockup).

**Phase to address:**
Phase 1 — Editor-Agent skeleton must include: hard per-call token cap, cycle detection in chain resolver, idempotency key on compile, circuit breaker, and self-loop filter. *Before* any compile actually runs in production, the budget cap and circuit breaker are non-negotiable.

**Sources:** PLUGIN_SPEC.md §13.5, §16.1, §17, §21.4; paperclipai/paperclip PR #4738 (run lifecycle CAS guards); paperclipai/paperclip issues #4954, #4952, #5096 ("Retry max-turn exhausted heartbeats", "Raise agent heartbeat concurrency default"); industry: [How to Stop AI Agent Cost Blowups Before They Happen](https://dev.to/sapph1re/how-to-stop-ai-agent-cost-blowups-before-they-happen-1ehp); CrewAI/AutoGen/LangGraph framework comparisons ([DataCamp comparison](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)).

---

### Pitfall 7: Polling thundering herd — N tabs × 60s recompute = unmanaged load on host

**What goes wrong:**
Decision #2 says Situation Room recomputes every 60s on view. The Bulletin mockup says "Live ops · auto-refresh 30s" in its sub-mast (so even faster). If Eric has the Situation Room open in 3 tabs (e.g., laptop + monitor + phone), each tab independently fires `usePluginData("situation-room", ...)` every 60s. The host bridge fans these out to the worker. The worker, in turn, re-runs the cross-org compile.

This is the classic thundering herd (well-documented in the Cloudflare Sept 12 2025 outage — when the Tenant Service restarted, every dashboard re-authenticated at once and DDoSed itself). For clarity-pack at v1 audience scale (Eric only) this looks fine, but: phones background-poll, browser tab discard-and-restore wakes them all simultaneously, and the *next* phase introduces the chat surface which has *its own* polling. By Phase 4 you have 3+ subscriptions per tab, 3 tabs, 1-min cadence = 540 requests/hour of compile work.

Worse, the spec's at-least-once event delivery semantics (§13.5) means the worker's `onEvent` handlers will *also* re-trigger compiles, on top of the polling. No single layer is broken; the layers compound.

**Why it happens:**
Each tab thinks it's alone. There's no SharedWorker / BroadcastChannel coordination by default. The bridge doesn't dedupe identical `getData` calls in flight. The worker treats every call as fresh.

**How to avoid:**
- **In-flight request dedupe at the bridge layer:** if a `getData("situation-room", {...})` is already running for the same key+params, return the same promise to all callers in the same tab. (`@paperclipai/plugin-sdk/ui` may not provide this out-of-the-box — verify, and wrap if needed.)
- **Cross-tab coordination via BroadcastChannel:** elect one "leader tab" per browser to do the actual polling; other tabs subscribe to the channel for results. Falls back gracefully if BroadcastChannel isn't supported.
- **Pause polling when tab is hidden:** `document.visibilityState === 'hidden'` → stop the timer, restart on `visibilitychange`. Trivial 5-line fix; many devs forget.
- **Worker-side cache with content-hash invalidation:** the compile output is keyed by `hash(activity_log[since: last_compile])`. If nothing has changed, return the cached result without re-running the LLM.
- **Stale-while-revalidate UI pattern:** show cached result immediately with a "computing…" pulse; refresh in background. This makes 60s feel instant and reduces user-perceived pressure to over-poll.

**Warning signs:**
- `plugin_job_runs` shows multiple Editor-Agent compile runs within seconds of each other for the same surface.
- Network tab shows the same `getData` URL fired 3+ times in <1 second.
- Editor-Agent token spend spikes proportionally to number of open tabs (not number of users).

**Phase to address:**
Phase 1 (Situation Room) — establish the polling primitive with dedupe, visibility pause, and cache. Phase 2 (Bulletin) — verify the primitive holds. Phase 3 (Chat) — verify when the third subscription per tab is added.

**Sources:** Industry: [Cloudflare Sept 12 2025 outage post-mortem](https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/); [UX strategies for real-time dashboards (Smashing 2025)](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/); PLUGIN_SPEC.md §13.5, §13.8 (`getData`).

---

### Pitfall 8: "Stale data masquerading as live" — the Situation Room shows 13:42 ET when the actual time is 14:30

**What goes wrong:**
The mockup shows a top-bar timestamp "As of **13:42 ET**" with a "Live ops · auto-refresh 30s" subtitle. If the polling fails silently (worker restart, network blip, capability denied after a host upgrade revoked something), the timestamp freezes. The user reads "13:42" as truth and acts on stale state — for example, "everyone is awaiting you" still shows old blockers.

The `PluginBridgeError` shape (§19.7) gives the bridge `WORKER_UNAVAILABLE`, `CAPABILITY_DENIED`, `WORKER_ERROR`, `TIMEOUT`, `UNKNOWN` codes. But many UIs just retry on error and keep the last-known data on screen — which is exactly the wrong UX for an ops cockpit.

The Bulletin mockup has the same issue: "Compiled in 38 seconds from 14 agent ledgers · 0 manual edits" — but if the *next* compile fails (06:30 ET tomorrow), the user opens the page and sees Vol. I No. 47 dated 7 May, with no banner saying "this is yesterday's bulletin, today's didn't compile."

**Why it happens:**
LLM dashboards optimize for "looks good." Showing cached data is faster than showing an error. Devs forget that a frozen "live" display is worse than no display.

**How to avoid:**
- **Three states, never two:** every live surface displays one of `Live (last refresh < 90s)`, `Stale (last refresh > 90s, still trying)`, `Failed (last refresh > 5min OR last error received)`. Color-code: green / amber / red. The mockup's existing state pills (`live`/`warn`/`alert`) can carry this.
- **"As of" timestamp must be the timestamp of the data, not the timestamp of the page render.** Show it prominently with a "stale" badge if >90s old.
- **Bulletin specifically:** date-stamp the bulletin in the masthead (the mockup does this — "Thursday · 7 May 2026 · 06:30 ET"). If today's bulletin failed to compile, render an explicit "Today's bulletin failed to compile at 06:30. Showing yesterday's. [Retry now]" banner, not silent fallback to yesterday.
- **Editor-Agent attribution check:** every compile output writes a "compiled at" timestamp into the artifact. The frontend reads this from the data, never trusts wall clock.
- **Telemetry:** track `time_since_last_successful_refresh` per surface per session. Alert if p95 > 5 min.

**Warning signs:**
- The Situation Room timestamp hasn't moved in 5 minutes but the page hasn't shown an error.
- The Bulletin masthead date is yesterday's date but the user opened the page today.
- A user reports "everyone is awaiting you" persisted after they answered the question.

**Phase to address:**
Phase 1 (Situation Room). Phase 2 (Bulletin date-stamping).

**Sources:** PLUGIN_SPEC.md §19.7 (`PluginBridgeError`); industry: [UX strategies for real-time dashboards (Smashing 2025)](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) (status pill pattern: "Live", "Stale", "Paused").

---

### Pitfall 9: Daily Bulletin DST drift — 06:30 ET runs at 07:30 ET (or never) twice a year

**What goes wrong:**
Decision #2: "scheduled (06:30 daily Bulletin)." PLUGIN_SPEC.md §17 says jobs are declared in the manifest with cron expressions; the host is the scheduler of record. If the cron runs in UTC (recommended best practice) or the host's local timezone, **twice a year** the 06:30 ET schedule drifts:

- **Spring forward (2nd Sunday of March):** 02:00 ET → 03:00 ET. If the cron is "30 6 * * *" in ET it runs once. But if it was authored in UTC as "30 11 * * *" (correct for 06:30 EST), then after spring-forward 06:30 EDT = 10:30 UTC, so the bulletin lands at 07:30 ET for 8 months.
- **Fall back (1st Sunday of November):** the 01:00–02:00 ET hour repeats. If the cron is run-once-per-trigger, no issue. If the cron driver double-fires within the repeated hour, the bulletin compiles twice.
- The PLUGIN_SPEC.md spec is silent on how cron strings are interpreted (timezone of the host, of the operator, of UTC?). For a multi-host or relocated deployment, this is ambiguous.

This isn't theoretical — node-cron, action-scheduler (WooCommerce), Sentry cron monitor, and Red Hat cron have all shipped fixes for these specific bugs.

**Why it happens:**
Cron strings don't carry timezone context. "06:30 ET" doesn't mean anything to the underlying scheduler — it means UTC offset that varies twice a year. Plugin authors test in summer or winter, never both.

**How to avoid:**
- **Don't use bare cron.** The Editor-Agent's bulletin trigger is implemented inside the worker (since heartbeat-driven), reading a "next-due-at" timestamp from `plugin_state`. Compute next-due-at using a real timezone library (`date-fns-tz` or `luxon`) in the America/New_York zone. This auto-handles DST.
- **Use the §17 declared `cron` field as a hint only.** When the heartbeat fires and sees current_time > next_due_at, run the bulletin and compute the *next* next_due_at using the timezone library.
- **Audit-log the actual fire time.** Bulletin No. 47 should record "compiled at 06:30 EDT (10:30 UTC)." If two bulletins fire same calendar day (fall-back duplicate), the second one reads next_due_at < now and idempotently no-ops.
- **Test both DST transitions.** CI test that fakes the system clock to 2 March (the day before spring forward), 9 March (the day of), 1 November (the day before fall back), and 2 November. Verify exactly one bulletin compiles per day, at the right wall-clock time.
- **Compile cycle number is monotonic** (mockup shows "Vol. I · No. 47", "Operations Cycle 47"). DST should not cause a cycle skip or duplicate.

**Warning signs:**
- Two bulletin rows for the same date.
- A bulletin's "compiled at" timestamp shifts by 1 hour after the second Sunday of March.
- An "06:30 ET" bulletin shows 11:30 UTC in audit log year-round (correct in EST, wrong in EDT).

**Phase to address:**
Phase 2 (Daily Bulletin). Test DST transitions in CI before Phase 2 ships.

**Sources:** PLUGIN_SPEC.md §17; [When DST broke our cronjobs (Medium)](https://medium.com/@rudra910203/when-daylight-savings-time-broke-our-cronjobs-in-3-different-ways-ee3ce525904f); [Handling Timezone Issues in Cron Jobs 2025 Guide](https://dev.to/cronmonitor/handling-timezone-issues-in-cron-jobs-2025-guide-52ii); node-cron issue #56; Sentry issue #66763.

---

### Pitfall 10: Hallucinated bulletin summaries — "Editor-Agent compiled X" when X never happened

**What goes wrong:**
The Bulletin mockup is dense with attributable claims:
- "Sent to 3 / 3 paying subscribers. Open rate 100%, two replies, one forwarded internally."
- "Twenty-seven cold emails sent, four replies, two discoveries booked."
- "Refund request, account #C-0042 — Blindspot Guarantee invoked."
- The lineage thread: "SCOUT 412 signals → CLASSIFIER 38 candidates → SCORER top-4 → WRITER → QA → EDITOR → PUBLISHER".

If even one number is wrong — "412 signals" when actually 387, or "two discoveries booked" when the agent hallucinated the second booking — Eric loses trust in the entire bulletin. Industry research on LLM hallucinations shows summaries invent metrics, fake citations, and wrong attributions confidently.

The colophon "Compiled in 38 seconds from 14 agent ledgers · 0 manual edits" is itself a trust signal that backfires when wrong: a confident artifact with no human edit-pass amplifies any single error.

**Why it happens:**
LLMs summarize fluently and confidently regardless of source-of-truth correctness. Without explicit grounding (RAG / structured retrieval) and without a verification step, numbers drift.

**How to avoid:**
- **Numbers come from queries, not from LLM generation.** Every numeric claim in the bulletin (cold-email count, reply rate, MRR, discoveries booked) is a SQL/structured query result, *interpolated* into prose by the LLM. The LLM never decides what the number is.
- **Citations are mandatory.** Every claim in the bulletin links to the source artifact (issue ID, comment ID, audit-log row). The mockup already does this (BEAAA-148 chips, ref-inline pills) — extend to all numeric/factual claims.
- **Two-pass compile with self-verification:** pass 1 generates the bulletin draft; pass 2 is a "verifier" pass that re-queries every numeric claim against the structured store and flags mismatches. Mismatches surface as `[VERIFICATION FAILED]` markers in the draft and block publish.
- **Errata page (mockup already has this!):** the mockup shows "Errata appended to Issue 46 — AcmeSec Pro pricing correction." This is the right pattern. Make the errata workflow first-class: any issued bulletin can be retroactively annotated with errata, and the errata is itself audit-logged.
- **Attribution rule:** if the Editor-Agent uses output from another agent, the bulletin item's `by` line must read "Compiled by Editor-Agent, after handoff from Writer-Cyber" (mockup pattern). Never elide the chain.
- **Confidence in the mockup's tone:** the mockup is restrained — it cites sources, attributes work, marks SLAs. Codify these in the Editor-Agent's prompt template and refuse to publish a bulletin item that doesn't conform.

**Warning signs:**
- A bulletin claim's number doesn't match the underlying query when manually re-checked.
- An attribution to "Writer-Cyber" when no such agent ran yesterday (hallucinated agent).
- A lineage thread node (e.g., "SCORER 4 moves scored ≥ 9/15") with no corresponding `agent.run.finished` event in the activity log.
- User reports "I never approved that" but the bulletin claims they did.

**Phase to address:**
Phase 2 (Bulletin) — verifier pass and citation requirement must ship with v1 of the bulletin, not added later. Phase 1 (Reader view TL;DR) — same hallucination risk applies to the inline TL;DR strip.

**Sources:** [Hallucination detection and mitigation framework for faithful summarization (Nature 2025)](https://www.nature.com/articles/s41598-025-31075-1); [LLM hallucination examples & detection (factors.ai)](https://www.factors.ai/blog/llm-hallucination-detection-examples); sketches/paperclip-fix-bulletin.html (errata pattern).

---

### Pitfall 11: Hybrid chat dual-write divergence — message persists as comment, comment edit not reflected in chat thread

**What goes wrong:**
Decision #1: "Chat = hybrid (real-time UI, durable as issue comments + work-product attachments)." Coexistence guarantee #5: "Chat messages render as ordinary threaded comments in the classic Paperclip UI." The chat mockup shows messages with topic chips (`CHT-44`), reply IDs, and a "Storage pin" footer: "all messages persist as issue comments · attachments as work-products · single source of truth."

Failure modes documented in real chat-as-comment systems:
1. **Edit divergence:** Eric edits a chat message in the chat UI. Did it write a NEW comment with edit-marker, or update the existing comment in place? If classic UI shows the original comment text and chat shows the edited text, they diverge. Per Paperclip's `issue.comment.created` event (§16) — there's no `issue.comment.updated` event listed, suggesting comments may be append-only at the host. If so, "edit" must be append-with-supersedes.
2. **Delete divergence:** Eric deletes a message in chat. The classic UI has no concept of "this comment was deleted from a chat" — does the comment vanish, or remain with a tombstone?
3. **Real-time UI optimistic updates:** the chat UI shows a message instantly (optimistic), then the bridge `performAction("send-message")` round-trips. If the round-trip fails (worker error, capability denied, network), the message is in the user's UI but never reached `issue_comments` storage. The user thinks they sent it; the agent never received it.
4. **Comment ordering:** the chat thread is ordered by client-side send time. Issue comments are ordered by server-side timestamp. Clock skew across multiple tabs / devices causes reorder when round-trip lands.
5. **Attachment work-product leak:** the mockup says "stored in cfo/CHT-44/attachments/ · 1.4 MB · uploaded 16:51". The work-product service is one of the explicitly ⚪-unbuilt Paperclip surfaces (per PROJECT.md Context). If it's not yet built, attachments have no home.

**Why it happens:**
Dual-write is hard. Optimistic UI is fast but lossy. Classic Paperclip UI doesn't know it's looking at a chat thread — to it, comments are just comments.

**How to avoid:**
- **Single source of truth: `issue_comments` is canonical.** The chat UI is a *view*, not a *store*. Every message MUST be written to `issue_comments` via `ctx.issues.relations` / `issue.comments.create` capability before showing the user "sent."
- **No optimistic updates that survive failure:** if the write fails, immediately roll back the UI bubble and show a "send failed — retry" affordance. Never let the user believe a failed message was delivered.
- **Edits as new comments with supersedes-link:** mockup pattern — message X has reasoning panel with citations. Edits write a new comment that references the previous one. Classic UI sees a comment thread with edit annotations; chat UI collapses the edit chain.
- **Deletes as tombstone-comments:** never destructive. Classic UI shows "this message was retracted." Chat UI hides it but keeps the tombstone for audit.
- **Idempotency keys per message:** client generates a `message_uuid` before send. Server-side write is keyed by uuid; replay-safe.
- **Comment timestamp = server-assigned, always.** Display "Yesterday 16:42" using server time. Reorder client-side after round-trip if needed; never trust client clock.
- **Attachment fallback when work-product service is down:** chat UI must detect work-product capability availability via `ctx.actions.checkCapability` (or pre-flight call) and disable the attach button if absent, with explicit "attachments require work-products plugin enabled." Never let the user attach into the void.
- **Reconciliation job:** a daily Editor-Agent job reads `issue_comments` for chat-topic issues and verifies the chat UI's view matches. If divergence is found, audit-log the discrepancy and surface in the bulletin's "errata" pattern.

**Warning signs:**
- A chat thread shows N messages but the underlying issue comment count is N-1.
- A chat message edit visible in chat UI but classic UI shows original text.
- An attachment row in `plugin_state` references a work-product ID that returns 404.
- User reports "I sent that but the agent says they never saw it."

**Phase to address:**
Phase 3 (Chat) — entirely. Plus Phase 1 verification: confirm `issue.comment.created` is the right event hook (per §16), and confirm whether `issue.comment.updated` exists or comments are append-only (the spec lists `created` but not `updated` in §16's minimum event set — that is itself a finding worth surfacing in SPEC.md).

**Sources:** PLUGIN_SPEC.md §16 (event types — note absence of `comment.updated`), §14.1 (`ctx.issues` orchestration APIs), §15.1 (capability `issue.comments.create`); industry: [Real-Time Event Stream Reconciliation Pattern (Medium)](https://medium.com/@rajesh1.ojha/real-time-event-stream-reconciliation-pattern-35d2ba949da6); PROJECT.md Context (Artifacts & Work Products is ⚪ unbuilt).

---

### Pitfall 12: Inline reference resolution — N+1 fan-out on a task page with 30 cross-references

**What goes wrong:**
The Reader view's killer feature is "every reference resolved inline." The mockup shows ~6 reference chips in the top half alone. A real BEAAA task may reference 20–30 issues, each requiring:
- Title (issues.read)
- Status badge (issues.read)
- Owner (issues.read + agents.read)
- Quoted excerpt (issue.documents.read)
- Permission check (does the viewer have access?)
- Cycle check (does this reference reference us back?)

Naïve impl: 30 references × 4 sequential reads = 120 queries on page load. Page renders in 4+ seconds. Worse, the spec doesn't list a batched-read API in §14 — `ctx.issues` has `getSubtree` and individual reads, but no `issues.batchGet([ids])`. Plugin authors will write a loop.

**Why it happens:**
Each reference is rendered by a `<RefInline issueId={...}>` component that does its own `usePluginData("ref", { id })`. React's render order causes serial fetches. No batching layer.

**How to avoid:**
- **Batch resolver pattern:** the page-level component collects all referenced IDs first (one tree walk), issues a single `getData("resolve-refs", { ids: [...] })` to the worker, the worker batch-reads via `ctx.issues.getSubtree` or repeated `ctx.issues` calls (still serial worker-side, but only one round-trip from the UI). All `<RefInline>` children read from the resolved cache via React context.
- **Response cache with TTL** (worker-side): a reference resolved in the last 30 seconds is reused. Issue-update events invalidate the cache.
- **Permission-first resolution:** the worker checks the *viewer's* permission to read each referenced issue *before* including its content. If denied, return `{ id, status: "RESTRICTED", title: null }` — the UI renders a `[restricted]` chip, never leaks the title or quote. This is critical because the spec's capability gates only protect the worker — the UI is same-origin trusted, so a permission leak via the worker bypassing the user's session permission set is a real concern.
- **Cycle detection:** track visited IDs on the worker; if a reference points back to the current task, render it as a regular chip but don't recurse for transitive resolution.
- **Lazy resolution for off-screen refs:** IntersectionObserver on `<RefInline>` — only resolve when scrolled into view. Top-of-page refs resolve eagerly.
- **Stale resolution flagging:** if a resolved reference's `updated_at` is older than the current page load, render a subtle "stale" indicator. Don't silently show outdated quotes.

**Warning signs:**
- Reader view paint time > 1s on a task with 20+ references.
- Network tab shows >10 sequential `getData` calls on page load.
- A user reports they saw the title of an issue they shouldn't have access to.
- A reference quote shows old text after the underlying issue was edited.

**Phase to address:**
Phase 1 (Reader view) — batch resolver primitive established here, reused in Situation Room (Phase 1) and Chat (Phase 3, for `@mentions` and topic refs).

**Sources:** PLUGIN_SPEC.md §14 (no batched `issues.batchGet` listed), §14.1 (`ctx.issues.getSubtree` exists for one-issue subtree), §15.1 (capabilities); sketches/paperclip-fix-task-detail.html (6+ ref chips on one task).

---

### Pitfall 13: Transitive blocker chain wrong — "everyone is awaiting you" false positive

**What goes wrong:**
The Situation Room mockup shows critical-path entries like:
> "CFO is at 60% on band factors → Sec. 4 needs broker-comm % (12 or 15) → **YOU answer · ~5 min · clears 5 tickets**"

Two failure modes:
1. **Stale resolution.** The chain was computed at 13:18 ET; the user opens the page at 13:42 ET; in those 24 minutes Eric *already* answered (in chat or directly). The chain still says "awaiting you." This is the inverse of Pitfall 8 — wrong action attribution propagates urgency that no longer exists.
2. **Wrong terminal.** The DFS that resolves "CFO blocked on Eric" via `(blocker, blocker, ..., terminal)` may stop at the wrong terminal. Example: CFO is blocked on a board-locked artifact (BEAAA-25, "Locked", Owner: CEO). The chain incorrectly walks past the lock and claims CEO is the blocker. CEO can't unlock because it's board-locked. Eric clicks "ping CEO" — CEO is irritated, problem unsolved.
3. **Cycle missed.** A → B → C → A. If the cycle detection isn't tight, the chain renders an infinite list or picks an arbitrary "terminal" mid-cycle.

The mockup's Actuary card shows a beautiful resolution: "CFO is at 60% on band factors (in-progress, ETA Wed AM) / CFO is itself waiting on broker-comm % from YOU / Real unblock: confirm broker-comm % (~5 min decision)". Getting this right is the core differentiator. Getting it wrong destroys trust.

**Why it happens:**
- LLMs are confidently wrong about chains; deterministic graph algorithms are correct but show ugly output.
- Locked / board-approved artifacts are treated as "regular" tasks by the chain resolver because they have an owner and a status.
- Cycle detection is easy to forget when the graph is "obviously" acyclic in dev fixtures.

**How to avoid:**
- **Deterministic chain resolution; LLM only for narrative.** The graph walk is pure code: BFS/DFS with visited set, terminal detection rules. The LLM only writes the prose around the deterministic chain. Never let the LLM choose the terminal.
- **Terminal type taxonomy:**
  - `human-decision` (terminal — points to Eric or another user)
  - `agent-working` (NOT terminal — the agent is executing; surface ETA, no action needed)
  - `external-blocker` (terminal — vendor reply, etc.; surface ping action)
  - `locked-artifact` (terminal but no action — render "anchored to BEAAA-25 [Locked]; no override available")
  - `cycle-detected` (terminal — surface as planning bug, not a blocker)
- **Recompute on chain-relevant events:** subscribe to `issue.relations.updated`, `issue.updated`, `issue.checked_out`, `issue.released` (per §16). If the resolver was computed >5 minutes ago AND any of these events fired since, force recompute on next view.
- **Show the resolution timestamp:** "Resolved 13:18 ET, 24 min ago" — gives Eric the meta-data to discount stale chains.
- **Acceptance test:** for every chain rendered in the Situation Room, generate the chain via deterministic algorithm AND via the LLM; assert they pick the same terminal. If they ever diverge, log + alert (this is a regression test that catches LLM drift).

**Warning signs:**
- A chain's terminal is a board-locked or permission-locked artifact (the user can't act on it).
- "Awaiting you" persists after the user has demonstrably acted (audit log shows the action).
- A chain's terminal changes between two consecutive recomputes without any underlying issue change.
- Chain length > 6 — usually means cycle or wrong walk.

**Phase to address:**
Phase 1 (Situation Room) — deterministic resolver, terminal taxonomy, recompute trigger. Acceptance test on chain correctness.

**Sources:** PLUGIN_SPEC.md §16 (events: `issue.relations.updated`, `issue.checked_out`, `issue.released`), §14.1 (`ctx.issues.relations.get`); sketches/paperclip-fix-situation-room.html (chain resolution mockup); industry: [Dependency graph cycle detection (Wikipedia)](https://en.wikipedia.org/wiki/Dependency_graph).

---

### Pitfall 14: Editor-Agent compile uses LLM output that contradicts underlying truth

**What goes wrong:**
A specific subtype of Pitfall 10 worth calling out separately. The Editor-Agent compiles three artifact types:
- **TL;DR strip on Reader view** ("CFO is building per-fan band factors v1.5 so the pricing model can be reconciled...")
- **Critical-path narrative on Situation Room** ("You approve LOI v1.4 deck → CMO finalizes outreach...")
- **Bulletin items** ("Twelve cyber-SaaS prospects enriched, eight qualified.")

If the underlying truth changes between the compile-read and the user-render, the Editor-Agent's narrative contradicts the truth. Example: CFO says "at 60%" in the source comment; LLM rewrites as "at 75%" because the prompt nudged it toward optimism. The user reads "75%" in the TL;DR and "60%" in the activity log on the same page. Trust gone.

This is distinct from hallucination (Pitfall 10) — hallucination is "made-up content"; *this* is "transcription drift" — the LLM accurately summarizes some part of the source while subtly misstating quantitative or attribution facts.

**Why it happens:**
LLMs compress lossy. Numbers, dates, and attributions are exactly the parts that need to be lossless.

**How to avoid:**
- **Quote, don't summarize, when truth matters.** TL;DR uses verbatim phrases from the source comment for any numeric claim. The mockup pattern: `<b>per-fan band factors v1.5</b>` (verbatim title), `Sec. 1 (loss-cost prior) and Sec. 2 (expense load) are done` (verbatim section names).
- **Structured slot-filling, not free generation.** TL;DR template has slots: `{owner_role}, {artifact_name}, {sections_done}/{sections_total}, {blocking_actor_name}, {blocking_reason}`. LLM fills slots, doesn't generate the surrounding sentence structure.
- **Cross-reference invariant:** any number in the TL;DR appears verbatim somewhere in the source. CI test: for every generated TL;DR fixture, every digit in the output exists in the input.
- **Attribution rule:** the compiler-agent attributes itself: footer "Compiled by Editor-Agent · Editorial Desk" (mockup pattern). Never let the LLM impersonate another actor's voice.
- **Editor-Agent's own activity log:** every compile is logged with `actorType: "plugin"` and `sourcePluginId: clarity-pack` (per §21.4). The Reader view's TL;DR strip shows "auto-summary" badge. The user always knows it's machine-written.

**Warning signs:**
- A TL;DR contains a number that doesn't appear in the source comments or the `plugin_state` cache.
- A TL;DR attributes a quote to an agent that didn't write that quote.
- The TL;DR uses "we" or "I" — the Editor-Agent should never speak in the user's voice.
- User reports "the summary is wrong" with a specific factual mismatch.

**Phase to address:**
Phase 1 (TL;DR on Reader view) — slot-filling template + verbatim invariant test. Phase 1 (Situation Room narrative). Phase 2 (Bulletin) — rolls up these patterns.

**Sources:** PLUGIN_SPEC.md §21.4 (activity log actor types); industry: [Hallucination detection framework for faithful summarization (Nature 2025)](https://www.nature.com/articles/s41598-025-31075-1); sketches (TL;DR template with `<b>`-marked verbatim content).

---

### Pitfall 15: PLUGIN_SPEC.md §13.5 at-least-once event delivery — non-idempotent handlers double-write

**What goes wrong:**
PLUGIN_SPEC.md §13.5 is explicit: "at least once / plugin must be idempotent / no global ordering guarantee across all event types / per-entity ordering is best effort but not guaranteed after retries." This is normal distributed-systems hygiene, but plugin authors who haven't built event-sourced systems before reach for the wrong abstraction.

For clarity-pack:
- A duplicate `issue.updated` event causes a duplicate TL;DR regen → two copies of the TL;DR in `plugin_state` (different `state_key` values if not careful) or two LLM calls (token waste).
- A duplicate `agent.run.finished` triggers double bulletin-item write (two "Onboarding brief delivered" rows for the same delivery).
- A duplicate `issue.comment.created` from the chat surface causes the chat thread to render the same message twice.

**Why it happens:**
Plugin authors test in dev where retries don't fire. The spec note is buried in §13.5. The handler logic naturally writes "create new row" rather than "upsert by deterministic key."

**How to avoid:**
- **Every event handler is upsert with a deterministic key.** TL;DR cache keyed by `(issue_id, content_hash)`. Bulletin-item keyed by `(date, source_event_id)`. Chat message rendered by `(message_uuid)`.
- **Emit events from the worker with deterministic IDs too.** Per §13.5 "Each event must include: event id". Use this in the handler — keyed dedupe on event ID seen in last N hours.
- **Per-entity ordering is best-effort:** for ordered streams (chat thread, activity log render), include a server-assigned monotonic sequence number, not relying on event delivery order.
- **Idempotency test in CI:** run every handler twice with the same input; assert state is identical after one and two runs. Run them out of order; assert state is correct.
- **Same applies to webhooks (§18 rule 5: "Webhook handling must be idempotent").**

**Warning signs:**
- A `plugin_state` row update count grows by 2 instead of 1 on a single underlying event.
- A bulletin lists the same artifact twice.
- A chat message bubble appears twice in the thread (different timestamps but same content).
- `plugin_job_runs` shows the same `(plugin_job_id, trigger="schedule")` row succeeding twice within a minute.

**Phase to address:**
Phase 1 — every event handler must have an idempotency test from day 1. Cross-cutting concern.

**Sources:** PLUGIN_SPEC.md §13.5 ("at least once"), §17.5 ("Failed jobs are retryable"), §18 rule 5 ("Webhook handling must be idempotent").

---

### Pitfall 16: PLUGIN_SPEC.md §19 SPA navigation — clarity-pack uses raw `<a href>` and forces full page reload

**What goes wrong:**
PLUGIN_SPEC.md §19.0.1 has a paragraph that's easy to skim past:
> "Plugin links should prefer `linkProps()` so anchors keep real `href` values for copy-link, modifier-click, middle-click, and open-in-new-tab behavior while plain left-clicks route through the host SPA router. **Plugin UI should not use raw same-origin `href`s or `window.location.assign()` for internal Paperclip navigation because those can force a full document reload.**"

The mockups have many `<a href="#">` links and breadcrumbs (the Reader view crumbs: "BEAAA / Issues / Pricing methodology / BEAAA-148"). If clarity-pack ports these to React with raw `<a href="/issues/...">`, every click reloads the host shell, which:
1. Re-mounts the entire host UI including Eric's other open work.
2. Loses the chat thread scroll position, the Situation Room poll state, and any unsaved chat composer text.
3. Is dramatically slower than SPA nav.
4. Coexistence guarantee #2 ("Original UI never replaced") is technically intact, but the *experience* of navigating from clarity-pack back to classic feels broken.

**Why it happens:**
The mockups are static HTML; `<a href>` is the natural primitive. Devs port 1:1.

**How to avoid:**
- **Mandatory: every internal Paperclip link uses `useHostNavigation().linkProps(to)`** (per §19.0.1). Lint rule against raw `<a href="/...">` for paths starting with `/api`, `/issues`, `/projects`, `/agents`, `/settings`, or any host route.
- **External links (e.g., the Bulletin's "beaaa.io/methodology" footnote, font CDN — wait, see Pitfall 4) use raw `<a target="_blank" rel="noopener">`.**
- **Scroll position preservation:** when clarity-pack itself navigates between its surfaces (Reader → Situation Room), use the host SPA router via `useHostNavigation().navigate()`.
- **Test:** on every internal link click, assert the host shell DOM root is unchanged (no full reload).

**Warning signs:**
- A breadcrumb click reloads the page (browser back button shows two entries instead of one).
- The chat composer text is lost when the user clicks an `@`-mention link.
- Lint passes but `<a href` appears in clarity-pack source.

**Phase to address:**
Phase 1 (Reader view breadcrumbs and ref chips have the most internal links). Establish the lint rule before Phase 1 ships.

**Sources:** PLUGIN_SPEC.md §19.0.1 (the SPA navigation paragraph — easy to miss).

---

### Pitfall 17: PLUGIN_SPEC.md §11 (current implementation caveats) — `apiRoutes` JSON-only and cannot shadow core

**What goes wrong:**
PLUGIN_SPEC.md §11 has a small but lethal clause:
> "Scoped plugin API routes are JSON-only and must be declared in `apiRoutes`. They mount under `/api/plugins/:pluginId/api/*`; plugins cannot shadow core API routes."

For clarity-pack this means:
- **All non-bridge calls to plugin-owned data go through `/api/plugins/clarity-pack/api/*`.** Not `/api/clarity-pack/...` (which would 404). Not `/api/issues/extra-summary` (which collides with core).
- **Streaming responses are not allowed via `apiRoutes`** — the spec says JSON-only. So if the chat surface wanted to stream LLM responses via SSE for the Editor-Agent's reasoning panel, the bridge `getData` is the only path, and it returns a single response, not a stream.
- **Plugins cannot intercept core API calls.** A naïve "wrap `/api/issues/123` to add the TL;DR" doesn't work — only the bridge `getData("tldr", { issueId })` does.

The mockups don't make any HTTP calls explicit, but the implementation will need decisions on each call site.

**Why it happens:**
"JSON-only" is one phrase in §11. SSE/WebSocket streaming is an obvious implementation choice for live surfaces and gets reached for naturally.

**How to avoid:**
- **Live updates via polling-with-cache, not streaming.** Situation Room: 60s poll with content-hash diff (Pitfall 7's primitive). Chat: 5s poll for new messages (or longer with pagination on user scroll). No SSE on `apiRoutes`.
- **If streaming is genuinely needed**, the host bridge would need extension — file a Paperclip issue rather than work around it.
- **`apiRoutes` are scoped under `/api/plugins/clarity-pack/api/*`** — document each route in SPEC.md with its `routeKey`, `method`, `auth`, `capability`, `path`. Auth/cookie headers are *not* forwarded to the worker (§14.1) — so the worker cannot impersonate the user for downstream calls; it must use its own capability-gated SDK.
- **Naming:** all clarity-pack route keys prefixed `cp-` (e.g., `cp-bulletin`, `cp-tldr-recompute`) to avoid future collision when adding routes.

**Warning signs:**
- A plugin route returns `Content-Type: text/event-stream` — fails the JSON-only rule.
- A plugin route mounted at `/api/...` (without the `plugins/clarity-pack/api/` prefix).
- The worker's `onApiRequest` reads cookie headers — they're not forwarded (§14.1).

**Phase to address:**
Phase 1 — establish route convention.

**Sources:** PLUGIN_SPEC.md §11 (current implementation caveats — the apiRoutes JSON-only clause); §14.1 ("Only safe request headers are forwarded; auth/cookie headers are never passed to the worker").

---

### Pitfall 18: PLUGIN_SPEC.md §15.3 capability upgrade gate — stuck `upgrade_pending` blocks routine ops

**What goes wrong:**
PLUGIN_SPEC.md §15.3:
> "If a plugin upgrade adds capabilities: the host must mark the plugin `upgrade_pending`; the operator must explicitly approve the new capability set; the new version does not become `ready` until approval completes."

For clarity-pack v1 → v1.1, if you forgot a capability in v1 and add it in v1.1 (e.g., need `events.emit` to publish plugin-namespaced events for cross-clarity-pack coordination), the upgrade *blocks* until Eric clicks "approve." But:
- Eric is the operator AND the user. If he upgrades while traveling and misses the approval prompt, clarity-pack is stuck in `upgrade_pending` — the *new* worker is not running. Existing data is intact, but nothing compiles, no bulletin ships, no chat message goes through.
- §25.4.3 says hot upgrade "completes without operator interaction" if no new capabilities are added. So adding capabilities is the regression that causes operator friction.
- The worse mode: operator clicks "approve" without reading the new capability list. Now clarity-pack has any capability it asked for (e.g., `webhooks.receive` it didn't actually need), expanding the trust footprint silently.

**Why it happens:**
- Capability planning is hard at v1 — you don't know what you'll need at v1.1.
- Approval prompts are dismissed without reading.

**How to avoid:**
- **Over-declare at v1, within reason.** Declare every capability that any of the four surfaces *might* need across Phase 1–4. This avoids `upgrade_pending` on every release. Don't declare `webhooks.receive` if Phase 4 doesn't actually need it — but do declare `events.emit` if any cross-surface event could plausibly fire.
- **Document capability rationale in SPEC.md.** Each declared capability has one sentence explaining why it's needed. This makes the v1.1 audit "did we actually need to add this?" possible.
- **Re-declare capabilities at v1 boundary.** Capability changes between minor versions should be rare and intentional. If §15.3 fires, treat it as a process failure — could the capability have been declared earlier?
- **Operator UX:** when an upgrade is `upgrade_pending`, surface that prominently in the host's plugin list (per §24.1) so Eric sees it on next login.

**Warning signs:**
- `upgrade_pending` status persists for >24h.
- v1.1 release notes include "added X capability" — should be rare.
- Approval prompt lists more capabilities than the release notes mentioned.

**Phase to address:**
Phase 1 — declare full v1 capability set with rationale. Phase 4 (Clipmart) — re-audit the capability list before public submission.

**Sources:** PLUGIN_SPEC.md §15.3, §24.1, §25.4.3.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline raw `:root` CSS variables from mockups into a global stylesheet | Fast port of mockup look-and-feel; fewer files | CSS bleed into host UI; coexistence guarantee #2 violated; visual regression nightmare | **Never**. Always scope to `[data-clarity-surface]`. |
| Use `setInterval(fn, 60_000)` for Situation Room polling | 1-line implementation | Tab-discard wake-up storms, no dedupe across tabs, polls during plugin disable | **Never** — wrap in lifecycle-aware primitive on day 1. |
| Cache LLM-generated TL;DRs in `plugin_state` without `schemaVersion` field | Less code | v1.1 read path can't distinguish v1 vs v2 cache; data corruption on upgrade | **Never** — schemaVersion is a one-line cost. |
| Skip cycle detection in blocker chain resolver because "BEAAA fixtures are acyclic" | Faster Phase 1 demo | Production cycle causes infinite recursion → Editor-Agent OOM | **Never** — cycle detection is 5 LOC. |
| Render `<a href="/issues/123">` for ref chips | Mockup ports cleanly | Full page reload on every click; loses chat composer state, scroll positions | **Never** — use `useHostNavigation().linkProps()`. |
| LLM-generate the bulletin in one prompt, no verifier pass | Faster Phase 2 ship | Hallucinated metrics; trust collapses on first wrong number | Acceptable in Phase 1 TL;DR demo *only*; never for Phase 2 Bulletin. |
| Optimistic chat UI updates that survive failed sends | Snappy chat UX | Messages appear sent but never persist → divergence | Only with rollback-on-failure + retry affordance. |
| Skip BroadcastChannel cross-tab coordination | Less code | 3x polling cost when 3 tabs open; thundering herd at scale | Acceptable for v1 with single-user (Eric only) audience; revisit before Clipmart. |
| Use `fetch()` to call Paperclip APIs from clarity-pack UI | Less SDK boilerplate | Capability bypass; Clipmart-blocking; supply-chain attack surface | **Never** — bridge only. Lint rule. |
| Trust LLM to choose the terminal in a blocker chain | Prose reads natural | Wrong terminal → user pings wrong person → trust loss | **Never** — deterministic walk; LLM only writes prose. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Paperclip `ctx.issues` SDK | Loop over IDs, calling `ctx.issues.get` once per ref | Use `ctx.issues.getSubtree` or batch via repeated calls in a single `getData` round-trip; cache TTL'd resolutions |
| `ctx.events.on('issue.updated', ...)` | Handler treats every event as fresh; non-idempotent write | Dedupe by event ID + entity ID; upsert by deterministic key |
| Plugin manifest `apiRoutes` | Use it for SSE/streaming or to wrap a core route | JSON-only; mounted at `/api/plugins/clarity-pack/api/*`; never shadow core |
| `instanceConfigSchema` for the user opt-in toggle | Store `enabled: true` as default in schema → all existing users opted in | User-scoped `plugin_state` row, absence = disabled; default false |
| `ctx.issues.requestWakeup` | Call on every Editor-Agent compile to "ping" the next agent | Only call when there's a real blocker resolution; respects host heartbeat semantics, terminal-status, blocker, assignee, and budget hard-stop checks |
| Work-product service for chat attachments | Assume it exists; upload to it; fall back silently | Pre-flight capability check; disable attach button if absent with explicit error |
| `ctx.activity.log.write` for Editor-Agent compiles | Forget `actorType: "plugin"` and `sourcePluginId` | Always tag plugin-originated mutations per §21.4; required for audit |
| `useHostNavigation()` for breadcrumbs | Use raw `<a href>` from mockup port | `linkProps(to)` for internal; raw `<a target="_blank" rel="noopener">` for external |
| Cron-style scheduled bulletin (06:30 ET) | Declare cron in manifest in UTC; assume DST is auto-handled | Worker-side timezone-aware next-due-at in `plugin_state`; `date-fns-tz` or `luxon` for ET; idempotent fire |
| Plugin worker `shutdown()` (§12.5) | In-flight bulletin compile interrupted; partial result persisted | Transactional compile: write to `bulletin_drafts`, commit-flag only on success; handle `shutdown` by aborting and rolling back the draft |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 reference resolution on Reader view | Page paint > 1s; serial network calls in dev tools | Batch resolver: collect all IDs, single `getData("resolve-refs", { ids })`, React context for distribution | Reader view with 15+ refs (real BEAAA tasks per the mockup pattern have ~6 visible + transitive) |
| Polling thundering herd from N tabs | Editor-Agent token spend scales with tab count | BroadcastChannel leader election + visibility-aware pause + worker-side content-hash cache | 3+ open tabs (already realistic for laptop+monitor+phone) |
| LLM context blowup on transitive blocker chain with cycle | Editor-Agent run duration > 5min; token spend per run grows; eventual OOM/budget cap | Deterministic graph walk with cycle detection; LLM only writes prose around fixed terminals | First production cycle in BEAAA's task graph |
| Reader view TL;DR re-fires on Editor-Agent's own write | Self-loop: TL;DR regen → write → `issue.updated` → TL;DR regen | Filter `actor_type=plugin AND actor_id=clarity-pack-editor-agent` from event triggers (§16.1) | Day 1 — must be in place before first compile |
| Bulletin compile re-reads full activity log on retry | 3 retries = 3x token cost for a failed bulletin | Idempotency key on `(date, content_hash)`; cache partial results | First retry-triggering failure (network blip, OpenAI 429) |
| Activity timeline rendering all events back to project start | Slow scroll on long-running BEAAA project | Pagination + virtualized list; default to last 7d | After ~3 months of project history |
| `plugin_state` row count grows monotonically (no purge) | Postgres slow on plugin queries; `pg_stat_user_tables` shows clarity-pack table bloat | TTL-based cleanup job: TL;DR cache > 30d → purge; bulletin > 1y → archive | After ~6 months |
| Heartbeat orphan timeout | Editor-Agent stuck in `running` indefinitely; new compiles blocked | Watchdog timeout enforced by host (per Paperclip issue #5123 fix) — clarity-pack must respect host's `shutdown()` deadline (§12.5) | Network partition or worker hang |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Use raw `fetch('/api/issues/...')` from clarity-pack UI bundle | Capability bypass — bypasses worker capability gate; plugin UI can call any host API the user's session permits, including `approval.decided` and `budget.override` (forbidden capabilities §15.2 are unenforced from UI) | Mandatory bridge-only via `usePluginData`/`usePluginAction`; ESLint rule fails CI on raw fetch to host paths |
| Untrusted transitive npm dependency runs `fetch` to external URL | Data exfiltration of session-scoped data Eric can see (BEAAA financials, customer data) | Pin lockfile; monthly `pnpm audit`; license + author review; no `postinstall` scripts; CSP-ready bundle (no external font/image CDN) |
| Reference resolver returns title/quote of an issue the viewer doesn't have permission for | Permission leak via cross-reference resolution | Worker-side permission check *per-viewer* before returning resolved content; `RESTRICTED` status when denied; UI renders `[restricted]` chip with no metadata |
| Editor-Agent compile output writes secret-ref contents to bulletin or audit log | Secret material persists in `plugin_state`, `plugin_job_runs`, or activity log | Per §22 rules 4: never write resolved secrets to plugin config, activity logs, webhook deliveries, or error messages; sanitize LLM input before prompting |
| Chat composer renders user-provided markdown with HTML passthrough | XSS via `<script>` or `<iframe>` injected by a malicious user (or a malicious agent — agents speak in chat too) | Strict markdown renderer with allow-list (no raw HTML); attachment filenames escaped; no `dangerouslySetInnerHTML` |
| Editor-Agent capability set exceeds standard agent's | Coexistence guarantee #4 violated; governance parity broken | Acceptance test asserts Editor-Agent's declared capabilities equal the canonical "standard agent" set; PR review red flag on any capability addition to Editor-Agent |
| Plugin event handlers process events outside the user's company scope | Cross-company data leak in multi-company instances | Event filter at subscribe time (§16.1) by `companyId`; verify in CI fixture with two companies |
| `getData` handler returns full `plugin_state` row including internal fields | Internal Editor-Agent reasoning, prompt content, or cached secrets leaked to UI | Explicit DTO shape per data key; never `return state.value_json` directly |
| Attachment work-product upload accepts arbitrary MIME / size | DoS via huge upload; malicious file persisted | Allowlist MIME types (image/*, application/pdf, text/*, application/vnd.openxmlformats-*); size cap (10MB? 50MB?); virus-scan hook (future) |
| User input in chat composer interpolated into Editor-Agent LLM prompt | Prompt injection — user crafts a message that overrides system prompt and exfiltrates internal reasoning | Treat all user-typed content as data, never instruction; clear delimiters in the prompt template; defense-in-depth (separate "user message" tool from "instruction" tool) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "As of 13:42 ET" timestamp doesn't update when polling fails | User acts on stale state; trust collapses | Three-state status pill (Live/Stale/Failed); explicit "stale 4 min" badge |
| Bulletin date defaults to last successful compile silently | User sees yesterday's bulletin thinking it's today | Explicit "Today's bulletin failed; showing yesterday. [Retry]" banner |
| Reader view tab appears even when user hasn't opted in | Tab strip shows feature the user can't use | Tab visible with "Enable Clarity Pack in your profile" CTA; clear discovery path |
| Critical-path entry says "you" when the user already acted | False urgency; user feels gaslit | Subscribe to action events; recompute chain on `issue.updated`/`approval.decided`; show resolution timestamp |
| Chat optimistic update persists after send failure | User believes message sent; agent never received | Roll back UI bubble on failure; show retry affordance |
| Editor-Agent's own writes spawn user notifications | Noise: "TL;DR was updated" notifications fire for every keystroke in source | Filter Editor-Agent writes from notification triggers; opt-in for power users |
| Dark editorial palette in clarity-pack vs. classic Paperclip palette | Visual whiplash navigating between surfaces | Honor the host's design tokens for navigation chrome; clarity-pack's palette only inside the surface body (`[data-clarity-surface]`) |
| Bulletin's paper-cream palette visible during transition to/from classic UI | Half-second flash of unstyled content (FOUC) | CSS scoped to surface containers; route-level boundary explicitly resets to host palette |
| User can't distinguish Editor-Agent's prose from a real human's comment | Subtle hallucinations passed off as authoritative | Persistent "auto-summary" badge; Editor-Agent footer attribution; "Show reasoning" panel (mockup pattern) for transparency |
| Disabling clarity-pack via toggle vs. uninstalling has different effects, both invisible | User confused by what each action does | Settings page lists both with explicit consequences: "Disable: hides views, stops compute, preserves data" / "Uninstall: stops everything, data preserved 30 days" |

## "Looks Done But Isn't" Checklist

- [ ] **Reader view tab visible:** verify it appears as ADDITIONAL tab, original tabs untouched (coexistence guarantee #2). Verify tab content renders an opt-in CTA when user hasn't opted in (Pitfall 5).
- [ ] **Situation Room recompute:** verify polling pauses on tab hide; verify dedupe across tabs (BroadcastChannel); verify content-hash cache fires; verify "stale" badge appears after 90s of failure (Pitfall 7, 8).
- [ ] **Critical-path resolution:** verify deterministic terminal selection; verify cycle detection with a test fixture; verify "locked-artifact" doesn't render as actionable terminal; verify recompute fires on `issue.relations.updated` (Pitfall 13).
- [ ] **Bulletin 06:30 ET:** verify CI test of DST transitions (March, November); verify idempotent on duplicate fire; verify date-stamp prominent in masthead (Pitfall 9).
- [ ] **Bulletin numbers grounded:** verify every number cites an underlying query result; verify verifier pass; verify errata workflow exists (Pitfall 10).
- [ ] **Chat message dual-write:** verify `issue_comments` row exists for every chat bubble; verify edit semantics (Pitfall 11); verify message_uuid idempotency.
- [ ] **Reference resolution:** verify N+1 batched into one round-trip; verify permission check per-viewer; verify `[restricted]` chip rendering; verify cycle detection (Pitfall 12).
- [ ] **TL;DR verbatim:** verify every digit/proper-noun in TL;DR appears in source (CI invariant test); verify "auto-summary" badge always visible (Pitfall 14).
- [ ] **Idempotency:** verify every event handler tested with duplicate input → identical state (Pitfall 15).
- [ ] **SPA navigation:** verify every internal link uses `linkProps`; verify lint rule against raw `<a href>`; verify breadcrumb click doesn't reload page (Pitfall 16).
- [ ] **Capability footprint:** verify declared capability list matches SPEC.md rationale; verify Editor-Agent's set equals "standard agent"; verify no v1.1 surprise additions (Pitfall 18).
- [ ] **Plugin disable:** verify all polling stops; verify open WebSockets/SSEs close; verify Editor-Agent's in-flight compile aborts and rolls back; verify `plugin_state` byte-equal pre/post (Pitfall 1, 2).
- [ ] **CSS scope:** verify visual regression of host classic dashboard with clarity-pack installed-and-toggle-off matches plugin-uninstalled (Pitfall 4).
- [ ] **No raw `fetch` from UI:** verify ESLint rule passes; verify bundle analysis shows no external network (Pitfall 3).
- [ ] **Activity log attribution:** verify every Editor-Agent mutation writes `actorType: "plugin"`, `sourcePluginId: "clarity-pack"`, and initiating-actor metadata (§21.4).
- [ ] **Opt-in toggle gating:** verify user-scoped `plugin_state` absence = disabled (default OFF); verify zero Editor-Agent compute fires before opt-in (Pitfall 5).
- [ ] **Token caps:** verify Editor-Agent has hard `max_tokens` per call AND per-day budget cap AND circuit breaker on 3 consecutive failures (Pitfall 6).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Plugin disable left orphaned WebSocket leaking on user tabs | LOW | Push a UI hotfix that listens to `plugin.uninstalled` event; users reload to pick it up; in the meantime, host returns 410 Gone on the orphaned route to force EventSource error path |
| Schema namespace squatting (two surfaces wrote to the same `plugin_state` namespace) | MEDIUM | Migration job to rename one namespace; backfill verify; flag-flip read paths; coexistence is preserved because no rows deleted |
| CSS bleed into host UI | LOW–MEDIUM | Wrap all clarity-pack styles in `[data-clarity-surface]` scope; visual regression test catches remaining bleeds; deploy as patch |
| Same-origin trust violation (a dependency made an unauthorized fetch) | MEDIUM | Pin or remove the dependency; rotate Eric's session if any data was exfiltrated; audit `request_log` for the dependency's network activity |
| Editor-Agent runaway cost | LOW (with circuit breaker) | Circuit breaker auto-pauses; operator un-pauses after fix; lost compute is sunk cost. Without circuit breaker: HIGH (manual intervention to kill worker, may be too late) |
| Bulletin published with hallucinated number | LOW | Errata page (mockup pattern) — append correction; notify subscribers; trust signal preserved per the mockup's own example |
| Chat dual-write divergence (chat shows N msgs, comments show N-1) | MEDIUM | Reconciliation job: re-read `issue_comments` for chat-topic issue, rebuild client-side cache; surface discrepancy in audit log |
| Wrong terminal in critical-path chain | LOW | Hotfix the resolver's terminal taxonomy; recompute fires automatically on next view |
| DST drift (bulletin fires at wrong time) | LOW | Patch worker's next-due-at calculator; first correct bulletin re-sets the cycle |
| `upgrade_pending` blocking ops because operator missed approval | LOW | Operator clicks approve in `/settings/plugins/clarity-pack`; new worker boots; no data lost |
| Idempotency violation (duplicate bulletin row) | LOW | Manual dedupe by `(date, source_event_id)`; add idempotency key to handler |
| Permission leak via reference resolver | HIGH | Patch resolver to enforce per-viewer permission check; audit which references were leaked to whom; notify Eric/users; rotate any sensitive issue content if needed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 — Orphaned poller after plugin disable | Phase 1 | Plugin lifecycle event subscription test; manual disable-while-tab-open test |
| 2 — Schema namespace squatting | Phase 1 | Disable/re-enable cycle CI test verifies byte-equal `plugin_state` |
| 3 — Same-origin trust footgun (raw fetch bypass) | Phase 1 | ESLint custom rule; bundle network audit; Editor-Agent capability acceptance test |
| 4 — CSS bleed-through | Phase 1 | Visual regression of host classic dashboard pre/post-install |
| 5 — Opt-in toggle not gating rendering | Phase 1 | "Enable Clarity Pack" CTA test; zero-compute-before-opt-in metric |
| 6 — Editor-Agent runaway cost | Phase 1 | Token cap per call; circuit breaker fixture test; cycle detection test |
| 7 — Polling thundering herd | Phase 1 (Situation Room), reverify Phase 2, 3 | Multi-tab dedupe test; visibility-pause test |
| 8 — Stale data masquerading as live | Phase 1 (Situation Room), Phase 2 (Bulletin) | Status pill three-state test; "as of" timestamp drift test |
| 9 — Bulletin DST drift | Phase 2 | CI test fakes system clock to spring-forward and fall-back days |
| 10 — Hallucinated bulletin summaries | Phase 2 | Verifier-pass test; citation-required test; errata workflow test |
| 11 — Chat dual-write divergence | Phase 3 | Reconciliation job test; `issue_comments` byte-match test; failure rollback test |
| 12 — Reference resolver N+1 + permission leak | Phase 1 (Reader view), reverify Phase 2, 3 | Single round-trip test; per-viewer permission test |
| 13 — Wrong critical-path terminal | Phase 1 | Deterministic walk vs LLM walk acceptance test; cycle fixture test |
| 14 — TL;DR transcription drift | Phase 1 | Verbatim-invariant test (every digit in output exists in input) |
| 15 — At-least-once non-idempotent handlers | Phase 1 (cross-cutting) | Every handler: run-twice-same-state CI test |
| 16 — Raw `<a href>` SPA navigation | Phase 1 | ESLint rule; "no full reload" navigation test |
| 17 — `apiRoutes` JSON-only / route shadowing | Phase 1 | Route registry test; `cp-` prefix rule |
| 18 — `upgrade_pending` from late capability addition | Phase 1 (declare comprehensively); Phase 4 (re-audit) | Capability rationale review at v1 lock-in |

## Sources

**PLUGIN_SPEC.md (paperclipai/paperclip/main/doc/plugins/PLUGIN_SPEC.md, fetched via gh API, 1720 lines, 64KB):**
- §11 (Current implementation caveats — same-origin trust, apiRoutes JSON-only)
- §12.5 (Graceful Shutdown Policy — 10s drain + SIGTERM + SIGKILL)
- §13.5 (`onEvent` at-least-once delivery, idempotency requirement)
- §13.8, §13.9 (`getData`, `performAction` bridge methods)
- §14, §14.1 (SDK surface, ctx.issues orchestration APIs, scoped apiRoutes)
- §15.1, §15.2, §15.3 (capability categories, forbidden capabilities, upgrade rules)
- §16, §16.1 (event types — note absence of `comment.updated`; event filtering)
- §17 (scheduled jobs — host as scheduler of record, retry semantics)
- §18 (webhooks — idempotency requirement)
- §19, §19.0.1, §19.0.2, §19.7 (UI extension model, SDK ui subpath, bundle isolation, PluginBridgeError shape)
- §21 (persistence — first-party tables, plugin_state, plugin_entities)
- §21.4 (activity log changes — `actor_type: plugin`)
- §22 (secrets handling rules)
- §25 (uninstall/upgrade/hot lifecycle — 30-day retention, `--purge` flag)
- §29.1, §29.2 (API version rules, SDK versioning)
- §30 (recommended delivery order — clarifies what's Phase 1 in the spec's own terms)

**Paperclip GitHub issues/PRs (closed; real-world plugin experience):**
- [PR #4738 — feat: complete documented plugin lifecycle event plumbing](https://github.com/paperclipai/paperclip/pull/4738) (CAS-guarded run lifecycle transitions; informs Pitfall 1, 6)
- [PR #5205 — Expand plugin host surface](https://github.com/paperclipai/paperclip/pull/5205) (plugin-managed DB namespaces ADDED to host surface; informs Pitfall 2)
- [Issue #5123 — Fix external heartbeat orphan timeout race](https://github.com/paperclipai/paperclip/pull/5123) (informs Pitfall 1)
- [Issue #4954 — Raise agent heartbeat concurrency default](https://github.com/paperclipai/paperclip/issues/4954) (informs Pitfall 6)
- [Issue #5096, #4952 — Retry max-turn exhausted heartbeats (codex)](https://github.com/paperclipai/paperclip/pull/5096) (informs Pitfall 6, 15)
- [Issue #5326 — Serialize sandbox callback bridge against concurrent heartbeats](https://github.com/paperclipai/paperclip/pull/5326) (informs Pitfall 15)
- [Issue #4233 — Harden heartbeat runtime cleanup](https://github.com/paperclipai/paperclip/pull/4233) (informs Pitfall 1)

**Industry / generic patterns:**
- Cost runaway: [How to Stop AI Agent Cost Blowups (DEV)](https://dev.to/sapph1re/how-to-stop-ai-agent-cost-blowups-before-they-happen-1ehp); [CrewAI vs LangGraph vs AutoGen (DataCamp)](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- Schema migration: [Strapi schema-data-loss issue #19141](https://github.com/strapi/strapi/issues/19141); [Shopware destructive migration on plugin uninstall #553](https://github.com/shopware/shopware/issues/553); [Schema evolution without data loss (buildwithmatija)](https://www.buildwithmatija.com/blog/schema-evolution-without-data-loss); [Atlassian Forge data lifecycle](https://developer.atlassian.com/platform/forge/storage-reference/hosted-storage-data-lifecycle/)
- Polling/thundering herd: [Cloudflare Sept 12 2025 dashboard outage post-mortem](https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/); [UX strategies for real-time dashboards (Smashing 2025)](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/)
- Hallucination: [Hallucination detection and mitigation framework for faithful summarization (Nature 2025)](https://www.nature.com/articles/s41598-025-31075-1); [LLM hallucination examples (factors.ai)](https://www.factors.ai/blog/llm-hallucination-detection-examples)
- DST/cron: [When DST broke our cronjobs (Medium)](https://medium.com/@rudra910203/when-daylight-savings-time-broke-our-cronjobs-in-3-different-ways-ee3ce525904f); [Handling Timezone Issues in Cron Jobs 2025 Guide (DEV)](https://dev.to/cronmonitor/handling-timezone-issues-in-cron-jobs-2025-guide-52ii); [node-cron issue #56](https://github.com/kelektiv/node-cron/issues/56); [Sentry cron timezone issue #66763](https://github.com/getsentry/sentry/issues/66763); [Red Hat cron + DST guide](https://access.redhat.com/solutions/477963)
- Dual-write/reconciliation: [Real-Time Event Stream Reconciliation Pattern (Medium)](https://medium.com/@rajesh1.ojha/real-time-event-stream-reconciliation-pattern-35d2ba949da6); [Chatbot message persistence (getstream)](https://getstream.io/glossary/chatbot-message-persistence/)
- CSS isolation: [Why we abandoned the iframe (OpenWeb)](https://www.openweb.com/blog/why-we-decided-to-abandon-the-iframe/); [Encapsulating style with Shadow DOM (CSS-Tricks)](https://css-tricks.com/encapsulating-style-and-structure-with-shadow-dom/); [Styles isolation in microfrontends (Bitko)](https://alexbitko.medium.com/styles-isolation-in-microfrontends-with-react-including-material-styles-5f5cde4a724e)
- Watchdog/heartbeat: [Linux softlockup/hardlockup detector docs](https://docs.kernel.org/admin-guide/lockup-watchdogs.html); [Envoy issue #614 (deadlock detection)](https://github.com/envoyproxy/envoy/issues/614)
- Cycle detection: [Dependency graph & cycle detection (Wikipedia)](https://en.wikipedia.org/wiki/Dependency_graph)

**Local artifacts (read in full):**
- `.planning/PROJECT.md` (constraints, six coexistence guarantees, key decisions)
- `.planning/PRIOR-DECISIONS.md` (locked decisions before /gsd:new-project)
- `sketches/paperclip-fix-task-detail.html` (Reader view; ref chips, TL;DR, blocker callout)
- `sketches/paperclip-fix-situation-room.html` (Situation Room; critical path, agent grid, artifact shelf, footer "Compiled by Compiler-Agent · Next compile · 13:43 ET (live)")
- `sketches/paperclip-fix-bulletin.html` (Bulletin; "Requires Your Decision" inbox, lineage thread, errata pattern, "Quiet alert: Researcher-Agent at 91% of weekly token cap")
- `sketches/paperclip-fix-employee-chat.html` (Chat; topics, reasoning panel, attachments, "Storage pin · all messages persist as issue comments · attachments as work-products · single source of truth")

---
*Pitfalls research for: Paperclip plugin (clarity-pack)*
*Researched: 2026-05-07*
