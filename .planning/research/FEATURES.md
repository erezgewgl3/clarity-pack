# Feature Research

**Domain:** Paperclip plugin (`clarity-pack`) — four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) + Editor-Agent on top of Paperclip's agent-driven org chart.
**Researched:** 2026-05-07
**Confidence:** MEDIUM-HIGH (sketches are authoritative for IA; external claims grounded in product docs and community sources, all cross-checked)

---

## How To Read This Document

Four surface categories, each scored on the same axes:

1. **Table stakes** — must have or users immediately bounce.
2. **Differentiators** — premium feel, the reason Eric picks Clarity Pack over staying in classic Paperclip.
3. **Anti-features** — deliberately NOT built; explicit Out of Scope candidates.
4. **Complexity ceiling** — what's hard, what's easy in this domain.

After the four sections, a **Cross-Surface Reuse** section identifies primitives shared across multiple surfaces — these are the architecturally important shapes for the plugin core. The MVP, dependency, and prioritization sections close.

The four `sketches/` HTML mockups are treated as the visual + IA contract. Every claim below has been cross-checked against them.

---

## Surface A — Task Detail Reader View

**Examples surveyed:** Linear Peek preview, Linear issue Quick Look (Cmd+K), GitHub issue smart preview / hovercards (incl. github-hovercard ext), Jira parent/child rollup, Height task summary, Notion references-resolved view, Plane.so summary tab.

### A.1 Table Stakes (must have)

| Feature | Why Expected | Complexity | Mockup evidence |
|---|---|---|---|
| **Plain-English TL;DR at top** | Linear/Plane/Notion all open with a summary header; if Reader view is "just the issue body again" users abandon. | MEDIUM | `paperclip-fix-task-detail.html` lines 333–343 (`.tldr` strip with `tldr-lbl` "TL;DR · auto-summary" and label "_This summary is regenerated each time the task body changes_"). |
| **Inline reference resolution** | GitHub auto-augments `#3888` with title; Linear hovercards show status+assignee+description without click. Without this, the "rabbit hole" complaint persists. | MEDIUM-HIGH | `.ref-inline` chips throughout (e.g., line 358 `BEAAA-141 · In review`); full `.ref-card` with quote excerpt at 442–488 ("Anchored to (resolved)"). |
| **Status pill + state at a glance** | Linear/Jira/Plane all show issue state in header; users won't scroll to find it. | LOW | `.state-big.warn` "In progress · Stuck on you" at line 321; `.priority` "High priority". |
| **Owner / assignee identity** | Standard across every issue tracker since 2010. | LOW | `.by` "Owned by **CFO · Capital agent**" at 325. |
| **Acceptance criteria checklist with state** | Plane/Linear/GitHub Tasks all surface AC; without it the "what is done" question stays open. | MEDIUM (auto-status is harder than checklist) | `.ac-list` at 498–519, with `.ac-mark` done/partial/todo states. |
| **Activity timeline (truncated)** | Linear timeline sidebar, Jira "Activity" tab — table stakes for "what happened recently". | LOW | `.timeline` panel at 562–569. |
| **Breadcrumb to project / parent** | Linear, Jira, Plane all expose hierarchy ancestry. Goal-ancestry orientation is in `PROJECT.md` Surface 1 line item. | LOW | `.crumbs` at 309–314 (BEAAA / Issues / Pricing methodology / BEAAA-148). |
| **Open in classic UI escape hatch** | Coexistence guarantee #2 (Reader view never replaces classic). Users will need it for edit-heavy actions. | LOW | Implied by the additional-tab model in `PROJECT.md`; not literally a button in mockup but enforced by tab placement. |

### A.2 Differentiators (competitive advantage)

| Feature | Value Proposition | Complexity | Mockup evidence |
|---|---|---|---|
| **Resolved-reference quote cards** (not just link previews) | Linear hovercards show metadata only; Clarity Pack shows the *substantive quote* relevant to this task ("Capital charge fixed at 14.5% of net written premium…"). This is the "no rabbit hole" payoff. | HIGH (requires the Editor-Agent to extract the right excerpt, not just title+status) | `.ref-card` at 441–488: quote-block excerpts pulled from referenced issues, with `quote::before/::after` curly quotes. Each card has owner+status+excerpt. |
| **Deliverable preview inline** (the actual artifact, not a "view file" link) | No competitor renders the artifact's contents in the issue page. This is the "where does it live, what's in it" answer in one glance. | HIGH (XLSX preview is non-trivial; markdown/text easier) | `.deliverable` at 400–430: live XLSX preview with section headers + a 4-row table of cluster × trigger × commission deltas. |
| **Live-blocker callout with one-click resolution buttons** | Most "stuck" issues require navigating to a question/sub-task. The mockup puts decision buttons inline ("12% — accept CFO recommendation" / "15% — keep deck rate"). | MEDIUM (needs governance/audit hooks) | `.ref-card` styled with alert color at 371–389: "⚑ ON YOU" + "Confirm broker-comm % (12% vs 15%)" + 3 inline buttons. |
| **Auto-tracked AC with evidence link** | Plane/Linear have AC; few link AC state to *which artifact section* satisfies it. The "Met / Partial / Blocked" states are sourced from work-product not user check-off. | HIGH (requires Editor-Agent reasoning over the deliverable) | `.ac-item.partial` at 510 references "capital charge applied; final QA pending sec. 4 close" — implying AC state is computed, not checked. |
| **Downstream impact strip** | "Closing this clears 5 tickets" — Linear shows blocking-relationships; mockup goes further by listing them inline as ref-chips. | MEDIUM | "Downstream impact" panel at 571–576: 5 ref-chips of issues that auto-clear. |
| **Goal-ancestry breadcrumb** (project + milestone) | Beyond just the parent issue — links to milestone date ("Tier-ladder lock · 12 May"). Most trackers show parent only. | LOW | Sidebar "Project" row at 555–557: "Pricing methodology v1 · milestone: Tier-ladder lock · 12 May". |
| **Editor-Agent attribution + freshness stamp** | Anti-hallucination posture — every AI-generated section says when it was generated and from what. | LOW (cosmetic) | TL;DR italic line "_This summary is regenerated each time the task body changes_" at 341. |

### A.3 Anti-features (deliberately NOT built)

| Anti-feature | Why Tempting | Why Bad | Mockup-grounded alternative |
|---|---|---|---|
| **Hide edit affordances entirely** | Mockup is reader-style and read-feels-clean. | Users will still want to comment, reassign, escalate. Mockup *includes* `.btn.you "⚑ Answer for CFO"` and `.btn.ghost "Reassign · escalate · close"` at 328–330. Pure read-only would force a tab-switch back to classic for any action. | Keep targeted action buttons (decide / reassign / escalate / close) inline. Edit-the-issue-body actions stay in classic. |
| **Replace classic issue tab** | "Reader view is so much better, why have classic?" | Coexistence guarantee #2 is hard. Classic is the canonical edit/admin surface; Eric's daily flow on BEAAA must not break. | Reader view is an *additional* tab; classic is the default landing. Confirmed in `PROJECT.md` line 30, 41, 98. |
| **AI summary without source links / freshness** | Cleaner visual, fewer stamps. | Hallucination risk per LLM-summarization research; users lose trust the moment they catch one wrong fact. | TL;DR is regenerated on body change (line 341) and AC sections cite the source ("anchored to BEAAA-25 (board-locked)"). |
| **Resolve every reference inline, fully expanded** | "More context = better." | Visual overload; defeats the "1 paragraph + 3 ref-cards" rhythm. | Mockup shows 3 ref-cards (lines 442–488) — not all references, just *anchored-to* inputs. Other refs render as `.ref-inline` chips with status only. |
| **Real-time collaborative editing in Reader view** | Linear/Notion-style live cursors. | Out of scope for plugin — Paperclip core owns issue mutation. Plugin runs same-origin and could call APIs, but doubling the edit path creates conflict-resolution misery. | Reader view is read-mostly. Mutations route through classic Paperclip APIs; chat surface owns conversational mutations. |
| **Per-section emoji reactions / engagement metrics** | Slack/Linear comment reactions are loved. | Reader view is a *briefing*, not a discussion. Reactions belong on chat (Surface 4) and on classic comments. | Discussion lives in chat & classic comments; Reader view stays editorial. |

### A.4 Complexity ceiling for Surface A

- **Easy:** breadcrumbs, status pill, owner chip, activity timeline, AC checklist UI shell. (Standard React + shadcn — same as Linear/Plane.)
- **Medium:** inline ref-chip (needs hover / click-to-popover behavior), ref-card with quote extraction (needs an issue→excerpt picker — Editor-Agent does this), TL;DR generator (LLM with grounding to issue body + comments + linked refs).
- **Hard:** deliverable inline preview for arbitrary file types (XLSX live render is non-trivial; markdown/text easy; PDF medium; everything else punts to "Open in app"), AC auto-status (requires reasoning over the deliverable contents — needs explicit AC structure or a constrained AC schema), keeping all of the above fast on a 60s on-view recompute budget.

---

## Surface B — Situation Room (Live-Ops Cockpit for Agent Fleet)

**Examples surveyed:** AutoGen Studio dashboards, CrewAI inspector, LangGraph Studio + LangSmith, Inngest dev server (replay + visual workflow inspector), Temporal Web (Workflow Execution history + flagged-on-task-failure live monitoring), Sema4 / Robocorp Control Room.

### B.1 Table Stakes (must have)

| Feature | Why Expected | Complexity | Mockup evidence |
|---|---|---|---|
| **Live state per agent** (working / stuck / awaiting / idle) | Temporal Web, LangSmith, AutoGen Studio all surface execution state. Without it the cockpit has no "now" axis. | MEDIUM | `.state.live/warn/alert/idle` at 166–169; one card per agent at 405–707. |
| **Last-update / age timestamps** | Every observability tool has them. "Stuck 2d 4h" is the load-bearing signal. | LOW | `.head-time` "stuck<b>2d 4h</b>" at 449; "As of 13:42 ET" topbar at 343. |
| **What the agent is doing right now** (one-liner) | LangSmith trace view shows current node; users need plain-English equivalent. | MEDIUM (needs Editor-Agent / heartbeat to phrase it) | `.now-doing` at 414 ("Reviewing carrier-paper / MGA structure options memo before sending it to you"). |
| **Auto-refresh** (with visible cadence) | Temporal Web auto-refreshes; users distrust dashboards that look static. | LOW-MEDIUM | Topbar "Live ops · auto-refresh 30s" at 333; footer "Next compile · 13:43 ET (live)" at 768. (Note: PROJECT.md line 31 says 60s; mockup says 30s — flag for SPEC.md.) |
| **Click-through to agent / task detail** | Drill-down is universal. | LOW | "click any card to drill into the agent's day" meta at 401. |
| **Counts / meters at top** (working / stuck / awaiting-you) | Every ops dashboard summarizes total state above the fold. | LOW | `.meters` row at 337–341. |
| **Empty-state for idle agent** | Temporal/Inngest both render "no executions" cleanly. | LOW | `.artifact.empty` at 466 ("No new artifact today — idle 6h since reconciliation halt"). |

### B.2 Differentiators (premium feel)

| Feature | Value Proposition | Complexity | Mockup evidence |
|---|---|---|---|
| **Transitively-resolved blocker chain** ending in a single human action | This is *the* Clarity Pack value prop. Temporal/LangGraph show one-hop dependencies; nobody collapses a 6-link chain into "⚑ YOU answer · ~5 min". | HIGH (requires graph traversal + termination at human-actionable node + plain-English step rendering) | `.blocker .chain` at 460–464: "CFO at 60% → CFO waiting on broker-comm % from YOU → Real unblock: confirm broker-comm % to CFO (~5 min)". `.step.terminal` style for human-action node at 211. |
| **Critical path strip** (3 chains across whole org) | Jira critical path requires plugins; nothing surfaces "unblock these → unblock the org" in three sentences. | HIGH (needs whole-graph reasoning) | `.crit` section at 348–394, three numbered chains with arrow notation and impact tail. |
| **"Awaiting You" inbox pill with count + age** | Slack mentions count, Linear inbox count — but tying age to the *org-wide oldest-unanswered* is rare. | LOW (once chain logic exists) | `.inbox-pill` at 87–93 / 345 ("⚑ Awaiting You · 2 · oldest 1d 14h"). |
| **Per-agent velocity bars** (7d delivered) | Most dashboards show throughput in graphs, not 7 mini-bars on the agent card. The micro-format reads at a glance. | LOW (sparkline) | `.vel-bars` at 244–252, "7d 4 / 14" stat at 438. |
| **Artifact shelf** (today's deliverables, previewed inline) | Most dashboards link out to artifacts; the shelf renders italic-serif excerpts ("Reads cleanly at 9pt…") inline. | MEDIUM | `.shelf` section at 718–762, six `.shelf-item` cards with `.shelf-prev` italic excerpts. |
| **Self-resolving annotation** | "Self-resolving — CTO ETA Wed 17:00. No human action needed; agent will auto-resume on artifact arrival." Distinguishes "stuck and stuck-on-you" from "stuck and waiting on a peer agent". | MEDIUM | CBDO card at 596 (`Standing down because…`); critical-path row 3 styled `.crit-row.auto` with green age stamp. |
| **You-action inline mini-actions** (12% / 15% / Open question) | Slack approval bots have buttons; cockpits don't. Mockup makes the answer one click from the cockpit. | MEDIUM (governance + audit hookup) | `.you-action` at 419–427, 492–500. |
| **Color-coded card border tied to state** | Subtle, visual scanability — instantly identifies the alert cards in a 3×3 grid. | LOW | `.card.alert/warn/live/idle` left-border at 147–150. |

### B.3 Anti-features (deliberately NOT built)

| Anti-feature | Why Tempting | Why Bad | Alternative |
|---|---|---|---|
| **Real-time WebSocket push for every event** | "Cockpit must be truly live!" | Paperclip is single-tenant single-node; WebSocket plumbing is heavy and brittle. Decision #2 in `PROJECT.md` already locked: scheduled compile + on-view 60s recompute. | Polling on-view + scheduled background compile. Mockup says 30s, PROJECT.md says 60s — pick one in SPEC.md. |
| **Full event log / Workflow history view** (Temporal-style) | Temporal Web is great at this. | Wrong audience. Eric is a non-engineer founder; he needs plain English, not span trees. The audit log already exists in classic Paperclip. | Classic Paperclip provides audit trail; Situation Room is the *narrative* layer. |
| **Drag-to-reassign / kanban interactions** | Asana/Linear board feel. | Mutation belongs in classic. Cockpit is an observation surface; mixing observation with reassignment creates governance issues (per Decision #6 / coexistence #4). | Reassign button on agent card opens classic flow in modal/new tab. |
| **Per-agent terminal / tool I/O stream** | LangSmith has this; impressive. | Wrong audience again. Eric doesn't read tool calls; the Editor-Agent translates them into the `.now-doing` line. | Distilled "now-doing" + activity timeline; raw I/O lives behind a "Show reasoning" disclosure (matches Surface 4 pattern at chat sketch line 547). |
| **Critical-path widget with a Gantt visualization** | Project-management tools love Gantts. | The mockup deliberately uses three plain-English sentences. Gantt charts force users to *read the chart*; the goal is "read the unblock". | Three numbered prose chains (`.crit-row` 358–392) — already the right answer. |
| **Showing every agent state change as a notification** | "Real-time = engaging." | Notification fatigue. Industry research: aggregating into digest cuts opt-out 43%, raises engagement 31%. | The cockpit *is* the notification surface; the daily Bulletin (Surface C) is the editorial digest. |

### B.4 Complexity ceiling for Surface B

- **Easy:** topbar meters, agent grid layout, state pills, velocity sparklines, artifact shelf cards, click-through wiring.
- **Medium:** "now-doing" plain-English line (per-agent prompt against current task + heartbeat), one-hop blocker description, auto-refresh and on-view recompute timer, you-action button governance plumbing.
- **Hard:** transitive blocker chain reduction (graph traversal + terminal-node detection + readable step prose) — this is the hardest single primitive in Phase 1. Critical-path identification across 9+ agents (must be deterministic enough to not flicker, fresh enough to be useful, cheap enough to recompute every 30–60s on view).

---

## Surface C — Daily Bulletin (Auto-Compiled Editorial Digest)

**Examples surveyed:** Slack AI Daily Recap (Mar 2026 GA — channel-following, AM digest, Recap view), Notion Daily Recap, GitHub For-You / activity digests, ClickUp AI Summary, "Morning Brew"-style internal compilers built on work data.

### C.1 Table Stakes (must have)

| Feature | Why Expected | Complexity | Mockup evidence |
|---|---|---|---|
| **Scheduled delivery, predictable cadence** | Slack Recap is daily AM; the user has a habit slot. Erratic cadence kills the habit. | LOW (cron-like in plugin) | Locked in Decision #2 / `PROJECT.md` (06:30 ET); mockup masthead "Thursday · 7 May 2026 · 06:30 ET" at 244. |
| **Action / decision inbox at top** | Slack Recap shows "you were @mentioned 4 times." Without an action layer, digest is just news. | LOW (UI), MEDIUM (governance for one-click approve) | `.action-inbox` at 250–288: "Requires Your Decision · 02 ITEMS · OLDEST 14h" with two cards and Approve/Decline buttons. |
| **Grouping by department / domain** | Notion Daily Recap groups by workspace; Slack groups by channel. Without grouping it's a wall. | LOW | `.ops-section` headers Production / Sales / Customer / Builder at 297–403. |
| **Standing numbers / metrics block** | Every internal newsletter has KPIs in a sidebar. | LOW | `.panel` "Standing Numbers" at 410–417 (MRR, briefs sent, reply rate, refund rate). |
| **Date stamp + "issue number"** | Editorial conventions — newspaper masthead pattern. | LOW | Masthead "Vol. I · No. 47" at 241; sub-mast "Operations Cycle 47 · Auto-compiled" at 246. |
| **Quiet-day handling** | Empty days break the rhythm; needs graceful prose. | LOW | `.quiet` block at 402: "Quiet day. PRD-12 (Production-agent wrappers around SignalSweep) at 60%. No founder action required." |
| **Editor / "for you" attribution** | Trust-building. | LOW (cosmetic) | "prepared for *Eric G., Editor-in-Chief*" at 245. |

### C.2 Differentiators (premium feel)

| Feature | Value Proposition | Complexity | Mockup evidence |
|---|---|---|---|
| **Editorial voice + design** (Fraunces / Newsreader, drop-cap, double rules, "The Bulletin") | Slack Recap is *useful* but visually bland. Editorial design signals "this was edited, not auto-blasted." | MEDIUM (design system, font loading) | Whole sketch — Fraunces 600 78px masthead, Newsreader serif body, drop-cap on first dept (line 159), double-rule sub-mast at 47, italic byline conventions at 94. |
| **Agent-lineage strip** (one artifact, end-to-end) | No competitor shows the production pipeline as a horizontal node thread per artifact. | MEDIUM (needs structured trace metadata) | `.lineage-foot` at 445–457: 8 nodes (Scout → Classifier → Scorer → Writer → QA → Editor-Agent → Publisher → Subscribers) with timestamps. Inline mini-lineages on each item at 308–315. |
| **Inline lineage on each item** (mini version) | Per-item provenance without the full thread; users see how each thing was produced at a glance. | MEDIUM | Mini-lineage at lines 308–315 ("SCOUT 412 signals → CLASSIFIER 38 candidates → SCORER top-4 → …"). |
| **Agent spend / budget panel with alerts** | ClickUp/Linear don't track API spend; relevant for agent fleet. Mockup quietly flags "Researcher-Agent at 91% of weekly token cap." | LOW (data plumbing exists in Paperclip) | Right rail "Agent Spend · May" at 419–431 with `.bar.warn` and the `.alert` block. |
| **Today's schedule pull-in** | Calendar block at right rail closes the "now what?" loop. | LOW | "Today's Schedule" panel at 433–439. |
| **One-click decision approval inside the digest** | Slack Recap doesn't let you act; it summarizes. Mockup lets Approve & Send happen inside the bulletin. | MEDIUM (governance hooks, audit) | `.action-card .actions` at 265, 280: Approve & Send / Approve Refund / Open Audit Trail. |
| **Compile metadata footer** ("Compiled in 38 seconds from 14 agent ledgers · 0 manual edits") | Trust signal — like a magazine colophon. Reinforces editorial voice. | LOW | `.colophon` at 459–463. |

### C.3 Anti-features (deliberately NOT built)

| Anti-feature | Why Tempting | Why Bad | Alternative |
|---|---|---|---|
| **Push real-time digest updates** | "What if something changes during the day?" | Defeats the daily-cadence-as-habit. Per Decision #2 — Bulletin is scheduled; Situation Room is on-view live. | Bulletin = 06:30 once. Live ops = Situation Room. They're complementary surfaces. |
| **Per-user personalization beyond founder** | "Each agent could have its own digest." | v1 audience is "Eric on BEAAA" (Decision #7). Multi-recipient personalization is a v2 concern at minimum. | Single recipient, single timezone. |
| **Wall of every event reformatted as bullets** | Easier than editorial compilation. | Identified anti-pattern in digest research: "wall of raw notifications reformatted into a single email is just the same noise in a different container." | Editor-Agent does selective compilation: only items worth reading; quiet-day handling for slow domains; lineage threads for high-trust items. |
| **Auto-send to subscribers / Slack / email** | "Recap should ship!" | Out of scope. Bulletin is internal to the Paperclip plugin route. Email/Slack distribution is a v2+ surface. | Bulletin renders at a route; user opens it. |
| **Editor-Agent self-praise lines** ("I summarized 14 ledgers brilliantly!") | LLMs love to do this. | Editorial voice is restrained; the colophon "Compiled in 38 seconds … 0 manual edits" is the right level. | Strip first-person Editor-Agent voice except in the persona-attribution byline. |
| **Mutable past bulletins** | "Edit yesterday if you find an error." | Errata are first-class items in the editorial model. Mockup itself shows "Errata appended to Issue 46 — AcmeSec Pro pricing correction" at line 320. | Errata are a kind of item, not a mutation. |
| **Marketing-flavored hero metrics** ("MRR up 47%!!") | Tempts the digest into vanity. | Standing Numbers panel is intentionally neutral (MRR, briefs sent, reply rate, refund rate — not deltas). | Keep metrics neutral; let the trend bars (`.bar.warn`) flag concerns. |

### C.4 Complexity ceiling for Surface C

- **Easy:** scheduled cron / heartbeat trigger, masthead + section layout, standing numbers panel, schedule pull-in, errata as ordinary item type.
- **Medium:** Editor-Agent prompt design for editorial voice (the hardest *qualitative* problem — bad voice kills trust), action inbox inline approval governance, agent-spend panel data plumbing, quiet-day handling logic.
- **Hard:** lineage threads at scale (need structured trace metadata in the agent activity stream — per-agent emit at handoff), summarization grounding to avoid hallucinated numbers (per LLM-summarization research, even RAG-grounded summaries hallucinate detail; need guardrails: numbers must be quoted from work-products, not generated). Bulletin will need a "facts table" pre-render step that the LLM is forced to source from.

---

## Surface D — Employee Chat (Hybrid Real-Time + Persisted-as-Comments)

**Examples surveyed:** Linear chat-to-issue / threaded comments, GitHub Discussions, Plain "everything is a thread" + Linear integration ("Close the Loop"), Tana DM-to-task, ClickUp Chat, Slack-Linear bridge, Linear Asks.

### D.1 Table Stakes (must have)

| Feature | Why Expected | Complexity | Mockup evidence |
|---|---|---|---|
| **Real-time message UI** (chat-shaped: bubbles, avatars, day dividers, typing rhythm) | Anything else feels like email. Users will bounce within 10s. | MEDIUM | `.messages` scroller at 519–664; `.msg`, `.bubble`, `.day-divider` at 162–195. |
| **Per-employee threads** (one chat per agent) | Slack DMs, Linear Asks per-issue — universal. | LOW | `.roster` left rail at 408–488; one thread per agent. |
| **Persistence** (messages don't vanish on reload / plugin disable) | Per Decision #1 + coexistence guarantee #5: messages persist as ordinary issue comments in classic Paperclip UI. | MEDIUM-HIGH (requires hybrid live + durable model) | "Topic · **Broker comm % decision** (CHT-44)" at 670; "Messages persist as comments on issue · attachments stored in cfo/CHT-44/" at 671. Storage pin at 733–736. |
| **Attachments** (with preview) | Slack/Discord/Teams basic. | MEDIUM | `.attach` at 234–268, with `.attach.image` variant rendering filename + size + storage path. |
| **Search** | Slack global search is the most-used feature. Decision #4: per-employee linear timeline + global search. | MEDIUM (full-text on issue comments table) | `.global-search` in thread head at 498–502, "Search all chats and tasks across BEAAA…" |
| **Composer with send shortcut + draft state** | `Cmd+Enter` is industry standard. | LOW | `.composer-hint` "⌘+↵ to send" at 683. |
| **Timestamps + delivery latency** | Users want to know when something arrived; "auto-replied 14s" reassures. | LOW | `.b-meta .ts` "16:43 · auto-replied 14s" at 542. |
| **Identity disambiguation** (you vs agent) | Bubble alignment + color (you = right + gold-tinted; agent = left + neutral). | LOW | `.msg.me` style at 172, `.bubble`/`.eric-bubble` color at 184. |

### D.2 Differentiators (competitive advantage)

| Feature | Value Proposition | Complexity | Mockup evidence |
|---|---|---|---|
| **Hybrid persistence model** (real-time UI but durable as issue comments + work-product attachments) | Slack messages are siloed; Linear comments are visible everywhere but feel sluggish. Hybrid = best of both. **This is THE chat decision** (Decision #1). | HIGH (dual-write or write-through architecture; must survive plugin disable per coexistence #3) | Composer-meta line "Messages persist as comments on issue · attachments stored in cfo/CHT-44/" at 671; storage pin at 733–736. Attachment metadata includes "stored in cfo/CHT-44/attachments/" at 575. |
| **Topic strip per employee** (multiple parallel chat threads per agent, each = one private issue) | Slack threads-per-channel; nobody scopes by `agent × topic`. The "broker comm decision" thread is a different issue from the "loss-cost prior method" thread. | MEDIUM | `.topics` row at 510–517: 5 topics (CHT-44 active, CHT-39, CHT-31, CHT-22, CHT-14) per CFO. |
| **Inline reference resolution in messages** | The same `.ref-inline` chip from Reader view + Situation Room appears in chat. Cross-surface primitive. | MEDIUM (reuse) | `.b-text .ref-inline` at 198–211, multiple occurrences in CFO messages e.g., "Anchored to BEAAA-25 [Locked]" at 544. |
| **Reasoning panel** (collapsed by default; "Show reasoning · 4 sources, 2 model runs") | LangSmith shows traces; no chat tool exposes agent-side rationale per message. Building trust under governance parity. | MEDIUM | `.reasoning` `<details>` block at 547–557, with sources, sensitivity numbers, recommendation rationale. |
| **Promote-to-task on hover** | Linear chat-to-issue requires explicit slash commands; mockup makes it a hover affordance on every message. | MEDIUM | `.promote` on bubble hover at 282–291 ("↗ Promote to task" / "⚑ Pin"). |
| **One-click decision message** (centered, dashed border, audit-stamped) | Slack approval bots use cards; mockup styles it as a *first-class chat artifact* with audit-trail link to issue. | MEDIUM (governance + audit) | `.decision-msg` at 607–611: "Decision recorded · Eric chose A · 12% … audit trail attached". |
| **Resolution pill** when a chat message produces a real work object | "Created BEAAA-202 · Locked sec. 4 at 12% · Notified CSO + Actuary" — closes the loop visibly. | MEDIUM | `.resolved` / `.resolved.warn` at 271–279; resolution pill at 626 ("Created BEAAA-202 · …"). |
| **Context rail** (right panel: agent card + spend + active tasks + recent attachments + quick actions) | Slack has profile sidebar; nothing combines agent governance state, owed actions, and attachments into one rail. | MEDIUM | `.ctx` rail at 693–739: agent card with budget/spend, active tasks owned, "You owe CFO" highlight, recent attachments, quick actions, storage pin. |
| **Auto-reply delivery time stamp** ("auto-replied 14s") | Distinguishes agent message from human message; useful when agents are heartbeat-driven. | LOW | At 542, 592, 621, 657. |
| **Group threads** (Pricing huddle: CFO · Actuary · Underwriter) | Slack channels do this, but tying it to issue-comment persistence with a cross-agent topic is novel. | HIGH (multi-agent coordination, comment routing) | Roster section "Group threads" at 474–486. |

### D.3 Anti-features (deliberately NOT built)

| Anti-feature | Why Tempting | Why Bad | Alternative |
|---|---|---|---|
| **Real-time chat protocol that does NOT persist to issue comments** | Lower latency, simpler engineering. | **Explicitly out of scope per `PROJECT.md` line 46.** Chat must be durable as ordinary threaded comments — "guarantees data survives plugin disable". | Hybrid model: write to issue comments table immediately; UI optimistic-renders for live feel. |
| **Lose messages on plugin disable** | "Plugin lifecycle is complicated." | Coexistence guarantee #5 makes this a hard fail. Schema is additive-only; chat data IS issue-comment data. | Per-topic issue comments survive disable; only the live-feel UI is gone. |
| **Reactions / emojis as a primary feature** | Slack-style fun. | Out of scope for v1; chat is operational, not social. Discussion isn't the value proposition — *durable decision capture* is. | Defer to v2. Comment threading already supports text, which is enough for now. |
| **Fully separate chat database** | Live-chat rigs (Stream, Sendbird) start here. | Doubles storage; breaks coexistence #3 (additive-only schema). Two sources of truth = decision drift. | Reuse Paperclip's issue + comment + work-product tables. Plugin owns one new join table at most. |
| **Voice / video / call** | Slack-Huddle creep. | Massively out of scope for plugin form factor + single-tenant single-node deployment. | Text only. |
| **Editing past messages without an audit trail** | Slack-style edits feel native. | Comments in Paperclip are auditable; chat-edits-without-audit would be a governance hole (coexistence #4 governance parity for Editor-Agent — and same parity for chat). | Edits create a new revision/comment; original retained. |
| **Per-message reactions stored separately from issue comment** | "Add a reaction column!" | Schema-additive constraint. | Reactions, if added later, must round-trip to Paperclip's comment model. |
| **AI auto-replies in group threads without consent** | Demo-friendly. | Multi-agent coordination needs explicit governance; Editor-Agent has standard agent rules per Decision #6. | v1: 1:1 chats only. Group threads ship in a later phase or v2. (Mockup shows them in roster but the core decision in `PROJECT.md` doesn't commit to v1 group-thread feature parity.) |
| **Showing raw tool calls / token traces in the chat bubble** | LangSmith does. | Wrong audience (Eric, founder). The `.reasoning` `<details>` is the right disclosure: collapsed by default, plain-English when expanded. | Reasoning panel only; raw I/O lives in classic activity log if at all. |

### D.4 Complexity ceiling for Surface D

- **Easy:** roster list, chat shell layout, day dividers, composer UI, identity disambiguation, storage-pin metadata block.
- **Medium:** real-time UI with eventual persistence (write-through to issue comments; UI optimistic render), per-topic issue scoping (each topic = one private issue with stable ID), promote-to-task hover, resolution pills, context rail data assembly, attachment storage as work-products, full-text search across comments + work-products.
- **Hard:** hybrid live + durable architecture without a separate datastore — must guarantee no lost messages, must survive plugin disable, must round-trip cleanly to classic Paperclip UI's threaded-comment renderer (coexistence #5). Group threads are even harder (multi-agent send/receive ordering). Reasoning-panel content generation (the agent must produce both reply *and* reasoning trace per message — design choice on whether reasoning is generated at reply-time or stored separately).

---

## Cross-Surface Reuse — Shared Primitives

These are the architecturally important shapes. Each one should be implemented once and reused across surfaces. **This is what the plugin core needs.**

### Primitive 1 — Inline Reference Chip (`ref-inline`)

The small chip showing `BEAAA-141 · In review` with a status color.

| Surface | Use |
|---|---|
| Reader view | Throughout prose — inline mentions in TL;DR, "Why this exists", AC, downstream impact. (`.ref-inline` at task-detail line 277.) |
| Situation Room | On agent cards, in critical-path text, in artifact metadata. (`.ref-chip` at situation-room line 178.) |
| Daily Bulletin | Implied in lineage threads (terminal nodes); could ground item references. |
| Employee Chat | In every agent message body. (`.b-text .ref-inline` at chat line 198.) |

**Implementation note:** One React component, one prop shape (`{ id, title?, status }`), one styling tokens (live/warn/alert/locked/idle/done). Hover/click could open Reader view in a popover (matches Linear Peek). Title resolution via Editor-Agent or a cheap issue-by-id lookup.

### Primitive 2 — Resolved Reference Card (`ref-card`) with Quote Excerpt

The bigger card with title + owner + status + a *substantive quote* from the referenced issue.

| Surface | Use |
|---|---|
| Reader view | "Anchored to (resolved)" section — 3 cards. (`.ref-card` at task-detail 442–488.) |
| Situation Room | Latest-artifact card on agent grid items. (`.artifact` at situation-room 215–238.) |
| Daily Bulletin | Action-inbox cards have similar structure (title, byline, summary, actions). |
| Employee Chat | The attachment block in messages is a smaller cousin (`.attach` at 234, `.attach.image` at 250). |

**Implementation note:** Variants — "with quote" / "with deliverable preview" / "with action buttons" / "with attachment". Single base component, slot-based content. Quote excerpt extraction is an Editor-Agent responsibility.

### Primitive 3 — Blocker Chain Step List (`blocker-chain`)

Vertical list of `↳ step` lines with one terminal `⚑ YOU step`.

| Surface | Use |
|---|---|
| Reader view | Right-rail "Live blocker · on you" panel. (`.blocker-chain` at task-detail 258–263.) |
| Situation Room | Inside `.blocker .chain` on each agent card; also implicit in the critical-path strip's arrow notation. (At situation-room 207–212.) |
| Daily Bulletin | "Lineage threads" are a sibling shape — different semantics (production lineage, not blocker chain) but identical visual rhythm with arrow + terminal node. |
| Employee Chat | Could surface in context rail when discussing a blocked task. |

**Implementation note:** One graph-traversal utility (`reduceBlockerChain(taskId) → Step[]`), one renderer that styles terminal nodes specially. The traversal logic is the *most expensive* shared primitive — it's what powers "zero rabbit holes."

### Primitive 4 — TL;DR / Plain-English Summary Block

The italic Editor-Agent-generated paragraph, with a freshness/regen stamp.

| Surface | Use |
|---|---|
| Reader view | TL;DR strip at top. (`.tldr` at task-detail 99–113.) |
| Situation Room | "Now-doing" line on each agent card; critical-path prose. |
| Daily Bulletin | The whole bulletin IS this primitive at scale. |
| Employee Chat | Reasoning panel disclosure is a sibling — a contained editorial paragraph generated per message. |

**Implementation note:** One Editor-Agent prompt template family (input: structured task/agent state; output: bounded plain-English prose); one visual treatment (italic-serif accent for the AI voice, monospace stamp for freshness). All four surfaces consume this primitive — it's the "voice" of the plugin.

### Primitive 5 — Status / State Pill

Pill with color, icon dot, all-caps label.

| Surface | Use |
|---|---|
| Reader view | `.state-big.warn`/`.alert` in header (line 67–71); AC item state pills. |
| Situation Room | `.state.live/warn/alert/idle` on every agent card (line 161–169). |
| Daily Bulletin | Department tags + standing numbers `.v.pos/.neg`. |
| Employee Chat | `.resolved` / `.resolved.warn` pill on resolved messages; per-employee dot indicator on roster. |

**Implementation note:** Trivial component with strong tokens. Already implied by Paperclip's existing shadcn / `ui/components.json`.

### Primitive 6 — Editor-Agent Attribution / Freshness Stamp

"Compiled by Editor-Agent · 06:30 ET" / "auto-replied 14s" / "last write 13:18 by CFO".

| Surface | Use |
|---|---|
| Reader view | TL;DR italic line; deliverable head metadata. |
| Situation Room | Topbar timestamp; footer compile metadata. |
| Daily Bulletin | Sub-mast, byline lines, colophon. |
| Employee Chat | Per-message timestamps with "auto-replied 14s". |

**Implementation note:** Trust signal that must be everywhere AI-generated content lives. Hard rule: **every AI-generated block has a freshness stamp.**

### Primitive 7 — Action Affordance with Audit Hookup

The buttons that produce an audited mutation: "Approve & Send" / "12%" / "Promote to task".

| Surface | Use |
|---|---|
| Reader view | "Answer for CFO" + inline "12% / 15%" buttons (lines 328, 386–388). |
| Situation Room | `.you-action .actions` (lines 419–427, 492–500). |
| Daily Bulletin | `.action-card .actions` (lines 265, 280). |
| Employee Chat | One-click decision message + composer tools (Approve / New task). |

**Implementation note:** All such buttons must route through a single audit-emitting wrapper; the resulting mutation must appear in classic Paperclip UI as a normal comment / status change (coexistence #5). One handler family, surface-specific UI.

### Primitive 8 — Artifact / Work-Product Preview

Inline rendering of the actual deliverable contents.

| Surface | Use |
|---|---|
| Reader view | "The deliverable" full preview with table (lines 400–430). |
| Situation Room | `.artifact` mini-preview on agent cards; `.shelf-prev` italic excerpts on artifact shelf. |
| Daily Bulletin | Implied in production-section items (referenced by name, not previewed inline). |
| Employee Chat | `.attach` block; `.attach.image` with image preview. |

**Implementation note:** Preview-renderer registry by file type — markdown + plain text + image are easy; XLSX/CSV is medium; PDF is medium; everything else punts to "Open in app". This registry pays for itself across all surfaces.

---

## Feature Dependencies

```
[Inline Reference Chip] (Primitive 1)
    └──requires──> [Issue-by-id resolver service] (Editor-Agent or cheap API)
                       └──requires──> [Paperclip issue read API]

[Resolved Reference Card] (Primitive 2)
    └──requires──> [Inline Reference Chip]
    └──requires──> [Quote-excerpt extractor] (Editor-Agent)

[Blocker Chain] (Primitive 3)
    └──requires──> [Issue dependency graph traversal]
    └──requires──> [Terminal-node detection (human-action vs agent-action)]
    └──requires──> [Plain-English step renderer] (Editor-Agent)

[TL;DR / Summary] (Primitive 4)
    └──requires──> [Editor-Agent skeleton with grounded-summarization prompt]
    └──requires──> [Freshness stamp infra]

[Critical Path strip] (Surface B differentiator)
    └──requires──> [Blocker Chain] (Primitive 3)
    └──requires──> [Whole-graph traversal across all agents]

[AC auto-status] (Surface A differentiator)
    └──requires──> [Editor-Agent reasoning over deliverable contents]
    └──requires──> [Constrained AC schema or per-AC source pointer]

[Daily Bulletin Lineage] (Surface C differentiator)
    └──requires──> [Structured agent-trace metadata in activity stream]
    └──requires──> [TL;DR / Summary] (Primitive 4)

[Hybrid Chat persistence] (Surface D core)
    └──requires──> [Per-topic private-issue creation hook]
    └──requires──> [Comment write-through]
    └──requires──> [Work-product attachment hook]

[Reasoning panel] (Surface D differentiator)
    └──requires──> [Agent emits reasoning trace per reply]
    └──requires──> [Editor-Agent or message-time generation]

[Inline Action Affordances]
    └──requires──> [Audit-emitting mutation wrapper]
    └──requires──> [Coexistence-safe comment/status round-trip to classic UI]

[Artifact Preview] (Primitive 8)
    └──requires──> [Preview-renderer registry by file-type]

[All four surfaces]
    └──requires──> [Per-user opt-in toggle (Paperclip profile)]
    └──requires──> [Plugin scaffold installable via paperclipai plugin install clarity-pack]
```

### Dependency Notes

- **Primitive 3 (Blocker Chain) is the highest-leverage primitive.** It's required by Reader view's "Live blocker" panel, Situation Room's per-agent blocker box, Situation Room's critical-path strip, and quietly underwrites the "Awaiting You" inbox count. **Get this right in Phase 1.**
- **Primitive 4 (TL;DR generator) is the second-highest-leverage primitive.** Needed by Reader view, Situation Room, Bulletin, and Chat reasoning panel. Must be grounded against work-products to avoid hallucinating numbers.
- **Hybrid Chat persistence depends on coexistence guarantees more than on any other feature.** Decision #1 + coexistence #3 + #5 form a three-way constraint: schema-additive, durable, classic-UI-renderable. This makes Surface D the riskiest single architectural commitment in the project.
- **Critical path strip (Surface B) requires Blocker Chain to already work** — phase B's premium feel depends on Primitive 3 landing solidly in Phase 1.
- **AC auto-status enhances Reader view but isn't required for v1** — could ship as manual checklist in v1, upgrade to auto-status in v1.x or v2.

---

## MVP Definition

### Launch With (v1 = Phase 1: Reader view + Situation Room + Editor-Agent skeleton)

Phase-1 scope per Decision #3.

- [ ] **Plugin scaffold + install via `paperclipai plugin install clarity-pack`** — Phase 1 prerequisite.
- [ ] **Per-user opt-in profile toggle** (default OFF) — coexistence #1.
- [ ] **Editor-Agent skeleton** (regular org-chart hire, heartbeat-driven, standard governance) — Decision #6.
- [ ] **Inline Reference Chip primitive** — required by both Reader view and Situation Room.
- [ ] **Resolved Reference Card primitive** (with quote excerpt — needs Editor-Agent) — Reader view's "Anchored to" section.
- [ ] **TL;DR primitive** (grounded summarization with freshness stamp) — Reader view + Situation Room "now-doing".
- [ ] **Reader view tab** on issue pages — TL;DR, breadcrumb, ref-cards, AC checklist, activity timeline, right-rail blocker panel. AC v1 = manual checklist (not auto-status).
- [ ] **Situation Room route** — agent grid with state pills, now-doing line, blocker box, latest-artifact card, velocity bars, awaiting-you inbox pill, artifact shelf.
- [ ] **Blocker Chain primitive** (graph traversal + terminal-node detection + plain-English steps) — used by both Reader view and Situation Room.
- [ ] **Critical Path strip** (3 chains org-wide) — Situation Room.
- [ ] **Auto-refresh / on-view recompute** at 30–60s (resolve mockup-vs-PROJECT.md discrepancy in SPEC.md).
- [ ] **Status / State Pill primitive** — universal.
- [ ] **Editor-Agent attribution stamp** on every AI-generated block.

### Add After Validation (Phase 2 = Daily Bulletin)

- [ ] **Scheduled compile at 06:30 ET** with cron-equivalent trigger from Editor-Agent heartbeat.
- [ ] **Bulletin route** with masthead, sub-mast, action inbox, department sections, right-rail panels, lineage threads, colophon.
- [ ] **Action inbox with one-click approve / decline / open audit** (governance hookup).
- [ ] **Lineage thread structured-trace plumbing** in agent activity emit.
- [ ] **Standing numbers + agent spend panels** with budget alert pattern.
- [ ] **Quiet-day handling** logic.
- [ ] **Errata as item type** — first-class.

### Add After Bulletin (Phase 3 = Employee Chat)

- [ ] **Hybrid persistence architecture** (real-time UI, write-through to issue comments, attachments as work-products).
- [ ] **Per-employee × per-topic private-issue scoping** (each topic = one private issue with CHT-NN ID).
- [ ] **Chat shell** (roster, topics strip, messages scroller, composer, context rail).
- [ ] **Per-employee linear timeline + global search** (Decision #4).
- [ ] **Reasoning panel** disclosure on agent messages.
- [ ] **Promote-to-task hover affordance** + resolution pills + one-click decision messages.
- [ ] **Coexistence test:** disable plugin → verify all messages still render as comments in classic UI.

### Phase 4 (Polish + distribution)

- [ ] Settings UI for opt-in toggle, schedules, persona choice.
- [ ] npm publish polish.
- [ ] **Group threads** (Pricing huddle / GTM huddle) — moved here from Phase 3 because multi-agent coordination is hard.
- [ ] **AC auto-status** upgrade from manual checklist.
- [ ] **Artifact preview registry** beyond markdown/text/image (XLSX, PDF).

### Future Consideration (v2+)

- [ ] **Clipmart submission criteria** (accessibility audit, theming portability, multi-tenant safety, public support story) — explicit per `PROJECT.md` line 47.
- [ ] **Multi-recipient personalization** for Bulletin.
- [ ] **Email / Slack distribution** of Bulletin.
- [ ] **Reactions / emojis** in chat.
- [ ] **Voice / video / call** — likely never; out of plugin form factor.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Inline Reference Chip | HIGH | LOW | P1 |
| Resolved Reference Card with quote | HIGH | MEDIUM-HIGH | P1 |
| TL;DR (grounded summarization) | HIGH | MEDIUM-HIGH | P1 |
| Blocker Chain primitive | HIGH | HIGH | P1 |
| Reader view tab integration | HIGH | MEDIUM | P1 |
| Situation Room route | HIGH | MEDIUM | P1 |
| Critical Path strip | HIGH | HIGH | P1 |
| Editor-Agent skeleton | HIGH | MEDIUM | P1 |
| Per-user opt-in toggle | HIGH | LOW | P1 |
| Artifact inline preview (md/txt/img) | HIGH | MEDIUM | P1 |
| Awaiting-You inbox pill | HIGH | LOW (given chain logic) | P1 |
| AC checklist (manual) | MEDIUM | LOW | P1 |
| AC auto-status | HIGH | HIGH | P3 (defer) |
| Action inbox in Bulletin | HIGH | MEDIUM | P2 |
| Bulletin lineage threads | MEDIUM | MEDIUM-HIGH | P2 |
| Bulletin editorial design | HIGH | MEDIUM (font/layout tax) | P2 |
| Hybrid chat persistence | HIGH | HIGH | P2 (Phase 3) |
| Reasoning panel in chat | MEDIUM | MEDIUM | P2 |
| Promote-to-task hover | MEDIUM | LOW | P2 |
| Group threads | MEDIUM | HIGH | P3 (Phase 4 / v2) |
| XLSX preview | MEDIUM | HIGH | P3 |
| PDF preview | LOW-MEDIUM | MEDIUM | P3 |
| Reactions / emojis in chat | LOW | MEDIUM (schema concern) | P3 |
| Multi-recipient bulletin | LOW (v1 audience = Eric) | MEDIUM | v2+ |
| Email/Slack distribution | LOW (v1) | HIGH | v2+ |

**Priority key:**
- **P1** = ships in Phase 1 (Decision #3 scope).
- **P2** = ships in Phase 2/3 per `PRIOR-DECISIONS.md` rough roadmap.
- **P3** = ships in Phase 4 polish or deferred.
- **v2+** = explicitly out of v1 audience (Decision #7).

---

## Competitor Feature Analysis

| Feature | Linear | Slack/Notion | LangSmith/Temporal | Clarity Pack approach |
|---|---|---|---|---|
| Inline issue preview | Peek/Quick Look — title + assignee + status | Slack: limited; Notion: link previews | N/A | **Goes further:** quote excerpt + status + owner. Editor-Agent picks excerpt; Paperclip API supplies metadata. |
| Daily summary digest | Linear "morning summary" exists (mentioned in 2026 changelog/Linear Agent context) | Slack AI Daily Recap (Mar 2026 GA) — channel-following, AM digest | None native | **Editorial-voice + lineage threads + action inbox.** Goes beyond "channel summary" to "operations chronicle". |
| Live ops cockpit for AI agents | Linear Agent (announced Mar 2026) — single agent invocation; not a fleet view | None | LangSmith: granular trace view (per-node tokens, replay-mid-run); Temporal Web: event-history + flagged-on-task-failure | **Plain-English fleet view.** Eric audience, not engineer audience. Critical-path strip is the differentiator. |
| Chat-to-issue hybrid | Linear Asks; threaded comments on issues; Plain integration "Close the Loop" | Slack: thread-per-channel siloed; Linear-Slack bridge available | N/A | **Per-topic private issue + real-time UI + attachments-as-work-products.** Hybrid by design (Decision #1). |
| Inline reference resolution | Hovercard-style (Peek) | GitHub Hovercard ext shows title; native GitHub auto-augments `#NNN` with title | N/A | **Reusable primitive across all 4 surfaces.** With status state baked into the chip. |
| Blocker chain visualization | Visual link map; Easy Agile dep graph | None | LangSmith: per-execution tree | **Transitive reduction to single human action.** Plain English, not graph. The signature primitive. |
| Reasoning panel on agent messages | None | None | LangSmith: traces (engineer-grade) | **Founder-grade `<details>` disclosure** — collapsed by default, plain-English when expanded. |

---

## Open Questions Surfaced During Research

These don't block FEATURES.md but should be resolved in REQUIREMENTS.md / SPEC.md:

1. **Auto-refresh cadence:** PROJECT.md says 60s; Situation Room mockup says 30s. Pick one.
2. **AC v1 = manual checklist or auto-status?** Recommendation: manual in Phase 1, auto in later phase. Auto-status is high-value but high-risk.
3. **Reasoning panel content origin:** Generated at message-time by the responding agent, or compiled later by Editor-Agent? Affects latency and storage shape.
4. **Group thread availability in v1:** Mockup roster shows them; PROJECT.md doesn't commit. Recommendation: defer to Phase 4 / v2 (multi-agent coordination is hard).
5. **Promote-to-task hover affordance availability across surfaces:** Mockup shows only on chat bubbles. Should it also appear on Reader-view comments? Probably yes (consistency), but not v1-critical.
6. **XLSX preview fidelity in Reader view:** Mockup shows a 4-row Δ table. Live XLSX rendering inside the plugin UI is hard; alternative is a pre-rendered "facts table" snippet emitted by the agent at write time.
7. **Editor-Agent's actual employee role vs. "skeleton":** Phase 1 commits to "skeleton". What's the minimum viable Editor-Agent contract — generate TL;DRs only, or also blocker-chain prose, or also critical-path narratives? Recommendation: TL;DR + now-doing + blocker step prose minimum; bulletin compilation is Phase 2.

---

## Sources

**Mockups (authoritative for IA/visual contract):**
- `sketches/paperclip-fix-task-detail.html` (Surface A)
- `sketches/paperclip-fix-situation-room.html` (Surface B)
- `sketches/paperclip-fix-bulletin.html` (Surface C)
- `sketches/paperclip-fix-employee-chat.html` (Surface D)

**Project context:**
- `.planning/PROJECT.md`
- `.planning/PRIOR-DECISIONS.md`

**External (web — confidence MEDIUM):**

Surface A — Reader view:
- [Linear Peek preview docs](https://linear.app/docs/peek)
- [Linear changelog 2026 / Linear Agent](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
- [GitHub Hovercard ext](https://github.com/Justineo/github-hovercard)
- [Using hover cards on GitHub Docs](https://docs.github.com/en/get-started/using-github-docs/using-hover-cards-on-github-docs)

Surface B — Situation Room:
- [Temporal Web UI documentation](https://docs.temporal.io/web-ui)
- [Inngest vs. Temporal comparison](https://akka.io/blog/inngest-vs-temporal)
- [LangGraph / CrewAI / AutoGen comparison (DataCamp)](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [Mastering Agents: LangGraph vs AutoGen vs CrewAI (Galileo)](https://galileo.ai/blog/mastering-agents-langgraph-vs-autogen-vs-crew)
- [Jira critical path / dependency visualization guide](https://www.quirk.com.au/ultimate-guide-to-jira-dependency-graphs-reports-and-visualizations/)

Surface C — Daily Bulletin:
- [Slack AI Recap (Salesforce announcement, March 2026)](https://www.salesforce.com/news/stories/slack-ai-news-update/)
- [Slack AI Daily Recap practical guide (eesel)](https://www.eesel.ai/blog/slack-ai-daily-recaps)
- [Notification fatigue research (Courier)](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)
- [LLM hallucination in summarization (GDELT)](https://blog.gdeltproject.org/hallucinating-detail-in-simple-summaries-why-llm-grounding-doesnt-work-to-combat-hallucination/)
- [Lakera LLM hallucinations 2026 guide](https://www.lakera.ai/blog/guide-to-hallucinations-in-large-language-models)

Surface D — Employee Chat:
- [Linear comments and reactions docs](https://linear.app/docs/comment-on-issues)
- [Plain → Linear integration ("Close the Loop")](https://www.plain.com/docs/integrations/linear)
- [Linear Asks docs](https://linear.app/docs/linear-asks)
- [Chat persistence architecture (System Design Handbook)](https://www.systemdesignhandbook.com/guides/design-a-chat-system/)
- [Persistence vs. durability in messaging (Red Hat)](https://developers.redhat.com/blog/2016/08/10/persistence-vs-durability-in-messaging)

---

*Feature research for: Clarity Pack — Paperclip plugin (4 surfaces + Editor-Agent)*
*Researched: 2026-05-07*
