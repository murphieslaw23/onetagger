import { createHash } from 'node:crypto';
import {
  EnrichmentReportSchema,
  FieldClaimSchema,
  missingFields,
  validateField,
  type CatalogRecord,
  type EnrichmentReport,
  type FieldClaim,
  type RecordId,
  type ReviewItem
} from '@syco23/catalog-domain';
import { normalizeName, normalizeProviderRef } from '@syco23/catalog-domain';
import type { CatalogRepository, CatalogTransaction } from './repository.js';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function claimFingerprint(claimInput: FieldClaim): string {
  const claim = FieldClaimSchema.parse(claimInput);
  const identity = {
    targetRecordId: claim.targetRecordId,
    field: claim.field,
    value: claim.value,
    provider: normalizeProviderRef(claim.provider),
    sourceUrl: claim.sourceUrl,
    evidence: claim.evidence
  };
  return `claim_${createHash('sha256').update(stableJson(identity)).digest('hex').slice(0, 56)}`;
}

function valueFor(record: CatalogRecord, field: string): unknown {
  if (record.kind === 'mix') {
    if (field === 'cover') {
      const asset = record.assets.find((item) => item.role === 'mix-cover');
      return asset ? { role: asset.role, url: asset.url } : undefined;
    }
    const value = record[field as keyof typeof record];
    if ((field === 'genres' || field === 'styles') && Array.isArray(value) && value.length === 0) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  }
  if (record.kind === 'entity') {
    const assetRole = field === 'artistPortrait' ? 'artist-portrait'
      : field === 'crewLogo' ? 'crew-logo'
        : field === 'labelLogo' ? 'label-logo' : undefined;
    if (assetRole) {
      const asset = record.assets.find((item) => item.role === assetRole);
      return asset ? { role: asset.role, url: asset.url } : undefined;
    }
    const value = record[field as keyof typeof record];
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  }
  if (field === 'eventDate') return record.startDate;
  if (field === 'flyer') {
    const asset = record.assets.find((item) => item.role === 'event-flyer');
    return asset ? { role: asset.role, url: asset.url } : undefined;
  }
  return record[field as keyof typeof record];
}

function comparisonValue(value: unknown): string {
  if (typeof value === 'string') return normalizeName(value);
  if (Array.isArray(value)) return stableJson([...value].map((item) => typeof item === 'string' ? normalizeName(item) : item).sort());
  return stableJson(value);
}

function withSelectedField(record: CatalogRecord, field: string, value: unknown, evidenceId: RecordId, claim: FieldClaim): CatalogRecord {
  const selectedEvidence = { ...record.selectedEvidence, [field]: evidenceId };
  const base = { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), selectedEvidence };

  if (field === 'cover' && record.kind === 'mix') {
    const cover = value as { role: 'mix-cover'; url: string };
    return { ...base, assets: [...record.assets.filter((asset) => asset.role !== 'mix-cover'), { ...cover, source: claim.provider.provider }] };
  }
  if (field === 'flyer' && record.kind === 'event') {
    const flyer = value as { role: 'event-flyer'; url: string };
    return { ...base, assets: [...record.assets.filter((asset) => asset.role !== 'event-flyer'), { ...flyer, source: claim.provider.provider }] };
  }
  if (record.kind === 'entity' && ['artistPortrait', 'crewLogo', 'labelLogo'].includes(field)) {
    const asset = value as { role: 'artist-portrait' | 'crew-logo' | 'label-logo'; url: string };
    return { ...base, assets: [...record.assets.filter((item) => item.role !== asset.role), { ...asset, source: claim.provider.provider }] };
  }
  if (field === 'eventDate' && record.kind === 'event') {
    return {
      ...record,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
      selectedEvidence,
      startDate: value as typeof record.startDate
    };
  }
  return { ...base, [field]: value } as CatalogRecord;
}

type ClaimOutcome = 'selected' | 'corroborated' | 'pending';

function applyOne(tx: CatalogTransaction, claim: FieldClaim): ClaimOutcome | 'duplicate' {
  const fingerprint = claimFingerprint(claim);
  if (tx.getClaim(fingerprint)) return 'duplicate';
  const record = tx.getRecord(claim.targetRecordId);
  if (!record) throw new Error(`Target record ${claim.targetRecordId} does not exist`);
  const value = validateField(record, claim.field, claim.value);
  const currentValue = valueFor(record, claim.field);
  const id = fingerprint as RecordId;

  if (currentValue !== undefined && comparisonValue(currentValue) === comparisonValue(value)) {
    tx.addClaim(id, fingerprint, claim, 'corroborated', record.revision);
    return 'corroborated';
  }

  const sourceIsLinked = tx.findByProvider(claim.provider) === record.id;
  const canSelect = currentValue === undefined && record.verification !== 'proposed'
    && (claim.evidence === 'curated' || (claim.evidence === 'direct' && sourceIsLinked));
  if (canSelect) {
    tx.saveRecord(withSelectedField(record, claim.field, value, id, claim), record.revision);
    tx.addClaim(id, fingerprint, claim, 'selected', record.revision + 1);
    return 'selected';
  }

  tx.addClaim(id, fingerprint, claim, 'pending', record.revision, currentValue);
  return 'pending';
}

export function applyClaims(repository: CatalogRepository, claimInputs: FieldClaim[]): EnrichmentReport {
  const claims = claimInputs.map((claim) => FieldClaimSchema.parse(claim));
  const report: EnrichmentReport = {
    state: 'completed',
    attemptedProviders: [...new Set(claims.map((claim) => claim.provider.provider))],
    applied: 0,
    corroborated: 0,
    reviewed: 0,
    errors: [],
    missingFields: []
  };
  const touchedRecords = new Set<RecordId>();

  for (const claim of claims) {
    try {
      const outcome = repository.transaction((tx) => applyOne(tx, claim));
      touchedRecords.add(claim.targetRecordId);
      if (outcome === 'selected') report.applied += 1;
      if (outcome === 'corroborated') report.corroborated += 1;
      if (outcome === 'pending') report.reviewed += 1;
    } catch (error) {
      report.errors.push({ provider: claim.provider.provider, message: error instanceof Error ? error.message : String(error) });
    }
  }

  report.missingFields = [...new Set([...touchedRecords].flatMap((id) => {
    const record = repository.getRecord(id);
    return record ? missingFields(record) : [];
  }))];
  return EnrichmentReportSchema.parse(report);
}

export function decideReview(
  repository: CatalogRepository,
  id: RecordId,
  decision: 'accept' | 'reject',
  expectedRevision: number,
  actor: string
): ReviewItem {
  repository.transaction((tx) => {
    const item = tx.getReview(id);
    if (!item) throw new Error(`Review item ${id} does not exist`);
    const record = tx.getRecord(item.targetRecordId);
    if (!record) throw new Error(`Target record ${item.targetRecordId} does not exist`);
    if (record.revision !== expectedRevision || item.recordRevision !== expectedRevision) {
      throw new Error(`Revision conflict for ${item.targetRecordId}`);
    }

    if (decision === 'accept') {
      const value = validateField(record, item.field, item.claim.value);
      let updated = withSelectedField(record, item.field, value, item.id, item.claim);
      if (record.kind === 'event' && record.verification === 'proposed' && item.field === 'name') {
        updated = { ...updated, verification: 'curator-confirmed', reviewState: 'ready' };
      }
      tx.saveRecord(updated, expectedRevision);
      tx.decideReview(id, 'accepted', actor);
    } else {
      tx.decideReview(id, 'rejected', actor);
    }
  });
  const decided = repository.getReview(id);
  if (!decided) throw new Error(`Review item ${id} could not be reloaded`);
  return decided;
}

export function refreshReview(repository: CatalogRepository, id: RecordId): ReviewItem {
  repository.transaction((tx) => {
    const item = tx.getReview(id);
    if (!item) throw new Error(`Review item ${id} does not exist`);
    const record = tx.getRecord(item.targetRecordId);
    if (!record) throw new Error(`Target record ${item.targetRecordId} does not exist`);
    tx.refreshReview(id, record.revision, valueFor(record, item.field));
  });
  const refreshed = repository.getReview(id);
  if (!refreshed) throw new Error(`Review item ${id} could not be reloaded`);
  return refreshed;
}