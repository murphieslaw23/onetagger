<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">DISCOVERY / JOB CONTROL</p>
        <h1>Pull a signal. Keep the source.</h1>
        <p class="hero-copy">Imports run as bounded jobs. Discovery creates reviewable candidates; indexing can optionally fill missing metadata across available providers.</p>
      </div>
    </header>

    <div class="import-layout">
      <section class="panel import-console">
        <div class="panel-head"><span>NEW JOB</span><b>DISCOVERY TARGET</b></div>

        <div class="provider-switch">
          <button
            v-for="provider in discoveryProviders"
            :key="provider.id"
            :class="{ active: selectedProvider === provider.id }"
            :disabled="providerBlocked(provider.id)"
            :title="providerBlocked(provider.id) ? provider.detail : provider.detail"
            @click="selectedProvider = provider.id"
          >
            <SourceBadge :provider="provider.id" />
            <small>{{ provider.mode }} · {{ provider.state }}</small>
          </button>
        </div>

        <label class="field-label" for="discovery-query">QUERY OR DIRECTORY URL</label>
        <textarea
          id="discovery-query"
          v-model="query"
          rows="4"
          :placeholder="selectedProvider === 'freeteknomusic'
            ? 'https://archive.freeteknomusic.org/metek/\nor: Metek live 1998'
            : selectedProvider === 'youtube' || selectedProvider === 'hearthis'
              ? 'Paste a public video/track URL, or search artist + mix title'
              : 'Artist + title, crew, event or other identifying terms'"
        ></textarea>

        <div class="split-fields" :class="{ 'split-fields--compact': selectedProvider !== 'freeteknomusic' }">
          <label v-if="selectedProvider === 'freeteknomusic'">
            <span>MAX DEPTH</span>
            <input v-model.number="maxDepth" type="number" min="0" max="6" />
          </label>
          <label v-if="selectedProvider === 'freeteknomusic'">
            <span>MAX ITEMS</span>
            <input v-model.number="maxItems" type="number" min="10" max="2500" step="10" />
          </label>
          <label v-else>
            <span>RESULT LIMIT</span>
            <input v-model.number="resultLimit" type="number" min="5" max="75" step="5" />
          </label>
          <label>
            <span>MIN DURATION</span>
            <select v-model="minDuration">
              <option :value="30">30 min</option>
              <option :value="45">45 min</option>
              <option :value="60">60 min</option>
            </select>
          </label>
        </div>

        <label class="enrichment-toggle">
          <input v-model="autoEnrich" type="checkbox" />
          <span>
            <strong>Auto-enrich missing metadata after indexing</strong>
            <small>Queries available providers for missing artwork, description, date, genres and source IDs. Conflicts stay in Review.</small>
          </span>
        </label>

        <button class="btn btn--primary btn--wide" :disabled="submitting || !query.trim() || providerBlocked(selectedProvider) || youtubeTextSearchBlocked" @click="queueDiscovery">
          <q-icon :name="submitting ? 'mdi-loading mdi-spin' : 'mdi-radar'" />
          {{ submitting ? 'Contacting worker…' : 'Queue discovery job' }}
        </button>
        <p class="legal-note">Public metadata only. No protected-content bypass, no full-audio download during discovery.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <span>{{ state.jobs.length ? 'ACTIVE / RECENT' : 'NO RECENT JOBS' }}</span>
          <b>JOB QUEUE</b>
        </div>

        <div v-if="state.jobs.length" class="job-list">
          <article v-for="job in state.jobs" :key="job.id" class="job-row">
            <div class="job-row__icon">
              <q-icon :name="job.state === 'running' || job.state === 'queued' ? 'mdi-loading mdi-spin' : job.state === 'error' ? 'mdi-alert-circle-outline' : 'mdi-radar'" />
            </div>
            <div class="job-row__body">
              <div><strong>{{ job.label }}</strong><span>{{ job.state.toUpperCase() }}</span></div>
              <small>{{ job.provider }} · {{ job.scanned }} scanned · {{ job.found }} candidates</small>
              <small v-if="job.error" class="job-error">{{ job.error }}</small>
              <div class="job-progress"><i :style="{ width: job.progress + '%' }"></i></div>
            </div>
            <button
              class="icon-btn"
              :title="jobActionLabel(job)"
              :aria-label="jobActionLabel(job)"
              @click="runJobAction(job)"
            >
              <q-icon :name="jobActionIcon(job)" />
            </button>
          </article>
        </div>

        <div v-else class="panel-empty">
          <q-icon name="mdi-radar" size="28px" />
          <strong>No worker jobs yet.</strong>
          <small>Queue a discovery request to start the index flow.</small>
        </div>
      </section>
    </div>

    <section v-if="discovered.length" class="panel discovery-panel">
      <div class="panel-head"><span>{{ discovered.length }} CANDIDATES</span><b>DISCOVERY RESULTS</b></div>
      <div class="discovery-list">
        <article v-for="candidate in discovered" :key="candidate.source.url" class="discovery-row">
          <div class="discovery-row__source">
            <SourceBadge :provider="candidate.provider" />
            <strong>{{ Math.round(candidate.confidence * 100) }}%</strong>
          </div>
          <div class="discovery-row__identity">
            <h3>{{ candidate.title }}</h3>
            <p v-if="candidate.crews.length">Crew: {{ candidate.crews.join(' · ') }}</p>
            <p>{{ candidate.artists.join(' · ') || 'Unknown artist' }}</p>
            <small>{{ candidate.reasons.join(' · ') }}</small>
          </div>
          <div class="discovery-row__meta">
            <span v-if="candidate.durationMs">{{ duration(candidate.durationMs) }}</span>
            <span v-if="candidate.recordedAt">{{ candidate.recordedAt }}</span>
          </div>

          <router-link
            v-if="indexedMix(candidate)"
            class="btn"
            :to="'/mix/' + encodeURIComponent(indexedMix(candidate)!.id)"
          >
            <q-icon name="mdi-open-in-new" /> Open indexed
          </router-link>
          <button
            v-else
            class="btn btn--primary"
            :disabled="busySources.has(candidate.source.url)"
            @click="importCandidate(candidate)"
          >
            <q-icon :name="busySources.has(candidate.source.url) ? 'mdi-loading mdi-spin' : 'mdi-plus'" />
            {{ busySources.has(candidate.source.url)
              ? (autoEnrich ? 'Index + enrich…' : 'Indexing…')
              : matchingMix(candidate)
                ? 'Merge source'
                : 'Add to index' }}
          </button>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';
import type { ImportJob, ProviderId } from '../domain/types';
import {
  cancelDiscoveryJob,
  createDiscoveryJob,
  getDiscoveryJob,
  getDiscoveryJobs,
  getProviderHealth,
  type ApiDiscoveryJob,
  type ApiMixCandidate,
} from '../services/api';

const {
  state,
  addDiscoveredCandidate,
  enrichMixRecord,
  findMixBySource,
  findCandidateMatch,
  syncApiJobs,
  upsertApiJob,
  updateProviderHealth,
  setApiState,
} = useMixStore();

const $q = useQuasar();
const selectedProvider = ref<ProviderId>('freeteknomusic');
const query = ref('https://archive.freeteknomusic.org/metek/');
const maxDepth = ref(1);
const maxItems = ref(250);
const resultLimit = ref(25);
const minDuration = ref(45);
const submitting = ref(false);
const discovered = ref<ApiMixCandidate[]>([]);
const busySources = ref(new Set<string>());
const autoEnrich = ref(typeof window === 'undefined' ? true : window.localStorage.getItem('syco23.mixsets.autoEnrich') !== 'false');
let alive = true;

watch(autoEnrich, (value) => {
  window.localStorage.setItem('syco23.mixsets.autoEnrich', String(value));
});

const discoveryProviders = computed(() => state.providers.filter((provider) => provider.mode !== 'enrich'));
const youtubeTextSearchBlocked = computed(() => selectedProvider.value === 'youtube'
  && !/^https?:\/\//i.test(query.value.trim())
  && state.providers.find((provider) => provider.id === 'youtube')?.state !== 'ready');

function providerBlocked(id: ProviderId) {
  const provider = state.providers.find((item) => item.id === id);
  if (!provider) return false;
  if (id === 'youtube') return false;
  if (provider.state === 'offline') return true;
  return id === 'soundcloud' && provider.state !== 'ready';
}

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function indexedMix(candidate: ApiMixCandidate) {
  return findMixBySource(candidate.source.url);
}

function matchingMix(candidate: ApiMixCandidate) {
  return findCandidateMatch(candidate);
}

function providerQuery() {
  const input = query.value.trim();
  const next: Record<string, unknown> = {
    minDurationMs: minDuration.value * 60_000,
    limit: selectedProvider.value === 'freeteknomusic' ? 100 : resultLimit.value,
  };
  if (selectedProvider.value === 'freeteknomusic') {
    next.maxDepth = maxDepth.value;
    next.maxItems = maxItems.value;
    if (/^https?:/i.test(input)) next.url = input;
    else next.q = input;
  } else {
    if ((selectedProvider.value === 'youtube' || selectedProvider.value === 'hearthis') && /^https?:\/\//i.test(input)) next.url = input;
    else next.q = input;
  }
  return next;
}

async function pollJob(id: string) {
  for (let attempt = 0; attempt < 160 && alive; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    const job = await getDiscoveryJob(id);
    upsertApiJob(job);
    if (!['queued', 'running'].includes(job.state)) {
      discovered.value = job.candidates || [];
      if (job.state === 'error') {
        $q.notify({ type: 'negative', message: job.error || 'Discovery job failed' });
      } else {
        $q.notify({ message: `${job.found} candidates ready for review`, position: 'top-right' });
      }
      return;
    }
  }
}

async function queueDiscovery() {
  if (!query.value.trim()) return;
  submitting.value = true;
  discovered.value = [];
  try {
    const job = await createDiscoveryJob(selectedProvider.value, providerQuery());
    setApiState('online');
    upsertApiJob(job);
    void pollJob(job.id);
  } catch (error) {
    setApiState('offline');
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : 'Worker unavailable. No job was queued.',
    });
  } finally {
    submitting.value = false;
  }
}

function jobActionLabel(job: ImportJob) {
  if (job.state === 'running' || job.state === 'queued') return 'Cancel job';
  if (job.state === 'review') return 'Show candidates';
  return 'Run job again';
}

function jobActionIcon(job: ImportJob) {
  if (job.state === 'running' || job.state === 'queued') return 'mdi-close';
  if (job.state === 'review') return 'mdi-eye-outline';
  return 'mdi-refresh';
}

async function runJobAction(job: ImportJob) {
  if (job.state === 'running' || job.state === 'queued') {
    try {
      upsertApiJob(await cancelDiscoveryJob(job.id));
    } catch {
      $q.notify({ type: 'negative', message: 'Could not cancel remote job.' });
    }
    return;
  }

  if (job.state === 'review') {
    try {
      const remote = await getDiscoveryJob(job.id);
      upsertApiJob(remote);
      discovered.value = remote.candidates || [];
      document.querySelector('.discovery-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      $q.notify({ type: 'negative', message: 'Could not restore discovery results.' });
    }
    return;
  }

  selectedProvider.value = job.provider;
  const original = job.query || {};
  query.value = String(original.url || original.q || job.label);
  submitting.value = true;
  try {
    const remote = await createDiscoveryJob(job.provider, original);
    upsertApiJob(remote);
    void pollJob(remote.id);
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Could not rerun job.' });
  } finally {
    submitting.value = false;
  }
}

async function importCandidate(candidate: ApiMixCandidate) {
  busySources.value.add(candidate.source.url);
  let indexed = false;
  try {
    const mix = await addDiscoveredCandidate(candidate);
    indexed = true;
    if (!autoEnrich.value) {
      $q.notify({ message: `Indexed “${mix.title}”`, position: 'top-right' });
      return;
    }

    const summary = await enrichMixRecord(mix);
    const filled = summary.filledFields.length
      ? `added ${summary.filledFields.join(', ')}`
      : 'no new fields found';
    const conflicts = summary.reviewCandidatesAdded
      ? ` · ${summary.reviewCandidatesAdded} conflict${summary.reviewCandidatesAdded === 1 ? '' : 's'} sent to Review`
      : '';
    $q.notify({
      message: `Indexed + enriched “${mix.title}”: ${filled}${conflicts}${summary.failures.length ? ` · ${summary.failures.map((failure) => failure.provider).join(', ')} unavailable` : ''} · ${summary.remainingMissing.length} fields still missing`,
      position: 'top-right',
      timeout: 5000,
    });
  } catch (error) {
    $q.notify({
      type: 'warning',
      message: `${indexed ? 'Mix indexed; enrichment could not complete' : 'Import was not saved'}: ${error instanceof Error ? error.message : String(error)}`,
      timeout: 5000,
    });
  } finally {
    busySources.value.delete(candidate.source.url);
  }
}

onMounted(async () => {
  try {
    const [jobs, health] = await Promise.all([getDiscoveryJobs(), getProviderHealth()]);
    syncApiJobs(jobs);
    updateProviderHealth(health);
    setApiState('online');
  } catch {
    setApiState('offline');
  }
});

onBeforeUnmount(() => {
  alive = false;
});
</script>
