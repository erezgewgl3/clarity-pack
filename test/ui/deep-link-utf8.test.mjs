// test/ui/deep-link-utf8.test.mjs
//
// Overnight 2026-05-28 — REGRESSION FOR BEAAA-828 + WIDESPREAD READER CRASH.
//
// Root cause: `b64encode(s)` in `src/ui/surfaces/chat/deep-link.mjs` called
// raw `btoa(s)` on the serialized deep-link payload. `btoa` throws
// `InvalidCharacterError` on ANY character outside Latin-1 (0x00-0xFF).
// `chat.openForIssue` returns `seedTitle: <issue title>` and
// `seedBody: 'Continuing from <id>: <issue title>'` — both of which carry
// the verbatim BEAAA issue title. Operator-typed titles routinely contain
// em-dashes (—, U+2014), smart quotes (“ ” ‘ ’, U+201C..U+2019), and other
// Unicode that lives outside Latin-1. When `ContinueInChatButton` rendered
// against any such issue, `buildChatDeepLink → appendHash → b64encode →
// btoa` threw synchronously during React render, which propagated up
// into the HOST's `PluginSlotErrorBoundary` and rendered the single
// "Clarity Pack: failed to render" pill — wiping the entire Reader tab.
// Operator confirmed widespread blast radius: BEAAA-828, BEAAA-142,
// BEAAA-141, BEAAA-125, BEAAA-138, BEAAA-682, BEAAA-79.
//
// The fix (deep-link.mjs `b64encode` / `b64decode`) uses the canonical
// UTF-8-via-binary-string pattern: `TextEncoder` → bytes → binary string
// → `btoa`. Round-trip is bit-exact for any Unicode input. A surrounding
// try/catch returns '' (encode) or '' (decode) on any unexpected failure,
// so callers degrade to "not navigable" / "no deep link" instead of
// throwing.
//
// PRE-FIX VERIFICATION (RED row): the tests in this file would have
// thrown `InvalidCharacterError` at the `buildChatDeepLink(...)` call
// inside the helper because raw `btoa` cannot handle U+2014, U+201C,
// emoji, or any non-Latin1 input. POST-FIX (GREEN): round-trip resolves
// without throwing and yields the original strings byte-for-byte.
//
// Pure-JS runnable test (no jsdom, no TSX transform) — matches the
// existing `test/ui/deep-link.test.mjs` pattern.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  buildChatDeepLink,
  parseChatDeepLink,
} from '../../src/ui/surfaces/chat/deep-link.mjs';

function extractHash(to) {
  const i = to.indexOf('#');
  return i === -1 ? '' : to.slice(i);
}

// ---------------------------------------------------------------------------
// Regression: the literal characters that triggered the BEAAA-828 crash
// ---------------------------------------------------------------------------

const UNICODE_TITLES = [
  // em-dash (U+2014) — by far the most common offender; lives in copy-paste
  // titles from any operator who uses prose punctuation.
  'IFA rates and insures AI agents — overview',
  // smart quotes (U+201C / U+201D) — common in titles copied from docs.
  'Recover the “awaiting human” chain on BEAAA',
  // en-dash (U+2013) — also outside Latin-1.
  'Quarterly review – Q3 BEAAA-828 deliverable',
  // single smart quote (U+2019) — apostrophe replacement.
  'Eric’s overnight pass on the Reader crash',
  // mid-string emoji (surrogate pair) — exercises the surrogate path
  // through TextEncoder.
  'Deliverable shipped 🚀 to BEAAA',
  // non-ASCII letters (composed) — exercises BMP > 0x7F path.
  'Café reconciliation — résumé attached',
  // CJK — verifies the 3-byte UTF-8 path.
  '会議の議事録 BEAAA-828',
  // mixed Latin1 + CJK + emoji.
  'Café — 会議 — 🚀',
];

for (const title of UNICODE_TITLES) {
  test(`b64-utf8 regression — buildChatDeepLink('new-topic-needed') with title containing non-Latin1 (${JSON.stringify(title).slice(0, 60)}) does NOT throw and round-trips byte-for-byte`, () => {
    // Before the overnight fix, this call threw InvalidCharacterError at the
    // raw `btoa(...)` inside b64encode. The throw propagated up through
    // ContinueInChatButton → React render → HOST PluginSlotErrorBoundary
    // → "Clarity Pack: failed to render". After the fix, the call returns
    // a navigable link.
    const built = buildChatDeepLink({
      route: 'new-topic-needed',
      companyPrefix: 'BEAAA',
      assigneeAgentId: 'agent-uuid-77',
      seedTitle: title,
      seedBody: `Continuing from BEAAA-828: ${title}`,
      originIssueId: 'issue-uuid-828',
    });
    assert.ok(built, 'buildChatDeepLink must return a navigable link for non-Latin1 titles');
    assert.match(built.to, /^\/BEAAA\/chat#h=/, 'fragment carrier');

    // Round-trip must yield byte-identical seedTitle / seedBody.
    const link = parseChatDeepLink({ hash: extractHash(built.to) });
    assert.ok(link, 'parseChatDeepLink must round-trip the encoded fragment');
    assert.equal(link.seedTitle, title, 'seedTitle must round-trip byte-for-byte');
    assert.equal(
      link.seedBody,
      `Continuing from BEAAA-828: ${title}`,
      'seedBody must round-trip byte-for-byte',
    );
    assert.equal(link.newTopic, true);
    assert.equal(link.employee, 'agent-uuid-77');
    assert.equal(link.originIssueId, 'issue-uuid-828');
  });
}

test('b64-utf8 regression — empty seedTitle + seedBody still produce a navigable link (back-compat with the existing happy path)', () => {
  const built = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: 'COU',
    assigneeAgentId: 'agent-1',
    seedTitle: '',
    seedBody: '',
    originIssueId: 'issue-x',
  });
  assert.ok(built);
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link);
  assert.equal(link.seedTitle, '');
  assert.equal(link.seedBody, '');
});

test('b64-utf8 regression — explicit em-dash in seedTitle is the canonical BEAAA-828 repro', () => {
  // The exact-shape repro: a Unicode-bearing title that mirrors the BEAAA
  // operator's writing voice. The chat.openForIssue worker (Plan 04.2-01)
  // builds seedBody as `Continuing from ${identifier}: ${title}` — so the
  // em-dash appears at LEAST twice in the JSON payload.
  const built = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: 'BEAAA',
    assigneeAgentId: 'editor-agent-uuid',
    seedTitle: 'Editorial Desk — daily bulletin sweep — BEAAA-828',
    seedBody: 'Continuing from BEAAA-828: Editorial Desk — daily bulletin sweep — BEAAA-828',
    originIssueId: 'issue-uuid-828',
  });
  assert.ok(built, 'em-dash titles must produce a navigable link (regression for BEAAA-828)');
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link);
  assert.match(link.seedTitle ?? '', /—/, 'em-dash must round-trip in seedTitle');
  assert.match(link.seedBody ?? '', /—/, 'em-dash must round-trip in seedBody');
});

// ---------------------------------------------------------------------------
// Proof of root cause — raw `btoa(s)` (the pre-fix shape) STILL throws today
// on the same inputs. This is the literal RED state the b64encode fix
// resolves: had the fix not landed, every assertion above would crash on
// `InvalidCharacterError` thrown inside React render.
// ---------------------------------------------------------------------------

test('root-cause proof — raw btoa(JSON.stringify({title: "<em-dash>"})) throws InvalidCharacterError (the pre-fix b64encode shape)', () => {
  // Reproduce the pre-fix call shape that crashed the Reader. Node 20+
  // ships a Web-compatible global btoa with the same throw-on-non-Latin1
  // contract as the browser, so this is an exact behavioral match for
  // what blew up inside the host page.
  const seedTitle = 'Editorial Desk — daily bulletin sweep — BEAAA-828';
  const payload = JSON.stringify({ newTopic: true, seedTitle });
  assert.throws(
    () => {
      // eslint-disable-next-line no-undef
      btoa(payload);
    },
    /InvalidCharacterError|character|latin/i,
    'raw btoa on a non-Latin1 payload must throw — this is the BEAAA-828 crash',
  );
});

test('root-cause proof — the UTF-8-via-binary-string pattern does NOT throw on the same payload', () => {
  const seedTitle = 'Editorial Desk — daily bulletin sweep — BEAAA-828';
  const payload = JSON.stringify({ newTopic: true, seedTitle });
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  let encoded = '';
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-undef
    encoded = btoa(binary);
  });
  assert.ok(encoded.length > 0, 'encoded payload must be non-empty');
});

// ---------------------------------------------------------------------------
// Encoder guard — the fix uses TextEncoder, not raw btoa
// ---------------------------------------------------------------------------

test('b64-utf8 regression — deep-link.mjs source uses TextEncoder for the UTF-8 path (pre-fix used raw btoa(s) which crashed on non-Latin1)', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    path.resolve(HERE, '..', '..', 'src/ui/surfaces/chat/deep-link.mjs'),
    'utf8',
  );
  assert.match(
    SRC,
    /TextEncoder/,
    'b64encode must use TextEncoder to be UTF-8-safe',
  );
  // The pre-fix shape was: `if (typeof btoa === 'function') return btoa(s);`
  // (raw bare-string btoa, no encoder). Post-fix that exact one-liner is
  // gone — btoa is now called on the binary-string built from
  // TextEncoder bytes.
  assert.doesNotMatch(
    SRC,
    /return\s+btoa\(\s*s\s*\)\s*;/,
    'b64encode must NOT call raw btoa(s) — that throws on non-Latin1 (BEAAA-828 crash root cause)',
  );
});
