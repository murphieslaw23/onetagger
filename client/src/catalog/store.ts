import { reactive, readonly } from 'vue';
import type {
  CatalogRecord,
  EnrichmentReport,
  ImportCandidate,
  ImportResult,
  IndexKind,
  MigrationResult,
  RecordId,
  ReviewItem
} from '@syco23/catalog-domain';
import { catalogApi, type IndexOptions } from './api';

export type CatalogGateway = typeof catalogApi;

export interface CatalogStoreState {
  indexKind: IndexKind;
  records: CatalogRecord[];
  detail?: CatalogRecord;
  review: ReviewItem[];
  loading: boolean;
  authenticated: boolean;
  error?: string;
  page: number;
  pageSize: number;
  total: number;
}

export function createCatalogStore(gateway: CatalogGateway = catalogApi) {
  const state = reactive<CatalogStoreState>({
    indexKind: 'mix', records: [], review: [], loading: false, authenticated: false,
    page: 1, pageSize: 25, total: 0
  });

  function remember(record: CatalogRecord) {
    state.detail = record;
    const index = state.records.findIndex((item) => item.id === record.id);
    if (index >= 0) state.records[index] = record;
    return record;
  }

  async function loadIndex(kind: IndexKind, options: IndexOptions = {}) {
    state.loading = true;
    state.error = undefined;
    state.indexKind = kind;
    state.page = options.page ?? 1;
    state.pageSize = options.pageSize ?? 25;
    try {
      const result = await gateway.getIndex(kind, { ...options, page: state.page, pageSize: state.pageSize });
      state.records = result.items;
      state.page = result.page;
      state.pageSize = result.pageSize;
      state.total = result.total;
      return result;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Catalog index could not be loaded';
      throw error;
    } finally {
      state.loading = false;
    }
  }

  async function loadDetail(id: RecordId) {
    state.loading = true;
    state.error = undefined;
    try {
      return remember(await gateway.getRecord(id));
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Catalog record could not be loaded';
      throw error;
    } finally {
      state.loading = false;
    }
  }

  async function loadReview() {
    state.error = undefined;
    try {
      state.review = await gateway.getReview();
      return state.review;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Review queue could not be loaded';
      throw error;
    }
  }

  async function checkSession() {
    state.authenticated = await gateway.checkSession();
    return state.authenticated;
  }

  async function login(password: string) {
    state.error = undefined;
    try {
      state.authenticated = await gateway.login(password);
      return state.authenticated;
    } catch (error) {
      state.authenticated = false;
      state.error = error instanceof Error ? error.message : 'Login failed';
      throw error;
    }
  }

  async function logout() {
    await gateway.logout();
    state.authenticated = false;
    state.review = [];
  }

  async function importCandidate(candidate: ImportCandidate): Promise<ImportResult> {
    state.error = undefined;
    try {
      const result = await gateway.importCandidate(candidate);
      remember(result.record);
      return result;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Import was not saved';
      throw error;
    }
  }

  async function enrichRecord(id: RecordId): Promise<EnrichmentReport> {
    state.error = undefined;
    try {
      const report = await gateway.enrichRecord(id);
      await loadDetail(id);
      await loadReview().catch(() => undefined);
      return report;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Enrichment failed';
      throw error;
    }
  }

  async function persistWaveform(id: RecordId, imageDataUrl: string, sourceUrl: string) {
    const record = remember(await gateway.persistWaveform(id, imageDataUrl, sourceUrl));
    return record;
  }

  async function updateRecord(id: RecordId, patch: unknown, revision: number) {
    state.error = undefined;
    try {
      return remember(await gateway.updateRecord(id, patch, revision));
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Changes were not saved';
      throw error;
    }
  }

  async function decideReview(id: RecordId, decision: 'accept' | 'reject', revision: number) {
    state.error = undefined;
    try {
      const item = await gateway.decideReview(id, decision, revision);
      state.review = state.review.filter((review) => review.id !== id);
      await loadDetail(item.targetRecordId);
      return item;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Review decision was not saved';
      throw error;
    }
  }

  async function refreshReview(id: RecordId) {
    const item = await gateway.refreshReview(id);
    const index = state.review.findIndex((review) => review.id === id);
    if (index >= 0) state.review[index] = item;
    return item;
  }

  async function migrateLocalLibrary(): Promise<MigrationResult | undefined> {
    if (typeof window === 'undefined') return undefined;
    const raw = window.localStorage.getItem('syco23.mixsets.library');
    if (!raw) return undefined;
    const records = JSON.parse(raw) as unknown[];
    const batchStorageKey = 'syco23.mixsets.migrationBatchId';
    const batchId = window.localStorage.getItem(batchStorageKey) || crypto.randomUUID();
    window.localStorage.setItem(batchStorageKey, batchId);
    const media = records.flatMap((record) => {
      if (!record || typeof record !== 'object') return [];
      const legacy = record as Record<string, unknown>;
      const waveform = legacy.waveform;
      if (!waveform || typeof waveform !== 'object') return [];
      const asset = waveform as Record<string, unknown>;
      return typeof legacy.id === 'string' && typeof asset.imageDataUrl === 'string' && typeof asset.sourceUrl === 'string'
        ? [{ legacyId: legacy.id, imageDataUrl: asset.imageDataUrl, sourceUrl: asset.sourceUrl }]
        : [];
    });
    const recordsWithoutMedia = records.map((record) => {
      if (!record || typeof record !== 'object' || !('waveform' in record)) return record;
      const withoutWaveform = { ...record };
      delete withoutWaveform.waveform;
      return withoutWaveform;
    });
    const result = await gateway.migrate(batchId, recordsWithoutMedia);
    for (const asset of media) {
      const recordId = result.legacyIds[asset.legacyId];
      if (recordId) await gateway.persistWaveform(recordId, asset.imageDataUrl, asset.sourceUrl);
    }
    return result;
  }

  return {
    state: readonly(state),
    loadIndex,
    loadDetail,
    loadReview,
    checkSession,
    login,
    logout,
    importCandidate,
    enrichRecord,
    persistWaveform,
    updateRecord,
    decideReview,
    refreshReview,
    migrateLocalLibrary
  };
}

export const useCatalogStore = createCatalogStore();