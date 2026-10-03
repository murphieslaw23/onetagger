import http from 'node:http';
import { URL } from 'node:url';
import { ProviderRegistry } from './core/registry.js';
import { InMemoryJobQueue } from './jobs/in-memory.js';
import { enrichMix } from './core/enrichment.js';

const port = Number(process.env.PORT || 8787);
const registry = new ProviderRegistry();
const queue = new InMemoryJobQueue(registry);

function corsOrigin(req: http.IncomingMessage): string | undefined {
  const configured = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.includes('*')) return '*';
  const requested = req.headers.origin;
  return requested && configured.includes(requested) ? requested : undefined;
}

function json(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown) {
  const payload = status === 204 ? '' : JSON.stringify(body);
  const origin = corsOrigin(req);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(status === 204 ? {} : { 'content-length': Buffer.byteLength(payload) }),
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
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
  if (!req.url) return json(req, res, 404, { error: 'not found' });
  if (req.method === 'OPTIONS') return json(req, res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(req, res, 200, { ok: true, service: 'syco23-mixsets', providers: await registry.health() });
    }
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return json(req, res, 200, await registry.health());
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      return json(req, res, 200, queue.list());
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const input = await body(req);
      if (!input.provider || (!input.query?.q && !input.query?.url && !input.query?.artist)) return json(req, res, 400, { error: 'provider and query are required' });
      return json(req, res, 202, queue.create(String(input.provider), input.query));
    }
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const job = queue.get(jobMatch[1]);
      return job ? json(req, res, 200, job) : json(req, res, 404, { error: 'job not found' });
    }
    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const job = queue.cancel(cancelMatch[1]);
      return job ? json(req, res, 200, job) : json(req, res, 404, { error: 'job not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/enrich') {
      const input = await body(req);
      if (!input.title || !Array.isArray(input.artists)) return json(req, res, 400, { error: 'title and artists are required' });
      return json(req, res, 200, await enrichMix(registry, input));
    }
    if (req.method === 'POST' && url.pathname === '/api/soundcloud/artwork') {
      const input = await body(req);
      if (typeof input.url !== 'string' || input.url.length > 2048) return json(req, res, 400, { error: 'A public SoundCloud track URL is required' });
      try {
        const artwork = await registry.soundcloud.resolvePublicArtwork(input.url);
        return artwork.artworkUrl
          ? json(req, res, 200, artwork)
          : json(req, res, 422, { error: 'That SoundCloud link has no track cover artwork' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(req, res, message.includes('URL is invalid') ? 400 : 502, { error: message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/discogs/enrich') {
      const input = await body(req);
      if (!input.name) return json(req, res, 400, { error: 'name is required' });
      const kind = ['artist', 'crew', 'label'].includes(input.kind) ? input.kind : 'artist';
      return json(req, res, 200, await registry.discogs.enrichEntity(String(input.name), kind));
    }
    return json(req, res, 404, { error: 'not found' });
  } catch (error) {
    return json(req, res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`SYCO23 Mixsets API listening on :${port}`);
});
