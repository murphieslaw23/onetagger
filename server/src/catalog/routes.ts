import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CatalogRecordSchema,
  IndexKindSchema,
  PageQuerySchema,
  type CatalogRecord,
  type IndexKind,
  type RecordId
} from '@syco23/catalog-domain';
import type { CuratorAuth } from '../auth/curator.js';
import { decideReview, refreshReview } from './merge.js';
import type { CatalogRepository } from './repository.js';
import { applyCorsHeaders, HttpInputError, isAllowedOrigin, readJsonBody, sendJson } from '../http.js';
import type { ProviderRegistry } from '../core/registry.js';
import { enrichCatalogRecord } from './enrich.js';
import { importCandidate } from './identity.js';
import { ImportCandidateSchema } from '@syco23/catalog-domain';
import { migrateLegacyLibrary } from './migration.js';
import { persistWaveform, readWaveformMedia } from './media.js';
import { readRequestBytes } from '../http.js';

export interface CatalogRouteContext {
  repository: CatalogRepository;
  auth: CuratorAuth;
  registry?: ProviderRegistry;
}

const editableFields: Record<CatalogRecord['kind'], readonly string[]> = {
  mix: ['title', 'description', 'durationMs', 'recordingDate', 'people', 'eventIds', 'genres', 'styles', 'assets', 'playbackUrls'],
  entity: ['displayName', 'roles', 'aliases', 'profile', 'country', 'assets', 'artist', 'crew', 'label'],
  event: ['name', 'startDate', 'endDate', 'venue', 'locality', 'country', 'assets', 'sourceUrls', 'mixIds']
};

function requireCurator(context: CatalogRouteContext, request: IncomingMessage, response: ServerResponse): boolean {
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'Origin is not allowed' });
    return false;
  }
  if (!context.auth.authenticate(request)) {
    sendJson(response, 401, { error: 'Curator login is required' });
    return false;
  }
  return true;
}

function parsedError(error: unknown): { status: number; body: unknown } {
  if (error instanceof HttpInputError) return { status: error.statusCode, body: { error: error.message } };
  if (error && typeof error === 'object' && 'issues' in error) {
    return { status: 400, body: { error: 'Input validation failed', issues: error.issues } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/revision conflict/i.test(message)) return { status: 409, body: { error: message } };
  if (/does not exist|unknown record/i.test(message)) return { status: 404, body: { error: message } };
  return { status: 400, body: { error: message } };
}

function recordId(value: string): RecordId {
  return decodeURIComponent(value) as RecordId;
}

async function handlePatch(context: CatalogRouteContext, request: IncomingMessage, response: ServerResponse, id: RecordId) {
  if (!requireCurator(context, request, response)) return;
  try {
    const input = await readJsonBody(request) as { expectedRevision?: unknown; patch?: unknown };
    if (!Number.isInteger(input.expectedRevision) || !input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
      sendJson(response, 400, { error: 'expectedRevision and an object patch are required' });
      return;
    }
    const current = context.repository.getRecord(id);
    if (!current) {
      sendJson(response, 404, { error: 'Catalog record not found' });
      return;
    }
    const patch = input.patch as Record<string, unknown>;
    if (Object.keys(patch).some((field) => !editableFields[current.kind].includes(field))) {
      sendJson(response, 400, { error: 'Patch contains a field that cannot be edited directly' });
      return;
    }
    if (current.revision !== input.expectedRevision) {
      sendJson(response, 409, { error: `Revision conflict for ${id}` });
      return;
    }
    const updated = CatalogRecordSchema.parse({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString()
    });
    context.repository.transaction((tx) => tx.saveRecord(updated, current.revision));
    sendJson(response, 200, updated);
  } catch (error) {
    const parsed = parsedError(error);
    sendJson(response, parsed.status, parsed.body);
  }
}

export async function handleCatalogRoute(context: CatalogRouteContext, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  applyCorsHeaders(request, response);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  const mediaMatch = path.match(/^\/api\/catalog\/media\/([A-Za-z0-9_-]{8,128})$/);
  if (request.method === 'GET' && mediaMatch) {
    const bytes = readWaveformMedia(context.repository, recordId(mediaMatch[1]));
    if (!bytes) {
      sendJson(response, 404, { error: 'Media asset not found' });
      return true;
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': bytes.byteLength,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff'
    });
    response.end(bytes);
    return true;
  }

  if (request.method === 'POST' && path === '/api/catalog/migrate') {
    if (!requireCurator(context, request, response)) return true;
    try {
      const input = await readJsonBody(request) as { batchId?: unknown; records?: unknown };
      if (typeof input.batchId !== 'string' || !Array.isArray(input.records)) {
        sendJson(response, 400, { error: 'batchId and records are required' });
        return true;
      }
      const actor = context.auth.authenticate(request)!;
      const result = migrateLegacyLibrary(context.repository, input.records, input.batchId, actor);
      sendJson(response, 200, result);
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  const waveformMatch = path.match(/^\/api\/catalog\/records\/([^/]+)\/waveform$/);
  if (request.method === 'PUT' && waveformMatch) {
    if (!requireCurator(context, request, response)) return true;
    if (!/^image\/png(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
      sendJson(response, 415, { error: 'Waveform uploads must use image/png' });
      return true;
    }
    try {
      const png = await readRequestBytes(request, 8 * 1024 * 1024);
      const sourceUrl = url.searchParams.get('sourceUrl') ?? '';
      const record = persistWaveform(context.repository, recordId(waveformMatch[1]), png, sourceUrl);
      sendJson(response, 200, record);
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  if (request.method === 'POST' && path === '/api/catalog/import') {
    if (!requireCurator(context, request, response)) return true;
    try {
      const input = ImportCandidateSchema.parse(await readJsonBody(request));
      const actor = context.auth.authenticate(request)!;
      const result = importCandidate(context.repository, input, actor);
      sendJson(response, result.outcome === 'created' ? 201 : 200, result);
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  const enrichMatch = path.match(/^\/api\/catalog\/records\/([^/]+)\/enrich$/);
  if (request.method === 'POST' && enrichMatch) {
    if (!requireCurator(context, request, response)) return true;
    if (!context.registry) {
      sendJson(response, 503, { error: 'Provider registry is unavailable' });
      return true;
    }
    try {
      const actor = context.auth.authenticate(request)!;
      const report = await enrichCatalogRecord(context.repository, context.registry, recordId(enrichMatch[1]), actor);
      sendJson(response, 200, report);
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  const recordMatch = path.match(/^\/api\/catalog\/records\/([^/]+)$/);
  if (request.method === 'GET' && recordMatch) {
    const record = context.repository.getRecord(recordId(recordMatch[1]));
    if (record?.verification === 'proposed' && !context.auth.authenticate(request)) {
      sendJson(response, 404, { error: 'Catalog record not found' });
      return true;
    }
    sendJson(response, record ? 200 : 404, record ?? { error: 'Catalog record not found' });
    return true;
  }

  if (request.method === 'PATCH' && recordMatch) {
    await handlePatch(context, request, response, recordId(recordMatch[1]));
    return true;
  }

  if (request.method === 'GET' && path === '/api/catalog/review') {
    if (!context.auth.authenticate(request)) {
      sendJson(response, 401, { error: 'Curator login is required' });
      return true;
    }
    sendJson(response, 200, context.repository.listReview());
    return true;
  }

  const decisionMatch = path.match(/^\/api\/catalog\/review\/([^/]+)\/decision$/);
  if (request.method === 'POST' && decisionMatch) {
    if (!requireCurator(context, request, response)) return true;
    try {
      const input = await readJsonBody(request) as { decision?: unknown; expectedRevision?: unknown };
      if (!['accept', 'reject'].includes(String(input.decision)) || !Number.isInteger(input.expectedRevision)) {
        sendJson(response, 400, { error: 'decision and expectedRevision are required' });
        return true;
      }
      const actor = context.auth.authenticate(request)!;
      const item = decideReview(context.repository, recordId(decisionMatch[1]), input.decision as 'accept' | 'reject', input.expectedRevision as number, actor.sessionId);
      sendJson(response, 200, item);
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  const refreshMatch = path.match(/^\/api\/catalog\/review\/([^/]+)\/refresh$/);
  if (request.method === 'POST' && refreshMatch) {
    if (!requireCurator(context, request, response)) return true;
    try {
      sendJson(response, 200, refreshReview(context.repository, recordId(refreshMatch[1])));
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  const indexMatch = path.match(/^\/api\/catalog\/([^/]+)$/);
  if (request.method === 'GET' && indexMatch) {
    try {
      const kind = IndexKindSchema.parse(indexMatch[1]) as IndexKind;
      const page = PageQuerySchema.parse({
        page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
        pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
        query: url.searchParams.get('q') ?? undefined
      });
      sendJson(response, 200, context.repository.listIndex(kind, page));
    } catch (error) {
      const parsed = parsedError(error);
      sendJson(response, parsed.status, parsed.body);
    }
    return true;
  }

  return false;
}