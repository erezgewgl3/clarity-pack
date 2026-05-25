// test/visual/sketch-regression.test.mjs
//
// Plan 05-04 Task 4 (DIST-04 visual-regression half + D-04 + D-25) —
// Playwright-driven loop that screenshots each tracked sketches/*.html
// under file:// and diffs against test/visual/baselines/<sketch>.png with
// VISUAL_DIFF_THRESHOLD = 0.02 (2% of pixels may differ).
//
// Rationale for the 2% threshold (cross-OS antialiasing drift envelope):
// baselines may be generated on either Windows (dev) or Linux (CI). At
// 0.02 the cross-OS antialiasing drift envelope for these four static
// sketches sits comfortably under threshold. Tightening to 0.001 would
// force baselines to be regenerated on a Linux CI runner to avoid
// spurious failure -- explicitly deferred to v1.1+ per CONTEXT D-04.
// Visual-regression CI workflow (.github/workflows/visual-regression.yml)
// exposes a workflow_dispatch escape hatch to regen baselines on Linux
// if the threshold ever needs to tighten.
//
// Top-of-file include guard: SKIP_VISUAL=1 in the environment skips the
// whole test suite for contributors without a working chromium install.
// CI never sets this (the workflow runs `playwright install --with-deps
// chromium` before invoking the suite).
//
// UPDATE_BASELINES=1 in the environment writes the captured PNG to the
// baseline path and skips the diff -- this is the `pnpm visual:update`
// flow used to bootstrap the four baselines (run once on first setup,
// then commit the four PNGs under test/visual/baselines/).

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// 2% of pixels may differ before the test fails. See file header for
// the rationale; the value is grepped by the Task 4 acceptance check.
const VISUAL_DIFF_THRESHOLD = 0.02;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SKETCHES_DIR = path.join(REPO_ROOT, 'sketches');
const BASELINES_DIR = path.join(HERE, 'baselines');
const DIFFS_DIR = path.join(HERE, 'diffs');

// The four tracked frozen sketches per D-25 lockdown. Each maps to a
// stable baseline PNG path. `paperclip-fix-chat-true-task.html` is NOT
// in this list (per CONTEXT.md — only the original four are frozen).
const SKETCHES = [
  { sketch: 'paperclip-fix-task-detail.html', baseline: '01-task-detail-reader.png' },
  { sketch: 'paperclip-fix-situation-room.html', baseline: '02-situation-room.png' },
  { sketch: 'paperclip-fix-bulletin.html', baseline: '03-bulletin.png' },
  { sketch: 'paperclip-fix-employee-chat.html', baseline: '04-employee-chat.png' },
];

const SKIP_VISUAL = process.env.SKIP_VISUAL === '1';
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';

if (SKIP_VISUAL) {
  test('visual-regression: SKIPPED via SKIP_VISUAL=1', () => {
    // No-op; explicitly recorded so the suite count is stable.
  });
} else {
  // Ensure the diffs/ output dir exists before any test writes into it.
  if (!existsSync(DIFFS_DIR)) {
    mkdirSync(DIFFS_DIR, { recursive: true });
  }
  if (!existsSync(BASELINES_DIR)) {
    mkdirSync(BASELINES_DIR, { recursive: true });
  }

  for (const { sketch, baseline } of SKETCHES) {
    test(`visual: ${baseline}`, async () => {
      const sketchPath = path.join(SKETCHES_DIR, sketch);
      if (!existsSync(sketchPath)) {
        assert.fail(`sketch missing: ${sketchPath}`);
      }

      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const url = pathToFileURL(sketchPath).href;
        await page.goto(url);
        // The sketches embed Google Fonts via <link> tags; wait for
        // networkidle so font loading completes before the screenshot.
        await page.waitForLoadState('networkidle');
        // Extra defensive 200ms idle to absorb any subpixel layout shift.
        await page.waitForTimeout(200);

        const actualBuffer = await page.screenshot({
          fullPage: true,
          animations: 'disabled',
          scale: 'device',
        });

        const baselinePath = path.join(BASELINES_DIR, baseline);

        if (UPDATE_BASELINES) {
          writeFileSync(baselinePath, actualBuffer);
          console.log(`  → baseline regenerated: ${baseline} (${actualBuffer.length} bytes)`);
          return; // No diff in UPDATE mode.
        }

        if (!existsSync(baselinePath)) {
          assert.fail(
            `baseline missing: ${baselinePath} — run UPDATE_BASELINES=1 ` +
              `node --test test/visual/sketch-regression.test.mjs to bootstrap.`,
          );
        }

        const baselinePng = PNG.sync.read(readFileSync(baselinePath));
        let actualPng;
        try {
          actualPng = PNG.sync.read(actualBuffer);
        } catch (e) {
          assert.fail(`captured screenshot is not a valid PNG: ${(e).message}`);
        }

        // Sizes can drift when the sketch changes by one row of text;
        // pixelmatch requires matched dimensions. Report which axis
        // drifted so the operator knows whether to regen.
        if (
          actualPng.width !== baselinePng.width ||
          actualPng.height !== baselinePng.height
        ) {
          // Write the actual capture as a diff artifact so the operator
          // can inspect it.
          const sidePath = path.join(DIFFS_DIR, baseline);
          writeFileSync(sidePath, actualBuffer);
          assert.fail(
            `dimension drift on ${baseline}: ` +
              `expected ${baselinePng.width}x${baselinePng.height}, got ` +
              `${actualPng.width}x${actualPng.height}. Capture saved to ${sidePath}.`,
          );
        }

        const { width, height } = baselinePng;
        const diffPng = new PNG({ width, height });
        const diffPixels = pixelmatch(
          baselinePng.data,
          actualPng.data,
          diffPng.data,
          width,
          height,
          { threshold: 0.1 },
        );
        const totalPixels = width * height;
        const ratio = diffPixels / totalPixels;

        if (ratio > VISUAL_DIFF_THRESHOLD) {
          const diffPath = path.join(DIFFS_DIR, baseline);
          writeFileSync(diffPath, PNG.sync.write(diffPng));
          assert.fail(
            `visual diff on ${baseline}: ${diffPixels} / ${totalPixels} pixels ` +
              `differ (${(ratio * 100).toFixed(3)}% > ${(VISUAL_DIFF_THRESHOLD * 100).toFixed(2)}% ` +
              `threshold). Diff PNG saved to ${diffPath}.`,
          );
        }
      } finally {
        await browser.close();
      }
    });
  }
}
