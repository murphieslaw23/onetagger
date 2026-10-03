import type { EntityRef, MixCandidate, ProviderId, SourceRef } from '../domain.js';
import { normalizeQuery } from './utils.js';
import type { ProviderRegistry } from './registry.js';

export interface MixEnrichmentInput {
  title: string;
  artists: string[];
  crews?: string[];
  durationMs?: number;
  recordedAt?: string;
  description?: string;
  genres?: string[];
  artwork?: Array<{ url: string; provider?: ProviderId; kind?: 'cover' | 'artist' | 'crew' }>;
  sources?: SourceRef[];
  externalIds?: Record<string, string>;
}

export interface EnrichmentArtwork {
  url: string;
  provider: ProviderId;
  kind: 'cover' | 'artist' | 'crew';
}

export interface EnrichmentProvenance {
  provider: ProviderId;
  field: string;
  confidence: number;
  sourceUrl?: string;
}

export interface MixEnrichmentResult {
  patch: {
    durationMs?: number;
    recordedAt?: string;
    description?: string;
    genres?: string[];
    artwork?: EnrichmentArtwork[];
    sources?: SourceRef[];
    externalIds?: Record<string, string>;
  };
  candidates: MixCandidate[];
  entities: EntityRef[];
  provenance: EnrichmentProvenance[];
  attempted: ProviderId[];
  failures: Array<{ provider: ProviderId; error: string }>;
}

function exactEntity(name: string, entities: EntityRef[]): EntityRef | undefined {
  const wanted = normalizeQuery(name);
  return entities.find((entity) => normalizeQuery(entity.name) === wanted);
}

function providerQuery(provider: ProviderId, input: MixEnrichmentInput) {
  const identity = [input.artists?.[0], input.title].filter(Boolean).join(' ').trim();
  if (provider === 'freeteknomusic') {
    const anchor = input.crews?.[0] || input.artists?.[0];
    if (!anchor) return null;
    const slug = normalizeQuery(anchor).replace(/\s+/g, '');
    if (!slug) return null;
    return {
      url: `https://archive.freeteknomusic.org/${encodeURIComponent(slug)}/`,
      q: identity,
      maxDepth: 0,
      maxItems: 120,
      limit: 8,
      durationExpectedMs: input.durationMs,
    };
  }
  return {
    q: identity || input.artists?.[0] || input.title,
    minDurationMs: Math.max(30 * 60_000, Math.floor((input.durationMs || 0) * 0.65)) || 30 * 60_000,
    durationExpectedMs: input.durationMs,
    limit: 8,
  };
}

export async function enrichMix(registry: ProviderRegistry, input: MixEnrichmentInput): Promise<MixEnrichmentResult> {
  const existingProviders = new Set((input.sources || []).map((source) => source.provider));
  const attempted: ProviderId[] = [];
  const failures: Array<{ provider: ProviderId; error: string }> = [];
  const candidates: MixCandidate[] = [];

  const discoveryTasks = [...registry.discovery.entries()]
    .filter(([provider]) => !existingProviders.has(provider as ProviderId))
    .map(async ([providerId, provider]) => {
      const id = providerId as ProviderId;
      const query = providerQuery(id, input);
      if (!query) return;
      attempted.push(id);
      try {
        const health = await provider.health();
        if (health.state === 'offline' || (id === 'soundcloud' && health.state !== 'ready')) {
          failures.push({ provider: id, error: health.detail });
          return;
        }
        const results = await provider.search(query);
        candidates.push(...results.filter((candidate) => candidate.confidence >= 0.5));
      } catch (error) {
        failures.push({ provider: id, error: error instanceof Error ? error.message : String(error) });
      }
    });

  await Promise.all(discoveryTasks);
  candidates.sort((a, b) => b.confidence - a.confidence);

  const patch: MixEnrichmentResult['patch'] = {};
  const provenance: EnrichmentProvenance[] = [];
  const addedSources = new Map<string, SourceRef>();
  const externalIds: Record<string, string> = {};
  const artwork: EnrichmentArtwork[] = [];

  const fill = <K extends 'durationMs' | 'recordedAt' | 'description' | 'genres'>(
    field: K,
    value: MixEnrichmentResult['patch'][K],
    candidate: MixCandidate,
  ) => {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (patch[field] !== undefined) return;
    (patch as Record<string, unknown>)[field] = value;
    provenance.push({
      provider: candidate.provider,
      field,
      confidence: candidate.confidence,
      sourceUrl: candidate.source.url,
    });
  };

  for (const candidate of candidates) {
    if (candidate.confidence < 0.58) continue;
    if (!input.durationMs && candidate.durationMs) fill('durationMs', candidate.durationMs, candidate);
    if (!input.recordedAt && candidate.recordedAt) fill('recordedAt', candidate.recordedAt, candidate);
    if (!input.description && candidate.description) fill('description', candidate.description, candidate);
    if (!(input.genres || []).length && candidate.genres?.length) fill('genres', candidate.genres, candidate);

    if (!(input.artwork || []).length && !artwork.length && candidate.artwork?.length) {
      artwork.push(...candidate.artwork.slice(0, 2).map((url) => ({ url, provider: candidate.provider, kind: 'cover' as const })));
      provenance.push({
        provider: candidate.provider,
        field: 'artwork',
        confidence: candidate.confidence,
        sourceUrl: candidate.source.url,
      });
    }

    if (candidate.confidence >= 0.64) {
      addedSources.set(`${candidate.source.provider}:${candidate.source.url}`, candidate.source);
      Object.assign(externalIds, candidate.externalIds || {});
    }
  }

  const entities: EntityRef[] = [];
  if (!existingProviders.has('discogs')) {
    attempted.push('discogs');
    try {
      const health = await registry.discogs.health();
      if (health.state === 'offline') {
        failures.push({ provider: 'discogs', error: health.detail });
      } else {
        for (const [kind, names] of [
          ['artist', input.artists || []],
          ['crew', input.crews || []],
        ] as const) {
          for (const name of names.slice(0, 3)) {
            try {
              const matches = await registry.discogs.enrichEntity(name, kind);
              entities.push(...matches);
              const exact = exactEntity(name, matches);
              if (!exact) continue;
              if (!(input.artwork || []).length && !artwork.length && exact.imageUrl) {
                artwork.push({ url: exact.imageUrl, provider: 'discogs', kind });
                provenance.push({ provider: 'discogs', field: 'artwork', confidence: 0.88, sourceUrl: exact.url });
              }
              if (exact.externalId) externalIds[kind === 'artist' ? 'discogsArtist' : 'discogsCrew'] = exact.externalId;
              if (exact.url) addedSources.set(`discogs:${exact.url}`, { provider: 'discogs', url: exact.url, externalId: exact.externalId });
            } catch (error) {
              failures.push({ provider: 'discogs', error: error instanceof Error ? error.message : String(error) });
              break;
            }
          }
        }
      }
    } catch (error) {
      failures.push({ provider: 'discogs', error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (artwork.length) patch.artwork = artwork;
  if (addedSources.size) patch.sources = [...addedSources.values()];
  if (Object.keys(externalIds).length) patch.externalIds = externalIds;

  return {
    patch,
    candidates: candidates.slice(0, 12),
    entities,
    provenance,
    attempted: [...new Set(attempted)],
    failures,
  };
}
