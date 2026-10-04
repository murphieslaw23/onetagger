<template>
  <section class="page">
    <header class="page-hero">
      <div>
        <p class="kicker">LONGFORM LIBRARY / INDEX 001</p>
        <h1>Mixes, not tracks.</h1>
        <p class="hero-copy">One durable record per long set. Sources stay attached, enrichment fills only missing data automatically, and conflicting claims stay reviewable.</p>
      </div>
      <div class="hero-metrics">
        <div><strong>{{ state.mixes.length }}</strong><span>SETS</span></div>
        <div><strong>{{ reviewCount }}</strong><span>REVIEW</span></div>
        <div><strong>{{ avgConfidence }}%</strong><span>AVG CONF.</span></div>
      </div>
    </header>

    <div class="control-deck">
      <label class="search-field">
        <q-icon name="mdi-magnify" size="20px" />
        <input ref="searchInput" v-model="state.query" placeholder="Search artist, crew, event, place…" aria-label="Search library" />
        <kbd>⌘ K</kbd>
      </label>
      <select v-model="state.source" aria-label="Source filter">
        <option value="all">All sources</option>
        <option value="freeteknomusic">Freeteknomusic</option>
        <option value="soundcloud">SoundCloud</option>
        <option value="archiveorg">Archive.org</option>
        <option value="youtube">YouTube</option>
        <option value="hearthis">hearthis.at</option>
        <option value="discogs">Discogs</option>
      </select>
      <select v-model="state.status" aria-label="Status filter">
        <option value="all">All states</option>
        <option value="ready">Ready</option>
        <option value="review">Review</option>
        <option value="enriching">Enriching</option>
        <option value="error">Error</option>
      </select>
      <router-link class="btn btn--primary" v-if="catalog.state.authenticated" to="/import"><q-icon name="mdi-plus" /> Import signal</router-link>
    </div>

    <div v-if="catalog.state.authenticated && state.selected.size" class="bulk-bar">
      <strong>{{ state.selected.size }} selected</strong>
      <button :disabled="bulkBusy" @click="enrichSelected">
        <q-icon :name="bulkBusy ? 'mdi-loading mdi-spin' : 'mdi-database-sync-outline'" />
        {{ bulkBusy ? 'Enriching…' : 'Enrich missing' }}
      </button>

      <button :disabled="bulkBusy" @click="clearSelection">Clear</button>
    </div>

    <div class="section-heading">
      <div><span>{{ filtered.length }} RECORDS</span><strong>Indexed long-form material</strong></div>
      <span class="mono">SORT / CONFIDENCE ↓</span>
    </div>

    <div class="mix-grid">
      <MixCard
        v-for="mix in filtered"
        :key="mix.id"
        :mix="mix"
        :selected="state.selected.has(mix.id)"
        @toggle="toggleSelected(mix.id)"
      />
    </div>

    <div v-if="!filtered.length" class="empty-state">
      <q-icon name="mdi-radar" size="42px" />
      <strong>No signal matched the current filters.</strong>
      <button class="btn" @click="resetFilters">Reset filters</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch }  from 'vue';
import { useQuasar } from 'quasar';
import MixCard from '../components/MixCard.vue';
import {useCatalogStore} from '../catalog/store';
import { useMixStore } from '../composables/useMixStore';

const $q = useQuasar();
const catalog=useCatalogStore();
let searchTimer:ReturnType<typeof setTimeout>;
watch(()=>state.query,()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void catalog.loadIndex('mix',{q:state.query}).catch(()=>{}),250);});
onMounted(()=>void catalog.loadIndex('mix').catch(()=>{}));
const {
  state,
  filtered,
  reviewCount,
  toggleSelected,
  clearSelection,
  enrichMixRecord,
  markReviewed,
} = useMixStore();

const bulkBusy = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

const avgConfidence = computed(() => state.mixes.length
  ? Math.round(state.mixes.reduce((sum, mix) => sum + mix.confidence, 0) / state.mixes.length * 100)
  : 0);

const selectedMixes = computed(() => state.mixes.filter((mix) => state.selected.has(mix.id)));

function resetFilters() {
  state.query = '';
  state.source = 'all';
  state.status = 'all';
}

async function enrichSelected() {
  if (!selectedMixes.value.length || bulkBusy.value) return;
  bulkBusy.value = true;
  let enriched = 0;
  let failed = 0;
  let fields = 0;
  try {
    for (const mix of selectedMixes.value) {
      try {
        const summary = await enrichMixRecord(mix);
        enriched += 1;
        fields += summary.filledFields.length;
      } catch {
        failed += 1;
      }
    }
    $q.notify({
      type: failed ? 'warning' : 'positive',
      message: `Enrichment complete: ${enriched} mix(es), ${fields} missing field group(s) filled${failed ? `, ${failed} failed` : ''}`,
      position: 'top-right',
      timeout: 5000,
    });
  } finally {
    bulkBusy.value = false;
  }
}

function markSelectedReviewed() {
  let marked = 0;
  let skipped = 0;
  for (const mix of selectedMixes.value) {
    if (markReviewed(mix)) marked += 1;
    else skipped += 1;
  }
  $q.notify({
    type: skipped ? 'warning' : 'positive',
    message: `${marked} record(s) marked reviewed${skipped ? `; ${skipped} skipped because conflicts are still pending` : ''}`,
    position: 'top-right',
    timeout: 5000,
  });
  clearSelection();
}

function onShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

onMounted(() => window.addEventListener('keydown', onShortcut));
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut));
</script>
