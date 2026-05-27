// src/ui/surfaces/chat/deep-link.mjs
//
// Plan 04.2-02 Task 2 — the ONE verified Reader->Chat deep-link contract
// (originally GAP-RCB-03-DEEPLINK).
// Plan 04.2-03 Task 2 — carrier swap to URL_HASH (GAP-RCB-03-CARRIER).
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
// Plan 04.2-02 swapped the carrier from `?query` to `{ state }` and shipped
// 0.9.1. The second Countermoves drill 2026-05-23 proved that the host's
// `useHostNavigation().navigate()` wrapper ALSO strips `{ state }` before
// reaching react-router's useNavigate — `history.state.usr` was `null` on
// the live host. Plan 04.2-02 swapped one stripped carrier for another.
//
// Plan 04.2-03 ran an empirical carrier-survival probe on the live host
// (scripts/probes/carrier-survival.mjs OPERATOR-OUTPUT, run 2026-05-23 on
// COU-2215). The probe proved that the URL FRAGMENT (`window.location.hash`)
// SURVIVES end-to-end: setting `window.location.href = '/COU/chat#h=<encoded>'`
// from the Reader tab results in `window.location.hash === '#h=<encoded>'`
// at the chat-surface mount, and the encoded payload base64+JSON-decodes
// back to the exact original. RFC 3986 fragments are client-side-only and
// never reach the server / never pass through the host's path-routing or
// resolveHref step — which is exactly why the host cannot strip them.
//
// THE FIX — one contract, carried on the one channel the live host
// PRESERVES end-to-end: the URL fragment.
//
//   `buildChatDeepLink` builds  `/<prefix>/chat#h=<encodeURIComponent(btoa(
//                                JSON.stringify(payload)))>` — a single
//                                argument to navigate(). NO `state:` option.
//   `parseChatDeepLink({ hash })` decodes the fragment back. (search + state
//                                are kept as defensive fallbacks for tolerant
//                                input handling but no longer carry the
//                                canonical payload.)
//
// The `?query` tail and the `state` argument are both DROPPED from the build
// shape entirely. Their previously-stated semantics did not survive the live
// host. Backward compatibility with 0.9.0 `?query` URLs or 0.9.1 `{ state }`
// payloads is intentionally NOT preserved — neither carrier ever worked
// end-to-end on this host, so there are no in-the-wild URLs to preserve.
//
// SECURITY (threat_model T-04.2-03-01..06): every field is treated as an
// untrusted operator-controlled string. `parseChatDeepLink` tolerates missing
// / extra / malformed keys without throwing (try/catch around base64-decode
// + JSON.parse) and returns plain strings only — the caller renders them as
// controlled React input values, never dangerouslySetInnerHTML.
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
 * Returns the navigate() arguments for the URL_HASH carrier (Plan 04.2-03):
 *   - `to`    — `/<prefix>/chat#h=<encodeURIComponent(btoa(JSON.stringify(
 *               payload)))>` — the encoded payload rides in the URL fragment.
 *               The fragment is client-side-only per RFC 3986; the host's
 *               company-prefix `resolveHref` step is path-only and cannot
 *               touch it. The Countermoves probe 2026-05-23 confirmed
 *               survival end-to-end on COU-2215.
 *   - `state` — `undefined`. The 0.9.1 `state` carrier proved to be stripped
 *               by the host wrapper around useNavigate (history.state.usr ===
 *               null on the live host); we no longer use it.
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
 * @returns {{ to: string, state: undefined } | null}
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
    return { to: appendHash(base, link), state: undefined };
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
    return { to: appendHash(base, link), state: undefined };
  }

  // Phase 6.1 HOTFIX (Plan 06.1-12) — Situation Room "Open chat with [Agent]"
  // engagement entry. The Situation Room agent card needs a deep-link that:
  //
  //   - selects the agent on the chat roster (so the topic strip + context
  //     rail reconcile to the right agent's data)
  //   - does NOT auto-open the New Topic dialog (the agent likely has
  //     existing topics the operator wants to continue, not start fresh)
  //   - does NOT auto-switch to a specific topic (the operator picks from
  //     the topic strip based on what they want to engage with)
  //
  // This route requires only `assigneeAgentId`. The encoded payload carries
  // `{ employee: <id> }` -- no `newTopic`, no `topic`, no seeds. The
  // chat-surface dispatch effect at chat/index.tsx detects this shape and
  // calls setEmployee(matched) only (Plan 06.1-12 dispatch branch).
  if (input.route === 'employee-only' && str(input.assigneeAgentId)) {
    /** @type {ChatDeepLink} */
    const link = {
      topic: null,
      comment: null,
      employee: str(input.assigneeAgentId),
      newTopic: false,
      seedTitle: null,
      seedBody: null,
      originIssueId: null,
    };
    return { to: appendHash(base, link), state: undefined };
  }

  return null;
}

/**
 * Build a topic-only deep link — the shape ReverseTopicsLink (RCB-06) needs.
 * Same contract as `buildChatDeepLink` existing-topic with optional employee.
 *
 * Plan 05-05 Task 3 (D-10) — added optional third parameter `employeeUserId`.
 * When provided AND non-empty, it threads into the encoded payload as
 * `employee` so the chat-surface dispatch (Plan 04.2-04) can match the roster
 * row and `setEmployee` BEFORE `setTopic`. Closes GAP-PICKER-ROW-DISPATCH
 * from the rc.7 drill — picker-row click lands on the thread, not the empty
 * `Select an employee` state. When omitted OR empty, behaviour is exactly the
 * pre-05-05 2-arg form (back-compat preserved).
 *
 * @param {string} companyPrefix
 * @param {string} topicIssueId
 * @param {string} [employeeUserId] — Plan 05-05 D-10. Optional.
 * @returns {{ to: string, state: undefined } | null}
 */
export function buildTopicDeepLink(companyPrefix, topicIssueId, employeeUserId) {
  return buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix,
    topicIssueId,
    // Belt-and-suspenders: explicit type+length check here AND the str()
    // helper inside buildChatDeepLink also handles empty-string defensively.
    // Both arms converge on the same null/non-null fork.
    assigneeAgentId:
      typeof employeeUserId === 'string' && employeeUserId.length > 0
        ? employeeUserId
        : undefined,
  });
}

/**
 * Append the deep-link params to a path as a `#h=<encoded>` URL fragment.
 * Plan 04.2-03 carrier: btoa(JSON.stringify(payload)) then
 * encodeURIComponent so the encoded base64 survives any future server-side
 * URL parsing should one be added (fragments are client-side-only today but
 * the encoding is defensive).
 */
function appendHash(base, link) {
  // Build a compact payload — only carry fields that have meaning per route,
  // so the encoded blob stays small. The decoder fills the rest with null.
  /** @type {Record<string, unknown>} */
  const payload = link.newTopic
    ? {
        newTopic: true,
        ...(link.employee ? { employee: link.employee } : {}),
        seedTitle: link.seedTitle ?? '',
        seedBody: link.seedBody ?? '',
        ...(link.originIssueId ? { originIssueId: link.originIssueId } : {}),
      }
    : {
        ...(link.topic ? { topic: link.topic } : {}),
        ...(link.comment ? { comment: link.comment } : {}),
        ...(link.employee ? { employee: link.employee } : {}),
      };
  const encoded = encodeURIComponent(b64encode(JSON.stringify(payload)));
  return `${base}#h=${encoded}`;
}

/**
 * Read one deep link back from the host router. The CANONICAL channel is
 * the URL fragment (Plan 04.2-03 URL_HASH carrier — proven to survive
 * end-to-end on the live Countermoves host). `search` and `state` arguments
 * are accepted for API compatibility / defensive input handling but no
 * longer carry the canonical payload — neither survives this host's
 * navigate() -> useHostLocation() handoff.
 *
 * Tolerates missing / extra / malformed input without throwing
 * (T-04.2-03-05): a missing fragment is null, a malformed base64 / JSON
 * is null, an unknown key is ignored. Every returned field is a plain
 * decoded string.
 *
 * @param {{ search?: string|null, state?: unknown, hash?: string|null }} location
 *   the `useHostLocation()` snapshot — pass `{ search, state, hash }`.
 * @returns {ChatDeepLink|null} null when no deep link is present.
 */
export function parseChatDeepLink(location) {
  if (!location || typeof location !== 'object') return null;

  // --- canonical channel: the URL fragment `#h=<base64-JSON>` ------------
  const hashLink = readFromHash(location.hash);
  if (hashLink) return hashLink;

  // No fragment present — return null. The 0.9.0 `?query` and 0.9.1 `state`
  // carriers are no longer canonical. Backward-compat for them is
  // intentionally not preserved (neither ever worked end-to-end on this
  // host, so there are no in-the-wild URLs to preserve).
  return null;
}

/** Pull a ChatDeepLink out of a `#h=<base64-JSON>` URL fragment. */
function readFromHash(hash) {
  if (typeof hash !== 'string' || hash.length === 0) return null;
  if (!hash.startsWith('#h=')) return null;
  const encoded = hash.slice(3);
  if (encoded.length === 0) return null;
  let payload;
  try {
    const json = b64decode(decodeURIComponent(encoded));
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (payload);
  const newTopic = r.newTopic === true;
  const topic = str(r.topic);
  if (!newTopic && !topic) return null;
  return {
    topic,
    comment: str(r.comment),
    employee: str(r.employee),
    newTopic,
    seedTitle:
      typeof r.seedTitle === 'string' ? r.seedTitle : newTopic ? '' : null,
    seedBody:
      typeof r.seedBody === 'string' ? r.seedBody : newTopic ? '' : null,
    originIssueId: str(r.originIssueId),
  };
}

/** btoa / atob isomorphic shim — same-origin plugin UI runs in the browser
 *  (window.btoa available), but Node's test runner needs Buffer fallback. */
function b64encode(s) {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf8').toString('base64');
}
function b64decode(s) {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('utf8');
}
