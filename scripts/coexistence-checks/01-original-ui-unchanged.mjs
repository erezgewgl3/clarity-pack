#!/usr/bin/env node
// scripts/coexistence-checks/01-original-ui-unchanged.mjs
//
// COEXIST-01 — Clarity Pack must not replace the original Paperclip UI.
// Asserts the manifest never declares a slot whose `routePath` targets a
// known Paperclip core route (issues, agents, projects, admin, dashboard,
// companies, plugins, settings). Plugin slot types are additive by design
// (PLUGIN_SPEC §10.1) so this is a defense-in-depth grep against author
// mistakes — not a host-level guarantee.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MANIFEST_PATH = path.resolve(process.cwd(), 'src', 'manifest.ts');

function fail(msg) {
  console.error(`COEXIST-01 violation: ${msg}`);
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  console.log('COEXIST-01 OK: no src/manifest.ts in this tree (skipping)');
  process.exit(0);
}

const src = readFileSync(MANIFEST_PATH, 'utf8');

// FORBIDDEN_ROUTES — host-owned route segments. The regex matches
// `routePath: 'issue'`, `routePath: "issues"`, etc.
const FORBIDDEN = /routePath\s*:\s*['"](?:issue|issues|agents|projects|admin|dashboard|companies|plugins|settings|home|onboarding|inbox)\b/;

if (FORBIDDEN.test(src)) {
  fail(
    'manifest declares a slot at a Paperclip core route (issue/agents/projects/admin/etc.). ' +
      'Clarity Pack must namespace its pages under a plugin-owned routePath (e.g. "situation-room", "bulletin", "chat").',
  );
}

console.log('COEXIST-01 OK: no Clarity slot overrides a core Paperclip route');
process.exit(0);
