<template>
  <section class="page">
    <header class="page-hero page-hero--compact">
      <div>
        <p class="kicker">HUMAN REVIEW / PROVENANCE FIRST</p>
        <h1>Accept fields, not guesses.</h1>
        <p class="hero-copy">Provider conflicts stay separate from the canonical set until you accept them. Low-confidence records without field conflicts also remain visible here until explicitly reviewed.</p>
      </div>
    </header>

    <div class="review-stack" v-if="pending.length">
      <article class="review-card" v-for="{ mix, candidate } in pending" :key="candidate.id">
        <div class="review-card__identity">
          <ArtworkFrame :src="mix.artwork[0]?.url" :alt="mix.title" />
          <div>
            <span class="kicker">CANONICAL</span>
            <router-link :to="'/mix/' + encodeURIComponent(mix.id)" class="review-title-link">
              <h2>{{ mix.title }}</h2>
            </router-link>
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
            <button class="btn" @click="rejectCandidate(candidate, mix)">Reject</button>
            <button class="btn btn--primary" @click="applyCandidate(mix, candidate)">Accept candidate</button>
          </div>
        </div>
      </article>
    </div>

    <section v-if="recordReviews.length" class="panel record-review-panel">
      <div class="panel-head"><span>{{ recordReviews.length }} RECORDS</span><b>LOW-CONFIDENCE CANONICAL REVIEW</b></div>
      <article v-for="mix in recordReviews" :key="mix.id" class="record-review-row">
        <ArtworkFrame :src="mix.artwork[0]?.url" :alt="mix.title" />
        <div class="record-review-row__body">
          <span class="kicker">{{ Math.round(mix.confidence * 100) }}% confidence · {{ Math.round(mix.completeness * 100) }}% complete</span>
          <router-link :to="'/mix/' + encodeURIComponent(mix.id)"><strong>{{ mix.title }}</strong></router-link>
          <small>{{ mix.artists.join(' · ') || 'Unknown artist' }}</small>
        </div>
        <router-link :to="'/mix/' + encodeURIComponent(mix.id)" class="btn">Inspect</router-link>
        <button class="btn btn--primary" @click="markReviewed(mix)">Mark reviewed</button>
      </article>
    </section>

    <div v-if="!pending.length && !recordReviews.length" class="empty-state">
      <q-icon name="mdi-check-decagram-outline" size="42px" />
      <strong>Review queue is clean.</strong>
      <router-link to="/import" class="btn">Discover more mixes</router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ArtworkFrame from '../components/ArtworkFrame.vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useMixStore } from '../composables/useMixStore';

const { state, applyCandidate, rejectCandidate, markReviewed } = useMixStore();

const pending = computed(() => state.mixes.flatMap((mix) =>
  mix.candidates
    .filter((candidate) => candidate.state === 'pending')
    .map((candidate) => ({ mix, candidate })),
));

const recordReviews = computed(() => state.mixes.filter((mix) =>
  mix.status === 'review' && !mix.candidates.some((candidate) => candidate.state === 'pending'),
));

const display = (value: unknown) => Array.isArray(value)
  ? value.join(' · ')
  : typeof value === 'object'
    ? JSON.stringify(value)
    : String(value ?? '—');
</script>
