// playwright.config.mjs
//
// Plan 05-04 Task 4 (DIST-04 visual-regression half) — minimal Playwright
// config. We use the `playwright` engine directly inside node --test
// (NOT @playwright/test's BDD runner) so the single `node --test` CI
// invocation remains the source of truth for the suite. This file exports
// the shared viewport + browser pin so the test can import it if needed.
//
// The viewport is the single canonical desktop size for v1 -- multi-
// viewport regression is out of scope (CONTEXT.md <deferred>).
//
// Headless chromium is the only project; Firefox/WebKit deferred to v1.1+.

export default {
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // Reduced-motion makes snapshots deterministic across runs.
    reducedMotion: 'reduce',
  },
  // Surface project name so the CI workflow can target it explicitly if
  // a multi-browser matrix is ever added.
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
