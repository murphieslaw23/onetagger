<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">PROVIDER REGISTRY / HEALTH</p>
        <h1>Sources stay explicit.</h1>
        <p class="hero-copy">Discovery and enrichment are separate capabilities. Provider state, auth requirements and limits are visible before a job starts.</p>
      </div>
    </header>

    <div class="section-heading provider-toolbar">
      <div>
        <span>{{ readyCount }} READY · {{ limitedCount }} LIMITED/OFFLINE</span>
        <strong>Provider health</strong>
      </div>
      <button class="btn" :disabled="checking" @click="refresh">
        <q-icon :name="checking ? 'mdi-loading mdi-spin' : 'mdi-refresh'" />
        {{ checking ? 'Checking registry…' : 'Refresh registry' }}
      </button>
    </div>

    <div class="provider-grid provider-grid--flush">
      <article v-for="provider in state.providers" :key="provider.id" class="provider-card">
        <div class="provider-card__top">
          <SourceBadge :provider="provider.id" />
          <span class="state-pill" :data-state="provider.state">{{ provider.state }}</span>
        </div>
        <h2>{{ provider.name }}</h2>
        <p>{{ provider.detail }}</p>
        <dl>
          <div><dt>MODE</dt><dd>{{ provider.mode }}</dd></div>
          <div><dt>AUTH</dt><dd>{{ provider.auth }}</dd></div>
          <div><dt>LAST CHECK</dt><dd>{{ formatCheck(provider.lastCheck) }}</dd></div>
        </dl>
      </article>
    </div>

    <section class="panel limits-panel">
      <div class="panel-head"><span>INDEXING RULE</span><b>NO INVISIBLE SCRAPING</b></div>
      <p>SoundCloud uses the official API and needs valid credentials. Discogs is enrichment-first and never forces a long mix into a release/track model. Archive.org stays public-API based. Freeteknomusic is crawled as bounded HTTP directory listings and is never treated as an FTP server.</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';
import { getProviderHealth } from '../services/api';

const { state, updateProviderHealth, setApiState } = useMixStore();
const checking = ref(false);
const readyCount = computed(() => state.providers.filter((provider) => provider.state === 'ready').length);
const limitedCount = computed(() => state.providers.length - readyCount.value);

function formatCheck(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function refresh() {
  checking.value = true;
  try {
    const health = await getProviderHealth();
    updateProviderHealth(health);
    setApiState('online');
  } catch {
    setApiState('offline');
  } finally {
    checking.value = false;
  }
}

onMounted(() => void refresh());
</script>
