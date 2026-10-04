import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import type { MixRecord } from '@syco23/catalog-domain';
import { openCatalog } from './repository.js';
import { createCuratorAuth, hashCuratorPassword } from '../auth/curator.js';
import { handleCatalogRoute } from './routes.js';

const timestamp = '2026-10-03T12:00:00.000Z';

function request(method: string, url: string, value?: unknown, headers: Record<string, string> = {}) {
  const input = value === undefined ? [] : [JSON.stringify(value)];
  const req = Readable.from(input) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers;
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  return req;
}

function response() {
  const result: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const res = {
    setHeader(name: string, value: string) { result.headers = { ...result.headers, [name]: value }; },
    writeHead(status: number, headers: Record<string, string>) { result.status = status; result.headers = headers; return this; },
    end(body = '') { result.body = body; }
  } as unknown as ServerResponse;
  return { res, result };
}

function mix(): MixRecord {
  return {
    kind: 'mix', id: 'mix_01J9CATALOGUE00000000000020', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, verification: 'source-confirmed', reviewState: 'ready', title: 'Original mix',
    people: [], eventIds: [], genres: [], styles: [], assets: [], sources: []
  };
}

test('catalog indexes are public while review is curator-only', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-catalog-routes-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  try {
    repo.transaction((tx) => tx.saveRecord(mix()));
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const context = { repository: repo, auth };
    const publicResponse = response();
    await handleCatalogRoute(context, request('GET', '/api/catalog/mix?page=1&pageSize=10'), publicResponse.res);
    assert.equal(publicResponse.result.status, 200);
    assert.equal(JSON.parse(publicResponse.result.body ?? '{}').items[0].id, mix().id);

    const privateResponse = response();
    await handleCatalogRoute(context, request('GET', '/api/catalog/review'), privateResponse.res);
    assert.equal(privateResponse.result.status, 401);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('curator edits use revision checks and never accept revision fields from the patch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-catalog-routes-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const previousOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  try {
    repo.transaction((tx) => tx.saveRecord(mix()));
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const cookie = auth.login('private-local-password', '127.0.0.1').split(';')[0];
    const context = { repository: repo, auth };
    const accepted = response();
    await handleCatalogRoute(context, request('PATCH', `/api/catalog/records/${mix().id}`, {
      expectedRevision: 1,
      patch: { title: 'Curated mix', revision: 99 }
    }, { cookie, origin: 'http://localhost:5173' }), accepted.res);
    assert.equal(accepted.result.status, 400);

    const changed = response();
    await handleCatalogRoute(context, request('PATCH', `/api/catalog/records/${mix().id}`, {
      expectedRevision: 1,
      patch: { title: 'Curated mix' }
    }, { cookie, origin: 'http://localhost:5173' }), changed.res);
    assert.equal(changed.result.status, 200);
    assert.equal(JSON.parse(changed.result.body ?? '{}').revision, 2);

    const stale = response();
    await handleCatalogRoute(context, request('PATCH', `/api/catalog/records/${mix().id}`, {
      expectedRevision: 1,
      patch: { title: 'Stale write' }
    }, { cookie, origin: 'http://localhost:5173' }), stale.res);
    assert.equal(stale.result.status, 409);
  } finally {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('catalog import requires curator access and is idempotent across retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-catalog-routes-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const previousOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  try {
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const context = { repository: repo, auth };
    const input = {
      provider: 'youtube', title: 'Live Mackitek Koalisson III', artists: ['Channel Name'], crews: [],
      artwork: ['https://i.ytimg.com/vi/vi5miMVpmuI/hqdefault.jpg'], confidence: 0.85,
      reasons: ['selected source'], source: {
        provider: 'youtube', resourceType: 'video', externalId: 'vi5miMVpmuI',
        url: 'https://www.youtube.com/watch?v=vi5miMVpmuI'
      }
    };
    const denied = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/import', input, { origin: 'http://localhost:5173' }), denied.res);
    assert.equal(denied.result.status, 401);

    const cookie = auth.login('private-local-password', '127.0.0.1').split(';')[0];
    const created = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/import', input, { cookie, origin: 'http://localhost:5173' }), created.res);
    assert.equal(created.result.status, 201);
    assert.equal(JSON.parse(created.result.body ?? '{}').record.people.length, 0);

    const retried = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/import', input, { cookie, origin: 'http://localhost:5173' }), retried.res);
    assert.equal(retried.result.status, 200);
    assert.equal(JSON.parse(retried.result.body ?? '{}').record.id, JSON.parse(created.result.body ?? '{}').record.id);
  } finally {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('proposed identity details are private until their identity is confirmed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-catalog-routes-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  try {
    const event = {
      kind: 'event' as const, id: 'event_01J9CATALOGUE00000000000020',
      createdAt: timestamp, updatedAt: timestamp, revision: 1, verification: 'proposed' as const,
      reviewState: 'review' as const, name: 'Aniane Free Party', assets: [], sourceUrls: [], mixIds: []
    };
    repo.transaction((tx) => tx.saveRecord(event));
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const context = { repository: repo, auth };
    const publicResponse = response();
    await handleCatalogRoute(context, request('GET', `/api/catalog/records/${event.id}`), publicResponse.res);
    assert.equal(publicResponse.result.status, 404);

    const cookie = auth.login('private-local-password', '127.0.0.1').split(';')[0];
    const curatorResponse = response();
    await handleCatalogRoute(context, request('GET', `/api/catalog/records/${event.id}`, undefined, { cookie }), curatorResponse.res);
    assert.equal(curatorResponse.result.status, 200);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy migration requires curator access and returns a stable batch result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-catalog-routes-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const previousOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  try {
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const context = { repository: repo, auth };
    const input = { batchId: 'browser-migration-1', records: [{ id: 'legacy-route-1', title: 'Archive mix', sources: [] }] };
    const denied = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/migrate', input, { origin: 'http://localhost:5173' }), denied.res);
    assert.equal(denied.result.status, 401);

    const cookie = auth.login('private-local-password', '127.0.0.1').split(';')[0];
    const created = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/migrate', input, { cookie, origin: 'http://localhost:5173' }), created.res);
    assert.equal(created.result.status, 200);
    const first = JSON.parse(created.result.body ?? '{}');
    assert.equal(first.imported, 1);

    const retried = response();
    await handleCatalogRoute(context, request('POST', '/api/catalog/migrate', input, { cookie, origin: 'http://localhost:5173' }), retried.res);
    assert.deepEqual(JSON.parse(retried.result.body ?? '{}'), first);
  } finally {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('curator waveform upload persists PNG bytes and public media GET serves the linked asset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-waveform-route-'));
  const priorOrigin = process.env.CORS_ORIGIN;
  const priorMediaPath = process.env.CATALOG_MEDIA_PATH;
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.CATALOG_MEDIA_PATH = join(directory, 'media');
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  try {
    repo.transaction((tx) => tx.saveRecord(mix()));
    const auth = createCuratorAuth(repo, hashCuratorPassword('private-local-password'));
    const cookie = auth.login('private-local-password', '127.0.0.1').split(';')[0];
    const context = { repository: repo, auth };
    const uploadRequest = Readable.from([png]) as IncomingMessage;
    uploadRequest.method = 'PUT';
    uploadRequest.url = `/api/catalog/records/${mix().id}/waveform?sourceUrl=${encodeURIComponent('https://archive.org/download/example/audio.mp3')}`;
    uploadRequest.headers = { cookie, origin: 'http://localhost:5173', 'content-type': 'image/png' };
    Object.defineProperty(uploadRequest, 'socket', { value: { remoteAddress: '127.0.0.1' } });
    const uploaded = response();
    await handleCatalogRoute(context, uploadRequest, uploaded.res);
    assert.equal(uploaded.result.status, 200);
    const result = JSON.parse(uploaded.result.body ?? '{}');
    const mediaId = result.assets.find((asset: { role: string }) => asset.role === 'waveform').mediaId;

    const mediaResponse = { status: 0, headers: {} as Record<string, string>, bytes: Buffer.alloc(0) };
    const getRequest = request('GET', `/api/catalog/media/${mediaId}`);
    const getResponse = {
      writeHead(status: number, headers: Record<string, string>) { mediaResponse.status = status; mediaResponse.headers = headers; return this; },
      end(bytes: Buffer) { mediaResponse.bytes = Buffer.from(bytes); }
    } as unknown as ServerResponse;
    await handleCatalogRoute(context, getRequest, getResponse);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers['content-type'], 'image/png');
    assert.deepEqual(mediaResponse.bytes, png);
  } finally {
    if (priorOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = priorOrigin;
    if (priorMediaPath === undefined) delete process.env.CATALOG_MEDIA_PATH;
    else process.env.CATALOG_MEDIA_PATH = priorMediaPath;
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});