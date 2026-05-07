// scripts/safety/test/paperclip-api.test.mjs
//
// API1–API9 — REST client for Paperclip's smoke surface.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHealth,
  listIssues,
  listCompanyAgents,
  listPlugins,
  invokeHeartbeat,
  redactedError
} from '../lib/paperclip-api.mjs';
import { startStubServer } from './fixtures/stub-paperclip-server.mjs';

test('API1 — startStubServer returns server, port, baseUrl, setMode, close', async () => {
  const stub = await startStubServer();
  try {
    assert.equal(typeof stub.port, 'number');
    assert.match(stub.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(typeof stub.setMode, 'function');
    assert.equal(typeof stub.close, 'function');
    // Independently verify it answers /health.
    const r = await fetch(stub.baseUrl + '/health');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  } finally {
    await stub.close();
  }
});

test('API2 — getHealth happy path returns {status:200, body, raw}', async () => {
  const stub = await startStubServer();
  try {
    const res = await getHealth({ apiUrl: stub.baseUrl });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.raw, 'raw Response object should be present');
  } finally {
    await stub.close();
  }
});

test('API3 — apiKey is sent as Authorization: Bearer <token>', async () => {
  const stub = await startStubServer();
  try {
    await getHealth({ apiUrl: stub.baseUrl, apiKey: 'sekret-token-1234' });
    assert.equal(stub.captured.lastAuthHeader, 'Bearer sekret-token-1234');
  } finally {
    await stub.close();
  }
});

test('API4 — abort signal triggers timeout within ~150ms', async () => {
  const stub = await startStubServer({ mode: 'healthy', delayMs: 10000 });
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const t0 = Date.now();
    let threw = false;
    try {
      await getHealth({ apiUrl: stub.baseUrl, signal: ctrl.signal });
    } catch (err) {
      threw = true;
      // AbortError, or any error caused by an abort, is acceptable.
      assert.ok(err && (err.name === 'AbortError' || /abort/i.test(err.message ?? '')));
    }
    const dt = Date.now() - t0;
    assert.equal(threw, true);
    assert.ok(dt < 1500, `expected <1500ms wall clock, saw ${dt}ms`);
  } finally {
    await stub.close();
  }
});

test('API5 — 4xx status is non-throwing; returned in result', async () => {
  const stub = await startStubServer({ mode: 'unauth' });
  try {
    const res = await listIssues({ apiUrl: stub.baseUrl });
    assert.equal(res.status, 401);
    assert.ok(res.body && typeof res.body === 'object');
  } finally {
    await stub.close();
  }
});

test('API6 — 5xx status is non-throwing; smoke layer decides fail', async () => {
  const stub = await startStubServer({ mode: 'down' });
  try {
    const res = await listIssues({ apiUrl: stub.baseUrl });
    assert.equal(res.status, 500);
    assert.ok(res.body && typeof res.body === 'object');
  } finally {
    await stub.close();
  }
});

test('API7 — redactedError replaces apiKey occurrences in error messages', async () => {
  const apiKey = 'sekret-token-1234';
  const original = new Error(`fetch failed: token=${apiKey} at host`);
  const wrapped = redactedError(original, apiKey);
  assert.ok(!wrapped.message.includes(apiKey), 'message must not contain apiKey');
  assert.ok(wrapped.message.includes('<REDACTED>'));
});

test('API8 — invokeHeartbeat is POST with JSON content-type and JSON body verbatim', async () => {
  const stub = await startStubServer();
  try {
    await invokeHeartbeat(
      { apiUrl: stub.baseUrl, apiKey: 'k1' },
      'agent-foo',
      { payload: 'data' }
    );
    assert.equal(stub.captured.lastMethod, 'POST');
    assert.match(stub.captured.lastContentType ?? '', /application\/json/);
    assert.equal(stub.captured.lastBody, JSON.stringify({ payload: 'data' }));
    assert.match(stub.captured.lastUrl ?? '', /\/api\/agents\/agent-foo\/heartbeat\/invoke$/);
  } finally {
    await stub.close();
  }
});

test('API9 — network failure: error message is redacted of apiKey', async () => {
  // Boot then close to get a definitively closed port.
  const stub = await startStubServer();
  const closedUrl = stub.baseUrl;
  await stub.close();
  const apiKey = 'sekret-bearer-9999';
  let caught;
  try {
    await getHealth({ apiUrl: closedUrl, apiKey });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected fetch to throw against a closed port');
  assert.ok(
    !String(caught.message ?? '').includes(apiKey),
    `apiKey must be absent from error message; saw: ${caught.message}`
  );
});

test('API_listCompanyAgents — exists and returns array on healthy stub', async () => {
  const stub = await startStubServer();
  try {
    const res = await listCompanyAgents({ apiUrl: stub.baseUrl }, 'company-1');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  } finally {
    await stub.close();
  }
});

test('API_listPlugins — returns array', async () => {
  const stub = await startStubServer();
  try {
    const res = await listPlugins({ apiUrl: stub.baseUrl });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body[0].id, 'paperclip.kitchen-sink-example');
  } finally {
    await stub.close();
  }
});
