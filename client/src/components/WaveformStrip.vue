<template>
  <div class="waveform" aria-label="Waveform analysis placeholder">
    <span v-for="(height, index) in bars" :key="index" :style="{ height: height + '%' }" />
    <div class="waveform__playhead" :style="{ left: playhead + '%' }" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ playhead?: number }>(), { playhead: 36 });
const bars = Array.from({ length: 96 }, (_, i) => 18 + ((i * 37 + i * i * 7) % 78));
</script>
