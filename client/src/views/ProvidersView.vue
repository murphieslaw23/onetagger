<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">PROVIDER REGISTRY / HEALTH</p>
        <h1>Sources stay explicit.</h1>
        <p class="hero-copy">Discovery and enrichment are separate capabilities. Provider state, auth requirements and limits are visible before a job starts.</p>
      </div>
    </header>

    <div class="provider-grid">
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
          <div><dt>LAST CHECK</dt><dd>{{ new Date(provider.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</dd></div>
        </dl>
        <button class="btn" :disabled="checking" @click="refresh"><q-icon :name="checking ? 'mdi-loading mdi-spin' : 'mdi-refresh'" /> Check provider</button>
      </article>
    </div>

    <section class="panel limits-panel">
      <div class="panel-head"><span>DESIGN RULE</span><b>NO INVISIBLE SCRAPING</b></div>
      <p>SoundCloud uses the official API and requires configured credentials. Discogs is enrichment-first and must not force a long mix into a release/track model. Archive.org stays public-API based. Freeteknomusic is crawled as bounded HTTP directory listings and never treated as an FTP server.</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';
import { getProviderHealth } from '../services/api';

const { state } = useMixStore();
const checking = ref(false);

async function refresh() {
  checking.value = true;
  try {
    const health = await getProviderHealth();
    for (const item of health) {
      const provider = state.providers.find((entry) => entry.id === item.id);
      if (!provider) continue;
      provider.state = item.state;
      provider.detail = item.detail;
      provider.lastCheck = item.checkedAt;
    }
  } catch {
    // Vercel/static preview intentionally keeps fixture health when no worker is attached.
  } finally {
    checking.value = false;
  }
}

onMounted(() => void refresh());
</script>
