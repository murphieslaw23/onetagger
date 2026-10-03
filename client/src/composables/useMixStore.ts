import { computed, reactive, watch } from 'vue';
import { jobs as initialJobs, mixes as initialMixes, providerHealth } from '../domain/fixtures';
import type { MixCandidate, MixSet, ProviderId } from '../domain/types';
import type { ApiMixCandidate } from '../services/api';

function loadMixes(): MixSet[] {
  if (typeof window === 'undefined') return structuredClone(initialMixes);
  try {
    const saved = window.localStorage.getItem('syco23.mixsets.library');
    return saved ? JSON.parse(saved) : structuredClone(initialMixes);
  } catch {
    return structuredClone(initialMixes);
  }
}

const state = reactive({
  mixes: loadMixes(),
  jobs: structuredClone(initialJobs),
  providers: structuredClone(providerHealth),
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
    return state.mixes.filter((mix) => {
      const haystack = [mix.title, ...mix.artists, ...mix.crews, mix.event, mix.location].filter(Boolean).join(' ').toLowerCase();
      const queryMatch = !q || haystack.includes(q);
      const sourceMatch = state.source === 'all' || mix.sources.some((s) => s.provider === state.source);
      const statusMatch = state.status === 'all' || mix.status === state.status;
      return queryMatch && sourceMatch && statusMatch;
    });
  });

  const reviewCount = computed(() => state.mixes.reduce((sum, mix) => {
    const pending = mix.candidates.filter((candidate) => candidate.state === 'pending').length;
    return sum + pending + (mix.status === 'review' && pending === 0 ? 1 : 0);
  }, 0));
  const runningJobs = computed(() => state.jobs.filter((job) => job.state === 'running' || job.state === 'queued').length);

  function findMix(id: string) {
    return state.mixes.find((mix) => mix.id === id);
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
  }

  function addDiscoveredCandidate(candidate: ApiMixCandidate): MixSet {
    const existing = state.mixes.find((mix) =>
      mix.sources.some((source) =>
        source.url === candidate.source.url ||
        (candidate.source.externalId && source.externalId === candidate.source.externalId),
      ),
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const idSuffix = candidate.source.externalId || crypto.randomUUID();
    const completenessParts = [
      candidate.title,
      candidate.artists.length,
      candidate.durationMs,
      candidate.recordedAt,
      candidate.description,
      candidate.artwork?.length,
    ].filter(Boolean).length;
    const mix: MixSet = {
      id: `${candidate.provider}-${idSuffix}`,
      title: candidate.title,
      artists: candidate.artists,
      crews: candidate.crews || [],
      recordedAt: candidate.recordedAt,
      durationMs: candidate.durationMs || 0,
      description: candidate.description,
      genres: candidate.genres || [],
      styles: [],
      artwork: (candidate.artwork || []).map((url) => ({ url, source: candidate.provider, kind: 'cover' as const })),
      sources: [candidate.source],
      externalIds: candidate.externalIds || {},
      candidates: [],
      confidence: candidate.confidence,
      completeness: Math.max(0.25, completenessParts / 6),
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
    state.mixes.unshift(mix);
    return mix;
  }

  function rejectCandidate(candidate: MixCandidate) {
    candidate.state = 'rejected';
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
    applyCandidate,
    addDiscoveredCandidate,
    rejectCandidate,
    toggleSelected,
    clearSelection,
  };
}
