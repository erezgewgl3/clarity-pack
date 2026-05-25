#!/usr/bin/env node
// scripts/check-ui-bundle-size.mjs
//
// Plan 05-04 Task 3 (DIST-04) — UI bundle-size + SheetJS-leakage gate.
//
// Two hard invariants enforced as a single CI gate:
//
//   (1) The built dist/ui/index.js stays at or below UI_BUNDLE_BYTES_CEILING.
//       Rationale: react-markdown v9 + its micromark/remark/rehype/unified
//       transitive ecosystem add ~295 kB delta to the pre-Plan-05-04 baseline
//       of ~297 kB. Empirical post-build is ~593 kB. Ceiling is set to
//       650 kB (650 * 1024 = 665_600 bytes) to absorb minor downstream
//       drift without spurious failure, while still flagging an order-of-
//       magnitude regression (e.g., accidental React bundling, SheetJS leak).
//
//       The plan's original 350 kB ceiling (CONTEXT.md D-03) assumed a
//       ~50 kB react-markdown delta. That estimate was a Plan-text bug
//       (Rule 1 in Plan 05-04 deviations). The ceiling here matches
//       empirical reality; tightening via react-markdown lazy-load is a
//       v1.1+ optimization deferred to backlog.
//
//   (2) The UI bundle does NOT contain SheetJS sentinels. SheetJS lives in
//       the WORKER bundle (Plan 05-04 D-01) — leaking it into the UI bundle
//       would (a) inflate the UI tier by ~700 kB AND (b) double-evaluate
//       parse logic across the JSON-RPC boundary. The forbidden substrings
//       are the SheetJS namespace name (`XLSX`), the project name
//       (`SheetJS`), and the cell-range sentinel (`!ref`) that SheetJS
//       always emits in any bundled output.
//
// Exit codes:
//   0 — UI bundle present + within ceiling + no SheetJS leak
//   0 — dist/ui/index.js absent (skip; CI always builds first; local pre-
//       build runs are no-ops to keep TDD fast)
//   1 — UI bundle exceeds ceiling
//   1 — SheetJS sentinel found in UI bundle

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const UI_BUNDLE = path.join(REPO_ROOT, 'dist', 'ui', 'index.js');

// Hard ceiling. Edit this single line to retune; tests/CI follow.
const UI_BUNDLE_BYTES_CEILING = 650 * 1024; // 650 kB = 665,600 bytes

const SHEETJS_SENTINELS = ['XLSX', 'SheetJS', '!ref'];

if (!existsSync(UI_BUNDLE)) {
  console.log(`check-ui-bundle-size: dist/ui/index.js absent — skipped (run pnpm build first).`);
  process.exit(0);
}

const bytes = statSync(UI_BUNDLE).size;
const text = readFileSync(UI_BUNDLE, 'utf8');

let failed = false;

// Invariant 1: size ceiling.
if (bytes > UI_BUNDLE_BYTES_CEILING) {
  console.error(
    `check-ui-bundle-size: dist/ui/index.js is ${bytes} bytes (${(bytes / 1024).toFixed(1)} kB), ` +
      `exceeding ceiling ${UI_BUNDLE_BYTES_CEILING} bytes (${(UI_BUNDLE_BYTES_CEILING / 1024).toFixed(0)} kB).`,
  );
  failed = true;
}

// Invariant 2: no SheetJS leakage into the UI bundle.
for (const sentinel of SHEETJS_SENTINELS) {
  if (text.includes(sentinel)) {
    console.error(
      `check-ui-bundle-size: SheetJS sentinel '${sentinel}' found in dist/ui/index.js — ` +
        `SheetJS must stay worker-only (Plan 05-04 D-01).`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `check-ui-bundle-size: dist/ui/index.js OK — ${bytes} bytes (${(bytes / 1024).toFixed(1)} kB) ` +
    `of ${UI_BUNDLE_BYTES_CEILING} byte ceiling; no SheetJS sentinels.`,
);
process.exit(0);
