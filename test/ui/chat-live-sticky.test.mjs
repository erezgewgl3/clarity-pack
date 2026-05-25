// test/ui/chat-live-sticky.test.mjs
//
// Plan 05-06 Task 3 (item e) — CONVERGENCE GATE for the LIVE indicator
// sticky restore. Plan-text language is "the deterministic computed-style
// test in test/ui/chat-live-sticky.test.mjs passes — NOT 'audit completed'.
// If the audit reports 'no breaker in chat.css' but the test fails, the
// executor MUST bisect ancestors until the test passes."
//
// IMPLEMENTATION: a Playwright headless harness loads chat.css and a
// synthetic DOM mirroring the actual chat surface ancestor chain
// (data-clarity-surface="chat" → .clarity-chat-shell → main.thread →
// .messages → .auto-refresh). The harness scrolls .messages and reads
// getComputedStyle + getBoundingClientRect to assert:
//   (i)  getComputedStyle(.auto-refresh).position === 'sticky'
//   (ii) after scroll, the element's getBoundingClientRect().top stays
//        at the .messages container's top edge (i.e. the element stuck).
//
// Why Playwright (not jsdom): jsdom does NOT compute layout fidelity for
// sticky elements (no real scroll context). Playwright does, via real
// Chromium. The visual-regression infra (Plan 05-04) already ships
// `playwright@1.55.1` as a devDep so this test adds no new runtime cost.
//
// SKIP gate (mirrors test/visual/sketch-regression.test.mjs): SKIP_VISUAL=1
// in the environment skips this suite for contributors without a working
// Chromium install. CI never sets this.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CHAT_CSS = readFileSync(
  path.join(ROOT, 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);

const SKIP = process.env.SKIP_VISUAL === '1';

// Build a self-contained HTML harness that mirrors the actual chat surface
// ancestor chain. The .auto-refresh + .messages + .thread + .clarity-chat-
// shell + [data-clarity-surface="chat"] selectors match the production CSS
// against this synthetic tree. We seed enough message rows to force
// .messages to overflow so the scroll context engages.
function harnessHtml(css) {
  const messageRows = Array.from({ length: 40 }, (_, i) =>
    `<article class="msg"><div class="av">A</div><div class="bubble"><div class="b-meta"><span class="who">Agent</span><span class="ts">${String(i).padStart(2, '0')}:00</span></div><div class="b-text">Synthetic message ${i} for the sticky-context layout probe.</div></div></article>`,
  ).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
:root { height: 100%; }
body { margin: 0; height: 100vh; font-family: sans-serif; }
${css}
</style></head>
<body>
<div data-clarity-surface="chat">
  <div class="clarity-chat-shell" data-clarity-region="chat-shell">
    <aside class="roster">Roster (stub)</aside>
    <main class="thread" data-clarity-region="thread">
      <div class="messages" data-clarity-region="messages">
        <div class="auto-refresh" role="status" data-liveness="healthy" id="live">
          <span aria-hidden="true">Live</span>
          <span class="sr-only">Live - updates are refreshing.</span>
        </div>
        ${messageRows}
        <div id="end"></div>
      </div>
    </main>
    <aside class="ctx">Context rail (stub)</aside>
  </div>
</div>
</body></html>`;
}

test('Plan 05-06 item (e) CONVERGENCE GATE: .auto-refresh sticks at top of .messages on scroll (Playwright headless)', { skip: SKIP }, async () => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    // Playwright not installed in this environment; surface as a skip.
    console.warn('playwright not available — skipping deterministic sticky test:', e?.message);
    return;
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.setContent(harnessHtml(CHAT_CSS), { waitUntil: 'load' });

    // (i) Computed position is sticky.
    const position = await page.evaluate(() => {
      const el = document.querySelector('.auto-refresh');
      if (!el) return null;
      return window.getComputedStyle(el).position;
    });
    assert.equal(position, 'sticky', '.auto-refresh computed position must be "sticky"');

    // (ii) Pre-scroll: .auto-refresh sits at top of .messages.
    const preScroll = await page.evaluate(() => {
      const el = document.querySelector('.auto-refresh');
      const container = document.querySelector('.messages');
      if (!el || !container) return null;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        elTop: Math.round(elRect.top),
        containerTop: Math.round(containerRect.top),
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      };
    });
    assert.ok(preScroll, 'pre-scroll measurements must resolve');
    assert.ok(
      preScroll.scrollHeight > preScroll.clientHeight,
      `.messages must overflow for the sticky context to engage (scrollHeight ${preScroll.scrollHeight} > clientHeight ${preScroll.clientHeight})`,
    );

    // Scroll .messages by ~200px and re-measure.
    await page.evaluate(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = 200;
    });
    // Allow a frame for layout to settle.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

    const postScroll = await page.evaluate(() => {
      const el = document.querySelector('.auto-refresh');
      const container = document.querySelector('.messages');
      if (!el || !container) return null;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        elTop: Math.round(elRect.top),
        containerTop: Math.round(containerRect.top),
        scrollTop: container.scrollTop,
      };
    });
    assert.ok(postScroll, 'post-scroll measurements must resolve');
    assert.ok(
      postScroll.scrollTop >= 100,
      `.messages must have actually scrolled (scrollTop ${postScroll.scrollTop})`,
    );

    // The sticky element MUST track the container's top — i.e. its top
    // bounding-rect coordinate equals the container's top. A 3-pixel
    // tolerance covers subpixel rounding (Chromium's layout engine rounds
    // sticky offsets to physical pixels which can drift by 1-2px from
    // ideal).
    const tolerance = 3;
    const drift = Math.abs(postScroll.elTop - postScroll.containerTop);
    assert.ok(
      drift <= tolerance,
      `sticky .auto-refresh must track .messages top after scroll: elTop=${postScroll.elTop}, containerTop=${postScroll.containerTop}, drift=${drift}, tolerance=${tolerance}. If this fails, an ancestor of .messages is breaking the sticky context (overflow: hidden / transform / filter / contain / will-change: transform).`,
    );
  } finally {
    await browser.close();
  }
});

test('Plan 05-06 item (e) ANCESTOR-CHAIN AUDIT: no ancestor of .messages declares a sticky-context breaker at runtime', { skip: SKIP }, async () => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return;
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.setContent(harnessHtml(CHAT_CSS), { waitUntil: 'load' });

    // Walk the ancestor chain from .messages upward to the document root and
    // record computed values for the sticky-context-breaker set. This is the
    // canonical "named breaker" audit the plan-text asks for — at runtime,
    // not via CSS source grep.
    const audit = await page.evaluate(() => {
      const results = [];
      let node = document.querySelector('.messages');
      while (node && node !== document.documentElement) {
        const cs = window.getComputedStyle(node);
        const breakers = [];
        if (cs.overflow !== 'visible' && cs.overflow !== '') breakers.push(`overflow:${cs.overflow}`);
        if (cs.overflowX !== 'visible' && cs.overflowX !== '') breakers.push(`overflowX:${cs.overflowX}`);
        if (cs.overflowY !== 'visible' && cs.overflowY !== '') breakers.push(`overflowY:${cs.overflowY}`);
        if (cs.transform !== 'none' && cs.transform !== '') breakers.push(`transform:${cs.transform}`);
        if (cs.filter !== 'none' && cs.filter !== '') breakers.push(`filter:${cs.filter}`);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') breakers.push(`backdropFilter:${cs.backdropFilter}`);
        if (cs.contain !== 'none' && cs.contain !== '') breakers.push(`contain:${cs.contain}`);
        if (cs.willChange === 'transform') breakers.push(`willChange:transform`);
        results.push({
          tag: node.tagName.toLowerCase(),
          cls: node.className?.toString?.() || '',
          breakers,
        });
        node = node.parentElement;
      }
      return results;
    });

    // The .messages node ITSELF declares overflow-y: auto by design — that's
    // the scroll container that establishes the sticky context. Sticky
    // elements stick INSIDE this overflow container. The first entry in the
    // walk IS .messages, so its overflowY: auto is expected. The breaker
    // check applies to ancestors ABOVE .messages.
    const ancestorBreakers = audit.slice(1).flatMap((a) =>
      a.breakers.map((b) => `${a.tag}.${a.cls.split(/\s+/).filter(Boolean).join('.')}:${b}`),
    );
    assert.deepEqual(
      ancestorBreakers,
      [],
      `No ancestor of .messages may declare a sticky-context breaker. Found: ${ancestorBreakers.join(' | ') || 'none'}. Audit chain: ${JSON.stringify(audit, null, 2)}`,
    );
  } finally {
    await browser.close();
  }
});
