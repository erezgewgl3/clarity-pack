#!/usr/bin/env node
// scripts/audit-postinstall.mjs
//
// Plan 02-02 Task 3 — SCAF-04 + COEXIST-04: CI fails on any direct or
// transitive dependency that ships a postinstall / preinstall / install
// script. Trust-model rationale: postinstall scripts run with full
// developer-machine privileges at `pnpm install` time. A single compromised
// dependency could exfiltrate secrets, persist a backdoor, or modify code in
// node_modules. pnpm 9.x default-deny mitigates by NOT running unallowlisted
// postinstalls, but the SAFE posture is "no postinstalls in the tree at all,
// or each one allowlisted with documented rationale."
//
// Allowlist exception: esbuild. Per Plan 02-01 SMOKE-FINDINGS §"D-08(f)
// Postinstall Audit", esbuild ships a vestigial `postinstall: "node
// install.js"` for legacy fallback. pnpm 9.x default-deny blocks execution;
// the platform binary is delivered via the `@esbuild/<platform>` optional-dep
// mechanism (a pure package extraction with no script invocation). The audit
// allowlists esbuild specifically with a comment citing the rationale.
//
// Exit codes:
//   0 — clean tree (modulo allowlist)
//   1 — unallowlisted dependency declares a lifecycle script; prints which one
//
// Wired into CI via .github/workflows/scaffold-check.yml. Also runnable
// locally: `node scripts/audit-postinstall.mjs`.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWLIST = new Set([
  // esbuild — vestigial install.js; pnpm 9.x default-deny blocks execution;
  // platform binary arrives via @esbuild/<platform> optional dep. Empirically
  // verified clean in Plan 02-01 SMOKE-FINDINGS §"D-08(f) Postinstall Audit"
  // (tree diff --ignore-scripts vs default install: empty across 10 packages).
  'esbuild',
]);

const LIFECYCLE_KEYS = ['postinstall', 'preinstall', 'install'];

async function* walkPackageJsons(rootDir) {
  // Walk node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/package.json paths.
  const pnpmDir = path.join(rootDir, 'node_modules', '.pnpm');
  let topLevel;
  try {
    topLevel = await readdir(pnpmDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // No node_modules — caller forgot to install. Treat as success (nothing
      // to audit) rather than failing CI before install ran.
      return;
    }
    throw err;
  }
  for (const versionedName of topLevel) {
    const innerNm = path.join(pnpmDir, versionedName, 'node_modules');
    let innerNames;
    try {
      innerNames = await readdir(innerNm);
    } catch {
      continue;
    }
    for (const pkgName of innerNames) {
      // Handle @scope/name (pkgName starts with '@' → recurse one level deeper)
      if (pkgName.startsWith('@')) {
        const scopeDir = path.join(innerNm, pkgName);
        let scoped;
        try {
          scoped = await readdir(scopeDir);
        } catch {
          continue;
        }
        for (const scopedPkg of scoped) {
          const candidate = path.join(scopeDir, scopedPkg, 'package.json');
          try {
            const s = await stat(candidate);
            if (s.isFile()) yield candidate;
          } catch {
            // skip
          }
        }
      } else {
        const candidate = path.join(innerNm, pkgName, 'package.json');
        try {
          const s = await stat(candidate);
          if (s.isFile()) yield candidate;
        } catch {
          // skip
        }
      }
    }
  }
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const offenders = [];
  let scanned = 0;
  for await (const pkgJsonPath of walkPackageJsons(rootDir)) {
    scanned += 1;
    let pkg;
    try {
      pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg.scripts || typeof pkg.scripts !== 'object') continue;
    const triggered = LIFECYCLE_KEYS.filter((k) => typeof pkg.scripts[k] === 'string');
    if (triggered.length === 0) continue;
    if (ALLOWLIST.has(pkg.name)) continue;
    offenders.push({
      name: pkg.name,
      version: pkg.version,
      scripts: triggered.reduce((acc, k) => {
        acc[k] = pkg.scripts[k];
        return acc;
      }, {}),
      path: pkgJsonPath,
    });
  }

  if (offenders.length > 0) {
    process.stderr.write(
      `audit-postinstall: ${offenders.length} unallowlisted dependency(ies) declare lifecycle scripts (SCAF-04 + COEXIST-04 violation):\n`,
    );
    for (const o of offenders) {
      process.stderr.write(`  ${o.name}@${o.version}: ${JSON.stringify(o.scripts)}\n`);
      process.stderr.write(`    at ${o.path}\n`);
    }
    process.stderr.write(
      `\nResolution: either remove the dependency, replace it with a no-postinstall alternative,\n` +
        `or add to ALLOWLIST in scripts/audit-postinstall.mjs with a documented rationale\n` +
        `(format: comment block citing the empirical-clean evidence per Plan 02-01 SMOKE-FINDINGS pattern).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`audit-postinstall: scanned ${scanned} package(s); 0 unallowlisted lifecycle scripts.\n`);
}

await main();
