<template>
  <section class="page" v-if="mix">
    <router-link to="/" class="back-link"><q-icon name="mdi-arrow-left" /> Back to library</router-link>

    <div class="detail-hero">
      <div class="detail-cover">
        <img :src="mix.artwork[0]?.url" :alt="mix.title" />
        <span class="corner-tag">{{ mix.status }}</span>
      </div>
      <div class="detail-title">
        <p class="kicker">{{ mix.recordedAt?.slice(0, 4) || 'DATE UNKNOWN' }} / {{ mix.location || 'LOCATION UNKNOWN' }}</p>
        <h1>{{ mix.title }}</h1>
        <h2>{{ mix.artists.join(' · ') }}</h2>
        <p class="crew-line" v-if="mix.crews.length">{{ mix.crews.join(' / ') }}</p>

        <div class="detail-sources">
          <SourceBadge v-for="source in mix.sources" :key="source.provider" :provider="source.provider" />
        </div>

        <div class="detail-stats">
          <div><span>DURATION</span><strong>{{ duration }}</strong></div>
          <div><span>CONFIDENCE</span><strong>{{ Math.round(mix.confidence * 100) }}%</strong></div>
          <div><span>COMPLETE</span><strong>{{ Math.round(mix.completeness * 100) }}%</strong></div>
          <div><span>LOUDNESS</span><strong>{{ mix.loudnessLufs ? mix.loudnessLufs + ' LUFS' : '—' }}</strong></div>
        </div>
      </div>
    </div>

    <section class="signal-panel">
      <div class="panel-head"><span>ANALYSIS SLOT</span><b>LONGFORM WAVEFORM</b></div>
      <WaveformStrip :playhead="42" />
      <div class="signal-footer">
        <span>{{ mix.bpmRange ? mix.bpmRange.join('–') + ' BPM' : 'BPM pending' }}</span>
        <span>{{ mix.genres.concat(mix.styles).join(' / ') }}</span>
      </div>
    </section>

    <div class="detail-grid">
      <section class="panel">
        <div class="panel-head"><span>CANONICAL RECORD</span><b>METADATA</b></div>
        <dl class="meta-table">
          <div><dt>ARTIST</dt><dd>{{ mix.artists.join(' · ') }}</dd></div>
          <div><dt>CREW / SYSTEM</dt><dd>{{ mix.crews.join(' · ') || '—' }}</dd></div>
          <div><dt>EVENT</dt><dd>{{ mix.event || '—' }}</dd></div>
          <div><dt>VENUE</dt><dd>{{ mix.venue || '—' }}</dd></div>
          <div><dt>LOCATION</dt><dd>{{ mix.location || '—' }}</dd></div>
          <div><dt>RECORDED</dt><dd>{{ mix.recordedAt || '—' }}</dd></div>
        </dl>
        <p class="description">{{ mix.description }}</p>
      </section>

      <section class="panel">
        <div class="panel-head"><span>{{ mix.provenance.length }} CLAIMS</span><b>PROVENANCE</b></div>
        <div class="prov-list">
          <article v-for="item in mix.provenance" :key="item.field + item.provider">
            <SourceBadge :provider="item.provider" />
            <div><strong>{{ item.field }}</strong><small>{{ Math.round(item.confidence * 100) }}% confidence</small></div>
          </article>
        </div>
      </section>
    </div>

    <section class="panel candidate-panel" v-if="pendingCandidates.length">
      <div class="panel-head"><span>{{ pendingCandidates.length }} PENDING</span><b>ENRICHMENT CANDIDATES</b></div>
      <article v-for="candidate in pendingCandidates" :key="candidate.id" class="inline-candidate">
        <div><SourceBadge :provider="candidate.provider" /><strong>{{ Math.round(candidate.confidence * 100) }}%</strong></div>
        <p>{{ candidate.reasons.join(' · ') }}</p>
        <div class="inline-candidate__actions">
          <button class="btn" @click="rejectCandidate(candidate)">Reject</button>
          <button class="btn btn--primary" @click="applyCandidate(mix!, candidate)">Accept</button>
        </div>
      </article>
    </section>
  </section>

  <section v-else class="page empty-state">
    <strong>Mix set not found.</strong>
    <router-link to="/" class="btn">Return to library</router-link>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SourceBadge from '../components/SourceBadge.vue';
import WaveformStrip from '../components/WaveformStrip.vue';
import { useMixStore } from '../composables/useMixStore';

const route = useRoute();
const { findMix, applyCandidate, rejectCandidate } = useMixStore();
const mix = computed(() => findMix(String(route.params.id)));
const pendingCandidates = computed(() => mix.value?.candidates.filter((candidate) => candidate.state === 'pending') ?? []);
const duration = computed(() => {
  if (!mix.value) return '—';
  const total = Math.floor(mix.value.durationMs / 1000);
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
});
</script>
