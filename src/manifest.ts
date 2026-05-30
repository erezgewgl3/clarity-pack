import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

// Plan 02-02 Task 3 — manifest promoted from the 2-slot smoke shape to the
// full Phase-2 declaration. All four surfaces are declared here so 02-03 and
// 02-04 fill in real components without re-editing the manifest:
//   - Reader (detailTab + entityTypes:['issue']) — slot identity LOCKED by
//     Plan 02-01 SMOKE-FINDINGS Check B (kitchen-sink canonical pattern;
//     architectural HIGH confidence; Linux re-spike will close visual D-01)
//   - Situation Room (page route)
//   - Bulletin (page route — stub component; real Bulletin lands in Phase 3)
//   - Chat (page route — stub component; real Chat lands in Phase 4)
//   - Settings (settingsPage) for the per-user opt-in toggle (OPTIN-01)
//
// Capability list expanded per .planning/research/STACK.md capabilities table.
// Schema corrections from Plan 02-01 Task 1 (commit bef083e) still apply —
// `id` (not name), entrypoints object, ui.detailTab.register +
// instance.settings.register capabilities for those slot types.
const manifest: PaperclipPluginManifestV1 = {
  id: 'clarity-pack',
  apiVersion: 1,
  // Release-history note (rc.6 release of 1.0.0 series, Quick fix 260524-s2y — AC manual toggle -> Reader refetch).
  // Wires `PluginDataResult.refresh` from `usePluginData('issue.reader', ...)`
  // AND `usePluginData('reader.ac.autostatus', ...)` down through
  // `AcChecklist` as an `onMutated` callback, called ONLY when
  // `usePluginAction('ac-toggle')` resolves to `{ok:true}`.
  // RATIONALE FOR NO MANIFEST CHANGE: @paperclipai/plugin-sdk@2026.512.0
  // exposes no `actions[]` field on `PaperclipPluginManifestV1` and no
  // `invalidat*` concept anywhere in the SDK type tree (verified by reading
  // dist/types.d.ts + grep). The operator's literal framing — "add an
  // invalidates declaration in src/manifest.ts" — was based on a misread
  // of the SDK shape. Data invalidation in this SDK is a UI-side concern;
  // this rc.6 ships the equivalent fix at the UI tier.
  // UI + 1 test only — no manifest shape, capability, schema, agent, job,
  // or worker-contract change.
  //
  // 0.8.3 (Plan 04.1-10 — gap-closure on the Plan 04.1-09 drill) — four
  // surgical UI fixes for the regressions Eric's 2026-05-20 second live
  // drill on Countermoves surfaced. Worker tier, schema, and capability
  // list all UNCHANGED — pure UI + CSS + small React rewires:
  // (1) INLINE TASK CARD + CREATION TOAST — onDialogSuccess in index.tsx
  //     used to do `void result; setRefreshKey(k=>k+1)` — discarded the
  //     dialog payload entirely. Consequence: the optimistic
  //     pendingTaskCard was NEVER written, so for promote-mode tasks the
  //     inline card only appeared ~15s later when the chat.taskOwned
  //     poll caught up to the marker comment. Cold-mode tasks (no marker
  //     by spec, no inline-card surface) vanished with zero operator
  //     confirmation. New shape: onSuccess receives { issueId, mode,
  //     title }; promote → setPendingTaskCard fires the optimistic card
  //     immediately with the operator-typed title; BOTH modes fire a 6s
  //     toast "↗ Task created — <8-char-id>, assigned to <name>.". The
  //     pending card clears via three paths: marker-arrival (MessageThread
  //     fires onPendingResolved), topic switch, employee switch.
  // (2) DIALOG DETAILS TEXTAREA + HORIZONTAL VIEWPORT OVERFLOW —
  //     (a) DETAILS field promoted from <input type=text> (single-line
  //     primary content surface, unworkable for real task bodies) to a
  //     <textarea rows=6>. CSS: min-height 140px, max-height 40vh,
  //     overflow-y auto, resize: vertical. (b) Long topic titles +
  //     several open topics pushed the chat shell wider than viewport,
  //     hiding the right rail. Root cause: grid items default to
  //     min-width: auto. CSS fix: .clarity-chat-shell > .thread, > main
  //     get min-width: 0; .topics gets min-width: 0 + max-width: 100%
  //     (its existing overflow-x: auto now scrolls inside instead of
  //     pushing the parent column wider); .topic .topic-title gets
  //     ellipsis truncation at max-width 220px with full title in
  //     title= attribute for hover discovery.
  // (3) RESUME HEARTBEAT INLINE TOGGLE — Plan 04.1-09 shipped Pause as
  //     visual-only; resuming required navigating away from chat to the
  //     agent page. The Quick Action row now TOGGLES based on the
  //     optimistic CEO status: paused → ▶ Resume heartbeat; otherwise
  //     ⏸ Pause heartbeat. Resume click attempts usePluginAction(
  //     'agents.resumeHeartbeat') with { agentId, companyId, userId };
  //     success → 4s confirm toast; failure (action key not bound on
  //     this host) → 6s graceful-degrade toast hinting the agent page.
  //     The optimistic flip (setPausedOverride(null)) lands BEFORE the
  //     host call so the visual is snappy regardless of host latency.
  // Suite 1195 -> ≥1219 (24+ new tests across 3 UI test files; one new
  // node:test file chat-index-on-dialog-success.test.mjs covers the
  // dialog-success rewire). UI/CSS only — no manifest shape, capability,
  // schema, or worker-contract change.
  //
  // 0.8.2 (Plan 04.1-09 — gap-closure on the Plan 04.1-08 drill) — five
  // surgical UI fixes for the regressions Eric's 2026-05-20 live drill on
  // Countermoves surfaced. Worker tier, schema, and capability list all
  // UNCHANGED — pure UI + CSS + small React rewires:
  // (1) DIALOG CENTERED MODAL — the +Create task dialog rendered TOP-LEFT
  //     because the existing CSS forced `position:fixed inset:0 width:480px`
  //     on the native <dialog> element. Replaced with a custom backdrop +
  //     body pair: outer .true-task-dialog-backdrop is fixed inset:0 flex
  //     centered; inner .true-task-dialog is position:relative max-width
  //     560px. Backdrop click closes; click inside body uses stopPropagation;
  //     Escape closes via window listener. The native <dialog> shell is gone.
  // (2) INLINE TASK CARD FULL WIDTH + REAL TITLE — the card was wrapped in
  //     `<article className="msg">` (the chat-bubble grid 34px 1fr) and
  //     collapsed into the 34px avatar column; the title came from
  //     markerMatch[1] which is the issueId, NOT the title — the card showed
  //     a UUID. Wrapper class is now `inline-task-card-row` (non-grid block);
  //     title is looked up from chat.taskOwned (`activeTasks`) by issueId
  //     with a pendingTaskCard fallback and a skeleton placeholder during
  //     the 15s race window. The chat.taskOwned fetch is lifted to index.tsx
  //     via the new useChatActiveTasks hook; one source of truth for both
  //     ContextRail and MessageThread.
  // (3) KEYBOARD SHORTCUT — Ctrl+T / ⌘+T opened a new browser tab because
  //     the browser intercepted the chord before the plugin handler ran.
  //     Replaced with Linear-style single-key `T` (no modifier) when no
  //     input/textarea/contenteditable is focused. Tooltip + kbd-hint copy
  //     updated.
  // (4) PAUSE HEARTBEAT FEEDBACK — the right rail's Quick Action was a
  //     disabled no-op. New toast primitive (src/ui/primitives/toast.tsx —
  //     ToastProvider + useToast + ChatToast) shows a transient
  //     bottom-right notification on pause click + optimistically flips the
  //     CEO status pill to `paused` (warn-amber) until the next 15s poll
  //     re-syncs. The real host RPC for pause-heartbeat is deferred to 4.2;
  //     the toast tells the operator the canonical pause path is the agent
  //     page.
  // (5) RIGHT-RAIL TASK-ROW WORD-WRAP — long titles in `Active tasks owned`
  //     wrapped char-by-char because the `1fr` middle column could not
  //     shrink below intrinsic content size. Grid is now `auto minmax(0, 1fr)
  //     auto`; .ttl wraps at word boundaries with hyphenation and clamps to
  //     3 lines; full title surfaces on hover via the title= attribute.
  // Suite 1158 -> 1195 (37 new tests across 5 UI test files). UI/CSS +
  // one new primitive (toast.tsx) — no manifest shape, capability, schema,
  // or worker-contract change.
  //
  // 0.7.8 (Plan 04-05 Task-4 follow-up — Employee Chat live indicator polish) —
  // two small fixes to the 0.7.7 indicator. (1) DUPLICATE DOT — the indicator
  // showed TWO dots: the CSS `.auto-refresh::before` pseudo-element (the real
  // pulsing, state-colored dot) AND a literal "● " glyph prefixing every
  // INDICATOR_BY_STATE label string. The label glyph was a dead, un-pulsing
  // second dot. The "● " prefix is removed from all three labels ('Live',
  // 'Updates delayed', 'Updates stopped'); the CSS ::before stays as the
  // single, correct dot. (2) EMPHASIZED HEALTHY "LIVE" — a genuinely-healthy
  // poll now reads as a confident, affirmative "yes, this is working": the
  // healthy-state label is the clear live-green (was the muted --ink-3) with a
  // slightly stronger font-weight. The stalled / disabled states stay
  // muted/amber, deliberately quieter. UI/CSS + test only — no manifest shape,
  // capability, schema, or worker-contract change.
  //
  // 0.7.7 (Plan 04-05 Task-4 follow-up — Employee Chat live indicator rework) —
  // the static "Live" label from 0.7.6 had three operator-flagged problems:
  // (1) it never pulsed, so there was no glanceable sign anything was alive;
  // (2) it rendered inline at the top of the scrolling .messages container so
  // it scrolled out of view in a multi-turn chat; (3) it was a hardcoded
  // string — it claimed "Live" even after polling had silently stopped. All
  // three are fixed. usePoll now exposes a GENUINE liveness signal —
  // `lastSuccessAt`, the epoch-ms of the most recent SUCCESSFUL refresh — and
  // a pure `deriveLiveness()` helper that turns poll.error + lastSuccessAt
  // into 'healthy' | 'stalled' | 'disabled'. The message-thread indicator
  // derives its state from that: HEALTHY → a calm ~1.8s ease-in-out pulsing
  // green "● Live"; STALLED (transient poll error, or no successful refresh
  // within 2x the 15s interval — a silently-dead timer) → a NON-pulsing amber
  // "● Updates delayed"; PLUGIN_DISABLED → a NON-pulsing amber "● Updates
  // stopped". It is `position: sticky` pinned to the top of the messages
  // scroller so it stays visible no matter how far the operator has scrolled.
  // role="status" text speaks the same truth. The 15s poll cadence, the
  // usePluginStream dormant handling, and the PLUGIN_DISABLED terminal-stop
  // are all UNCHANGED — only the indicator and the usePoll liveness signal
  // change. UI/CSS + use-poll primitive + tests — no manifest shape,
  // capability, schema, or worker-contract change.
  //
  // 0.7.6 (Plan 04-05 Task-4 follow-up — Employee Chat auto-refresh indicator) —
  // replace the looping auto-refresh countdown in the message thread with a
  // single, calm, STATIC indicator. Earlier builds rendered a live
  // "Auto-refreshing · next in Ns" ticker that decremented 15→0 and wrapped
  // back to 15, looping forever; operators read the perpetual loop as a stuck
  // spinner and it drew UX complaints three times. The countdown number, the
  // secondsToRefresh state, and the 1s decrementing setInterval are removed
  // entirely — the indicator is now a motionless "● Live" badge (role="status",
  // --ink-3 with a soft still live-green dot). The 15s poll, the usePluginStream
  // dormant handling, and the PLUGIN_DISABLED terminal-stop are all unchanged —
  // only the visible perpetual countdown is removed. UI/CSS + test only — no
  // manifest shape, capability, schema, or worker-contract change.
  //
  // 0.7.5 (Plan 04-05 Task-4 follow-up — Employee Chat composer keybinding) —
  // adopt the standard chat convention in the message composer: a plain Enter
  // now SENDS the message and Shift+Enter inserts a newline. The previous
  // build was the opposite-ish — ⌘/Ctrl+Enter sent and a plain Enter fell
  // through as a newline. handleKeyDown now preventDefaults + sends on Enter
  // without Shift, returns early on Shift+Enter so the textarea's default
  // newline happens, and keeps ⌘/Ctrl+Enter as a harmless secondary send
  // shortcut. The operator-facing copy was updated to match: the textarea
  // placeholder ("Enter to send, Shift+Enter for newline") and the
  // .composer-hint foot text ("↵ to send · ⇧+↵ for newline"). UI only — no
  // manifest shape, capability, schema, or worker-contract change.
  //
  // 0.7.4 (Plan 04-05 Task-4 — Employee Chat host-contract audit pass) — a
  // single THOROUGH audit of every chat handler + UI file against the five
  // real-Paperclip-host pitfalls the TDD fakes hid (bigint-as-string, UI↔handler
  // param-name match, createComment-not-stamping-authorUserId, the operator-only
  // chat_messages side table, plugin-streams 501). Bugs found + fixed:
  // (GAP 8) the auto-refresh countdown froze at "next in 0s" — it reset from a
  // useEffect([poll.data]) but the poll fetcher returns null every tick and
  // usePoll runs dedupeBy:'off', so poll.data identity never changed and the
  // reset effect never re-ran; the countdown is now a self-contained 15→0→15
  // wrap. The indicator was also illegibly dim (--ink-4) — raised to --ink-2
  // with a soft live-green dot. (GAP 10) operator-sent messages rendered as
  // "AGENT" — PITFALL #3: ctx.issues.createComment posts as the plugin worker so
  // operator comments come back with an EMPTY authorUserId; isMine now derives
  // from senderKind === 'user' (the chat_messages side-table stamp), not
  // authorUserId. (GAP 12) Promote-to-task and Pin did nothing on agent messages
  // — PITFALL #4: chat_messages is operator-write-only so an agent comment has
  // NO row, and the UI passed a comment id under a `messageUuid` key. chat.promote
  // now resolves the comment directly via ctx.issues.listComments by commentId +
  // topicIssueId (no getChatMessageByUuid); chat.pin UPSERTs a pin-only
  // chat_messages row for an agent comment (sender_kind 'agent', no body). Both
  // UI actions pass commentId + topicIssueId and surface visible confirmation
  // ("✓ Task created" / "⚑ Pinned") or a visible error — the old empty catch
  // swallowed both. UI/CSS + two worker handlers + one repo helper — no manifest
  // shape, capability, or schema change.
  //
  // 0.7.3 (Plan 04-05 Task-4 drill gap-closure round 3) — three Employee Chat
  // defects the live Countermoves re-drill surfaced once the host's realtime
  // posture was confirmed: the Paperclip host returns HTTP 501 (Not Implemented)
  // for the plugin-streams endpoint — usePluginStream / ctx.streams is a host
  // NO-PATH (browser console: repeated 501 on /api/plugins/<clarity-pack-id>).
  // (GAP 8) the realtime banner was permanently stuck: `degraded =
  // stream.error != null` was always true (the stream 501s forever), so the
  // alarming "Reconnecting — live updates paused" banner showed permanently and
  // usePoll was framed as a degraded fallback. Polling is now the calm,
  // always-on PRIMARY refresh (every 15s, no longer gated on `degraded`); the
  // banner is replaced by a subtle "Auto-refreshing · next in Ns" countdown
  // (role="status", unobtrusive styling). usePluginStream is kept DORMANT as a
  // best-effort bonus — stream.error drives no UI; a STREAMS_AVAILABLE NO-PATH
  // comment marks the future re-enable point, mirroring ATTACHMENTS_AVAILABLE.
  // (GAP 9) a sent message sat on "sending…" until the next poll — Optimistic
  // Message gained a 'sent' status; a successful chat.send flips the bubble to
  // 'sent' with an immediate "✓ sent" affordance until the reconciled server
  // comment lands. (GAP 7) React "missing key" warnings flooded the console —
  // the chat surface files are now covered by the no-react-key-warnings
  // source-grep test. UI/CSS + test only — no manifest shape, capability,
  // schema, or worker-contract change.
  //
  // 0.7.2 (Plan 04-05 Task-4 drill gap-closure round 2) — four more Employee
  // Chat defects the live Countermoves re-drill surfaced: (GAP 6) chat.send
  // failed on EVERY send — composer.tsx passed snake_case `message_uuid` but
  // the chat-send.ts handler reads camelCase `messageUuid` via reqStr, so
  // params.messageUuid was undefined and reqStr threw; the composer now sends
  // `messageUuid` (a cross-file wire-contract test guards the param names).
  // (GAP 5) the CHT-NN allocator produced CHT-1, CHT-11, CHT-111 — the bigint
  // MAX returns as a STRING from node-postgres, so `"1" + 1` concatenated;
  // allocateChtNumber now coerces via Number(...). (GAP 1) a new topic opened
  // but did not focus the message input — the composer textarea is now
  // autoFocus, and since the Composer is keyed per topic-issue it focuses on
  // every topic open. (GAP 3a) the context-rail frame borders leaned on
  // --line (too faint over the rail backgrounds) — a rail-scoped --ctx-line
  // token brightens them; --line is not globally redefined. UI/CSS + one
  // worker repo coercion — no manifest shape, capability, or schema change.
  //
  // 0.7.1 (Plan 04-05 Task-4 drill gap-closure) — four Employee Chat UI gaps
  // the live Countermoves visual-fidelity drill surfaced: (1) handleNewTopic
  // ignored the chat.topic.create return value, so a new topic never opened —
  // it now inspects the { ok, topicId, issueId, parentIssueId } | { error }
  // result, setTopic()s the new topic, and surfaces a returned error visibly;
  // (2) the new topic did not appear in the strip until the employee was
  // re-selected — a refreshKey folded into the TopicStrip key now forces a
  // fresh chat.topics fetch on create; (3a) the context rail leaned on --ink-3
  // (~4.3:1, below WCAG AA) — promoted to --ink-2, scoped to .ctx; (3b) the
  // agent card rendered "STATUSIDLE"/"TOPICHELLO" — the label is now its own
  // .stat-label span over a block <b> value. UI/CSS only — no manifest shape,
  // capability, schema, or worker-contract change.
  //
  // 0.7.0 (Plan 04-02 — Employee Chat data layer) — opens Phase 4. Adds the
  // 0006_chat.sql migration (chat_topics + chat_messages + chat_employee_parents
  // in the plugin namespace, additive-only) and the typed chat-topics-repo.
  // chat_messages is the D-09 idempotency side table (message_uuid -> comment_id
  // map + supersedes link + pin flag — never message body; content lives only
  // in public.issue_comments per CHAT-02). chat_employee_parents is the D-05
  // per-employee parent-issue map (composite PK gives each employee exactly one
  // Chat parent issue; race-safe first-ever-topic create). No new capability
  // strings: the chat worker handlers call ctx.issues.createComment /
  // ctx.issues.update / ctx.events.on / ctx.agents — all covered by capabilities
  // Phase 2/3 already declared and proved live on Countermoves (ctx.issues.update
  // is exercised by bulletin-action-approve, which installed live with the
  // current set, so D-06 auto-reopen needs no new string).
  //
  // 0.6.6 (debug fix from session bulletin-compile-cadence-runaway) — two bugs
  // the v0.6.5 closure re-drill exposed: (1) RUNAWAY COMPILE CADENCE — the
  // schedule pointer was advanced only on the success path, so every failure
  // continue left a stale past `next_due_at` and the every-minute cron
  // re-compiled immediately (6 cycles in 14 min). Fixed: advanceScheduleForCompany
  // moves the pointer on every path that consumes a due tick. (2) VERIFIER RACE —
  // verifyDraft re-ran each slot's SQL at compile END with tolerance 0; the ~50s
  // agent window let the live board drift. Fixed: verifyDraft validates the draft
  // against the FROZEN pass-1 facts snapshot, no live re-query.
  //
  // 0.6.5 (debug fix from session tldr-heartbeat-recursion) — two bugs the
  // v0.6.4 cycle-2 re-drill exposed once its bug-2 fix un-crashed the editor
  // TL;DR heartbeat: (1) INFINITE TL;DR RECURSION — handleEditorHeartbeat
  // compiled EVERY observed issue, including the plugin's OWN `tldr-compile`
  // operation issues, each of which spawns the next operation issue,
  // unbounded (17+ concurrent Editor-Agent runs live). Fixed: the heartbeat
  // skips any issue whose `originKind` is in the
  // `plugin:clarity-pack:operation:` namespace — the plugin must never
  // TL;DR-compile its own plumbing. (2) MALFORMED ARRAY LITERAL — every TL;DR
  // write failed at the host db layer: a scalar content-hash string was bound
  // into the `source_revisions text[]` (and `tags text[]`) column. Fixed:
  // upsertTldr binds both `text[]` columns as Postgres array-literal strings
  // through `$N::text[]` casts (toPgTextArrayLiteral). The recursion was
  // LATENT — the heartbeat crashed on the v0.6.3 `ctx.issue` typo (an
  // accidental circuit breaker) until v0.6.4's bug-2 fix un-crashed it.
  //
  // 0.6.4 (debug fix 2b1419f) — two latent bugs the v0.6.3 cycle-2 drill
  // exposed (neither a v0.6.3 regression): (1) every cycle >= 2 silently failed
  // to publish — publishBulletin's idempotency pre-check keyed on `next_due_at`,
  // which the prior published cycle's row also carries, so the pre-check matched
  // the prior cycle and returned 'failed'; re-keyed on (company_id,
  // cycle_number). (2) the Editor-Agent TL;DR compile had never run —
  // editor.ts read comments via a fictional `ctx.issue.comments.read`
  // (undefined on the host), now `ctx.issues.listComments`. The 0.6.3 defect-C
  // "fix" had only quieted that crash's log. compile-bulletin also gained
  // post-readback instrumentation (verdict + publish-result logging).
  //
  // 0.6.3 (debug fix from session bulletin-content-defects) — four defects the
  // v0.6.2 re-drill exposed on the published bulletin: (A) {{NUMBER:key}}
  // placeholders rendered literally — resolveDraftSlots writes resolved prose
  // back into editorialSummary + actionInbox summaries; (B) blank masthead —
  // buildMasthead populates it deterministically; (C) mislabeled WARN; (D) the
  // compile-bulletin catch-all routes unexpected throws through recordFailure.
  //
  // 0.6.2 (debug fix c9c6318) — per-department items normalization for
  // BULLETIN-RENDER-DEPT-ITEMS-UNDEFINED: validateDraftStructure coerces each
  // department's missing/non-array `items` to []. PROVEN LIVE on the v0.6.2
  // re-drill (Bulletin No. 1 published end-to-end).
  //
  // 0.6.1 (debug fix a0e77d3) — operation-issue exclusion for
  // BULLETIN-VERIFIER-COUNTS-OWN-OPERATION-ISSUE: the three public.issues
  // standing-number slots exclude Clarity Pack's own Compile Daily Bulletin
  // operation issue (origin_kind NOT LIKE 'plugin:clarity-pack:operation:%'), so
  // verifyDraft pass-2 no longer re-counts +1 against the frozen pass-1 number.
  // PROVEN LIVE on the 2026-05-17 v0.6.1 re-drill.
  //
  // Plan 03-10 — 0.6.0: standing-number schema-drift fix. STANDING_NUMBER_SLOTS
  // was rewritten with 5 agent-operations metrics whose SQL uses only columns
  // verified present against the live Paperclip schema (03-10-SCHEMA-FINDINGS.md
  // §2); the old 5 slots referenced invented columns (active_subscription_cents,
  // issues.tags, issue_comments.author_role) that failed every verifyDraft
  // pass-2 ctx.db.query on the Plan 03-09 closure drill.
  //
  // 1.1.3 (Plan 250530 — leading-PREFIX-NNN code-span split, closes the
  // BEAAA-1000 / pervasive-agent-pattern mess):
  //   - The agent's pervasive pattern is `<id> <separator> <gloss>` wrapped in
  //     backticks (e.g. `BEAAA-1086 — UW operational pre-read of BEAAA-1000`).
  //     v1.1.1 conservatively left these mixed-content code spans alone — the
  //     operator saw a wall of boxed monospace strings with no chips. Explicit
  //     reversal: a code span whose content STARTS with a valid PREFIX-NNN
  //     token followed by a separator (whitespace, em-dash, en-dash, colon)
  //     now chips the leading id AND recursively parses the trailing gloss so
  //     embedded refs in the gloss ALSO chip.
  //   - Hyphen (-) and dot (.) are NOT separators so derived tokens
  //     (BEAAA-933-extension, BEAAA-933.json) and legit code (npm test,
  //     v1.1.2, in_review, status enums) stay untouched.
  //   - Internally: `Match.span: InlineSpan` widened to `Match.spans: InlineSpan[]`
  //     so the code-span split can emit [ref, ...glossSpans] in one match step.
  //     Every other match type wraps its span in a single-element array.
  //
  // 1.1.2 (Plan 250530 — strong/em/link recursion in safe-markdown — fixes the
  // bold-headline "mess" complaint on BEAAA-1047, 2026-05-30):
  //   - InlineSpan.strong / .em / .link now carry `spans: InlineSpan[]` (was
  //     a flat `text` / `label` string). The parser recursively re-parses
  //     children so a ref / link / code / em nested INSIDE bold renders
  //     correctly (was: literal markdown syntax inside <strong>). The TL;DR's
  //     pattern `**BEAAA-1047 is blocked on countersigning [BEAAA-933](/.../BEAAA-933)**`
  //     now resolves both ids to titled chips inside the bold.
  //   - DISCOVERED (NOT FIXED — host bug, not plugin scope): 43+ console
  //     /api/issues/PAGE-3, STAGE-1, STAGE-2 404s on BEAAA-1047 come from the
  //     HOST's `paperclip-markdown-issue-ref` autolinker matching plain prose
  //     like "page-3" / "Stage 1" against its broad ref pattern. Zero clarity-
  //     pack chips here are bogus. Fix belongs upstream in paperclipai.
  //
  // 1.1.1 (Plan 250530 — Reader rabbit-hole fix on BEAAA-1047, 2026-05-30):
  //   (1) SAFE-MARKDOWN PARSER — a code span that is JUST a PREFIX-NNN token
  //       (e.g. `` `BEAAA-933` ``) and a markdown link whose label is a bare
  //       PREFIX-NNN AND whose href is the canonical `/<prefix>/issues/<id>`
  //       are now upgraded to a `ref` span so the Reader's chip resolves the
  //       title. Mixed-content code (`` `BEAAA-933 — gloss` ``), custom-label
  //       links, cross-instance links, and deep-link queries STAY their
  //       original kind — the upgrade is conservative. XSS allowlist
  //       (sanitizeHref) is unchanged; a hostile href still downgrades to text.
  //   (2) EDITOR-AGENT TL;DR PROMPT — added a hard contract: cite issue ids as
  //       plain prose (no backticks, no markdown link wrapping); never restate
  //       a cited issue's title/status next to its id (the chip already shows
  //       them); expand every internal abbreviation or jargon term on first
  //       use ("Head of Underwriting (HoUW)" etc.). The visible win on the
  //       existing BEAAA-1047 TL;DR is immediate via the parser fix; the
  //       prompt fix takes effect on the next agent heartbeat recompile.
  //
  // 1.1.0 (Plan 250529 — three shippable fixes from the 2026-05-29 BEAAA
  // diagnostic session):
  //   (1) PIN-NO-BRICK UI — message-thread.tsx onPin/onPromote made optimistic
  //       with an 8s safety timeout so a slow action ACK (measured 45s+ under
  //       box load, write still persisting) can never leave the button stuck
  //       on cursor:not-allowed.
  //   (2) requestWakeup DE-BLOCKED — the two awaited sites (chat-send.ts +
  //       agent-task-delivery.startAgentTask) are now fire-and-forget;
  //       requestWakeup is unreliable on paperclipai@2026.525.0 (30s timeout /
  //       scope errors) and native wake is the real delivery mechanism.
  //   (3) LAUNCHERS — ui.launchers below surfaces Situation Room / Daily
  //       Bulletin / Employee Chat as left-nav (sidebar) entries; previously
  //       reachable only by direct URL. Adds the ui.sidebar.register capability.
  version: '1.1.3',
  displayName: 'Clarity Pack',
  description:
    'Four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of unmodified Paperclip — plain-English clarity on what every employee is doing.',
  author: 'Eric G.',
  categories: ['ui', 'automation'],
  capabilities: [
    // Slot-registration capabilities — REQUIRED for the host to accept the
    // detailTab + settingsPage + page slots below (Plan 02-01 Task 1 Finding #5).
    // ui.page.register added 2026-05-13 during Plan 02-03 Task 3 rehearsal — host
    // validator (paperclipai/paperclip@master server/src/services/plugin-validator)
    // rejected install with "Missing required capabilities for declared features:
    // ui.page.register". One cap per page-bearing slot type.
    'ui.detailTab.register',
    'ui.page.register',
    'instance.settings.register',
    // Plan 250529 Task 3 — launcher nav entries (ui.launchers below). The host
    // capability validator maps every launcher placementZone to a required
    // capability (server/src/services/plugin-capability-validator.ts:
    // LAUNCHER_PLACEMENT_CAPABILITIES) and enforces it at install: the three
    // 'sidebar'-zone launchers require 'ui.sidebar.register' or install fails
    // with "Missing required capabilities: ui.sidebar.register".
    'ui.sidebar.register',
    // Data + agents capabilities — full Phase-2 scope.
    'database.namespace.migrate',
    'database.namespace.read',
    'database.namespace.write',
    // Delivery-layer rework (2026-05-28) — ctx.state (host KV store) holds the
    // per-company "pending compile" record so the agent-backed bulletin compile
    // can be STARTED in one job tick and its result CONSUMED on a later tick,
    // each in a fresh/valid host invocation (paperclipai@2026.525.0 expires the
    // invocation scope mid-poll otherwise — PR #6547). plugin.state.read gates
    // ctx.state.get; plugin.state.write gates ctx.state.set/delete. Additive
    // capability strings only — no schema/migration.
    'plugin.state.read',
    'plugin.state.write',
    'issues.read',
    'issue.comments.read',
    'issue.documents.read',
    'issue.documents.write',
    // Plan 02-03b Task 2 — added 2026-05-14 after API-shape diagnosis. Plan
    // 02-03 omitted these because the original handler-draft used ctx.http.fetch
    // for blockers and walked a fictional ctx.issues.ancestry. The rewritten
    // handlers use the typed SDK clients: ctx.issues.relations.get +
    // ctx.projects.get + ctx.goals.get. See 02-03b-API-SHAPES.md §§ 2, 7.
    'issue.relations.read',
    'projects.read',
    'goals.read',
    'agents.managed',
    'agents.read',
    'agents.pause',
    'agents.resume',
    // Plan 03-05 — production LLM invocation via ctx.agents.sessions
    // (03-LLM-INVOCATION-RESEARCH.md). The compile-bulletin job and the
    // Editor-Agent heartbeat TL;DR path open an agent chat session, send the
    // compile prompt, accumulate the streamed chunk events, and close — the
    // real LlmAdapter that replaces the impossible `ctx.llm` seam. Exact
    // members of PLUGIN_CAPABILITIES. `agents.resume` (above) lets the
    // compile job resume the manifest's status:'paused' Editor-Agent.
    'agent.sessions.create',
    'agent.sessions.list',
    'agent.sessions.send',
    'agent.sessions.close',
    'events.subscribe',
    'companies.read',
    // Plan 02-04 Task 2 — required for the recompute-situation 60s job
    // declared in jobs[] below (PLUGIN_SPEC §17).
    'jobs.schedule',
    // 2026-05-27 BEAAA hotfix — paperclipai@2026.525.0 added explicit
    // capability enforcement for ctx.http.fetch (previously implicit /
    // ungated). The resolve-refs worker handler (Reader inline reference
    // resolution) calls ctx.http.fetch to query the host's
    // /api/issues/<key> endpoint; without this capability the call is
    // rejected with CAPABILITY_DENIED → 502 → Reader error boundary
    // surfaces "Clarity Pack: failed to render". This was invisible on
    // Countermoves (older paperclipai version) and surfaced on AriClaw's
    // 2026.525.0 install. PR #6547 (invocation-scope hardening) was the
    // companion change; this is its capability-enforcement sibling.
    'http.outbound',
    // Plan 03-01 — Daily Bulletin. issues.create lets the compile pipeline
    // (Plan 03-02) persist each bulletin as a canonical Paperclip issue
    // (D-16); issue.comments.create lets Plan 03-04 append errata as a
    // comment on the prior cycle's issue (D-18).
    'issues.create',
    'issue.comments.create',
    // Plan 03-06 — ctx.issues.requestWakeup wakes the Editor-Agent immediately
    // when an operation issue is created (agent-task-delivery.ts — the
    // operation-issue task-delivery handoff that replaces the discarded
    // session prompt). Exact PLUGIN_CAPABILITIES member (SDK 2026.512.0
    // types.d.ts: "issues.wakeup for assignment wakeup requests").
    'issues.wakeup',
    // Plan 04-02 — Employee Chat. The 04-03 chat worker handlers need no NEW
    // capability strings: posting a chat message uses issue.comments.create
    // (above); the stream bridge subscribes issue.comment.created via
    // events.subscribe (above); the roster handler reads the employee list via
    // agents.read (above); the + New topic flow creates the child topic issue
    // via issues.create (above); D-06 auto-reopen calls ctx.issues.update,
    // which Phase 3's bulletin-action-approve already exercises live with this
    // exact capability set. Adding an unverified `issues.update` string would
    // risk the host install validator — not added. Chat tables are in the
    // plugin namespace so database.namespace.* (above) covers them.
    // Plan 03-08 — the dead Option C `agent.tools.register` capability was
    // removed. The 2026-05-16 closure re-drill live-disproved Option C: a
    // `claude_local` managed agent's session never receives a plugin-declared
    // tool. The readback is now an issue-document poll (issue.documents.read,
    // already declared above) — no plugin tool is registered.
  ],
  entrypoints: {
    worker: './dist/worker.js',
    ui: './dist/ui',
  },
  database: {
    migrationsDir: 'migrations',
    // SDK 2026.512.0 PluginDatabaseCoreReadTable union does NOT include
    // 'users' (verified empirically by tsc against
    // @paperclipai/plugin-sdk/dist/types.d.ts). The plan's research-doc
    // example listed 'users' from a stale SDK shape — same drift pattern as
    // the Task 1 schema corrections (manifest.id, entrypoints, etc.). If
    // we need user-row reads later (e.g. Reader view's "blocked by Eric"
    // display), we read via a worker handler that hits the host's user API
    // rather than direct DB SELECT — cleaner privilege boundary anyway.
    coreReadTables: [
      'issues',
      'issue_comments',
      'issue_documents',
      'agents',
      'companies',
      'projects',
    ],
  },
  ui: {
    slots: [
      {
        type: 'detailTab',
        id: 'clarity-reader',
        displayName: 'Reader',
        exportName: 'ReaderView',
        entityTypes: ['issue'],
      },
      {
        type: 'page',
        id: 'clarity-situation',
        displayName: 'Situation Room',
        exportName: 'SituationRoom',
        routePath: 'situation-room',
      },
      {
        type: 'page',
        id: 'clarity-bulletin',
        displayName: 'Daily Bulletin',
        exportName: 'BulletinPage',
        routePath: 'bulletin',
      },
      {
        type: 'page',
        id: 'clarity-chat',
        displayName: 'Employee Chat',
        exportName: 'ChatPage',
        routePath: 'chat',
      },
      // Plan 05-08 (D-15) — Archive full-view page. Resolves to
      // /<companyPrefix>/archive (NOT /clarity-pack/archive — see runbook
      // memory `clarity-pack-plugin-page-routes`). The host concatenates
      // the company prefix with the routePath; matching the existing
      // bulletin / situation-room / chat shape.
      {
        type: 'page',
        id: 'clarity-archive',
        displayName: 'Archive',
        exportName: 'ArchivePage',
        routePath: 'archive',
      },
      {
        type: 'settingsPage',
        id: 'clarity-settings',
        displayName: 'Clarity Pack',
        exportName: 'SettingsPage',
      },
    ],
    // Plan 250529 Task 3 — LAUNCHER NAV ENTRIES. The four surfaces above are
    // declared as ui.slots (page routes), but slots alone ship NO nav affordance
    // — pre-1.1.0 the only way to reach them was a direct URL. These launchers
    // surface Situation Room / Daily Bulletin / Employee Chat as left-nav entries.
    //
    // Verified against paperclipai/paperclip@master (2026-05-29):
    //   • placementZone 'sidebar' is the ONLY zone rendered in the persistent
    //     left <nav> (ui/src/components/Sidebar.tsx mounts
    //     <PluginLauncherOutlet placementZones={['sidebar']}/>). Requires the
    //     'ui.sidebar.register' capability declared above.
    //   • action.target for a 'navigate' launcher is the BARE routePath — the
    //     host prepends /<companyPrefix>/ for relative targets
    //     (ui/src/plugins/launchers.tsx resolveLauncherNavigationTarget). A
    //     leading '/' would be treated as already-absolute and skip the prefix,
    //     landing on the wrong company — so target is 'situation-room', NOT
    //     '/BEAAA/situation-room' and NOT the slot id 'clarity-situation'.
    //   • ui.launchers (nested) is the non-legacy home (preferred over the
    //     legacy top-level launchers field); the host loader + validator read
    //     both. Targets match the page slots' routePaths exactly.
    launchers: [
      {
        id: 'clarity-launch-situation-room',
        displayName: 'Situation Room',
        description: 'Clarity Pack — live cockpit of every agent',
        placementZone: 'sidebar',
        order: 1,
        action: { type: 'navigate', target: 'situation-room' },
      },
      {
        id: 'clarity-launch-bulletin',
        displayName: 'Daily Bulletin',
        description: 'Clarity Pack — morning editorial digest',
        placementZone: 'sidebar',
        order: 2,
        action: { type: 'navigate', target: 'bulletin' },
      },
      {
        id: 'clarity-launch-chat',
        displayName: 'Employee Chat',
        description: 'Clarity Pack — chat with any employee',
        placementZone: 'sidebar',
        order: 3,
        action: { type: 'navigate', target: 'chat' },
      },
    ],
  },
  // Plan 02-03 Task 1 — Editor-Agent (Editorial Desk) declaration. Per
  // PluginManagedAgentDeclaration shape (verified against
  // node_modules/@paperclipai/shared/dist/types/plugin.d.ts:86 + the
  // plugin-llm-wiki example at
  // paperclipai/paperclip@master:packages/plugins/plugin-llm-wiki/src/manifest.ts:152).
  //
  // Adapter preference per D-04..D-07: claude_local first (Eric's chosen
  // adapter for v1 dogfood), process fallback (host installs an in-process
  // adapter if claude_local isn't configured). The actual LLM provider is
  // configured by the operator via the Paperclip agent panel after install —
  // we never bake API keys into the plugin manifest.
  //
  // MCP server invocation is described in the adapterConfig.mcpServers map
  // (the shape the claude_local adapter expects). The version pin
  // 2026.512.0 matches @paperclipai/mcp-server's date-based npm version; npx
  // -y pulls it on first launch.
  // Plan 02-04 Task 2 — D-03 configurable cadence for Situation Room.
  // Host validates the resolved values against this JSON-schema-shaped object
  // before the worker boots; ctx.config.get() returns them. UI reads via the
  // 'clarity-pack/get-instance-config' worker handler (per 02-01 Check F
  // FALLBACK — SDK 2026.512.0 does not export useInstanceConfig).
  // Note: PaperclipPluginManifestV1 types instanceConfigSchema as JsonSchema
  // (Record<string, unknown>). Zod is the docstring-suggested authoring tool
  // for validation, but the manifest itself ships JSON-schema-shaped data.
  instanceConfigSchema: {
    type: 'object',
    properties: {
      situationRefreshIntervalMs: {
        type: 'number',
        minimum: 30_000,
        maximum: 600_000,
        default: 60_000,
        description:
          'Situation Room polling cadence in milliseconds. Mockup shows 30s; default 60s per D-03. ' +
          'Configurable via Paperclip admin UI; the running plugin picks up changes on next configChanged.',
      },
      // Plan 03-01 — Daily Bulletin config (D-20 departments, BULL-01 timezone).
      bulletinDepartments: {
        type: 'array',
        items: { type: 'string' },
        default: ['Production', 'Sales', 'Customer', 'Builder'],
        description: 'D-20: department sections rendered in the Daily Bulletin.',
      },
      bulletinTimezone: {
        type: 'string',
        default: 'Asia/Jerusalem',
        description:
          'BULL-01: IANA timezone for the 06:30 daily bulletin compile. Default Asia/Jerusalem (2026-05-28 — both founders work in Israel). Now wired through computeNextDueAt(now, tz); change this value (any IANA zone, e.g. America/New_York) and the next compile-bulletin tick recomputes next_due_at in the new zone.',
      },
      // Phase 6.1 ROOM-10 (D-05) — Situation Room per-agent artifact chip row
      // window. Mirrors the Phase 2 D-03 situationRefreshIntervalMs shape. The
      // situation.artifacts data handler reads this at dispatch time; unknown
      // / out-of-enum values coerce to '24h' at handler entry (T-06.1-10
      // mitigation -- never trust the raw config string in SQL). 24h matches
      // the Surface 2 mockup's verbatim "Artifacts shipped today" copy.
      situationArtifactsWindow: {
        type: 'string',
        enum: ['24h', '7d', '30d'],
        default: '24h',
        description:
          'Window for the Situation Room per-agent artifact chip row (ROOM-10). Default 24h matches the Surface 2 verbatim copy.',
      },
    },
  },
  // Plan 02-04 Task 2 — recompute-situation 60s cron job. The handler in
  // src/worker/jobs/situation-snapshot.ts no-ops when no row in
  // plugin_clarity_pack_cdd6bda4bd.active_viewers is < 90s old, so the
  // expensive snapshot only runs when ≥1 user has the Situation Room open.
  jobs: [
    {
      jobKey: 'recompute-situation',
      schedule: '*/1 * * * *',
      displayName: 'Recompute Situation Room snapshot',
    },
    // Plan 03-01 — fires every minute; the handler in
    // src/worker/jobs/compile-bulletin.ts reads bulletins.next_due_at and
    // only compiles when `now >= next_due_at`. The cron string is a
    // heartbeat HINT per D-12 — the worker-managed next_due_at (computed via
    // date-fns-tz in America/New_York) is the DST-safe source of truth.
    {
      jobKey: 'compile-bulletin',
      schedule: '*/1 * * * *',
      displayName: 'Compile Daily Bulletin (DST-safe; worker-managed next_due_at)',
    },
  ],
  agents: [
    {
      agentKey: 'editor-agent',
      displayName: 'Editor-Agent',
      role: 'editor',
      title: 'Editorial Desk',
      icon: 'feather',
      capabilities:
        'Compiles TL;DRs, critical-path narratives, and the Daily Bulletin from Paperclip issue + activity context. Always attributes to "Editorial Desk".',
      adapterType: 'claude_local',
      adapterPreference: ['claude_local', 'process'],
      adapterConfig: {
        // MCP server config — claude_local adapter pattern; the host wires
        // these stdio commands into the agent's tool surface at run time.
        mcpServers: {
          paperclip: {
            command: 'npx',
            args: ['-y', '@paperclipai/mcp-server@2026.512.0'],
          },
        },
      },
      // Start paused so Eric can review the agent in classic UI before
      // anything runs — coexistence-friendly default.
      status: 'paused',
      // No monthly budget cap baked into the manifest; Eric sets per-company
      // via classic admin UI. D-05 MAX_TOKENS=4000 lives in compile-tldr.ts
      // (input-side cap), not here.
      budgetMonthlyCents: 0,
      // Plan 03-08 — the Option C `permissions.pluginTools` block was removed.
      // The 2026-05-16 closure re-drill live-disproved Option C: a
      // `claude_local` managed agent's session never receives a plugin-declared
      // tool, so no plugin-tool grant is needed.
      instructions: {
        // Plan 03-08 — the agent delivers its result as an issue DOCUMENT keyed
        // `compile-result` (Option B). The 03-07 plugin-tool channel is dead.
        // NOTE: this static manifest instructions.content does
        // NOT propagate to an already-existing managed agent (reconcile() sets
        // instructions at creation only — debug doc ROOT CAUSE). The real
        // delivery contract reaches the live agent through the operation-issue
        // DESCRIPTION, which agent-task-delivery.ts appends RESULT_DELIVERY_
        // INSTRUCTION to on every compile. This content is informational only —
        // it must not contradict that description-borne instruction.
        content:
          'You are the Clarity Pack Editorial Desk. ' +
          'On each heartbeat, look in your inbox for an issue assigned to you whose originKind starts with "plugin:clarity-pack:operation:". That issue is a task from Clarity Pack — process it as follows. ' +
          'If the originKind is "plugin:clarity-pack:operation:bulletin-compile": the issue DESCRIPTION is a complete compile prompt. Follow it exactly. The prompt carries the facts table and the {{NUMBER:key}} placeholder rules — never invent numbers, use the placeholders. The result is the raw BulletinDraft JSON object (no prose preamble, no markdown code fences, no sign-off — the JSON object and nothing else). ' +
          'If the originKind is "plugin:clarity-pack:operation:tldr-compile": the issue DESCRIPTION is a TL;DR compile prompt. Follow it exactly and produce ONLY the requested TL;DR text (in the format the prompt specifies). Never write more than 8000 characters in a single TL;DR. ' +
          'If the originKind is "plugin:clarity-pack:operation:bulletin-gloss": the issue DESCRIPTION is a bulletin lineage gloss prompt. Follow it exactly and produce ONLY the STRICT JSON object it requests — an object mapping each thread id to a single plain-English sentence — with no prose, no markdown, no code fence, and no UUIDs or internal identifiers inside the sentences. ' +
          'When the operation is complete, deliver the result by storing it as an issue DOCUMENT on that operation issue, using the EXACT document key "compile-result" — for a bulletin-compile issue the document body is the raw BulletinDraft JSON object; for a tldr-compile issue it is the raw TL;DR text; for a bulletin-gloss issue it is the raw id-to-sentence JSON object. Then mark the operation issue done. The document keyed "compile-result" is the delivery channel the Clarity Pack worker reads. ' +
          'The "Editorial Desk" voice and sign-off rule apply to NARRATIVE prose you write INSIDE a draft (for example a department editorialSummary) — but the body of the "compile-result" document is the raw JSON object (bulletin-compile) or the raw TL;DR text (tldr-compile) only. ' +
          'If you cannot produce a useful result, store a "compile-result" document whose body is the literal string "Insufficient context" — the host treats that as a graceful skip.',
      },
    },
  ],
  // Plan 03-08 — the Option C `tools[]` array (the dead result-delivery tool)
  // was removed. The 2026-05-16 closure re-drill live-disproved Option C: a
  // `claude_local` managed agent's session never receives a plugin-declared
  // tool. The Editor-Agent now delivers its result as an issue document keyed
  // `compile-result` (Option B), read back by agent-task-delivery.ts.
};

export default manifest;
