import { computed, reactive, watch } from 'vue';
import { mixes as initialMixes, providerHealth } from '../domain/fixtures';
import type { ImportJob, MixCandidate, MixSet, ProviderId } from '../domain/types';
import {
  enrichMixMetadata,
  type ApiDiscoveryJob,
  type ApiEnrichmentResult,
  type ApiMixCandidate,
  type ApiProviderHealth,
} from '../services/api';

type ApiState = 'checking' | 'online' | 'offline';

function loadMixes(): MixSet[] {
  if (typeof window === 'undefined') return structuredClone(initialMixes);
  try {
    const saved = window.localStorage.getItem('syco23.mixsets.library');
    if (!saved) return structuredClone(initialMixes);
    const parsed = JSON.parse(saved) as MixSet[];
    const repaired = parsed.map((mix) => ({
      ...mix,
      artwork: Array.isArray(mix.artwork) ? mix.artwork : [],
      sources: Array.isArray(mix.sources) ? mix.sources : [],
      candidates: Array.isArray(mix.candidates) ? mix.candidates : [],
      provenance: Array.isArray(mix.provenance) ? mix.provenance : [],
      status: mix.status === 'enriching' ? 'review' : mix.status,
    }));
    window.localStorage.setItem('syco23.mixsets.library', JSON.stringify(repaired));
    return repaired;
  } catch {
    return structuredClone(initialMixes);
  }
}

function calculateCompleteness(mix: MixSet): number {
  const checks = [
    Boolean(mix.title),
    Boolean(mix.artists.length && !mix.artists.every((artist) => artist.toLowerCase() === 'unknown')),
    Boolean(mix.crews.length),
    Boolean(mix.durationMs),
    Boolean(mix.recordedAt),
    Boolean(mix.description),
    Boolean(mix.genres.length || mix.styles.length),
    Boolean(mix.artwork.length),
    Boolean(mix.event || mix.venue),
    Boolean(mix.location),
  ];
  return Number((checks.filter(Boolean).length / checks.length).toFixed(2));
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameList(left: string[] = [], right: string[] = []) {
  return normalized(left.join(' ')) === normalized(right.join(' '));
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || crypto.randomUUID();
}

function jobLabel(job: ApiDiscoveryJob): string {
  const query = job.query || {};
  return String(query.url || query.q || query.artist || 'manual discovery');
}

const state = reactive({
  mixes: loadMixes(),
  jobs: [] as ImportJob[],
  providers: structuredClone(providerHealth),
  apiState: 'checking' as ApiState,
  query: '',
  source: 'all' as ProviderId | 'all',
  status: 'all',
  selected: new Set<string>(),
});

if (typeof window !== 'undefined') {
  watch(() => state.mixes, (mixes) => {
    window.localStorage.setItem('syco23.mixsets.library', JSON.stringify(mixes));
  }, { deep: true });
}

export function useMixStore() {
  const filtered = computed(() => {
    const q = state.query.trim().toLowerCase();
    return state.mixes
      .filter((mix) => {
        const haystack = [mix.title, ...mix.artists, ...mix.crews, mix.event, mix.location].filter(Boolean).join(' ').toLowerCase();
        const queryMatch = !q || haystack.includes(q);
        const sourceMatch = state.source === 'all' || mix.sources.some((source) => source.provider === state.source);
        const statusMatch = state.status === 'all' || mix.status === state.status;
        return queryMatch && sourceMatch && statusMatch;
      })
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt));
  });

  const reviewCount = computed(() => state.mixes.reduce((sum, mix) => {
    const pending = mix.candidates.filter((candidate) => candidate.state === 'pending').length;
    return sum + pending + (mix.status === 'review' && pending === 0 ? 1 : 0);
  }, 0));

  const runningJobs = computed(() => state.jobs.filter((job) => job.state === 'running' || job.state === 'queued').length);

  function findMix(id: string) {
    return state.mixes.find((mix) => mix.id === id);
  }

  function findMixBySource(url: string) {
    return state.mixes.find((mix) => mix.sources.some((source) => source.url === url));
  }

  function findCandidateMatch(candidate: ApiMixCandidate) {
    const direct = findMixBySource(candidate.source.url)
      || state.mixes.find((mix) => candidate.source.externalId
        && mix.sources.some((source) => source.externalId === candidate.source.externalId));
    if (direct) return direct;

    return state.mixes.find((mix) => {
      const titleMatch = normalized(mix.title) === normalized(candidate.title || '');
      const artistMatch = sameList(mix.artists, candidate.artists || []);
      if (!titleMatch || !artistMatch) return false;
      if (!mix.durationMs || !candidate.durationMs) return true;
      const delta = Math.abs(mix.durationMs - candidate.durationMs) / Math.max(mix.durationMs, candidate.durationMs);
      return delta <= 0.08;
    });
  }

  function refreshCompleteness(mix: MixSet) {
    mix.completeness = calculateCompleteness(mix);
  }

  function applyCandidate(mix: MixSet, candidate: MixCandidate) {
    const patch = candidate.fields;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key !== 'id' && key !== 'candidates') {
        (mix as unknown as Record<string, unknown>)[key] = value;
      }
    }
    candidate.state = 'accepted';
    mix.confidence = Math.max(mix.confidence, candidate.confidence);
    mix.updatedAt = new Date().toISOString();
    refreshCompleteness(mix);
    if (!mix.candidates.some((item) => item.state === 'pending')) mix.status = 'ready';
  }

  function rejectCandidate(candidate: MixCandidate, mix?: MixSet) {
    candidate.state = 'rejected';
    if (mix) {
      mix.updatedAt = new Date().toISOString();
      if (!mix.candidates.some((item) => item.state === 'pending') && mix.confidence >= 0.82) mix.status = 'ready';
    }
  }

  function markReviewed(mix: MixSet) {
    for (const candidate of mix.candidates) {
      if (candidate.state === 'pending') candidate.state = 'rejected';
    }
    mix.status = 'ready';
    mix.updatedAt = new Date().toISOString();
  }

  function addDiscoveredCandidate(candidate: ApiMixCandidate): MixSet {
    const existing = findCandidateMatch(candidate);

    if (existing) {
      if (!existing.sources.some((source) => source.provider === candidate.source.provider && source.url === candidate.source.url)) {
        existing.sources.push(candidate.source);
        existing.updatedAt = new Date().toISOString();
      }
      return existing;
    }

    const now = new Date().toISOString();
    const idSuffix = safeId(candidate.source.externalId || crypto.randomUUID());
    const mix: MixSet = {
      id: `${candidate.provider}-${idSuffix}`,
      title: candidate.title || 'Untitled mix',
      artists: candidate.artists?.length ? candidate.artists : ['Unknown artist'],
      crews: candidate.crews || [],
      recordedAt: candidate.recordedAt,
      durationMs: candidate.durationMs || 0,
      description: candidate.description,
      genres: candidate.genres || [],
      styles: [],
      artwork: (candidate.artwork || []).filter(Boolean).map((url) => ({
        url,
        source: candidate.provider,
        kind: 'cover' as const,
      })),
      sources: [candidate.source],
      externalIds: candidate.externalIds || {},
      candidates: [],
      confidence: candidate.confidence,
      completeness: 0,
      provenance: [{
        provider: candidate.provider,
        field: 'identity',
        confidence: candidate.confidence,
        observedAt: now,
        sourceUrl: candidate.source.url,
      }],
      rawSource: candidate.raw,
      status: candidate.confidence >= 0.82 ? 'ready' : 'review',
      createdAt: now,
      updatedAt: now,
    };
    refreshCompleteness(mix);
    state.mixes.unshift(mix);
    return state.mixes[0];
  }

  function applyEnrichmentResult(mix: MixSet, result: ApiEnrichmentResult) {
    const filled = new Set<string>();
    const patch = result.patch;

    const assignMissing = (field: 'durationMs' | 'recordedAt' | 'description' | 'genres', value: unknown) => {
      const current = mix[field] as unknown;
      const missing = current === undefined || current === '' || current === 0 || (Array.isArray(current) && !current.length);
      if (!missing || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
      (mix as unknown as Record<string, unknown>)[field] = value;
      filled.add(field);
    };

    assignMissing('durationMs', patch.durationMs);
    assignMissing('recordedAt', patch.recordedAt);
    assignMissing('description', patch.description);
    assignMissing('genres', patch.genres);

    if (!mix.artwork.length && patch.artwork?.length) {
      mix.artwork = patch.artwork.map((item) => ({
        url: item.url,
        source: item.provider,
        kind: item.kind,
      }));
      filled.add('artwork');
    }

    for (const source of patch.sources || []) {
      if (!mix.sources.some((existing) => existing.provider === source.provider && existing.url === source.url)) {
        mix.sources.push(source);
        filled.add('sources');
      }
    }

    if (patch.externalIds) {
      Object.assign(mix.externalIds, patch.externalIds);
      if (Object.keys(patch.externalIds).length) filled.add('externalIds');
    }

    const observedAt = new Date().toISOString();
    for (const item of result.provenance) {
      if (!mix.provenance.some((existing) =>
        existing.provider === item.provider
        && existing.field === item.field
        && existing.sourceUrl === item.sourceUrl,
      )) {
        mix.provenance.push({ ...item, observedAt });
      }
    }

    let reviewCandidatesAdded = 0;
    for (const candidate of result.candidates) {
      if (candidate.confidence < 0.7) continue;
      const fields: Partial<MixSet> = {};
      if (candidate.title && normalized(candidate.title) !== normalized(mix.title)) fields.title = candidate.title;
      if (candidate.artists?.length && !sameList(candidate.artists, mix.artists)) fields.artists = candidate.artists;
      if (candidate.recordedAt && mix.recordedAt && candidate.recordedAt !== mix.recordedAt) fields.recordedAt = candidate.recordedAt;
      if (candidate.genres?.length && mix.genres.length && !sameList(candidate.genres, mix.genres)) fields.genres = candidate.genres;
      if (!Object.keys(fields).length) continue;

      const id = `enrich-${candidate.provider}-${safeId(candidate.source.externalId || candidate.source.url)}`;
      if (mix.candidates.some((existing) => existing.id === id)) continue;
      mix.candidates.push({
        id,
        provider: candidate.provider,
        confidence: candidate.confidence,
        reasons: candidate.reasons,
        fields,
        raw: candidate.raw,
        state: 'pending',
      });
      reviewCandidatesAdded += 1;
    }

    refreshCompleteness(mix);
    mix.updatedAt = observedAt;
    mix.status = reviewCandidatesAdded || mix.candidates.some((candidate) => candidate.state === 'pending')
      ? 'review'
      : mix.confidence >= 0.82
        ? 'ready'
        : 'review';

    return {
      filledFields: [...filled],
      reviewCandidatesAdded,
      attempted: result.attempted,
      failures: result.failures,
    };
  }

  async function enrichMixRecord(mix: MixSet) {
    const previousStatus = mix.status;
    mix.status = 'enriching';
    mix.updatedAt = new Date().toISOString();
    try {
      const result = await enrichMixMetadata(mix);
      return applyEnrichmentResult(mix, result);
    } catch (error) {
      mix.status = previousStatus === 'enriching' ? 'review' : previousStatus;
      mix.updatedAt = new Date().toISOString();
      throw error;
    }
  }

  function syncApiJobs(jobs: ApiDiscoveryJob[]) {
    state.jobs.splice(0, state.jobs.length, ...jobs.map((job): ImportJob => ({
      id: job.id,
      provider: job.provider,
      label: jobLabel(job),
      query: job.query || {},
      state: job.state,
      progress: job.progress,
      scanned: job.scanned,
      found: job.found,
      createdAt: job.createdAt || new Date().toISOString(),
      error: job.error,
    })));
  }

  function upsertApiJob(job: ApiDiscoveryJob) {
    const next: ImportJob = {
      id: job.id,
      provider: job.provider,
      label: jobLabel(job),
      query: job.query || {},
      state: job.state,
      progress: job.progress,
      scanned: job.scanned,
      found: job.found,
      createdAt: job.createdAt || new Date().toISOString(),
      error: job.error,
    };
    const current = state.jobs.find((item) => item.id === job.id);
    if (current) Object.assign(current, next);
    else state.jobs.unshift(next);
  }

  function updateProviderHealth(health: ApiProviderHealth[]) {
    for (const item of health) {
      const provider = state.providers.find((entry) => entry.id === item.id);
      if (!provider) continue;
      provider.state = item.state;
      provider.detail = item.detail;
      provider.lastCheck = item.checkedAt;
    }
  }

  function setApiState(value: ApiState) {
    state.apiState = value;
  }

  function toggleSelected(id: string) {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  }

  function clearSelection() {
    state.selected.clear();
  }

  return {
    state,
    filtered,
    reviewCount,
    runningJobs,
    findMix,
    findMixBySource,
    findCandidateMatch,
    applyCandidate,
    rejectCandidate,
    markReviewed,
    addDiscoveredCandidate,
    applyEnrichmentResult,
    enrichMixRecord,
    syncApiJobs,
    upsertApiJob,
    updateProviderHealth,
    setApiState,
    toggleSelected,
    clearSelection,
  };
}
