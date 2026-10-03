<template>
  <section class="page">
    <header class="page-hero">
      <div>
        <p class="kicker">LONGFORM LIBRARY / INDEX 001</p>
        <h1>Mixes, not tracks.</h1>
        <p class="hero-copy">One durable record per long set. Sources stay attached, enrichment stays reviewable, and every accepted field keeps its provenance.</p>
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
        <input v-model="state.query" placeholder="Search artist, crew, event, place…" />
        <kbd>⌘ K</kbd>
      </label>
      <select v-model="state.source" aria-label="Source filter">
        <option value="all">All sources</option>
        <option value="freeteknomusic">Freeteknomusic</option>
        <option value="soundcloud">SoundCloud</option>
        <option value="archiveorg">Archive.org</option>
        <option value="discogs">Discogs</option>
      </select>
      <select v-model="state.status" aria-label="Status filter">
        <option value="all">All states</option>
        <option value="ready">Ready</option>
        <option value="review">Review</option>
        <option value="enriching">Enriching</option>
      </select>
      <router-link class="btn btn--primary" to="/import"><q-icon name="mdi-plus" /> Import signal</router-link>
    </div>

    <div v-if="state.selected.size" class="bulk-bar">
      <strong>{{ state.selected.size }} selected</strong>
      <button>Queue enrichment</button>
      <button>Mark reviewed</button>
      <button @click="clearSelection">Clear</button>
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
      <button class="btn" @click="state.query = ''; state.source = 'all'; state.status = 'all'">Reset filters</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MixCard from '../components/MixCard.vue';
import { useMixStore } from '../composables/useMixStore';

const { state, filtered, reviewCount, toggleSelected, clearSelection } = useMixStore();
const avgConfidence = computed(() => Math.round(state.mixes.reduce((s, mix) => s + mix.confidence, 0) / state.mixes.length * 100));
</script>
