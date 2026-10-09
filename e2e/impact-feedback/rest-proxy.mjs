/**
 * Local-only Supabase-shaped proxy for the impact feedback E2E stack (manual runs, not CI).
 * Forwards /rest/v1/* to a PostgREST instance and answers CORS preflights.
 *
 *   POSTGREST_URL=http://127.0.0.1:54330 PORT=54321 node e2e/impact-feedback/rest-proxy.mjs
 */
import http from 'node:http';

const target = new URL(process.env.POSTGREST_URL || 'http://127.0.0.1:54330');
const port = Number(process.env.PORT || 54321);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-client-info',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, range'
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (!req.url.startsWith('/rest/v1')) {
    res.writeHead(404, { ...CORS, 'content-type': 'application/json' });
    res.end('{"message":"not available in the local feedback stack"}');
    return;
  }
  const headers = { ...req.headers, host: target.host };
  delete headers.apikey;
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port,
    path: req.url.slice('/rest/v1'.length) || '/',
    method: req.method,
    headers
  }, (up) => {
    res.writeHead(up.statusCode || 502, { ...up.headers, ...CORS });
    up.pipe(res);
  });
  upstream.on('error', (error) => {
    res.writeHead(502, CORS);
    res.end(String(error.message));
  });
  req.pipe(upstream);
}).listen(port, '127.0.0.1', () => console.log(`rest proxy :${port} -> ${target.href}`));
