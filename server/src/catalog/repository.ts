import type { DatabaseSync } from 'node:sqlite';
import {
  CatalogPageSchema,
  CatalogRecordSchema,
  EntityRecordSchema,
  PageQuerySchema,
  ProviderRefSchema,
  type CatalogDetail,
  type CatalogPage,
  type CatalogRecord,
  type EntityRecord,
  type EntityRole,
  type FieldClaim,
  type IndexKind,
  type MigrationResult,
  type PageQuery,
  type ProviderRef,
  type RecordId,
  type ReviewItem
} from '@syco23/catalog-domain';
import { normalizeName, normalizeProviderRef } from '@syco23/catalog-domain';
import { openDatabase } from './database.js';

export interface CatalogTransaction {
  getRecord(id: RecordId): CatalogRecord | undefined;
  getClaim(fingerprint: string): StoredClaim | undefined;
  getReview(id: RecordId): ReviewItem | undefined;
  findByProvider(ref: ProviderRef): RecordId | undefined;
  saveRecord(record: CatalogRecord, expectedRevision?: number): CatalogRecord;
  addProviderSource(recordId: RecordId, ref: ProviderRef): void;
  addClaim(id: RecordId, fingerprint: string, claim: FieldClaim, disposition: ClaimDisposition, recordRevision: number, currentValue?: unknown): void;
  refreshReview(id: RecordId, recordRevision: number, currentValue?: unknown): void;
  decideReview(id: RecordId, state: 'accepted' | 'rejected', actor: string): void;
  addRelationship(sourceId: RecordId, targetId: RecordId, relationship: EntityRole | 'event' | 'member' | 'parent-label' | 'sub-label'): void;
  addLegacyAlias(legacyId: string, recordId: RecordId): void;
  addMediaAsset(asset: StoredMediaAsset): void;
}

export type ClaimDisposition = 'selected' | 'corroborated' | 'pending' | 'rejected';
export interface StoredClaim {
  id: RecordId;
  fingerprint: string;
  claim: FieldClaim;
  disposition: ClaimDisposition;
}

export interface CuratorSession {
  id: RecordId;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface StoredMediaAsset {
  mediaId: RecordId;
  recordId: RecordId;
  role: 'waveform';
  relativePath: string;
  mimeType: 'image/png';
  byteSize: number;
  sourceUrl: string;
}

export interface CatalogRepository {
  getRecord(id: RecordId): CatalogDetail | undefined;
  listIndex(kind: IndexKind, query: PageQuery): CatalogPage;
  findByProvider(ref: ProviderRef): RecordId | undefined;
  findBySource(ref: ProviderRef): RecordId | undefined;
  findNameCandidates(role: EntityRole, name: string): EntityRecord[];
  listReview(): ReviewItem[];
  getReview(id: RecordId): ReviewItem | undefined;
  getClaim(fingerprint: string): StoredClaim | undefined;
  createSession(session: CuratorSession): void;
  getSession(tokenHash: string): CuratorSession | undefined;
  deleteSession(tokenHash: string): void;
  getMediaAsset(mediaId: RecordId): StoredMediaAsset | undefined;
  getMigrationBatch(batchId: string): MigrationResult | undefined;
  saveMigrationBatch(result: MigrationResult): MigrationResult;
  transaction<T>(operation: (tx: CatalogTransaction) => T): T;
  close(): void;
}

type StoredRecord = {
  id: string;
  kind: string;
  verification: string;
  revision: number;
  search_name: string;
  payload: string;
};

function parseRecord(row: StoredRecord | undefined): CatalogRecord | undefined {
  if (!row) return undefined;
  return CatalogRecordSchema.parse(JSON.parse(row.payload));
}

function recordName(record: CatalogRecord): string {
  if (record.kind === 'mix') return record.title;
  if (record.kind === 'entity') return record.displayName;
  return record.name;
}

function recordById(database: DatabaseSync, id: RecordId): CatalogRecord | undefined {
  const row = database.prepare('SELECT id, kind, verification, revision, search_name, payload FROM catalog_records WHERE id = ?').get(id) as StoredRecord | undefined;
  if (row) return parseRecord(row);
  const alias = database.prepare('SELECT record_id FROM record_aliases WHERE legacy_id = ?').get(id) as { record_id: string } | undefined;
  return alias ? recordById(database, alias.record_id) : undefined;
}

function putNameKeys(database: DatabaseSync, record: CatalogRecord) {
  database.prepare('DELETE FROM entity_names WHERE record_id = ?').run(record.id);
  database.prepare('DELETE FROM entity_roles WHERE record_id = ?').run(record.id);
  if (record.kind !== 'entity') return;

  const roleInsert = database.prepare('INSERT INTO entity_roles(record_id, role) VALUES (?, ?)');
  const nameInsert = database.prepare('INSERT OR IGNORE INTO entity_names(record_id, role, search_key) VALUES (?, ?, ?)');
  for (const role of record.roles) {
    roleInsert.run(record.id, role);
    for (const name of [record.displayName, ...record.aliases]) {
      nameInsert.run(record.id, role, normalizeName(name));
    }
  }
}

function createTransaction(database: DatabaseSync): CatalogTransaction {
  return {
    getRecord(id) {
      return recordById(database, id);
    },

    getClaim(fingerprint) {
      const row = database.prepare('SELECT id, fingerprint, claim_json, disposition FROM field_claims WHERE fingerprint = ?').get(fingerprint) as {
        id: string; fingerprint: string; claim_json: string; disposition: ClaimDisposition;
      } | undefined;
      return row ? { id: row.id, fingerprint: row.fingerprint, claim: JSON.parse(row.claim_json) as FieldClaim, disposition: row.disposition } : undefined;
    },

    getReview(id) {
      return readReview(database, id);
    },

    findByProvider(input) {
      const ref = normalizeProviderRef(ProviderRefSchema.parse(input));
      const row = database.prepare(`SELECT record_id FROM provider_sources
        WHERE provider = ? AND resource_type = ? AND external_id = ?`).get(ref.provider, ref.resourceType, ref.externalId) as { record_id: string } | undefined;
      return row?.record_id;
    },

    saveRecord(input, expectedRevision) {
      const record = CatalogRecordSchema.parse(input);
      const current = database.prepare('SELECT revision FROM catalog_records WHERE id = ?').get(record.id) as { revision: number } | undefined;
      if (current) {
        if (expectedRevision !== current.revision) throw new Error(`Revision conflict for ${record.id}`);
        if (record.revision !== current.revision + 1) throw new Error(`Record revision must advance to ${current.revision + 1}`);
        database.prepare(`UPDATE catalog_records
          SET kind = ?, verification = ?, revision = ?, search_name = ?, payload = ?, updated_at = ?
          WHERE id = ?`).run(record.kind, record.verification, record.revision, normalizeName(recordName(record)), JSON.stringify(record), record.updatedAt, record.id);
      } else {
        if (expectedRevision !== undefined) throw new Error(`Record ${record.id} does not exist`);
        if (record.revision !== 1) throw new Error('New records must start at revision 1');
        database.prepare(`INSERT INTO catalog_records(id, kind, verification, revision, search_name, payload, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.kind, record.verification, record.revision, normalizeName(recordName(record)), JSON.stringify(record), record.createdAt, record.updatedAt);
      }
      putNameKeys(database, record);
      return record;
    },

    addClaim(id, fingerprint, claim, disposition, recordRevision, currentValue) {
      database.prepare(`INSERT INTO field_claims(id, fingerprint, record_id, field, claim_json, disposition, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, fingerprint, claim.targetRecordId, claim.field, JSON.stringify(claim), disposition, claim.observedAt);
      if (disposition === 'pending') {
        database.prepare(`INSERT INTO review_items(id, record_id, field, current_value_json, record_revision, state, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(id, claim.targetRecordId, claim.field, currentValue === undefined ? null : JSON.stringify(currentValue), recordRevision, claim.observedAt);
      }
    },

    refreshReview(id, recordRevision, currentValue) {
      const review = readReview(database, id);
      if (!review || review.state !== 'pending') throw new Error(`Pending review item ${id} does not exist`);
      database.prepare('UPDATE review_items SET record_revision = ?, current_value_json = ? WHERE id = ?')
        .run(recordRevision, currentValue === undefined ? null : JSON.stringify(currentValue), id);
    },

    decideReview(id, state, actor) {
      const review = readReview(database, id);
      if (!review) throw new Error(`Review item ${id} does not exist`);
      if (review.state !== 'pending') throw new Error(`Review item ${id} is already decided`);
      const decidedAt = new Date().toISOString();
      database.prepare('UPDATE review_items SET state = ?, decided_at = ?, actor = ? WHERE id = ?').run(state, decidedAt, actor, id);
      database.prepare('UPDATE field_claims SET disposition = ? WHERE id = ?').run(state === 'accepted' ? 'selected' : 'rejected', id);
      database.prepare('INSERT INTO review_decisions(review_id, decision, actor, decided_at) VALUES (?, ?, ?, ?)').run(id, state, actor, decidedAt);
    },

    addProviderSource(recordId, input) {
      const ref = normalizeProviderRef(ProviderRefSchema.parse(input));
      if (!recordById(database, recordId)) throw new Error(`Unknown record ${recordId}`);
      database.prepare(`INSERT INTO provider_sources(provider, resource_type, external_id, url, record_id, added_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(ref.provider, ref.resourceType, ref.externalId, ref.url ?? null, recordId, new Date().toISOString());
    },

    addRelationship(sourceId, targetId, relationship) {
      const source = recordById(database, sourceId);
      const target = recordById(database, targetId);
      if (!source || !target) throw new Error('Relationship references an unknown record');
      if (['artist', 'crew', 'label'].includes(relationship)) {
        if (target.kind !== 'entity' || !target.roles.includes(relationship as EntityRole)) {
          throw new Error(`Relationship target does not have the ${relationship} role`);
        }
      }
      if (relationship === 'event' && target.kind !== 'event') throw new Error('Event relationship target must be an event');
      database.prepare('INSERT INTO record_relationships(source_id, target_id, relationship) VALUES (?, ?, ?)').run(sourceId, targetId, relationship);
    },

    addLegacyAlias(legacyId, recordId) {
      if (!legacyId || legacyId.length > 200) throw new Error('Legacy ID is invalid');
      if (!recordById(database, recordId)) throw new Error(`Unknown record ${recordId}`);
      database.prepare('INSERT INTO record_aliases(legacy_id, record_id, created_at) VALUES (?, ?, ?)').run(legacyId, recordId, new Date().toISOString());
    },

    addMediaAsset(asset) {
      if (asset.relativePath !== `${asset.mediaId}.png`) throw new Error('Media path is invalid');
      database.prepare(`INSERT INTO media_assets(media_id, record_id, role, relative_path, mime_type, byte_size, source_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(asset.mediaId, asset.recordId, asset.role, asset.relativePath, asset.mimeType, asset.byteSize, asset.sourceUrl, new Date().toISOString());
    }
  };
}

export function openCatalog(path: string): CatalogRepository {
  const database = openDatabase(path);
  let inTransaction = false;

  return {
    getRecord(id) {
      const record = recordById(database, id);
      return record ? CatalogRecordSchema.parse(record) : undefined;
    },

    listReview() {
      const rows = database.prepare(`SELECT id FROM review_items WHERE state = 'pending' ORDER BY created_at, id`).all() as { id: string }[];
      return rows.map((row) => readReview(database, row.id)!).filter(Boolean);
    },

    getReview(id) {
      return readReview(database, id);
    },

    getClaim(fingerprint) {
      return createTransaction(database).getClaim(fingerprint);
    },

    createSession(session) {
      database.prepare('INSERT INTO curator_sessions(id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(session.id, session.tokenHash, session.expiresAt, session.createdAt);
    },

    getSession(tokenHash) {
      const row = database.prepare('SELECT id, token_hash, expires_at, created_at FROM curator_sessions WHERE token_hash = ?')
        .get(tokenHash) as { id: string; token_hash: string; expires_at: string; created_at: string } | undefined;
      return row ? { id: row.id, tokenHash: row.token_hash, expiresAt: row.expires_at, createdAt: row.created_at } : undefined;
    },

    deleteSession(tokenHash) {
      database.prepare('DELETE FROM curator_sessions WHERE token_hash = ?').run(tokenHash);
    },

    getMediaAsset(mediaId) {
      const row = database.prepare(`SELECT media_id, record_id, role, relative_path, mime_type, byte_size, source_url
        FROM media_assets WHERE media_id = ?`).get(mediaId) as {
          media_id: string; record_id: string; role: 'waveform'; relative_path: string;
          mime_type: 'image/png'; byte_size: number; source_url: string;
        } | undefined;
      return row ? {
        mediaId: row.media_id,
        recordId: row.record_id,
        role: row.role,
        relativePath: row.relative_path,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        sourceUrl: row.source_url
      } : undefined;
    },

    getMigrationBatch(batchId) {
      const row = database.prepare('SELECT result_json FROM migration_batches WHERE batch_id = ?').get(batchId) as { result_json: string } | undefined;
      return row ? JSON.parse(row.result_json) as MigrationResult : undefined;
    },

    saveMigrationBatch(result) {
      database.prepare('INSERT OR IGNORE INTO migration_batches(batch_id, result_json, created_at) VALUES (?, ?, ?)')
        .run(result.batchId, JSON.stringify(result), new Date().toISOString());
      const row = database.prepare('SELECT result_json FROM migration_batches WHERE batch_id = ?').get(result.batchId) as { result_json: string } | undefined;
      if (!row) throw new Error(`Migration batch ${result.batchId} could not be stored`);
      return JSON.parse(row.result_json) as MigrationResult;
    },

    listIndex(kind, input) {
      const query = PageQuerySchema.parse(input);
      const offset = (query.page - 1) * query.pageSize;
      const index = kind === 'mix' || kind === 'event' ? kind : 'entity';
      const baseParams = kind === 'artist' || kind === 'crew' || kind === 'label'
        ? [kind]
        : [index];
      const from = kind === 'artist' || kind === 'crew' || kind === 'label'
        ? 'catalog_records r JOIN entity_roles er ON er.record_id = r.id'
        : 'catalog_records r';
      const filters = [
        kind === 'artist' || kind === 'crew' || kind === 'label' ? 'er.role = ?' : 'r.kind = ?',
        "r.verification <> 'proposed'"
      ];
      const params: (string | number)[] = [...baseParams];
      if (query.query) {
        filters.push('r.search_name LIKE ? ESCAPE \'\\\'');
        params.push(`%${normalizeName(query.query).replace(/[\\%_]/g, '\\$&')}%`);
      }
      const where = filters.join(' AND ');
      const rows = database.prepare(`SELECT r.id, r.kind, r.verification, r.revision, r.search_name, r.payload
        FROM ${from} WHERE ${where} ORDER BY r.updated_at DESC, r.id LIMIT ? OFFSET ?`)
        .all(...params, query.pageSize, offset) as StoredRecord[];
      const totalRow = database.prepare(`SELECT COUNT(DISTINCT r.id) AS total FROM ${from} WHERE ${where}`).get(...params) as { total: number };
      const page: CatalogPage = {
        items: rows.map((row) => parseRecord(row)!).filter((record) => record.kind === 'mix' || record.kind === 'event' || record.roles.includes(kind as EntityRole)),
        page: query.page,
        pageSize: query.pageSize,
        total: totalRow.total
      };
      return CatalogPageSchema.parse(page);
    },

    findByProvider(input) {
      const ref = normalizeProviderRef(ProviderRefSchema.parse(input));
      const row = database.prepare(`SELECT record_id FROM provider_sources
        WHERE provider = ? AND resource_type = ? AND external_id = ?`).get(ref.provider, ref.resourceType, ref.externalId) as { record_id: string } | undefined;
      return row?.record_id;
    },

    findBySource(input) {
      const ref = normalizeProviderRef(ProviderRefSchema.parse(input));
      if (ref.url) {
        const row = database.prepare('SELECT record_id FROM provider_sources WHERE provider = ? AND url = ?').get(ref.provider, ref.url) as { record_id: string } | undefined;
        if (row) return row.record_id;
      }
      return this.findByProvider(ref);
    },

    findNameCandidates(role, name) {
      const key = normalizeName(name);
      const rows = database.prepare(`SELECT r.id, r.kind, r.verification, r.revision, r.search_name, r.payload
        FROM entity_names n JOIN catalog_records r ON r.id = n.record_id
        WHERE n.role = ? AND n.search_key = ? ORDER BY r.updated_at DESC`).all(role, key) as StoredRecord[];
      return rows.map((row) => EntityRecordSchema.parse(parseRecord(row)));
    },

    transaction(operation) {
      if (inTransaction) throw new Error('Nested catalog transactions are not supported');
      inTransaction = true;
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = operation(createTransaction(database));
        if (result && typeof result === 'object' && 'then' in result) throw new Error('Catalog transactions must be synchronous');
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },

    close() {
      database.close();
    }
  };
}

function readReview(database: DatabaseSync, id: RecordId): ReviewItem | undefined {
  const row = database.prepare(`SELECT r.id, r.record_id, r.field, r.current_value_json, r.record_revision, r.state, r.created_at, c.claim_json
    FROM review_items r JOIN field_claims c ON c.id = r.id WHERE r.id = ?`).get(id) as {
      id: string; record_id: string; field: string; current_value_json: string | null; record_revision: number;
      state: 'pending' | 'accepted' | 'rejected'; created_at: string; claim_json: string;
    } | undefined;
  return row ? {
    id: row.id,
    targetRecordId: row.record_id,
    field: row.field,
    claim: JSON.parse(row.claim_json) as FieldClaim,
    state: row.state,
    createdAt: row.created_at,
    recordRevision: row.record_revision,
    ...(row.current_value_json === null ? {} : { currentValue: JSON.parse(row.current_value_json) as unknown })
  } : undefined;
}