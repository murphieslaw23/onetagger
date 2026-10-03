<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">HUMAN REVIEW / PROVENANCE FIRST</p>
        <h1>Accept fields, not guesses.</h1>
        <p class="hero-copy">Candidates remain separate from the canonical set until you accept them. Confidence explains ranking; provenance explains where each field came from.</p>
      </div>
    </header>

    <div class="review-stack" v-if="pending.length">
      <article class="review-card" v-for="{ mix, candidate } in pending" :key="candidate.id">
        <div class="review-card__identity">
          <img :src="mix.artwork[0]?.url" :alt="mix.title" />
          <div>
            <span class="kicker">CANONICAL</span>
            <h2>{{ mix.title }}</h2>
            <p>{{ mix.artists.join(' · ') }} <template v-if="mix.crews.length">/ {{ mix.crews.join(' · ') }}</template></p>
          </div>
        </div>

        <div class="candidate-card">
          <div class="candidate-card__top">
            <SourceBadge :provider="candidate.provider" />
            <strong>{{ Math.round(candidate.confidence * 100) }}% confidence</strong>
          </div>
          <div class="candidate-reasons">
            <span v-for="reason in candidate.reasons" :key="reason"><q-icon name="mdi-check" /> {{ reason }}</span>
          </div>
          <dl class="diff-list">
            <template v-for="(value, key) in candidate.fields" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ display(value) }}</dd>
            </template>
          </dl>
          <div class="review-actions">
            <button class="btn" @click="rejectCandidate(candidate)">Reject</button>
            <button class="btn btn--primary" @click="applyCandidate(mix, candidate)">Accept candidate</button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <q-icon name="mdi-check-decagram-outline" size="42px" />
      <strong>Review queue is clean.</strong>
      <router-link to="/import" class="btn">Discover more mixes</router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';

const { state, applyCandidate, rejectCandidate } = useMixStore();
const pending = computed(() => state.mixes.flatMap((mix) => mix.candidates.filter((candidate) => candidate.state === 'pending').map((candidate) => ({ mix, candidate }))));
const display = (value: unknown) => Array.isArray(value) ? value.join(' · ') : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
</script>
