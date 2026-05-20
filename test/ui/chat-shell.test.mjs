// test/ui/chat-shell.test.mjs
//
// Plan 04-05 Task 1 — Employee Chat shell + CSS-scope source contract.
//
// SOURCE-GREP test (Node doesn't load .tsx through the test runtime — same
// pattern as bulletin-page.test.mjs). Verifies:
//   - the four Task-1 files exist (index, roster-rail, topic-strip,
//     context-rail) plus chat.css;
//   - index.tsx exports ChatPage, wraps <ClaritySurfaceRoot name="chat">, and
//     uses useOptIn → useResolvedCompanyId → useResolvedUserId IN THAT ORDER;
//   - chat.css is fully [data-clarity-surface="chat"]-scoped (T-04-20) and
//     does not @import host CSS;
//   - the warm-dark palette tokens + Geist fonts are present;
//   - no file under src/ui/surfaces/chat/ uses dangerouslySetInnerHTML or a
//     raw fetch( (T-04-18 / T-04-19);
//   - roster-rail.tsx does NOT render a "Group threads" section (D-03).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CHAT_DIR = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat');
const CHAT_CSS = path.join(ROOT, 'src', 'ui', 'styles', 'chat.css');

function readChat(rel) {
  return readFileSync(path.join(CHAT_DIR, rel), 'utf8');
}

/**
 * Read a source file with // line comments and /* block comments *​/ stripped
 * — so a grep assertion checks the CODE, not the explanatory header. String
 * and template literals are preserved.
 */
function readChatCode(rel) {
  const src = readChat(rel);
  // Strip block comments, then line comments. Conservative: this also strips
  // anything inside a string that looks like a comment, which is fine for the
  // negative assertions below (the real code uses none of these patterns).
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Flatten CSS into top-level (selector, body) pairs, descending @media. */
function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let cursor = 0;
  while (cursor < stripped.length) {
    if (stripped[cursor] === '{') {
      let lookback = cursor - 1;
      while (
        lookback >= 0 &&
        stripped[lookback] !== '}' &&
        stripped[lookback] !== ';' &&
        stripped[lookback] !== '{'
      ) {
        lookback -= 1;
      }
      const prelude = stripped.slice(lookback + 1, cursor).trim();
      if (prelude.startsWith('@')) {
        // @keyframes has inner step preludes (`0%`, `50%`) that are NOT
        // surface-scoped selectors and never can be — skip the WHOLE block so
        // the scope check does not flag the animation steps. @media keeps the
        // descend-into-inner behaviour (its inner rules ARE real selectors and
        // must stay surface-scoped).
        if (/^@keyframes\b/.test(prelude)) {
          let scan = cursor + 1;
          let depth = 1;
          while (scan < stripped.length && depth > 0) {
            if (stripped[scan] === '{') depth += 1;
            else if (stripped[scan] === '}') depth -= 1;
            scan += 1;
          }
          cursor = scan;
          continue;
        }
        cursor += 1;
        continue;
      }
      let scan = cursor + 1;
      let depth = 1;
      while (scan < stripped.length && depth > 0) {
        if (stripped[scan] === '{') depth += 1;
        else if (stripped[scan] === '}') depth -= 1;
        scan += 1;
      }
      rules.push({ selector: prelude });
      cursor = scan;
      continue;
    }
    cursor += 1;
  }
  return rules;
}

const SHELL_FILES = ['index.tsx', 'roster-rail.tsx', 'topic-strip.tsx', 'context-rail.tsx'];

for (const f of SHELL_FILES) {
  test(`Chat shell: ${f} exists`, () => {
    assert.ok(existsSync(path.join(CHAT_DIR, f)), `expected src/ui/surfaces/chat/${f}`);
  });
}

test('Chat shell: chat.css exists', () => {
  assert.ok(existsSync(CHAT_CSS), 'expected src/ui/styles/chat.css');
});

test('Chat shell: index.tsx exports ChatPage + wraps <ClaritySurfaceRoot name="chat">', () => {
  const src = readChat('index.tsx');
  assert.match(src, /export function ChatPage/);
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']chat["']/);
});

test('Chat shell: index.tsx gates useOptIn → useResolvedCompanyId → useResolvedUserId in order', () => {
  const src = readChat('index.tsx');
  const iOpt = src.indexOf('useOptIn');
  const iCompany = src.indexOf('useResolvedCompanyId');
  const iUser = src.indexOf('useResolvedUserId');
  assert.ok(iOpt >= 0, 'useOptIn missing');
  assert.ok(iCompany >= 0, 'useResolvedCompanyId missing');
  assert.ok(iUser >= 0, 'useResolvedUserId missing');
  assert.ok(iOpt < iCompany, 'useOptIn must precede useResolvedCompanyId');
  assert.ok(iCompany < iUser, 'useResolvedCompanyId must precede useResolvedUserId');
});

test('Chat shell: index.tsx does NOT read bare useHostContext().userId', () => {
  const code = readChatCode('index.tsx');
  assert.doesNotMatch(
    code,
    /useHostContext\(\)\.userId/,
    'userId must come from useResolvedUserId, not bare useHostContext',
  );
});

test('Chat shell: the 3-column shell grid 264px 1fr 360px is present (Plan 04.1-08)', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  // Plan 04.1-08 — right rail widened from 340px to 360px so rail labels
  // ("Active tasks owned", "Archive this topic", "Search this employee's
  // chats", "Pause heartbeat") no longer truncate at 1280px / zoom 100%.
  assert.match(css, /grid-template-columns:\s*264px\s+1fr\s+360px/);
});

test('Chat shell: chat.css — every rule scoped to [data-clarity-surface="chat"]', () => {
  const rules = parseRules(readFileSync(CHAT_CSS, 'utf8'));
  assert.ok(rules.length > 0, 'expected at least one CSS rule');
  const offenders = rules.filter(
    (r) => !/\[data-clarity-surface="chat"\]/.test(r.selector),
  );
  assert.equal(
    offenders.length,
    0,
    `unscoped selectors:\n${offenders.map((o) => o.selector).join('\n')}`,
  );
});

test('Chat shell: chat.css — warm-dark palette tokens defined', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  for (const v of ['--bg', '--ink', '--live', '--warn', '--alert', '--you', '--idle']) {
    assert.ok(new RegExp(`${v}\\s*:`).test(css), `missing CSS custom property ${v}`);
  }
});

test('Chat shell: chat.css — Geist / Geist Mono / Instrument Serif fonts referenced', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  for (const fam of ['Geist', 'Geist Mono', 'Instrument Serif']) {
    assert.ok(css.includes(fam), `missing font family ${fam}`);
  }
});

test('Chat shell: chat.css does NOT @import host CSS', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  const imports = css.match(/@import[^;]+;/g) ?? [];
  for (const imp of imports) {
    assert.ok(
      /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(imp),
      `chat.css must not @import host CSS — offending: ${imp}`,
    );
  }
});

test('Chat shell: no file under src/ui/surfaces/chat/ uses dangerouslySetInnerHTML', () => {
  for (const f of readdirSync(CHAT_DIR)) {
    if (!f.endsWith('.tsx') && !f.endsWith('.ts') && !f.endsWith('.mjs')) continue;
    const code = readChatCode(f);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/, `${f} must not use dangerouslySetInnerHTML`);
  }
});

test('Chat shell: no file under src/ui/surfaces/chat/ uses a raw fetch(', () => {
  for (const f of readdirSync(CHAT_DIR)) {
    if (!f.endsWith('.tsx') && !f.endsWith('.ts') && !f.endsWith('.mjs')) continue;
    const code = readChatCode(f);
    assert.doesNotMatch(code, /(?<![A-Za-z.])fetch\(/, `${f} must not call raw fetch()`);
  }
});

test('Chat shell: roster-rail.tsx does NOT render a "Group threads" section (D-03)', () => {
  const code = readChatCode('roster-rail.tsx');
  assert.doesNotMatch(code, /Group threads/, 'group threads are v2 — must be omitted');
});

test('Chat shell: roster-rail.tsx renders status dots + uses chat.roster', () => {
  const src = readChat('roster-rail.tsx');
  assert.match(src, /chat\.roster/);
  assert.match(src, /s-live|s-warn|s-alert|s-idle/);
});

test('Chat shell: topic-strip.tsx uses chat.topics and renders CHT labels', () => {
  const src = readChat('topic-strip.tsx');
  assert.match(src, /chat\.topics/);
  assert.match(src, /CHT-/);
});

test('Chat shell: index.tsx wires + New topic to chat.topic.create', () => {
  const src = readChat('index.tsx');
  assert.match(src, /chat\.topic\.create/);
  assert.match(src, /\+ New topic/);
});

// --- GAP 1: a successful chat.topic.create drops the user into the new topic.
test('Chat shell: index.tsx inspects the chat.topic.create result (GAP 1)', () => {
  const code = readChatCode('index.tsx');
  // The create result is awaited into a variable and inspected — the old
  // bug awaited createTopic(...) and discarded the return value.
  assert.match(
    code,
    /const\s+result\s*=\s*await\s+createTopic\(/,
    'handleNewTopic must capture the chat.topic.create result',
  );
});

test('Chat shell: index.tsx setTopic()s the just-created topic (GAP 1)', () => {
  const code = readChatCode('index.tsx');
  // On a successful create the new topic is opened immediately so the
  // composer renders for the first message.
  assert.match(code, /setTopic\(\{/, 'a successful create must setTopic the new topic');
  assert.match(code, /issueId:\s*created\.issueId/, 'the opened topic uses the created issueId');
});

test('Chat shell: index.tsx surfaces a chat.topic.create { error } visibly (GAP 1)', () => {
  const code = readChatCode('index.tsx');
  // chat.topic.create RETURNS { error } — it does not throw — so a returned
  // error must be detected and surfaced, never silently swallowed.
  assert.match(code, /setCreateError\(/, 'a returned { error } must set a visible error state');
  const src = readChat('index.tsx');
  assert.match(src, /topic-create-error/, 'a visible create-error element must render');
});

// --- GAP 2: a created topic appears in the strip without re-selecting.
test('Chat shell: index.tsx bumps a refreshKey folded into the TopicStrip key (GAP 2)', () => {
  const code = readChatCode('index.tsx');
  assert.match(code, /refreshKey/, 'a refreshKey state must exist');
  assert.match(
    code,
    /setRefreshKey\(\(k\)\s*=>\s*k\s*\+\s*1\)/,
    'a successful create must bump refreshKey',
  );
  assert.match(
    code,
    /key=\{`\$\{employee\?\.id\s*\?\?\s*'none'\}:\$\{refreshKey\}`\}/,
    'the TopicStrip key must fold in refreshKey so chat.topics re-fetches',
  );
});

// --- GAP 3b: the agent card label and value render as separate elements.
test('Chat shell: context-rail.tsx separates the stat label from its value (GAP 3b)', () => {
  const code = readChatCode('context-rail.tsx');
  // The label must be its own element — not text directly adjacent to <b>,
  // which CSS uppercased into "STATUSIDLE" / "TOPICHELLO".
  assert.match(code, /<span className="stat-label">Status<\/span>/);
  assert.match(code, /<span className="stat-label">Topic<\/span>/);
  // The mashed-together form must be gone.
  assert.doesNotMatch(
    code,
    /Status<b>/,
    'Status must not be directly adjacent to the <b> value',
  );
  assert.doesNotMatch(code, /Topic<b>/, 'Topic must not be directly adjacent to the <b> value');
});

test('Chat shell: chat.css gives .stat-label its own block layout (GAP 3b)', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  assert.match(css, /\.stat-label\s*\{[^}]*display:\s*block/);
  assert.match(
    css,
    /\.stat-row\s+\.stat\s+b\s*\{[^}]*display:\s*block/,
    'the stat value <b> must render on its own line under the label',
  );
});
