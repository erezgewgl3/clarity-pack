// src/ui/surfaces/chat/deep-link.mjs
//
// Plan 04.2-02 Task 2 — the ONE verified Reader->Chat deep-link contract
// (GAP-RCB-03-DEEPLINK).
//
// ============================================================================
// WHY THIS MODULE EXISTS — the test-gap from 04.2-VERIFICATION.md
// ============================================================================
// Plan 04.2-01 built the Reader->Chat deep link as two halves that NEVER
// agreed: continue-in-chat-button.tsx EMITTED a query string via
// `useHostNavigation().navigate('/COU/chat?topic=...')`, and chat/index.tsx
// READ it via `useHostLocation().search`. The unit tests mocked the two host
// hooks INDEPENDENTLY — each half was tested against its own compatible fake —
// so the real cross-hook handoff was never exercised. The live Countermoves
// drill found the params dropped on both drilled paths.
//
// EMPIRICAL SDK FINDING (verified against node_modules/@paperclipai/plugin-sdk
// /dist/ui/{types.d.ts,hooks.js,runtime.js}, the SDK ESM the host loads):
//   - The SDK does NOT implement navigate / useHostLocation. They are thin
//     stubs: `getSdkUiRuntimeValue('useHostNavigation')` pulls the host's
//     real impl off `globalThis.__paperclipPluginBridge__.sdkUi` at runtime.
//   - The TYPE CONTRACT (types.d.ts) is the only stable surface:
//       * `HostLocation.search` — "Mirrors the relevant subset of `Location`
//         from react-router-dom" — i.e. the host wraps react-router.
//       * `HostNavigation.navigate(to, options?)` first runs `to` through
//         `resolveHref(to)` to apply the company prefix. `resolveHref` is
//         documented purely in PATH terms ("resolveHref('/wiki') -> '/PAP/
//         wiki'") — it makes NO guarantee about preserving a `?query` tail.
//       * `HostNavigationOptions.state` — "Optional state forwarded to the
//         host router" — and `HostLocation.state` — "Optional state forwarded
//         by the host router for same-tab SPA navigation."
//   - The drill proved the query string in `to` did NOT reach
//     `useHostLocation().search` on this host: the company-prefix `resolveHref`
//     step is the strip point (a path-only prefixer drops/garbles the `?tail`).
//
// THE FIX — one contract, carried on the channel the SDK type contract
// GUARANTEES end-to-end: `navigate()`'s `state` option -> `useHostLocation()
// .state`. `state` is a structured JS value forwarded verbatim by the host
// router; it never passes through path/URL parsing, so `resolveHref` cannot
// touch it. The query string is ALSO appended to `to` as a best-effort
// refresh / copy-link fallback (a reloaded chat URL with no React `state` can
// still recover the params from `search`).
//
// `buildChatDeepLink` (emit) and `parseChatDeepLink` (read) are the two ends
// of that single contract. The cross-hook regression test
// (continue-in-chat-deeplink-contract.test.mjs) feeds one's output straight
// into the other through ONE shared router-state object — never two
// independently-stubbed hooks.
//
// SECURITY (threat_model T-04.2-02-01..05): every field is treated as an
// untrusted operator-controlled string. `parseChatDeepLink` tolerates missing
// / extra / malformed keys without throwing and returns plain strings only —
// the caller renders them as controlled React input values, never
// dangerouslySetInnerHTML.
//
// `.mjs` (not `.tsx`): this is pure I/O-free logic and Node's test runner
// loads `.mjs` directly — the same pattern as
// src/ui/surfaces/chat/reasoning-block-parser.mjs.
// ============================================================================

/** The six deep-link params the Reader->Chat bridge carries. */
/**
 * @typedef {Object} ChatDeepLink
 * @property {string|null} topic         existing-topic: the topic ISSUE id
 * @property {string|null} comment       existing-topic: a comment to flash
 * @property {string|null} employee      the roster employee agent id
 * @property {boolean}     newTopic      new-topic-needed: open the seeded dialog
 * @property {string|null} seedTitle     new-topic: pre-filled topic title
 * @property {string|null} seedBody      new-topic: pre-filled first message
 * @property {string|null} originIssueId new-topic: the source issue (RCB-04)
 */

/** A non-empty trimmed string, or null. Defends every field against junk. */
function str(value) {
  if (typeof value !== 'string') return null;
  return value.length > 0 ? value : null;
}

/**
 * Build the Reader->Chat deep link for a resolved route.
 *
 * Returns BOTH halves of the one contract:
 *   - `to`    — the path WITH a `?query` tail (the refresh / copy-link
 *               fallback; also keeps the URL human-readable).
 *   - `state` — the structured params object, carried on `navigate()`'s
 *               `state` option. THIS is the load-bearing channel: the host
 *               forwards it verbatim to `useHostLocation().state`, untouched
 *               by the company-prefix `resolveHref` step.
 *
 * @param {Object} input
 * @param {'existing-topic'|'new-topic-needed'} input.route
 * @param {string} input.companyPrefix      e.g. "COU"
 * @param {string} [input.topicIssueId]
 * @param {string} [input.sourceCommentId]
 * @param {string} [input.assigneeAgentId]
 * @param {string} [input.seedTitle]
 * @param {string} [input.seedBody]
 * @param {string} [input.originIssueId]
 * @returns {{ to: string, state: { clarityChatDeepLink: ChatDeepLink } } | null}
 *   null when the route is not navigable.
 */
export function buildChatDeepLink(input) {
  if (!input || typeof input !== 'object') return null;
  const base = `/${input.companyPrefix}/chat`;

  if (input.route === 'existing-topic' && str(input.topicIssueId)) {
    /** @type {ChatDeepLink} */
    const link = {
      topic: str(input.topicIssueId),
      comment: str(input.sourceCommentId),
      employee: str(input.assigneeAgentId),
      newTopic: false,
      seedTitle: null,
      seedBody: null,
      originIssueId: null,
    };
    return { to: appendQuery(base, link), state: { clarityChatDeepLink: link } };
  }

  if (input.route === 'new-topic-needed') {
    /** @type {ChatDeepLink} */
    const link = {
      topic: null,
      comment: null,
      employee: str(input.assigneeAgentId),
      newTopic: true,
      seedTitle: typeof input.seedTitle === 'string' ? input.seedTitle : '',
      seedBody: typeof input.seedBody === 'string' ? input.seedBody : '',
      originIssueId: str(input.originIssueId),
    };
    return { to: appendQuery(base, link), state: { clarityChatDeepLink: link } };
  }

  return null;
}

/**
 * Build a topic-only deep link — the shape ReverseTopicsLink (RCB-06) needs.
 * Same contract as `buildChatDeepLink` existing-topic, no comment/employee.
 *
 * @param {string} companyPrefix
 * @param {string} topicIssueId
 * @returns {{ to: string, state: { clarityChatDeepLink: ChatDeepLink } } | null}
 */
export function buildTopicDeepLink(companyPrefix, topicIssueId) {
  return buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix,
    topicIssueId,
  });
}

/** Append the deep-link params to a path as a `?key=value` query string. */
function appendQuery(base, link) {
  const params = new URLSearchParams();
  if (link.newTopic) {
    params.set('newTopic', '1');
    if (link.originIssueId) params.set('originIssueId', link.originIssueId);
    if (link.employee) params.set('employee', link.employee);
    // seedTitle / seedBody are always set (possibly empty) so a refresh-only
    // recovery still finds the keys. URLSearchParams percent-encodes them.
    params.set('seedTitle', link.seedTitle ?? '');
    params.set('seedBody', link.seedBody ?? '');
  } else {
    if (link.topic) params.set('topic', link.topic);
    if (link.comment) params.set('comment', link.comment);
    if (link.employee) params.set('employee', link.employee);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Read one deep link back from the host router. PREFERS the structured
 * `state` channel (the load-bearing one — survives `resolveHref`); falls back
 * to the `search` query string (refresh / copy-link recovery).
 *
 * Tolerates missing / extra / malformed input without throwing (T-04.2-02-05):
 * a missing param is null, `newTopic` is a strict boolean, an unknown key is
 * ignored. Every returned field is a plain decoded string.
 *
 * @param {{ search?: string|null, state?: unknown }} location
 *   the `useHostLocation()` snapshot — pass `{ search, state }`.
 * @returns {ChatDeepLink|null} null when no deep link is present.
 */
export function parseChatDeepLink(location) {
  if (!location || typeof location !== 'object') return null;

  // --- channel 1 (load-bearing): the structured `state` object -------------
  const stateLink = readFromState(location.state);
  if (stateLink) return stateLink;

  // --- channel 2 (fallback): the `?query` string --------------------------
  return readFromSearch(location.search);
}

/** Pull a ChatDeepLink out of `useHostLocation().state`, if one is present. */
function readFromState(state) {
  if (!state || typeof state !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (state).clarityChatDeepLink;
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const newTopic = r.newTopic === true;
  const topic = str(r.topic);
  if (!newTopic && !topic) return null;
  return {
    topic,
    comment: str(r.comment),
    employee: str(r.employee),
    newTopic,
    seedTitle: typeof r.seedTitle === 'string' ? r.seedTitle : newTopic ? '' : null,
    seedBody: typeof r.seedBody === 'string' ? r.seedBody : newTopic ? '' : null,
    originIssueId: str(r.originIssueId),
  };
}

/** Pull a ChatDeepLink out of a `?query` string. URLSearchParams decodes. */
function readFromSearch(search) {
  if (typeof search !== 'string' || search.length === 0 || search === '?') {
    return null;
  }
  const params = new URLSearchParams(search);
  const newTopic = params.get('newTopic') === '1';
  const topic = str(params.get('topic'));
  if (!newTopic && !topic) return null;
  const seedTitle = params.get('seedTitle');
  const seedBody = params.get('seedBody');
  return {
    topic,
    comment: str(params.get('comment')),
    employee: str(params.get('employee')),
    newTopic,
    seedTitle:
      typeof seedTitle === 'string' ? seedTitle : newTopic ? '' : null,
    seedBody: typeof seedBody === 'string' ? seedBody : newTopic ? '' : null,
    originIssueId: str(params.get('originIssueId')),
  };
}
