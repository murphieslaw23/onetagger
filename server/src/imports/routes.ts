import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ImportJobSchema,
  PROVIDER_CAPABILITIES,
  ScoredEvidenceSchema,
  terminalImportState,
  type ImportJobState,
} from '@syco23/catalog-domain';
import type { CatalogRepository } from '../catalog/repository.js';
import type { CuratorAuth } from '../auth/curator.js';
import {
  applyCorsHeaders,
  isAllowedOrigin,
  readJsonBody,
  sendJson,
} from '../http.js';
import {
  ImportValidationError,
  decideImportPolicy,
  newImportId,
  parseImportRequest,
} from './policy.js';
import { WorkerAuthError, authenticateWorker, workerBodyText } from './service-auth.js';

export interface ImportRouteContext {
  repository: CatalogRepository;
  auth: CuratorAuth;
  importsEnabled: boolean;
}

// Hard administrative limits for the first release. Configurable via env so
// throughput and storage ceilings are never implicit assumptions in code.
export function importLimits() {
  return {
    maxInputBytes: Number(process.env.IMPORT_MAX_INPUT_BYTES || 2 * 1024 * 1024 * 1024),
    maxOutputBytes: Number(process.env.IMPORT_MAX_OUTPUT_BYTES || 1024 * 1024 * 1024),
    maxDurationMs: Number(process.env.IMPORT_MAX_DURATION_MS || 12 * 60 * 60 * 1000),
    maxAttempts: Number(process.env.IMPORT_MAX_ATTEMPTS || 5),
    autoApplyThreshold: Number(process.env.IMPORT_AUTO_APPLY_THRESHOLD || 80),
  };
}

function requireEnabled(context: ImportRouteContext, response: ServerResponse): boolean {
  if (!context.importsEnabled) {
    sendJson(response, 503, { error: 'Import jobs are disabled (IMPORTS_ENABLED)' });
    return false;
  }
  return true;
}

function requireCurator(context: ImportRouteContext, request: IncomingMessage, response: ServerResponse): boolean {
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

function jobView(context: ImportRouteContext, id: string) {
  const job = context.repository.getImportJob(id);
  if (!job) return undefined;
  return {
    job,
    events: context.repository.listImportEvents(id),
    artifacts: context.repository.listImportArtifacts(id),
    evidence: context.repository.listImportEvidenceScores(id),
  };
}

function parseError(error: unknown): { status: number; body: unknown } {
  if (error instanceof ImportValidationError) return { status: error.statusCode, body: { error: error.message } };
  if (error instanceof WorkerAuthError) return { status: error.statusCode, body: { error: error.message } };
  if (error && typeof error === 'object' && 'issues' in error) {
    return { status: 400, body: { error: 'Input validation failed', issues: (error as { issues: unknown }).issues } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown import job/i.test(message)) return { status: 404, body: { error: 'Import job not found' } };
  if (/duplicate|idempotency/i.test(message)) return { status: 409, body: { error: 'Idempotency key already used' } };
  if (message.includes('Input validation failed')) return { status: 400, body: { error: message } };
  console.error('Import route failure:', error);
  return { status: 500, body: { error: 'Request failed' } };
}

async function handleCreate(context: ImportRouteContext, request: IncomingMessage, response: ServerResponse) {
  if (!requireEnabled(context, response)) return;
  if (!requireCurator(context, request, response)) return;
  try {
    const body = await readJsonBody(request) as Record<string, unknown>;
    const headerKey = request.headers['idempotency-key'];
    const idempotencyKey = (typeof headerKey === 'string' ? headerKey : undefined)
      ?? (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined);
    if (!idempotencyKey) {
      sendJson(response, 400, { error: 'Idempotency-Key header is required' });
      return;
    }
    const request0 = parseImportRequest(body);
    const existing = context.repository.getImportJobByIdempotency(idempotencyKey);
    if (existing) {
      sendJson(response, 200, jobView(context, existing.id));
      return;
    }
    const actor = context.auth.authenticate(request)!;
    const policy = decideImportPolicy(request0);
    const state: ImportJobState = policy.allowed ? 'queued' : 'blocked_policy';
    const now = new Date().toISOString();
    const sourceUrl = request0.source.url ?? `urn:syco23:upload:${request0.source.uploadId}`;
    const job = context.repository.createImportJob(ImportJobSchema.parse({
      id: newImportId(),
      requestedBy: actor.sessionId,
      provider: request0.source.provider,
      sourceUrl,
      ...(request0.source.externalId ? { sourceExternalId: request0.source.externalId } : {}),
      mode: request0.mode,
      state,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    }));
    context.repository.saveImportProvenance(job.id, {
      provider: request0.source.provider,
      sourceUrl,
      ...(request0.source.externalId ? { externalId: request0.source.externalId } : {}),
      retrievalMethod: request0.source.provider === 'user_upload' ? 'user-upload' : 'provider-api',
      observedAt: now,
      snapshot: { mode: request0.mode, policy: { allowed: policy.allowed, reason: policy.reason } },
    });
    context.repository.saveImportRightsConsent({
      id: newImportId('rights'),
      jobId: job.id,
      requestedBy: actor.sessionId,
      basis: request0.rights.basis,
      provider: request0.source.provider,
      sourceUrl,
      attestationVersion: request0.rights.attestationVersion,
      ...(request0.rights.proofObjectKey ? { proofObjectKey: request0.rights.proofObjectKey } : {}),
    });
    if (policy.allowed) {
      context.repository.enqueueImportJob(job.id);
    } else {
      context.repository.appendImportEvent(job.id, 'blocked_policy', { reason: policy.reason });
    }
    sendJson(response, 202, {
      ...jobView(context, job.id),
      policy: { allowed: policy.allowed, reason: policy.reason, capabilities: policy.capabilities },
    });
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
  }
}

async function handleJobAction(
  context: ImportRouteContext,
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  action: string,
) {
  if (!requireEnabled(context, response)) return;
  if (!requireCurator(context, request, response)) return;
  try {
    const job = context.repository.getImportJob(id);
    if (!job) {
      sendJson(response, 404, { error: 'Import job not found' });
      return;
    }
    if (action === 'cancel') {
      if (terminalImportState(job.state)) {
        sendJson(response, 409, { error: `Job is already ${job.state}` });
        return;
      }
      context.repository.updateImportJobState(job.id, 'cancelled');
      sendJson(response, 200, jobView(context, job.id));
      return;
    }
    if (action === 'retry') {
      if (job.state !== 'failed' && job.state !== 'cancelled') {
        sendJson(response, 409, { error: 'Only failed or cancelled jobs can be retried' });
        return;
      }
      if (job.attempt >= importLimits().maxAttempts) {
        sendJson(response, 409, { error: 'Retry limit reached for this job' });
        return;
      }
      context.repository.updateImportJobState(job.id, 'queued', { errorCode: null, error: null });
      context.repository.enqueueImportJob(job.id);
      sendJson(response, 200, jobView(context, job.id));
      return;
    }
    sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
  }
}

async function readWorkerBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const stashed = workerBodyText(request);
  if (stashed !== undefined) {
    if (!stashed) return {};
    return JSON.parse(stashed) as Record<string, unknown>;
  }
  return await readJsonBody(request) as Record<string, unknown>;
}

/**
 * Lease endpoint: atomically assigns the oldest due job to this worker.
 * The outbox row is the durable queue; the lease expires after 30s so a crashed
 * worker's job becomes claimable again without losing it.
 */
async function handleWorkerNext(context: ImportRouteContext, request: IncomingMessage, response: ServerResponse) {
  try {
    await authenticateWorker(request);
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
    return;
  }
  try {
    const workerId = typeof request.headers['x-import-worker-id'] === 'string'
      ? request.headers['x-import-worker-id'].slice(0, 80)
      : 'worker';
    const job = context.repository.claimDueImportJob(workerId);
    if (!job) {
      sendJson(response, 204, {});
      return;
    }
    context.repository.appendImportEvent(job.id, 'claimed', { workerId });
    sendJson(response, 200, {
      job: { ...job, attempt: job.attempt + 1 },
      limits: importLimits(),
      capabilities: PROVIDER_CAPABILITIES,
    });
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
  }
}

async function handleWorker(
  context: ImportRouteContext,
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  action: string,
) {
  try {
    await authenticateWorker(request);
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
    return;
  }
  try {
    const job = context.repository.getImportJob(id);
    if (!job) {
      sendJson(response, 404, { error: 'Import job not found' });
      return;
    }
    if (request.method === 'GET' && action === 'work') {
      if (job.state === 'blocked_policy' || terminalImportState(job.state)) {
        sendJson(response, 409, { error: `Job is not workable (state ${job.state})` });
        return;
      }
      sendJson(response, 200, {
        job: { ...job, attempt: job.attempt + 1 },
        limits: importLimits(),
        capabilities: PROVIDER_CAPABILITIES,
      });
      return;
    }
    if (request.method === 'POST' && action === 'heartbeat') {
      const owner = typeof request.headers['x-import-worker-id'] === 'string'
        ? request.headers['x-import-worker-id'].slice(0, 80)
        : '';
      const renewed = owner ? context.repository.renewImportLease(job.id, owner) : false;
      if (!renewed) {
        sendJson(response, 409, { error: 'Lease is not held by this worker' });
        return;
      }
      sendJson(response, 204, {});
      return;
    }
    if (request.method === 'POST' && action === 'events') {
      const body = await readWorkerBody(request);
      const type = typeof body.type === 'string' ? body.type : '';
      if (!type || type.length > 80) {
        sendJson(response, 400, { error: 'type is required' });
        return;
      }
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload as Record<string, unknown>
        : {};
      context.repository.appendImportEvent(job.id, type, payload);
      if (typeof body.state === 'string') {
        const state = body.state as ImportJobState;
        if (state === 'failed' || state === 'completed' || state === 'review' || state === 'blocked_policy') {
          context.repository.updateImportJobState(job.id, state, {
            attempt: Number.isInteger(body.attempt) ? body.attempt as number : job.attempt,
            ...(typeof body.error === 'string' ? { error: body.error.slice(0, 2000) } : {}),
            ...(typeof body.errorCode === 'string' ? { errorCode: body.errorCode.slice(0, 120) } : {}),
            ...(typeof body.mixId === 'string' ? { mixId: body.mixId } : {}),
          });
        }
      }
      sendJson(response, 204, {});
      return;
    }
    if (request.method === 'POST' && action === 'artifacts') {
      const body = await readWorkerBody(request);
      // The backend re-validates every worker report: backend validates SHA,
      // size and type, because the worker is an untrusted producer.
      const role = typeof body.role === 'string' ? body.role : '';
      const objectKey = typeof body.objectKey === 'string' ? body.objectKey : '';
      const artifactSha = typeof body.sha256 === 'string' ? body.sha256 : '';
      if (!['original', 'staging', 'normalized', 'artwork', 'metadata'].includes(role)) {
        sendJson(response, 400, { error: 'Artifact role is not valid' });
        return;
      }
      if (!/^imports\/imp_[a-f0-9]+\/(original|staging|normalized|artwork|metadata)\/[0-9a-f]{64}\.[a-z0-9]+$/.test(objectKey)) {
        sendJson(response, 400, { error: 'Artifact object key does not match the expected shape' });
        return;
      }
      if (!/^[0-9a-f]{64}$/.test(artifactSha)) {
        sendJson(response, 400, { error: 'Artifact sha256 must be a lowercase hex digest' });
        return;
      }
      const sizeBytes = typeof body.sizeBytes === 'number' && Number.isInteger(body.sizeBytes) ? body.sizeBytes : null;
      if (sizeBytes !== null && (sizeBytes <= 0 || sizeBytes > 4294967296)) {
        sendJson(response, 400, { error: 'Artifact size is outside the allowed bounds' });
        return;
      }
      const durationMs = typeof body.durationMs === 'number' && Number.isFinite(body.durationMs) ? Math.round(body.durationMs) : null;
      if (durationMs !== null && (durationMs <= 0 || durationMs > 86400000)) {
        sendJson(response, 400, { error: 'Artifact duration is outside the allowed bounds' });
        return;
      }
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType.slice(0, 120) : null;
      const codec = typeof body.codec === 'string' ? body.codec.slice(0, 60) : null;
      const idem = typeof body.id === 'string' && body.id.length >= 8 && body.id.length <= 128 ? body.id : newImportId('art');
      try {
        context.repository.registerImportArtifact({
          id: idem,
          jobId: job.id,
          role,
          objectKey,
          sha256: artifactSha,
          mimeType,
          sizeBytes,
          codec,
          durationMs,
        });
      } catch (error) {
        // Duplicate registration from an at-least-once redelivery is idempotent.
        if (!/UNIQUE|PRIMARY/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
      sendJson(response, 201, { id: idem });
      return;
    }
    if (request.method === 'POST' && action === 'evidence') {
      const body = await readWorkerBody(request);
      const scores = Array.isArray(body.scores) ? body.scores : [];
      const saved = [] as unknown[];
      for (const raw of scores) {
        const scored = ScoredEvidenceSchema.parse(raw);
        saved.push(context.repository.saveImportEvidenceScore({
          id: newImportId('evd'),
          jobId: job.id,
          field: scored.field ?? 'unknown',
          scored,
        }));
      }
      sendJson(response, 201, { saved: saved.length });
      return;
    }
    if (request.method === 'POST' && action === 'complete') {
      const body = await readWorkerBody(request);
      const attempt = Number.isInteger(body.attempt) ? body.attempt as number : job.attempt;
      const wanted = body.state === 'review' ? 'review' : body.state === 'failed' ? 'failed' : 'completed';
      if (wanted === 'failed' && body.retryable === true && attempt < importLimits().maxAttempts) {
        // At-least-once retry with exponential backoff + jitter: the job goes back
        // to queued and becomes claimable after the delay, never silently lost.
        const backoffMs = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000)
          + Math.floor(Math.random() * 2000);
        context.repository.updateImportJobState(job.id, 'queued', {
          attempt,
          ...(typeof body.error === 'string' ? { error: body.error.slice(0, 2000) } : {}),
          ...(typeof body.errorCode === 'string' ? { errorCode: body.errorCode.slice(0, 120) } : {}),
        });
        context.repository.enqueueImportJob(job.id, backoffMs);
        sendJson(response, 200, { ...jobView(context, job.id), scheduledRetryInMs: backoffMs });
        return;
      }
      context.repository.updateImportJobState(job.id, wanted, {
        attempt,
        ...(typeof body.errorCode === 'string' ? { errorCode: body.errorCode.slice(0, 120) } : {}),
        ...(typeof body.mixId === 'string' ? { mixId: body.mixId } : {}),
        ...(typeof body.error === 'string' ? { error: body.error.slice(0, 2000) } : {}),
      });
      sendJson(response, 200, jobView(context, job.id));
      return;
    }
    sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    const parsed = parseError(error);
    sendJson(response, parsed.status, parsed.body);
  }
}

/**
 * Public capability handshake. The client gates its import UI on this so an
 * older UI never posts to a disabled or newer control plane.
 */
export function versionPayload(context: ImportRouteContext) {
  return {
    apiVersion: 1,
    importsEnabled: context.importsEnabled,
    providers: PROVIDER_CAPABILITIES,
    limits: importLimits(),
  };
}

export async function handleImportRoute(
  context: ImportRouteContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  applyCorsHeaders(request, response);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/version') {
    sendJson(response, 200, versionPayload(context));
    return true;
  }

  if (request.method === 'POST' && path === '/api/imports') {
    await handleCreate(context, request, response);
    return true;
  }

  const internalMatch = path.match(/^\/internal\/imports\/([^/]+)\/(work|events|artifacts|evidence|complete|heartbeat)$/);
  if (internalMatch) {
    await handleWorker(context, request, response, decodeURIComponent(internalMatch[1]), internalMatch[2]);
    return true;
  }

  if (request.method === 'GET' && path === '/internal/imports/next') {
    await handleWorkerNext(context, request, response);
    return true;
  }

  const actionMatch = path.match(/^\/api\/imports\/([^/]+)\/(cancel|retry)$/);
  if (request.method === 'POST' && actionMatch) {
    await handleJobAction(context, request, response, decodeURIComponent(actionMatch[1]), actionMatch[2]);
    return true;
  }

  const jobMatch = path.match(/^\/api\/imports\/([^/]+)$/);
  if (request.method === 'GET' && jobMatch) {
    if (!requireEnabled(context, response)) return true;
    if (!requireCurator(context, request, response)) return true;
    const view = jobView(context, decodeURIComponent(jobMatch[1]));
    sendJson(response, view ? 200 : 404, view ?? { error: 'Import job not found' });
    return true;
  }

  if (path === '/api/imports' || path.startsWith('/api/imports/') || path.startsWith('/internal/imports/')) {
    sendJson(response, 404, { error: 'not found' });
    return true;
  }

  return false;
}
