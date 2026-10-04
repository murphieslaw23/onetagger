import {
  CatalogRecordSchema,
  FieldClaimSchema,
  FieldDefinitions,
  ProviderMetadataSchema,
  validateField,
  type CatalogRecord,
  type FieldClaim,
  type ProviderMetadata
} from '@syco23/catalog-domain';

export type { ProviderMetadata };

export function claimsFromProvider(targetInput: CatalogRecord, metadataInput: ProviderMetadata): FieldClaim[] {
  const target = CatalogRecordSchema.parse(targetInput);
  const metadata = ProviderMetadataSchema.parse(metadataInput);
  const claims: FieldClaim[] = [];

  for (const [field, rawValue] of Object.entries(metadata.facts)) {
    if (!Object.hasOwn(FieldDefinitions, field)) continue;
    const value = validateField(target, field, rawValue);
    claims.push(FieldClaimSchema.parse({
      targetRecordId: target.id,
      field,
      value,
      provider: metadata.provider,
      sourceUrl: metadata.sourceUrl,
      observedAt: metadata.observedAt,
      evidence: metadata.fieldEvidence?.[field] === 'parsed' || metadata.match.status !== 'confirmed' ? 'parsed' : metadata.fieldEvidence?.[field] ?? 'direct',
      matchExplanation: metadata.match.explanation
    }));
  }

  return claims;
}