<template>
  <div class="waveform" :class="{ 'waveform--empty': !available }" :aria-label="available ? 'Waveform analysis' : 'Waveform analysis pending'">
    <template v-if="available">
      <span v-for="(height, index) in bars" :key="index" :style="{ height: height + '%' }" />
      <div v-if="playhead !== undefined" class="waveform__playhead" :style="{ left: playhead + '%' }" />
    </template>
    <div v-else class="waveform__empty">
      <q-icon name="mdi-waveform" size="28px" />
      <strong>Waveform not analyzed yet</strong>
      <small>Audio analysis stays separate from metadata discovery.</small>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ playhead?: number; available?: boolean }>(), { available: false });
const bars = Array.from({ length: 96 }, (_, i) => 18 + ((i * 37 + i * i * 7) % 78));
</script>
