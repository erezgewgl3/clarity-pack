// scripts/safety/lib/paperclip-api.mjs
//
// Thin REST client for Paperclip's smoke-test surface.
//
// Five helpers — one per endpoint smoke needs:
//   getHealth, listIssues, listCompanyAgents, listPlugins, invokeHeartbeat
//
// Each accepts a shared `opts = { apiUrl, apiKey?, signal? }` and returns
// `{ status, body, raw }`. 4xx and 5xx statuses are returned as-is (the
// smoke layer decides which are PASS vs FAIL); only network failures or
// abort signals throw. Throws are wrapped via redactedError so apiKey
// material never lands in logs (Security Domain V2 — credential redaction).
//
// No third-party deps; uses Node 20+ native fetch + AbortController.

/**
 * Build the Authorization header object. Returns {} when no apiKey is set
 * so we never emit a header with a blank Bearer value.
 */
function buildHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/**
 * Single-call helper: builds URL, sends fetch, returns {status, body, raw}.
 * Body is parsed as JSON when content-type indicates JSON, else as text.
 * Network errors are wrapped via redactedError so apiKey never leaks.
 */
async function call(opts, method, pathname, body) {
  if (!opts || typeof opts.apiUrl !== 'string' || opts.apiUrl.length === 0) {
    throw new Error('paperclip-api: opts.apiUrl is required');
  }
  const url = `${opts.apiUrl.replace(/\/$/, '')}${pathname}`;
  const init = {
    method,
    headers: { ...buildHeaders(opts.apiKey) },
    signal: opts.signal
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let raw;
  try {
    raw = await fetch(url, init);
  } catch (err) {
    throw redactedError(err, opts.apiKey);
  }
  const ct = raw.headers.get('content-type') ?? '';
  let parsed;
  try {
    parsed = ct.includes('application/json') ? await raw.json() : await raw.text();
  } catch (err) {
    // A non-JSON body when JSON was advertised is rare but possible.
    // Surface it without leaking the apiKey.
    throw redactedError(err, opts.apiKey);
  }
  return { status: raw.status, body: parsed, raw };
}

export function getHealth(opts) {
  return call(opts, 'GET', '/health');
}

export function listIssues(opts, query = {}) {
  const limit = query && Number.isFinite(query.limit) ? query.limit : 1;
  return call(opts, 'GET', `/api/issues?limit=${limit}`);
}

export function listCompanyAgents(opts, companyId) {
  return call(opts, 'GET', `/api/companies/${encodeURIComponent(companyId)}/agents`);
}

export function listPlugins(opts) {
  return call(opts, 'GET', '/api/plugins');
}

export function invokeHeartbeat(opts, agentId, payload = {}) {
  return call(
    opts,
    'POST',
    `/api/agents/${encodeURIComponent(agentId)}/heartbeat/invoke`,
    payload
  );
}

/**
 * Wrap an Error so every literal occurrence of `apiKey` in the message is
 * replaced with `<REDACTED>`. The Authorization header value is also
 * redacted (defense in depth — `Bearer ...` substrings are scrubbed). The
 * original `name` and `cause` are preserved.
 *
 * If apiKey is unset/empty, returns the original error (no redaction
 * needed).
 */
export function redactedError(err, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return err;
  const original = err && typeof err.message === 'string' ? err.message : String(err);
  let scrubbed = original.split(apiKey).join('<REDACTED>');
  // Defense in depth: also scrub a Bearer prefix variant if it leaked.
  scrubbed = scrubbed.split(`Bearer ${apiKey}`).join('Bearer <REDACTED>');
  const wrapped = new Error(scrubbed);
  if (err && err.name) wrapped.name = err.name;
  if (err && err.cause !== undefined) wrapped.cause = err.cause;
  return wrapped;
}
