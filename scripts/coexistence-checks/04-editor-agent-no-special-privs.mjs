#!/usr/bin/env node
// scripts/coexistence-checks/04-editor-agent-no-special-privs.mjs
//
// COEXIST-04 — the Editor-Agent must run as a standard Paperclip employee.
// No admin/bypass/root/sudo/owner-prefixed capability may appear anywhere in
// the manifest (agents[] block or the global capabilities array).
//
// This is a grep-based check; it catches the obvious vector of "Phase 3
// added admin.bypass-governance to ship a feature" before that PR lands.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MANIFEST_PATH = path.resolve(process.cwd(), 'src', 'manifest.ts');

function fail(msg) {
  console.error(`COEXIST-04 violation: ${msg}`);
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  console.log('COEXIST-04 OK: no src/manifest.ts in this tree (skipping)');
  process.exit(0);
}

const src = readFileSync(MANIFEST_PATH, 'utf8');

// Match string literals like 'admin.foo', "bypass.bar", 'root.x', 'sudo.x',
// 'owner.x'. We allow the host-defined 'agents.managed' since 'managed' is
// a capability suffix (not a privilege escalation), so the regex anchors on
// admin|bypass|root|sudo|owner specifically.
const PRIVILEGED = /["'](admin|bypass|root|sudo|owner)\.[A-Za-z0-9._-]+["']/;

if (PRIVILEGED.test(src)) {
  fail(
    'manifest declares an admin/bypass/root/sudo/owner-prefixed capability. ' +
      'Editor-Agent must inherit host governance (heartbeat caps, pause/terminate, audit log) like any other Paperclip employee.',
  );
}

console.log('COEXIST-04 OK: Editor-Agent capabilities within the standard-employee set');
process.exit(0);
