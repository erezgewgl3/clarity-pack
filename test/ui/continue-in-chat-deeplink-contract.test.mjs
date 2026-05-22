// test/ui/continue-in-chat-deeplink-contract.test.mjs
//
// Plan 04.2-02 Task 2 — the load-bearing cross-hook contract regression test
// for GAP-RCB-03-DEEPLINK.
//
// ============================================================================
// D3 — NO INDEPENDENT MOCKS (the exact test-gap from 04.2-VERIFICATION.md)
// ============================================================================
// 04.2-VERIFICATION.md, "why unit tests missed it":
//   "the UI tests mock the host hooks INDEPENDENTLY, so the navigate-emit and
//    the location-read were each tested in isolation against compatible mocks
//    — the real cross-hook contract was never exercised."
//
// This file does the opposite by CONSTRUCTION. There is exactly ONE shared
// router-state object — `fakeRouter` below. The button's deep-link builder
// (`buildChatDeepLink`) WRITES into it; the chat surface's reader
// (`parseChatDeepLink`) READS from the SAME object. There is no second mock,
// no second channel. If the emit shape and the read shape ever drift apart
// again, every D-test here fails.
//
// `node --test` cannot mount React hooks (no render harness in this repo).
// The contract is therefore tested through the two PURE functions the fix
// extracted into src/ui/surfaces/chat/deep-link.mjs — `buildChatDeepLink`
// (what continue-in-chat-button.tsx calls before navigate()) and
// `parseChatDeepLink` (what chat/index.tsx calls on the useHostLocation()
// snapshot). Those two functions ARE the real contract end-to-end; two
// independent hook mocks never were.
//
// EMPIRICAL SDK FINDING (recorded for the SUMMARY): the SDK's navigate /
// useHostLocation are thin host-bridge stubs (getSdkUiRuntimeValue) — the host
// supplies the real impl. The type contract says the host wraps
// react-router-dom and that `navigate(to)` first applies the company prefix
// via `resolveHref(to)`, which is documented purely in path terms and makes
// NO guarantee about preserving a `?query` tail. The drill proved the query
// string in `to` was dropped before reaching `useHostLocation().search`. The
// fix carries the params on `HostNavigationOptions.state` ->
// `HostLocation.state` — a structured channel the host forwards verbatim,
// untouched by `resolveHref` — and keeps the query string as a refresh-only
// fallback. The shared `fakeRouter` below models BOTH channels exactly as the
// host router behaves: `navigate(to, { state })` records `state`, and the
// `to` query tail is what a browser refresh would surface as `search`.

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
// The ONE shared router-state object. This is the whole point of the file:
// `navigate()` writes here, `useHostLocation()` reads from here — same object.
// ----------------------------------------------------------------------------
function makeFakeRouter() {
  /** The single source of truth — exactly what the host router holds. */
  const location = { pathname: '/', search: '', hash: '', state: undefined };
  return {
    /** Mirrors the host's navigate(to, options?): splits `to`, records state. */
    navigate(to, options) {
      const qIdx = to.indexOf('?');
      location.pathname = qIdx === -1 ? to : to.slice(0, qIdx);
      // The host's company-prefix `resolveHref` step is the documented
      // strip point for the `?query` tail. We model BOTH the optimistic
      // case (tail preserved) and the load-bearing channel (state). The
      // tests below assert the contract holds via `state` REGARDLESS of
      // whether the query tail survives — see `simulateResolveHrefDropsQuery`.
      location.search = qIdx === -1 ? '' : to.slice(qIdx);
      location.state = options ? options.state : undefined;
    },
    /** Mirrors useHostLocation(): a snapshot of the SAME object. */
    location() {
      return { ...location };
    },
    /**
     * Drill-faithful mode: the host's path-only `resolveHref` strips the
     * `?query` tail before the route commits. The structured `state` channel
     * is untouched. This is the EXACT failure the live drill exhibited.
     */
    dropQueryTail() {
      location.search = '';
    },
  };
}

// ----------------------------------------------------------------------------
// D1 — EXISTING-TOPIC-ROUNDTRIP
// ----------------------------------------------------------------------------
test('D1 — existing-topic deep link round-trips topic + comment + employee through one shared router', () => {
  const router = makeFakeRouter();

  // EMIT — the button builds the link and calls navigate(to, { state }).
  const built = buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix: 'COU',
    topicIssueId: 'topic-issue-abc',
    sourceCommentId: 'comment-xyz',
    assigneeAgentId: 'agent-77',
  });
  assert.ok(built, 'buildChatDeepLink returns a navigable link for existing-topic');
  router.navigate(built.to, { state: built.state });

  // READ — the chat surface reads the SAME router's location snapshot.
  const link = parseChatDeepLink(router.location());
  assert.ok(link, 'the chat-side reader resolves a deep link from the shared router');
  assert.equal(link.topic, 'topic-issue-abc', 'topic round-trips');
  assert.equal(link.comment, 'comment-xyz', 'comment round-trips');
  assert.equal(link.employee, 'agent-77', 'employee round-trips');
  assert.equal(link.newTopic, false, 'existing-topic is not a newTopic link');
});

// ----------------------------------------------------------------------------
// D2 — NEW-TOPIC-ROUNDTRIP
// ----------------------------------------------------------------------------
test('D2 — new-topic deep link round-trips all five params, URL-decoded, through one shared router', () => {
  const router = makeFakeRouter();

  // Deliberately use values with URL-special chars + spaces so the decode
  // path is genuinely exercised (T-04.2-02-01: still plain string decode).
  const seedTitle = 'Continuing from COU-1234: fix the login & sign-up flow';
  const seedBody = 'The button is dead — see step #3 (50% of users hit this).';

  const built = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: 'COU',
    assigneeAgentId: 'agent-42',
    seedTitle,
    seedBody,
    originIssueId: 'origin-issue-9001',
  });
  assert.ok(built, 'buildChatDeepLink returns a navigable link for new-topic-needed');
  router.navigate(built.to, { state: built.state });

  const link = parseChatDeepLink(router.location());
  assert.ok(link, 'the chat-side reader resolves a new-topic deep link');
  assert.equal(link.newTopic, true, 'newTopic flag round-trips');
  assert.equal(link.seedTitle, seedTitle, 'seedTitle round-trips URL-decoded intact');
  assert.equal(link.seedBody, seedBody, 'seedBody round-trips URL-decoded intact');
  assert.equal(link.originIssueId, 'origin-issue-9001', 'originIssueId round-trips');
  assert.equal(link.employee, 'agent-42', 'employee round-trips');
});

// ----------------------------------------------------------------------------
// D3 — NO-INDEPENDENT-MOCKS — the contract holds even when the host's
// company-prefix resolveHref strips the query tail (the exact drill failure).
// ----------------------------------------------------------------------------
test('D3 — the contract survives a resolveHref that drops the query tail (one shared channel)', () => {
  const router = makeFakeRouter();

  const built = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: 'COU',
    assigneeAgentId: 'agent-1',
    seedTitle: 'Drill-faithful title',
    seedBody: 'Drill-faithful body',
    originIssueId: 'origin-1',
  });
  router.navigate(built.to, { state: built.state });

  // Reproduce the live drill: the path-only host resolveHref drops `?query`.
  router.dropQueryTail();
  const loc = router.location();
  assert.equal(loc.search, '', 'drill-faithful: the query tail is gone (resolveHref stripped it)');

  // The deep link STILL resolves — because it travelled on `state`, the
  // channel the SDK type contract guarantees end-to-end. If the fix had
  // relied on the query string alone (the GAP-RCB-03 bug), this would be null.
  const link = parseChatDeepLink(loc);
  assert.ok(
    link,
    'the deep link still resolves with the query tail gone — proves it rides the ' +
      'structured state channel, not the strippable query string',
  );
  assert.equal(link.newTopic, true);
  assert.equal(link.seedTitle, 'Drill-faithful title');
  assert.equal(link.originIssueId, 'origin-1');

  // And — the structural D3 guarantee — the emit and the read share ONE
  // object. parseChatDeepLink reads exactly the `state` buildChatDeepLink
  // produced; there is no second independently-stubbed channel anywhere.
  assert.deepEqual(
    loc.state,
    built.state,
    'the chat-side read sees the EXACT state object the button emitted',
  );
});

// ----------------------------------------------------------------------------
// D4 — REVERSE-TOPICS-USES-SAME-CONTRACT
// ----------------------------------------------------------------------------
test('D4 — ReverseTopicsLink topic deep link round-trips through the same shared contract', () => {
  const router = makeFakeRouter();

  const built = buildTopicDeepLink('COU', 'reverse-topic-issue-555');
  assert.ok(built, 'buildTopicDeepLink returns a navigable link');
  router.navigate(built.to, { state: built.state });

  const link = parseChatDeepLink(router.location());
  assert.ok(link, 'the chat-side reader resolves the reverse-topics deep link');
  assert.equal(link.topic, 'reverse-topic-issue-555', 'reverse-topics topic round-trips');
  assert.equal(link.newTopic, false);
});

// ----------------------------------------------------------------------------
// D5 — DEFENSIVE: malformed / missing / extra keys do not throw (T-04.2-02-05)
// ----------------------------------------------------------------------------
test('D5 — parseChatDeepLink tolerates missing / empty / malformed location input', () => {
  assert.equal(parseChatDeepLink(null), null, 'null location -> null, no throw');
  assert.equal(parseChatDeepLink(undefined), null, 'undefined location -> null');
  assert.equal(parseChatDeepLink({}), null, 'empty location -> null');
  assert.equal(parseChatDeepLink({ search: '' }), null, 'empty search -> null');
  assert.equal(parseChatDeepLink({ search: '?' }), null, 'bare ? -> null');
  assert.equal(
    parseChatDeepLink({ search: '?unrelated=1&foo=bar' }),
    null,
    'a query with no topic/newTopic key -> null',
  );
  // A junk state object must not throw and must not produce a phantom link.
  assert.equal(
    parseChatDeepLink({ state: { clarityChatDeepLink: 'not-an-object' } }),
    null,
    'malformed state -> null, no throw',
  );
  assert.equal(
    parseChatDeepLink({ state: { clarityChatDeepLink: {} } }),
    null,
    'state with an empty deep-link object (no topic, no newTopic) -> null',
  );
  // Extra unknown keys alongside a valid link are ignored, not fatal.
  const link = parseChatDeepLink({
    search: '?topic=t1&bogus=zzz&another=qq',
  });
  assert.ok(link, 'a valid link with extra unknown keys still resolves');
  assert.equal(link.topic, 't1');
});

test('D6 — buildChatDeepLink returns null for a non-navigable route', () => {
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
// Wiring assertions — the live .tsx files USE the shared contract module.
// (Source-grep — Node's runner cannot mount the .tsx components.)
// ----------------------------------------------------------------------------
function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('deep-link.mjs: the shared contract module exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'src/ui/surfaces/chat/deep-link.mjs')),
    'src/ui/surfaces/chat/deep-link.mjs must exist',
  );
});

test('continue-in-chat-button.tsx: emits via the shared buildChatDeepLink + carries state', () => {
  const raw = readSrc('src/ui/surfaces/reader/continue-in-chat-button.tsx');
  const c = code(raw);
  assert.match(c, /buildChatDeepLink/, 'imports + uses buildChatDeepLink');
  // Grep the RAW source for the import path — `code()` strips line comments
  // and the file's pre-existing header has a `/*` glob inside a `//` comment
  // (src/ui/surfaces/reader/*) that confuses the block-strip regex into
  // eating the import lines along with it. The unambiguous import-path
  // grep here is reliable evidence of "imports from the shared module".
  assert.match(raw, /from\s+['"][^'"]*\bdeep-link\.mjs['"]/, 'imports from the shared deep-link module');
  // navigate is called with the structured state — the load-bearing channel.
  assert.match(
    c,
    /navigate\([\s\S]{0,160}state/,
    'navigate() is called with the structured state option',
  );
});

test('chat/index.tsx: reads via the shared parseChatDeepLink', () => {
  const c = code(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.match(c, /parseChatDeepLink/, 'imports + uses parseChatDeepLink');
  assert.match(c, /deep-link/, 'imports from the shared deep-link module');
  // The reader still feeds useHostLocation() — but now BOTH search AND state.
  assert.match(c, /useHostLocation/, 'still reads the host location snapshot');
  assert.match(c, /state/, 'the location read includes the state channel');
});

test('reverse-topics-link.tsx: deep-links via the same shared contract (D4 / RCB-06)', () => {
  const c = code(readSrc('src/ui/surfaces/reader/reverse-topics-link.tsx'));
  assert.match(
    c,
    /buildTopicDeepLink|buildChatDeepLink/,
    'ReverseTopicsLink uses the shared deep-link builder',
  );
  assert.match(
    c,
    /navigate\([\s\S]{0,160}state/,
    'ReverseTopicsLink navigate() carries the structured state',
  );
});

test('chat/index.tsx: consumed deep link is still cleared via a replace navigation (T-04.2-02-04)', () => {
  const c = code(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.match(c, /replace:\s*true/, 'params/state cleared via a replace navigation after consumption');
});

test('chat/index.tsx: no dangerouslySetInnerHTML on the deep-link path (T-04.2-02-01/02)', () => {
  const c = code(readSrc('src/ui/surfaces/chat/index.tsx'));
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/, 'seed values render as controlled React text only');
});
