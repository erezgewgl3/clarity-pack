// scripts/safety/lib/smoke.mjs
//
// 5-check smoke pass against a running Paperclip REST API.
//
//   1. GET /health                                   → 2xx (records body for version-cross-check)
//   2. GET /api/issues?limit=1                       → 2xx + array
//   3. GET /api/companies/<id>/agents                → 2xx + array
//   4. GET /api/plugins                              → 2xx + array (records body for plugin-cross-check)
//   5. POST /api/agents/<id>/heartbeat/invoke        → 2xx OR clean 4xx (server-alive)
//
// Plus, when a snapshotId is supplied:
//   6. plugin-list-cross-check  — set equality vs manifest.installedPlugins (always required)
//   7. version-cross-check      — equality vs manifest.paperclipVersion (CONDITIONAL: skipped
//                                  when /health body lacks paperclipVersion)
//
// Per-check timeout (default 5000ms) is enforced via a per-check
// AbortController. An optional outer deadline AbortSignal (passed by
// verify.mjs sized to maxRehearsalTimeMs) is composed via
// AbortSignal.any so whichever fires first cancels the in-flight fetch.
// When the deadline wins, smoke surfaces the EXACT reason string
// `'rehearsal time exceeded'` so verify can route it correctly.
//
// FAIL semantics (research Open Question 2 — endpoint exact shape unverified):
//   - 5xx + network failure  → FAIL (server is broken).
//   - 4xx                     → FAIL on health/issues/agents/plugins (data missing
//                               or wrong shape) but PASS on heartbeat (server is alive
//                               and rejected the auth — that's good enough for smoke).
//   - 2xx                     → PASS for all 5.

import path from 'node:path';

import * as api from './paperclip-api.mjs';
import { readManifest } from './manifest.mjs';

const DEFAULT_TIMEOUT = 5000;
const DEADLINE_REASON = 'rehearsal time exceeded';

/**
 * Build a per-check signal that aborts when EITHER the per-check timeout
 * fires OR the outer deadline (if any) aborts. Returns:
 *   { signal, cleanup, deadlineFired() }
 *
 * cleanup() must always be called (in a finally block) to clear the
 * setTimeout, otherwise we'd hold the event loop open.
 *
 * Uses AbortSignal.any (Node ≥20.3) — the package's engines.node ≥20 pin
 * is implicitly tightened to 20.3+ by this single API. The runtime here
 * is Node 24.14.0 (verified by running `node --version` before edit);
 * Plan 01's package.json already locks engines.node >= 20.
 */
function makeSignal(timeoutMs, deadline) {
  const localCtrl = new AbortController();
  const t = setTimeout(() => localCtrl.abort(new Error('per-check-timeout')), timeoutMs);
  let signal;
  if (deadline) {
    signal = AbortSignal.any([localCtrl.signal, deadline]);
  } else {
    signal = localCtrl.signal;
  }
  return {
    signal,
    cleanup: () => clearTimeout(t),
    deadlineFired: () => deadline?.aborted === true
  };
}

/**
 * Run one check helper, mapping aborts/errors to a pushable check entry.
 * Returns { ok: boolean, body? }: ok=false stops the pipeline; ok=true
 * means the check passed and the (optional) body is forwarded to the
 * caller for cross-check use.
 */
async function runCheck({ name, timeoutMs, deadline, fn, validate, on4xx }) {
  const { signal, cleanup, deadlineFired } = makeSignal(timeoutMs, deadline);
  try {
    const res = await fn(signal);
    // 5xx is always FAIL.
    if (res.status >= 500) {
      return { ok: false, check: { name, status: 'fail', detail: `HTTP ${res.status}` } };
    }
    // 4xx — caller-controlled disposition.
    if (res.status >= 400) {
      if (on4xx === 'pass') {
        return {
          ok: true,
          body: res.body,
          check: { name, status: 'pass', detail: `http-${res.status}-server-alive` }
        };
      }
      return { ok: false, check: { name, status: 'fail', detail: `HTTP ${res.status}` } };
    }
    // 2xx — apply optional shape validator.
    if (validate && !validate(res.body)) {
      return {
        ok: false,
        check: { name, status: 'fail', detail: `HTTP ${res.status} but body shape invalid` }
      };
    }
    return { ok: true, body: res.body, check: { name, status: 'pass' } };
  } catch (e) {
    const reason = deadlineFired() ? DEADLINE_REASON : (e && e.message) || String(e);
    return { ok: false, check: { name, status: 'fail', detail: reason } };
  } finally {
    cleanup();
  }
}

export async function smoke(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('smoke: opts is required');
  }
  const {
    apiUrl,
    apiKey,
    companyId,
    editorAgentId,
    timeoutMs = DEFAULT_TIMEOUT,
    snapshotId,
    snapshotsDir,
    deadline
  } = opts;
  if (typeof apiUrl !== 'string' || apiUrl.length === 0) {
    throw new Error('smoke: opts.apiUrl is required');
  }
  if (typeof companyId !== 'string' || companyId.length === 0) {
    throw new Error('smoke: opts.companyId is required');
  }

  const checks = [];
  let healthBody = null;
  let pluginsBody = null;
  const apiOpts = (signal) => ({ apiUrl, apiKey, signal });

  // 1. health
  {
    const r = await runCheck({
      name: 'health',
      timeoutMs,
      deadline,
      fn: (signal) => api.getHealth(apiOpts(signal))
    });
    checks.push(r.check);
    if (!r.ok) return finalize(checks);
    healthBody = r.body;
  }

  // 2. issues
  {
    const r = await runCheck({
      name: 'issues',
      timeoutMs,
      deadline,
      fn: (signal) => api.listIssues(apiOpts(signal), { limit: 1 }),
      validate: (body) => Array.isArray(body)
    });
    checks.push(r.check);
    if (!r.ok) return finalize(checks);
  }

  // 3. agents
  {
    const r = await runCheck({
      name: 'agents',
      timeoutMs,
      deadline,
      fn: (signal) => api.listCompanyAgents(apiOpts(signal), companyId),
      validate: (body) => Array.isArray(body)
    });
    checks.push(r.check);
    if (!r.ok) return finalize(checks);
  }

  // 4. plugins
  {
    const r = await runCheck({
      name: 'plugins',
      timeoutMs,
      deadline,
      fn: (signal) => api.listPlugins(apiOpts(signal)),
      validate: (body) => Array.isArray(body)
    });
    checks.push(r.check);
    if (!r.ok) return finalize(checks);
    pluginsBody = r.body;
  }

  // 5. heartbeat — 4xx is PASS (server-alive); only 5xx + network-fail are FAIL.
  if (!editorAgentId) {
    checks.push({ name: 'heartbeat', status: 'skipped', detail: 'no editor-agent id' });
  } else {
    const r = await runCheck({
      name: 'heartbeat',
      timeoutMs,
      deadline,
      fn: (signal) => api.invokeHeartbeat(apiOpts(signal), editorAgentId, {}),
      on4xx: 'pass'
    });
    checks.push(r.check);
    if (!r.ok) return finalize(checks);
  }

  // 6. + 7. cross-check vs manifest if snapshotId provided.
  if (snapshotId) {
    if (typeof snapshotsDir !== 'string' || snapshotsDir.length === 0) {
      throw new Error('smoke: opts.snapshotsDir is required when snapshotId is set');
    }
    const snapshotDir = path.join(snapshotsDir, snapshotId);
    const manifest = await readManifest(snapshotDir);

    // plugin-list-cross-check: ALWAYS required when a snapshotId is supplied.
    const expected = new Set((manifest.installedPlugins ?? []).map((p) => p.id));
    const actual = new Set((pluginsBody ?? []).map((p) => p.id));
    const missing = [...expected].filter((x) => !actual.has(x));
    const extra = [...actual].filter((x) => !expected.has(x));
    if (missing.length || extra.length) {
      checks.push({
        name: 'plugin-list-cross-check',
        status: 'fail',
        detail: `missing=[${missing.join(',')}] extra=[${extra.join(',')}]`
      });
      return finalize(checks);
    }
    checks.push({ name: 'plugin-list-cross-check', status: 'pass' });

    // version-cross-check: CONDITIONAL on /health body carrying paperclipVersion.
    // When the server does not report its version, this check is SKIPPED (does
    // not fail smoke). Promoting to fail-closed is an Open Question for SPEC.md.
    const reportedVersion =
      healthBody && typeof healthBody === 'object' ? healthBody.paperclipVersion : undefined;
    if (reportedVersion === undefined || reportedVersion === null) {
      checks.push({
        name: 'version-cross-check',
        status: 'skipped',
        detail:
          'server did not report paperclipVersion in /health body; version equality not enforced'
      });
    } else if (reportedVersion !== manifest.paperclipVersion) {
      checks.push({
        name: 'version-cross-check',
        status: 'fail',
        detail: `expected ${manifest.paperclipVersion} got ${reportedVersion}`
      });
      return finalize(checks);
    } else {
      checks.push({ name: 'version-cross-check', status: 'pass' });
    }
  }

  return finalize(checks);
}

function finalize(checks) {
  const failed = checks.find((c) => c.status === 'fail');
  if (failed) {
    return { ok: false, checks, failedCheck: failed.name, reason: failed.detail };
  }
  return { ok: true, checks };
}
