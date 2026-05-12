// scripts/safety/test/fixtures/stub-paperclip-server.mjs
//
// 100-line node:http server that mimics Paperclip's 5 documented REST
// endpoints with configurable response shapes for smoke-test fixtures.
//
// Modes:
//   'healthy'      — 200 + paperclipVersion 0.41.2; default plugin set.
//   'healthy-noversion' — 200 on /health but body omits paperclipVersion
//                          (used to drive smoke's conditional version-cross-check).
//   'down'         — every endpoint returns 500.
//   'unauth'       — every endpoint returns 401.
//   'plugin-drift' — /api/plugins returns an extra 'rogue' plugin.
//   'version-drift' — /health returns a different paperclipVersion (0.42.0).
//   'heartbeat-401' — heartbeat invoke returns 401; everything else healthy.
//
// Per-call delayMs lets smoke tests force the per-check timeout to fire.
// Always binds 127.0.0.1 only — never exposed beyond loopback.

import http from 'node:http';

const DEFAULT_PLUGINS = [
  { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' }
];
const DRIFT_PLUGINS = [
  { id: 'paperclip.kitchen-sink-example', version: '0.1.0', status: 'ready' },
  { id: 'rogue', version: '9.9.9', status: 'ready' }
];

export async function startStubServer({ mode = 'healthy', delayMs = 0 } = {}) {
  const captured = {
    lastAuthHeader: null,
    lastBody: null,
    lastUrl: null,
    lastMethod: null,
    lastContentType: null
  };
  const state = { mode, delayMs };

  const server = http.createServer(async (req, res) => {
    captured.lastAuthHeader = req.headers.authorization ?? null;
    captured.lastUrl = req.url;
    captured.lastMethod = req.method;
    captured.lastContentType = req.headers['content-type'] ?? null;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    captured.lastBody = chunks.length ? Buffer.concat(chunks).toString('utf8') : null;

    if (state.delayMs > 0) {
      await new Promise((r) => setTimeout(r, state.delayMs));
    }

    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (state.mode === 'down') return respond(500, { error: 'internal' });
    if (state.mode === 'unauth') return respond(401, { error: 'unauthorized' });

    const url = req.url ?? '';

    if (url === '/health') {
      if (state.mode === 'healthy-noversion') {
        return respond(200, { ok: true });
      }
      if (state.mode === 'version-drift') {
        return respond(200, { ok: true, paperclipVersion: '0.42.0' });
      }
      return respond(200, { ok: true, paperclipVersion: '0.41.2' });
    }
    if (url.startsWith('/api/issues')) {
      return respond(200, [{ id: 'BEAAA-1', title: 'Sample' }]);
    }
    // Paperclip moved /api/issues to /api/companies/{id}/issues — serve
    // either path so the stub matches both old and new safety CLI calls.
    if (/^\/api\/companies\/[^/]+\/issues/.test(url)) {
      return respond(200, [{ id: 'BEAAA-1', title: 'Sample' }]);
    }
    if (url.includes('/heartbeat/invoke')) {
      if (state.mode === 'heartbeat-401') {
        return respond(401, { error: 'agent-key-rejected' });
      }
      return respond(202, { accepted: true });
    }
    if (url.includes('/agents') && !url.includes('/heartbeat/')) {
      return respond(200, [{ id: 'agent-foo', role: 'editor' }]);
    }
    if (url === '/api/plugins') {
      const plugins = state.mode === 'plugin-drift' ? DRIFT_PLUGINS : DEFAULT_PLUGINS;
      return respond(200, plugins);
    }
    return respond(404, { error: 'not-found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    captured,
    setMode: (m, d = 0) => {
      state.mode = m;
      state.delayMs = d;
    },
    close: () => new Promise((r) => server.close(r))
  };
}
