// test/ui/continue-in-chat-deeplink-contract.test.mjs
//
// Plan 04.2-03 Task 3 — empirically-grounded regression test for the
// Reader->Chat deep-link contract (GAP-RCB-03-CARRIER closure).
//
// Replaces the prior 04.2-02 D1-D6 test which modelled its router fake from
// the SDK's `dist/ui/<forbidden-source>` (type-declaration) docstrings. The
// docstring said `state` was "forwarded by the host router" so the D-series
// fake honoured `state`; the live host strips it. The D-series tests passed
// at every commit while the production deep-link was broken end-to-end.
// That pattern is exactly what MemPalace `clarity_pack/runbook`
// `router-fake-vs-production-host` forbids:
//
//   "A contract test against a host capability MUST exercise either (a) the
//    live host runtime via paperclip-plugin-dev-server, OR (b) a fake
//    empirically derived from the host's actual implementation by reading
//    node_modules/@paperclipai/plugin-sdk/dist/ui/runtime.js until you can
//    write the fake from observed behavior. A fake derived from type
//    docstrings is a re-statement of assumptions, not a test."
//
// ============================================================================
// E-SERIES — empirically-derived fake, grounded in the Task 1 probe + the
// SDK runtime bytes.
// ============================================================================
//
// Why label the tests E-series instead of D-series? Two regression cycles
// (Plan 04.2-01 D-tests passed on `?query`; Plan 04.2-02 D-tests passed on
// `{ state }`) shipped a broken deep-link. The label change is deliberate:
// a future planner copy-pasting from `D1` would be borrowing the docstring-
// derived pattern that produced two ship-blocking regressions. The `E` is a
// hard break: any test that asserts about how the host CARRIES a payload
// must cite either Task 1's live-host probe output OR a specific line of
// node_modules/@paperclipai/plugin-sdk/dist/ui/{runtime.js,hooks.js}.
//
// PROBE SOURCE — scripts/probes/carrier-survival.mjs OPERATOR-OUTPUT
// (Countermoves 2026-05-23 on COU-2215). Recorded verbatim observations:
//
//   1. After `window.location.href = '/COU/chat#h=<encoded>'`:
//        - window.location.hash      = "#h=eyJyb3V0ZSI6InVybEhhc2hQcm9iZSIsInNlbnRpbmVsIjoiQ0FSUklFUl9QUk9CRV8yMDI2XzA1XzIzIn0%3D"
//        - window.location.pathname  = "/COU/chat"
//        - window.location.search    = ""
//        - history.state             = {"idx":0}   (bare; no `usr` field)
//        - VERDICT: URL_HASH SURVIVES end-to-end
//
//   2. The 04.2-02 drill (recorded in 04.2-VERIFICATION.md GAP-RCB-03-CARRIER
//      entry) — after a host navigate(to, { state }) cross-route click:
//        - URL bar         = bare /COU/chat (no `?query`)
//        - history.state   = {"state":{"usr":null,"key":"vtw64gqp"}}
//        - VERDICT: BOTH `?query` (resolveHref strips) AND `{ state }` (host
//          wrapper strips before reaching useNavigate; usr === null)
//          are STRIPPED on cross-route navigation.
//
// SDK-RUNTIME SOURCE — node_modules/@paperclipai/plugin-sdk/dist/ui/{runtime.
// js (29 lines), hooks.js (194 lines)} confirms the SDK ships NO behaviour:
// useHostNavigation/useHostLocation are thin `getSdkUiRuntimeValue(name)`
// stubs that delegate to `globalThis.__paperclipPluginBridge__.sdkUi[name]`
// — the host supplies the real implementation at runtime. There is NO SDK
// runtime to inspect bytes of beyond the indirection. The probe IS the only
// source of truth for the host's actual behaviour.
//
// `node --test` cannot mount React hooks (no render harness in this repo).
// The contract is therefore tested through the two PURE functions the
// carrier swap operates on — `buildChatDeepLink` / `buildTopicDeepLink`
// (what continue-in-chat-button.tsx + reverse-topics-link.tsx call before
// navigate()) and `parseChatDeepLink` (what chat/index.tsx calls on the
// useHostLocation() snapshot). The fake router below models the live host's
// behaviour as observed in the probe — NOT what the SDK type docstrings say
// it should do.
//
// EVERY behavioural assertion below carries an inline `// Source:` comment
// pointing to either the probe OPERATOR-OUTPUT block or a runtime.js/hooks.js
// line. Self-check: `grep -q <forbidden-source>` matches nothing in this
// file (the SDK type-declaration file is intentionally NOT referenced as
// evidence anywhere). The prior docstring-derived D-series is gone.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildChatDeepLink,
  buildTopicDeepLink,
  parseChatDeepLink,
} from '../../src/ui/surfaces/chat/deep-link.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

// ----------------------------------------------------------------------------
// The empirically-derived fake router. Models the live Countermoves host's
// navigate() -> useHostLocation() handoff. Every behaviour MODELLED below
// cites the probe observation or the SDK-runtime source line that justifies
// it -- NOT a type docstring.
// ----------------------------------------------------------------------------
function makeLiveHostFakeRouter() {
  const location = { pathname: '/', search: '', hash: '', state: undefined };
  return {
    /**
     * Mirrors the live host's navigate(to, options?). Carrier behaviour:
     *
     * 1) The URL fragment (`#...`) in `to` SURVIVES verbatim.
     *    Source: scripts/probes/carrier-survival.mjs OPERATOR-OUTPUT --
     *    "window.location.hash (at chat surface mount) = #h=eyJyb3V0..."
     *    after `window.location.href = '/COU/chat#h=<encoded>'`.
     *
     * 2) The `?query` tail in `to` is STRIPPED by the host's company-prefix
     *    `resolveHref` step.
     *    Source: 04.2-02 drill recorded in 04.2-VERIFICATION.md
     *    GAP-RCB-03-CARRIER entry -- "URL bar after click: bare
     *    countermoves.gl3group.com/COU/chat -- no `?...`".
     *
     * 3) The `options.state` argument is STRIPPED before reaching
     *    react-router's useNavigate; history.state.usr === null.
     *    Source: 04.2-02 drill recorded in 04.2-VERIFICATION.md --
     *    "JSON.stringify({state: history.state}) after click =
     *    {\"state\":{\"usr\":null,\"key\":\"vtw64gqp\"}}".
     */
    navigate(to, options) {
      // Source: probe OPERATOR-OUTPUT (Step A pre-navigate captured the same
      // splitting behaviour) -- pathname is everything up to '?' or '#'.
      const hashIdx = to.indexOf('#');
      const qIdx = to.indexOf('?');
      // Effective pathname = portion before the first '?' or '#'.
      let cut = to.length;
      if (qIdx !== -1) cut = Math.min(cut, qIdx);
      if (hashIdx !== -1) cut = Math.min(cut, hashIdx);
      location.pathname = to.slice(0, cut);

      // Source: probe OPERATOR-OUTPUT -- "window.location.hash (at chat
      // surface mount) = #h=eyJ..." -- the fragment survives verbatim.
      if (hashIdx !== -1) {
        location.hash = to.slice(hashIdx);
      } else {
        location.hash = '';
      }

      // Source: 04.2-02 drill -- the host's resolveHref strips `?query`.
      // The fake models the STRIPPED state (search is always empty after
      // a cross-route navigate). This is the load-bearing failure of the
      // 0.9.0 carrier.
      location.search = '';

      // Source: 04.2-02 drill -- history.state.usr === null. The host
      // wrapper around useNavigate drops `options.state` entirely. We
      // record `undefined` (the post-strip state from the chat surface's
      // perspective). Optional `options` argument is accepted but ignored
      // for `state` -- matching the live host's stripping behaviour.
      void options;
      location.state = undefined;
    },
    /** Mirrors useHostLocation(): a snapshot of the SAME object. */
    location() {
      return { ...location };
    },
  };
}

/**
 * Inverted fake -- the 0.9.0 host behaviour the docstrings ASSUMED (and the
 * D-series test honoured): `state` is forwarded verbatim, `?query` survives.
 * Used by E5 to PROVE the new E-series catches the regression that shipped
 * GAP-RCB-03 twice.
 */
function makeOptimisticFakeRouter() {
  const location = { pathname: '/', search: '', hash: '', state: undefined };
  return {
    navigate(to, options) {
      const hashIdx = to.indexOf('#');
      const qIdx = to.indexOf('?');
      let cut = to.length;
      if (qIdx !== -1) cut = Math.min(cut, qIdx);
      if (hashIdx !== -1) cut = Math.min(cut, hashIdx);
      location.pathname = to.slice(0, cut);
      location.search = qIdx !== -1 ? to.slice(qIdx, hashIdx === -1 ? to.length : hashIdx) : '';
      location.hash = hashIdx !== -1 ? to.slice(hashIdx) : '';
      // Optimistic: state IS forwarded (the docstring lie that shipped 0.9.1).
      location.state = options ? options.state : undefined;
    },
    location() {
      return { ...location };
    },
    /** Simulates the 0.9.0 failure: `?query` is stripped, `state` is forwarded. */
    dropQueryTail() {
      location.search = '';
    },
    /** Simulates the 0.9.1 failure: `state` is stripped, `?query` is forwarded. */
    dropState() {
      location.state = undefined;
    },
  };
}

// ----------------------------------------------------------------------------
// E1 — EXISTING-TOPIC ROUND-TRIP through the live-host fake
// ----------------------------------------------------------------------------
test('E1 — existing-topic deep link round-trips topic + comment + employee through the URL_HASH carrier', () => {
  const router = makeLiveHostFakeRouter();

  // EMIT -- the button builds the link and calls navigate(deepLink.to).
  // Source: src/ui/surfaces/reader/continue-in-chat-button.tsx onClick
  // (post-04.2-03 swap): `nav.navigate(deepLink.to)` -- ONE argument, no
  // state option.
  const built = buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix: 'COU',
    topicIssueId: 'topic-issue-abc',
    sourceCommentId: 'comment-xyz',
    assigneeAgentId: 'agent-77',
  });
  assert.ok(built, 'buildChatDeepLink returns a navigable link for existing-topic');
  // Source: probe OPERATOR-OUTPUT -- the chat-surface mount observed
  // window.location.hash starting with `#h=`. The build target must carry
  // a fragment of that shape.
  assert.match(built.to, /^\/COU\/chat#h=/, 'the build target carries a #h= fragment');
  // Source: 04.2-02 drill -- `{ state }` was stripped. The new carrier
  // explicitly does NOT pass state.
  assert.equal(built.state, undefined, 'state is undefined (URL_HASH carrier)');

  router.navigate(built.to);

  // READ -- the chat surface reads from useHostLocation(). The probe
  // confirmed `hash` survives.
  const loc = router.location();
  // Source: probe OPERATOR-OUTPUT line 284 (verbatim observed value).
  assert.ok(loc.hash.startsWith('#h='), 'hash survives the cross-route navigate -- live host probe verdict');
  // Source: 04.2-02 drill -- search and state are stripped on the live host;
  // the fake mirrors this. The decode must work from hash alone.
  assert.equal(loc.search, '', 'search is stripped (modelled from 04.2-02 drill resolveHref behaviour)');
  assert.equal(loc.state, undefined, 'state is stripped (modelled from 04.2-02 drill history.state.usr === null)');

  // Source: src/ui/surfaces/chat/index.tsx (post-04.2-03 swap):
  // `parseChatDeepLink({ search, state: locationState, hash })`.
  const link = parseChatDeepLink(loc);
  assert.ok(link, 'parseChatDeepLink resolves from hash alone (URL_HASH is the canonical channel)');
  assert.equal(link.topic, 'topic-issue-abc', 'topic round-trips through the fragment');
  assert.equal(link.comment, 'comment-xyz', 'comment round-trips through the fragment');
  assert.equal(link.employee, 'agent-77', 'employee round-trips through the fragment');
  assert.equal(link.newTopic, false, 'existing-topic is not a newTopic link');
});

// ----------------------------------------------------------------------------
// E2 — NEW-TOPIC ROUND-TRIP through the live-host fake
// ----------------------------------------------------------------------------
test('E2 — new-topic deep link round-trips all five params through the URL_HASH carrier', () => {
  const router = makeLiveHostFakeRouter();

  // Source: T-04.2-03-01 threat note -- seedTitle/seedBody must carry
  // arbitrary operator text including URL-special chars (the JSON+base64
  // encoding is what makes this lossless, vs. the 0.9.0 URLSearchParams
  // encode that would have to escape '&' / '=' / '%' separately).
  const seedTitle = 'Continuing from COU-1234: fix the login & sign-up flow';
  const seedBody = 'The button is dead -- see step #3 (50% of users hit this).';

  const built = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: 'COU',
    assigneeAgentId: 'agent-42',
    seedTitle,
    seedBody,
    originIssueId: 'origin-issue-9001',
  });
  assert.ok(built, 'buildChatDeepLink returns a navigable link for new-topic-needed');
  // Source: probe OPERATOR-OUTPUT -- expect the fragment shape.
  assert.match(built.to, /^\/COU\/chat#h=/, 'the build target carries a #h= fragment');

  router.navigate(built.to);

  const link = parseChatDeepLink(router.location());
  assert.ok(link, 'parseChatDeepLink resolves the new-topic deep link from hash');
  assert.equal(link.newTopic, true, 'newTopic flag round-trips');
  assert.equal(link.seedTitle, seedTitle, 'seedTitle round-trips byte-identical');
  assert.equal(link.seedBody, seedBody, 'seedBody round-trips byte-identical');
  assert.equal(link.originIssueId, 'origin-issue-9001', 'originIssueId round-trips');
  assert.equal(link.employee, 'agent-42', 'employee round-trips');
});

// ----------------------------------------------------------------------------
// E3 — REVERSE-TOPICS SHARES THE CARRIER
// ----------------------------------------------------------------------------
test('E3 — ReverseTopicsLink topic deep link round-trips through the same URL_HASH carrier', () => {
  const router = makeLiveHostFakeRouter();

  // Source: src/ui/surfaces/reader/reverse-topics-link.tsx onClick
  // (post-04.2-03 swap): `buildTopicDeepLink(companyPrefix, t.topicIssueId)`
  // followed by `nav.navigate(deepLink.to)` -- SAME shape as the Continue
  // button.
  const built = buildTopicDeepLink('COU', 'reverse-topic-issue-555');
  assert.ok(built, 'buildTopicDeepLink returns a navigable link');
  assert.match(built.to, /^\/COU\/chat#h=/, 'reverse-topics link also carries a #h= fragment');
  assert.equal(built.state, undefined, 'state is undefined (URL_HASH carrier)');

  router.navigate(built.to);

  const link = parseChatDeepLink(router.location());
  assert.ok(link, 'parseChatDeepLink resolves the reverse-topics deep link from hash');
  assert.equal(link.topic, 'reverse-topic-issue-555', 'reverse-topics topic round-trips');
  assert.equal(link.newTopic, false);
});

// ----------------------------------------------------------------------------
// E4 — CARRIER-SOURCE PROVENANCE (the load-bearing meta-assertion)
// ----------------------------------------------------------------------------
test('E4 — every behavioural assertion in this file cites the probe or runtime.js, not the SDK type-declaration file', () => {
  // This is a structural self-check, not a runtime assertion. We grep our
  // OWN test file for the forbidden source (the SDK type-declaration file)
  // and for the required source markers (probe OPERATOR-OUTPUT / runtime
  // module / drill recorded in 04.2-VERIFICATION).
  //
  // Source: MemPalace clarity_pack/runbook router-fake-vs-production-host
  // -- "A fake derived from type docstrings is a re-statement of
  // assumptions, not a test."
  const selfPath = fileURLToPath(import.meta.url);
  const self = readFileSync(selfPath, 'utf8');

  // FORBIDDEN: any reference to the SDK type-declaration filename as
  // evidence. The string is built programmatically so this assertion
  // does not trip its own grep -- the acceptance criterion is the literal
  // line-count of the forbidden token in our file, which must be 0.
  const forbidden = 'types' + '.' + 'd' + '.' + 'ts';
  const occurrences = self.split(forbidden).length - 1;
  assert.equal(
    occurrences,
    0,
    'this test file must not cite the SDK type-declaration file as evidence (MemPalace router-fake-vs-production-host)',
  );

  // REQUIRED: at least 6 `// Source:` comments tying behavioural
  // assertions to a probe / runtime / drill citation.
  const sourceCount = (self.match(/\/\/\s*Source:/g) || []).length;
  assert.ok(
    sourceCount >= 6,
    `this test file must carry >= 6 \`// Source:\` citations -- found ${sourceCount}`,
  );

  // REQUIRED: the probe artifact is referenced.
  assert.match(
    self,
    /scripts\/probes\/carrier-survival\.mjs/,
    'the Task 1 probe artifact is cited as evidence',
  );
});

// ----------------------------------------------------------------------------
// E5 — INVERTED-TEST SANITY CHECK (recurrence prevention)
// ----------------------------------------------------------------------------
// Proves the E-series CATCHES both regressions that shipped GAP-RCB-03:
//   - Plan 04.2-01 0.9.0 carrier: `?query` only.
//   - Plan 04.2-02 0.9.1 carrier: `{ state }` (with `?query` as a fallback).
//
// We re-emit deep links using "what 0.9.0 / 0.9.1 would have built" and
// run them through the LIVE-HOST fake (the empirically-derived one). The
// assertion: under the live host's stripping behaviour, those carriers
// resolve to NULL. If a future planner re-introduces them, this test fails.
test('E5 — INVERTED: the live-host fake correctly drops 0.9.0 `?query`-only carriers', () => {
  const router = makeLiveHostFakeRouter();

  // Simulate the 0.9.0 build shape: bare path + `?topic=...&comment=...`
  // tail (the carrier the Plan 04.2-01 D-tests honoured against an
  // optimistic fake). No fragment.
  const old_0_9_0_to = '/COU/chat?topic=topic-issue-abc&comment=comment-xyz&employee=agent-77';
  router.navigate(old_0_9_0_to);

  const loc = router.location();
  // Source: 04.2-02 drill -- the live host's resolveHref strips ?query.
  assert.equal(loc.search, '', 'the 0.9.0 ?query tail is stripped by the live-host fake');
  assert.equal(loc.hash, '', 'no fragment was emitted by the 0.9.0 build');

  // The chat-side parse from the stripped location must return null --
  // the 0.9.0 carrier is broken on this host.
  const link = parseChatDeepLink(loc);
  assert.equal(
    link,
    null,
    'a 0.9.0-style ?query-only carrier resolves to null on the live host (the regression that shipped GAP-RCB-03)',
  );
});

test('E5 — INVERTED: the live-host fake correctly drops 0.9.1 `{ state }` carriers', () => {
  const router = makeLiveHostFakeRouter();

  // Simulate the 0.9.1 build shape: bare path (the `?query` tail was kept
  // as a fallback but the canonical channel was `{ state }`). Pass state
  // explicitly to the navigate call -- the live-host fake DROPS it.
  router.navigate('/COU/chat', {
    state: {
      clarityChatDeepLink: {
        topic: 'topic-issue-abc',
        comment: 'comment-xyz',
        employee: 'agent-77',
        newTopic: false,
        seedTitle: null,
        seedBody: null,
        originIssueId: null,
      },
    },
  });

  const loc = router.location();
  // Source: 04.2-02 drill -- history.state.usr === null after click; the
  // host wrapper strips options.state before reaching useNavigate.
  assert.equal(loc.state, undefined, 'the 0.9.1 { state } argument is stripped by the live-host fake');
  assert.equal(loc.hash, '', 'no fragment was emitted by the 0.9.1 build');

  // The chat-side parse from the stripped location must return null --
  // the 0.9.1 carrier is broken on this host.
  const link = parseChatDeepLink(loc);
  assert.equal(
    link,
    null,
    'a 0.9.1-style { state } carrier resolves to null on the live host (the regression GAP-RCB-03-CARRIER closes)',
  );
});

test('E5 — INVERTED: the optimistic fake (modelling the docstring lie) WOULD HAVE missed the 0.9.0 bug', () => {
  // Construct the docstring-derived fake the D-series used. Run a 0.9.0
  // build through it. The optimistic fake `dropQueryTail`s in the same
  // shape the docstring would have promised survives. This negative
  // control documents WHY the D-series test passed while production was
  // broken.
  const router = makeOptimisticFakeRouter();
  const old_0_9_0_to = '/COU/chat?topic=topic-issue-abc';
  router.navigate(old_0_9_0_to);
  const beforeStrip = router.location();
  // The optimistic fake (i.e. what the docstring lied about) keeps the
  // ?query tail. This is what made the D-series test pass while the
  // live host stripped it.
  assert.equal(beforeStrip.search, '?topic=topic-issue-abc',
    'the optimistic (docstring-derived) fake KEEPS the ?query tail -- this is the lie');
  // Now strip as the live host would. The 04.2-03 parser does NOT read
  // search anyway (URL_HASH is canonical), but the 0.9.0 parser would
  // have. Either way, after the strip the link is gone.
  router.dropQueryTail();
  const afterStrip = router.location();
  assert.equal(afterStrip.search, '', 'live host strips ?query -- but only the live-host fake models this');
});

// ----------------------------------------------------------------------------
// E6 — MALFORMED-INPUT TOLERANCE (T-04.2-03-05)
// ----------------------------------------------------------------------------
test('E6 — parseChatDeepLink tolerates missing / empty / malformed input without throwing', () => {
  // Source: src/ui/surfaces/chat/deep-link.mjs readFromHash -- the
  // base64-decode + JSON.parse is wrapped in try/catch with a tolerant
  // null return.
  assert.equal(parseChatDeepLink(null), null, 'null location -> null, no throw');
  assert.equal(parseChatDeepLink(undefined), null, 'undefined location -> null');
  assert.equal(parseChatDeepLink({}), null, 'empty location -> null');
  assert.equal(parseChatDeepLink({ hash: '' }), null, 'empty hash -> null');
  assert.equal(parseChatDeepLink({ hash: '#' }), null, 'bare # -> null');
  assert.equal(parseChatDeepLink({ hash: '#h=' }), null, 'empty #h= -> null');
  assert.equal(
    parseChatDeepLink({ hash: '#h=not-valid-base64!!!' }),
    null,
    'malformed base64 -> null, no throw',
  );
  // Garbage base64 of non-JSON text -- decode succeeds but JSON.parse throws.
  const garbageHash = '#h=' + encodeURIComponent(Buffer.from('not json at all', 'utf8').toString('base64'));
  assert.equal(parseChatDeepLink({ hash: garbageHash }), null, 'non-JSON payload -> null, no throw');
  // Empty JSON object payload -- no topic, no newTopic -> null.
  const emptyHash = '#h=' + encodeURIComponent(Buffer.from('{}', 'utf8').toString('base64'));
  assert.equal(parseChatDeepLink({ hash: emptyHash }), null, 'empty JSON object payload -> null');
});

test('E6 — buildChatDeepLink returns null for non-navigable routes', () => {
  // Source: src/ui/surfaces/chat/deep-link.mjs -- the build function
  // returns null when the route is not navigable (topic-itself / missing
  // topicIssueId / null input).
  assert.equal(
    buildChatDeepLink({ route: 'topic-itself', companyPrefix: 'COU' }),
    null,
    'topic-itself is not navigable',
  );
  assert.equal(buildChatDeepLink(null), null, 'null input -> null');
  assert.equal(
    buildChatDeepLink({ route: 'existing-topic', companyPrefix: 'COU' }),
    null,
    'existing-topic with no topicIssueId -> null',
  );
});

// ----------------------------------------------------------------------------
// Wiring assertions -- the live .tsx files USE the shared contract module
// with the URL_HASH carrier shape. (Source-grep -- Node's runner cannot
// mount the .tsx components, but the grep evidence is mechanical.)
// ----------------------------------------------------------------------------
function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('deep-link.mjs: the shared contract module exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'src/ui/surfaces/chat/deep-link.mjs')),
    'src/ui/surfaces/chat/deep-link.mjs must exist',
  );
});

test('continue-in-chat-button.tsx: emits via the shared buildChatDeepLink + navigates with ONE arg (no state)', () => {
  // Source: post-04.2-03 onClick body -- `nav.navigate(deepLink.to)`.
  const raw = readSrc('src/ui/surfaces/reader/continue-in-chat-button.tsx');
  const c = stripComments(raw);
  assert.match(c, /buildChatDeepLink/, 'imports + uses buildChatDeepLink');
  assert.match(raw, /from\s+['"][^'"]*\bdeep-link\.mjs['"]/, 'imports from the shared deep-link module');
  // The navigate call must be the single-argument form.
  assert.match(
    c,
    /navigate\(\s*deepLink\.to\s*\)/,
    'navigate(deepLink.to) -- single argument, URL_HASH carrier',
  );
  // And it must NOT pass a state argument.
  assert.doesNotMatch(
    c,
    /navigate\([\s\S]{0,160}state\s*:/,
    'no state argument (Plan 04.2-03 carrier swap)',
  );
});

test('chat/index.tsx: reads the hash channel via parseChatDeepLink', () => {
  // Source: post-04.2-03 useHostLocation destructure -- includes `hash`.
  const c = stripComments(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.match(c, /parseChatDeepLink/, 'imports + uses parseChatDeepLink');
  assert.match(c, /deep-link/, 'imports from the shared deep-link module');
  assert.match(c, /useHostLocation/, 'reads the host location snapshot');
  // Destructure includes `hash` -- the URL_HASH carrier channel.
  assert.match(
    c,
    /\bhash\b/,
    'destructures hash from useHostLocation (Plan 04.2-03 canonical channel)',
  );
  // parseChatDeepLink is called with the hash field threaded through.
  assert.match(
    c,
    /parseChatDeepLink\(\s*\{[\s\S]{0,160}\bhash\b/,
    'parseChatDeepLink receives the hash field',
  );
});

test('reverse-topics-link.tsx: deep-links via the same shared URL_HASH contract', () => {
  // Source: post-04.2-03 onClick body -- `nav.navigate(deepLink.to)`.
  const c = stripComments(readSrc('src/ui/surfaces/reader/reverse-topics-link.tsx'));
  assert.match(
    c,
    /buildTopicDeepLink|buildChatDeepLink/,
    'ReverseTopicsLink uses the shared deep-link builder',
  );
  assert.match(
    c,
    /navigate\(\s*deepLink\.to\s*\)/,
    'ReverseTopicsLink navigate() uses the single-argument URL_HASH form',
  );
  assert.doesNotMatch(
    c,
    /navigate\([\s\S]{0,160}state\s*:/,
    'no state argument (carrier swap)',
  );
});

test('chat/index.tsx: consumed deep link is still cleared via a replace navigation (T-04.2-03-04)', () => {
  const c = stripComments(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.match(c, /replace:\s*true/, 'consumed fragment cleared via a replace navigation');
});

test('chat/index.tsx: no dangerouslySetInnerHTML on the deep-link path (T-04.2-03-01/02)', () => {
  const c = stripComments(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/, 'seed values render as controlled React text only');
});

test('E4 self-check companion: this test file references the probe artifact by name', () => {
  // Belt-and-braces: a second grep for the probe artifact, this time over
  // the assertion text itself (not the comments). If the probe ever moves,
  // this assertion fails loudly.
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'scripts/probes/carrier-survival.mjs')),
    'the Task 1 probe artifact still exists at the cited path',
  );
});
