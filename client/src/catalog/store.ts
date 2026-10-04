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
import { catalogApi, CatalogApiError, type IndexOptions } from './api';

export type CatalogGateway = typeof catalogApi;

export interface CatalogStoreState {
  indexKind: IndexKind;
  records: CatalogRecord[];
  recordCache: Record<string, CatalogRecord>;
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
    indexKind: 'mix', records: [], recordCache: {}, review: [], loading: false, authenticated: false,
    page: 1, pageSize: 25, total: 0
  });

  let indexRequest = 0;
  function fail(error: unknown, fallback: string) {
    state.error = error instanceof Error ? error.message : fallback;
    if (error instanceof CatalogApiError && error.status === 401) { state.authenticated = false; state.review = []; }
  }
  function remember(record: CatalogRecord) {
    state.detail = record;
    state.recordCache[record.id] = record;
    const index = state.records.findIndex((item) => item.id === record.id);
    if (index >= 0) state.records[index] = record;
    return record;
  }

  async function loadIndex(kind: IndexKind, options: IndexOptions = {}) {
    const requestId = ++indexRequest;
    state.loading = true;
    state.error = undefined;
    state.indexKind = kind;
    state.page = options.page ?? 1;
    state.pageSize = options.pageSize ?? 25;
    try {
      const result = await gateway.getIndex(kind, { ...options, page: state.page, pageSize: state.pageSize });
      if (requestId !== indexRequest) return result;
      state.records = result.items;
      for (const record of result.items) state.recordCache[record.id] = record;
      state.page = result.page;
      state.pageSize = result.pageSize;
      state.total = result.total;
      return result;
    } catch (error) {
      if (requestId === indexRequest) fail(error, 'Catalog index could not be loaded');
      throw error;
    } finally {
      if (requestId === indexRequest) state.loading = false;
    }
  }

  async function loadDetail(id: RecordId) {
    state.loading = true;
    state.error = undefined;
    try {
      return remember(await gateway.getRecord(id));
    } catch (error) {
      fail(error, 'Catalog record could not be loaded');
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
      fail(error, 'Review queue could not be loaded');
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
      fail(error, 'Import was not saved');
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
      fail(error, 'Enrichment failed');
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
      fail(error, 'Changes were not saved');
      throw error;
    }
  }

  async function decideReview(id: RecordId, decision: 'accept' | 'reject', revision: number) {
    state.error = undefined;
    try {
      const item = await gateway.decideReview(id, decision, revision);
      state.review = state.review.filter((review) => review.id !== id);
      return remember(item);
    } catch (error) {
      fail(error, 'Review decision was not saved');
      throw error;
    }
  }

  async function createRecord(input: unknown) {
    state.error = undefined;
    try { return remember(await gateway.createRecord(input)); }
    catch (error) { fail(error, 'Record was not created'); throw error; }
  }
  async function mergeRecords(survivor: RecordId, duplicate: RecordId, revisions: [number, number]) {
    state.error = undefined;
    try {
      const record = await gateway.mergeRecords(survivor, duplicate, revisions);
      state.records = state.records.filter((item) => item.id !== duplicate);
      delete state.recordCache[duplicate];
      return remember(record);
    } catch (error) { fail(error, 'Duplicate merge was not saved'); throw error; }
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
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error('Local library must contain a list of records. Your browser copy remains unchanged.');
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
      if (recordId) {
        try { remember(await gateway.persistWaveform(recordId, asset.imageDataUrl, asset.sourceUrl)); }
        catch (error) {
          const message = `Waveform was not stored: ${error instanceof Error ? error.message : String(error)}`;
          result.outcomes ??= [];
          const outcome = result.outcomes.find((item) => item.legacyId === asset.legacyId);
          if (outcome) { outcome.status = 'partial'; outcome.errors.push(message); }
          else result.outcomes.push({ legacyId: asset.legacyId, status: 'partial', recordId, errors: [message] });
        }
      }
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
    migrateLocalLibrary,
    createRecord,
    mergeRecords
  };
}

export const useCatalogStore = createCatalogStore();