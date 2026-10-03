<template>
  <article class="mix-card" :class="{ 'mix-card--selected': selected }">
    <button class="selection-dot" :aria-label="'Select ' + mix.title" @click.stop="$emit('toggle')">
      <q-icon :name="selected ? 'mdi-check' : 'mdi-circle-outline'" />
    </button>
    <router-link class="mix-card__cover" :to="'/mix/' + mix.id">
      <img :src="mix.artwork[0]?.url" :alt="mix.title" />
      <span class="duration">{{ duration }}</span>
    </router-link>
    <div class="mix-card__body">
      <div class="eyebrow">{{ mix.recordedAt?.slice(0, 4) || 'DATE UNKNOWN' }} · {{ mix.status.toUpperCase() }}</div>
      <router-link class="mix-card__title" :to="'/mix/' + mix.id">{{ mix.title }}</router-link>
      <div class="mix-card__artist">{{ mix.artists.join(' · ') }}</div>
      <div class="mix-card__crew" v-if="mix.crews.length">{{ mix.crews.join(' / ') }}</div>
      <div class="mix-card__meta">
        <SourceBadge v-for="source in mix.sources" :key="source.provider" :provider="source.provider" />
      </div>
      <div class="quality-row">
        <span>confidence {{ Math.round(mix.confidence * 100) }}%</span>
        <span>complete {{ Math.round(mix.completeness * 100) }}%</span>
      </div>
      <div class="quality-track"><i :style="{ width: (mix.confidence * 100) + '%' }" /></div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MixSet } from '../domain/types';
import SourceBadge from './SourceBadge.vue';

const props = defineProps<{ mix: MixSet; selected?: boolean }>();
defineEmits<{ toggle: [] }>();

const duration = computed(() => {
  const total = Math.floor(props.mix.durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
});
</script>
