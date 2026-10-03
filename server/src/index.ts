import http from 'node:http';
import { URL } from 'node:url';
import { ProviderRegistry } from './core/registry.js';
import { InMemoryJobQueue } from './jobs/in-memory.js';

const port = Number(process.env.PORT || 8787);
const registry = new ProviderRegistry();
const queue = new InMemoryJobQueue(registry);

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': process.env.CORS_ORIGIN || '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return json(res, 404, { error: 'not found' });
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'syco23-mixsets', providers: await registry.health() });
    }
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return json(res, 200, await registry.health());
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      return json(res, 200, queue.list());
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const input = await body(req);
      if (!input.provider || (!input.query?.q && !input.query?.url && !input.query?.artist)) return json(res, 400, { error: 'provider and query are required' });
      return json(res, 202, queue.create(String(input.provider), input.query));
    }
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const job = queue.get(jobMatch[1]);
      return job ? json(res, 200, job) : json(res, 404, { error: 'job not found' });
    }
    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const job = queue.cancel(cancelMatch[1]);
      return job ? json(res, 200, job) : json(res, 404, { error: 'job not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/discogs/enrich') {
      const input = await body(req);
      if (!input.name) return json(res, 400, { error: 'name is required' });
      const kind = ['artist', 'crew', 'label'].includes(input.kind) ? input.kind : 'artist';
      return json(res, 200, await registry.discogs.enrichEntity(String(input.name), kind));
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`SYCO23 Mixsets API listening on :${port}`);
});
