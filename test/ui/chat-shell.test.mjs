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

test('Chat shell: the 3-column shell grid 264px 1fr 340px is present', () => {
  const css = readFileSync(CHAT_CSS, 'utf8');
  assert.match(css, /grid-template-columns:\s*264px\s+1fr\s+340px/);
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
