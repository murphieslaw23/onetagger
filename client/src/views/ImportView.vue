<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">DISCOVERY / JOB CONTROL</p>
        <h1>Pull a signal. Keep the source.</h1>
        <p class="hero-copy">Imports run as bounded jobs. Freeteknomusic recursion never blocks the browser; remote providers return candidates first, mutations only after review.</p>
      </div>
    </header>

    <div class="import-layout">
      <section class="panel import-console">
        <div class="panel-head"><span>NEW JOB</span><b>DISCOVERY TARGET</b></div>
        <div class="provider-switch">
          <button v-for="provider in discoveryProviders" :key="provider.id" :class="{ active: selectedProvider === provider.id }" @click="selectedProvider = provider.id">
            <SourceBadge :provider="provider.id" />
            <small>{{ provider.mode }}</small>
          </button>
        </div>

        <label class="field-label">QUERY OR DIRECTORY URL</label>
        <textarea v-model="query" rows="4" placeholder="https://archive.freeteknomusic.org/metek&#10;or: Spiral Tribe warehouse 2001"></textarea>

        <div class="split-fields">
          <label>
            <span>MAX DEPTH</span>
            <input v-model.number="maxDepth" type="number" min="0" max="6" />
          </label>
          <label>
            <span>MAX ITEMS</span>
            <input v-model.number="maxItems" type="number" min="10" max="2500" step="10" />
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

        <button class="btn btn--primary btn--wide" :disabled="submitting" @click="queueDiscovery">
          <q-icon :name="submitting ? 'mdi-loading mdi-spin' : 'mdi-radar'" />
          {{ submitting ? 'Contacting worker…' : 'Queue discovery job' }}
        </button>
        <p class="legal-note">Public metadata only. No protected-content bypass, no full-audio download during discovery.</p>
      </section>

      <section class="panel">
        <div class="panel-head"><span>ACTIVE / RECENT</span><b>JOB QUEUE</b></div>
        <div class="job-list">
          <article v-for="job in state.jobs" :key="job.id" class="job-row">
            <div class="job-row__icon"><q-icon :name="job.state === 'running' ? 'mdi-loading mdi-spin' : 'mdi-radar'" /></div>
            <div class="job-row__body">
              <div><strong>{{ job.label }}</strong><span>{{ job.state.toUpperCase() }}</span></div>
              <small>{{ job.provider }} · {{ job.scanned }} scanned · {{ job.found }} candidates</small>
              <div class="job-progress"><i :style="{ width: job.progress + '%' }"></i></div>
            </div>
            <button class="icon-btn" :title="job.state === 'running' || job.state === 'queued' ? 'Cancel' : 'Run again'" @click="job.state === 'running' || job.state === 'queued' ? cancel(job.id) : queueDiscovery()">
              <q-icon :name="job.state === 'running' || job.state === 'queued' ? 'mdi-close' : 'mdi-refresh'" />
            </button>
          </article>
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
            <p>{{ candidate.artists.join(' · ') || 'Unknown artist' }}</p>
            <small>{{ candidate.reasons.join(' · ') }}</small>
          </div>
          <div class="discovery-row__meta">
            <span v-if="candidate.durationMs">{{ duration(candidate.durationMs) }}</span>
            <span v-if="candidate.recordedAt">{{ candidate.recordedAt }}</span>
          </div>
          <button class="btn btn--primary" @click="importCandidate(candidate)">
            <q-icon name="mdi-plus" /> Add to library
          </button>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useQuasar } from 'quasar';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';
import type { ProviderId } from '../domain/types';
import {
  cancelDiscoveryJob,
  createDiscoveryJob,
  getDiscoveryJob,
  type ApiDiscoveryJob,
  type ApiMixCandidate,
} from '../services/api';

const { state, addDiscoveredCandidate } = useMixStore();
const $q = useQuasar();
const selectedProvider = ref<ProviderId>('freeteknomusic');
const query = ref('https://archive.freeteknomusic.org/metek');
const maxDepth = ref(2);
const maxItems = ref(500);
const minDuration = ref(45);
const submitting = ref(false);
const discovered = ref<ApiMixCandidate[]>([]);
let alive = true;

const discoveryProviders = computed(() => state.providers.filter((provider) => provider.mode !== 'enrich'));

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function updateJob(job: ApiDiscoveryJob) {
  const current = state.jobs.find((item) => item.id === job.id);
  const next = {
    id: job.id,
    provider: job.provider,
    label: query.value || 'manual discovery',
    state: job.state,
    progress: job.progress,
    scanned: job.scanned,
    found: job.found,
    createdAt: current?.createdAt || new Date().toISOString(),
    error: job.error,
  };
  if (current) Object.assign(current, next);
  else state.jobs.unshift(next);
}

async function pollJob(id: string) {
  for (let attempt = 0; attempt < 160 && alive; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    const job = await getDiscoveryJob(id);
    updateJob(job);
    if (!['queued', 'running'].includes(job.state)) {
      discovered.value = job.candidates || [];
      if (job.state === 'error') $q.notify({ type: 'negative', message: job.error || 'Discovery job failed' });
      else $q.notify({ message: `${job.found} candidates ready for review`, position: 'top-right' });
      return;
    }
  }
}

async function queueDiscovery() {
  submitting.value = true;
  discovered.value = [];
  try {
    const input = query.value.trim();
    const providerQuery: Record<string, unknown> = {
      minDurationMs: minDuration.value * 60_000,
      maxDepth: maxDepth.value,
      maxItems: maxItems.value,
      limit: 100,
    };
    if (selectedProvider.value === 'freeteknomusic' && /^https?:/i.test(input)) providerQuery.url = input;
    else providerQuery.q = input;

    const job = await createDiscoveryJob(selectedProvider.value, providerQuery);
    updateJob(job);
    void pollJob(job.id);
  } catch (error) {
    state.jobs.unshift({
      id: 'fixture-' + Date.now(),
      provider: selectedProvider.value,
      label: query.value || 'manual discovery',
      state: 'queued',
      progress: 0,
      scanned: 0,
      found: 0,
      createdAt: new Date().toISOString(),
    });
    $q.notify({ type: 'warning', message: 'Worker unavailable — preview remains in fixture mode.' });
  } finally {
    submitting.value = false;
  }
}

async function cancel(id: string) {
  if (id.startsWith('fixture-') || id.startsWith('job-')) {
    const local = state.jobs.find((item) => item.id === id);
    if (local) local.state = 'cancelled';
    return;
  }
  try {
    const job = await cancelDiscoveryJob(id);
    updateJob(job);
  } catch (error) {
    $q.notify({ type: 'negative', message: 'Could not cancel remote job.' });
  }
}

function importCandidate(candidate: ApiMixCandidate) {
  const mix = addDiscoveredCandidate(candidate);
  $q.notify({ message: `Added “${mix.title}” to the library`, position: 'top-right' });
}

onBeforeUnmount(() => {
  alive = false;
});
</script>
