import {
  CatalogPageSchema,
  CatalogRecordSchema,
  EnrichmentReportSchema,
  ImportCandidateSchema,
  ImportResultSchema,
  MigrationResultSchema,
  ReviewItemSchema,
  type CatalogPage,
  type CatalogRecord,
  type EnrichmentReport,
  type ImportCandidate,
  type ImportResult,
  type IndexKind,
  type MigrationResult,
  type PageQuery,
  type RecordId,
  type ReviewItem
} from '@syco23/catalog-domain';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

export class CatalogApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  });
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const details = payload && typeof payload === 'object' ? payload : undefined;
    const message = details && 'error' in details && typeof details.error === 'string'
      ? details.error
      : `Catalog API request failed (${response.status})`;
    throw new CatalogApiError(message, response.status, details);
  }
  return payload;
}

export interface IndexOptions {
  page?: number;
  pageSize?: number;
  query?: string;
}

export const catalogApi = {
  async getIndex(kind: IndexKind, options: IndexOptions = {}): Promise<CatalogPage> {
    const query: PageQuery = { page: options.page ?? 1, pageSize: options.pageSize ?? 25, query: options.query || undefined };
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (query.query) params.set('q', query.query);
    return CatalogPageSchema.parse(await request(`/catalog/${kind}?${params}`));
  },

  async getRecord(id: RecordId): Promise<CatalogRecord> {
    return CatalogRecordSchema.parse(await request(`/catalog/records/${encodeURIComponent(id)}`));
  },

  async getReview(): Promise<ReviewItem[]> {
    const response = await request('/catalog/review');
    return Array.isArray(response) ? response.map((item) => ReviewItemSchema.parse(item)) : ReviewItemSchema.array().parse(response);
  },

  async checkSession(): Promise<boolean> {
    const response = await request('/auth/session') as { authenticated?: unknown };
    return Boolean(response && response.authenticated === true);
  },

  async login(password: string): Promise<boolean> {
    const response = await request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }) as { authenticated?: unknown };
    return response?.authenticated === true;
  },

  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST', body: '{}' });
  },

  async importCandidate(input: ImportCandidate): Promise<ImportResult> {
    const candidate = ImportCandidateSchema.parse(input);
    return ImportResultSchema.parse(await request('/catalog/import', { method: 'POST', body: JSON.stringify(candidate) }));
  },

  async migrate(batchId: string, records: unknown[]): Promise<MigrationResult> {
    return MigrationResultSchema.parse(await request('/catalog/migrate', { method: 'POST', body: JSON.stringify({ batchId, records }) }));
  },

  async enrichRecord(id: RecordId): Promise<EnrichmentReport> {
    return EnrichmentReportSchema.parse(await request(`/catalog/records/${encodeURIComponent(id)}/enrich`, { method: 'POST', body: '{}' }));
  },

  async persistWaveform(id: RecordId, imageDataUrl: string, sourceUrl: string): Promise<CatalogRecord> {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
    if (!match) throw new Error('Waveform response is not a PNG data URL');
    const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    const query = new URLSearchParams({ sourceUrl });
    const record = await request(`/catalog/records/${encodeURIComponent(id)}/waveform?${query}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes
    });
    return CatalogRecordSchema.parse(record);
  },

  async updateRecord(id: RecordId, patch: unknown, expectedRevision: number): Promise<CatalogRecord> {
    return CatalogRecordSchema.parse(await request(`/catalog/records/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ expectedRevision, patch })
    }));
  },

  async decideReview(id: RecordId, decision: 'accept' | 'reject', expectedRevision: number): Promise<ReviewItem> {
    return ReviewItemSchema.parse(await request(`/catalog/review/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, expectedRevision })
    }));
  },

  async refreshReview(id: RecordId): Promise<ReviewItem> {
    return ReviewItemSchema.parse(await request(`/catalog/review/${encodeURIComponent(id)}/refresh`, { method: 'POST', body: '{}' }));
  }
};